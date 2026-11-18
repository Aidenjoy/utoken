package canvas

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/webp"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// ===== 智能画布：图片与蒙版处理 =====

var canvasHTTPClient = &http.Client{Timeout: 60 * time.Second}

var (
	// ErrMaskSizeMismatch 蒙版尺寸与原图不一致（工具要求逐像素对齐）。
	ErrMaskSizeMismatch = errors.New("mask size mismatch")
	// ErrUnsupportedImage 无法识别的图片格式。
	ErrUnsupportedImage = errors.New("unsupported image format")
)

// ImageInfo 图片像素信息
type ImageInfo struct {
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Format string `json:"format"`
	Bytes  int64  `json:"bytes"`
}

// DecodeImageConfig 读取图片宽高与格式（只解析头部，不解码像素）。
func DecodeImageConfig(r io.Reader) (ImageInfo, error) {
	cfg, format, err := image.DecodeConfig(r)
	if err != nil {
		return ImageInfo{}, ErrUnsupportedImage
	}
	return ImageInfo{Width: cfg.Width, Height: cfg.Height, Format: format}, nil
}

// fetchRemoteImageInfo 读取远程图片的像素信息。只读取解码头部所需的字节，
// 并用 maxUploadBytes 兜住恶意/超大响应，避免把整张大图拉进内存。
func fetchRemoteImageInfo(url string) (ImageInfo, error) {
	if !isHTTPURL(url) {
		return ImageInfo{}, fmt.Errorf("图片地址不可直接读取: %s", url)
	}
	// 本地存储替身的图片直接读盘：它挂在鉴权接口后面，自请求会 401
	if localPath, ok := localAssetPathFor(url); ok {
		file, err := os.Open(localPath)
		if err != nil {
			return ImageInfo{}, fmt.Errorf("读取图片失败: %w", err)
		}
		defer file.Close()
		info, err := DecodeImageConfig(file)
		if err != nil {
			return ImageInfo{}, err
		}
		if stat, statErr := file.Stat(); statErr == nil {
			info.Bytes = stat.Size()
		}
		return info, nil
	}
	resp, err := canvasHTTPClient.Get(url)
	if err != nil {
		return ImageInfo{}, fmt.Errorf("读取图片失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ImageInfo{}, fmt.Errorf("读取图片失败: HTTP %d", resp.StatusCode)
	}
	limited := io.LimitReader(resp.Body, maxUploadBytes())
	info, err := DecodeImageConfig(limited)
	if err != nil {
		return ImageInfo{}, err
	}
	info.Bytes = resp.ContentLength
	return info, nil
}

func isHTTPURL(u string) bool {
	return strings.HasPrefix(u, "http://") || strings.HasPrefix(u, "https://")
}

// decodeDataURL 解析 data:image/...;base64,xxx 形式的图片载荷。
func decodeDataURL(payload string) ([]byte, error) {
	payload = strings.TrimSpace(payload)
	if !strings.HasPrefix(payload, "data:") {
		return nil, errors.New("不是合法的 data URL")
	}
	comma := strings.IndexByte(payload, ',')
	if comma < 0 {
		return nil, errors.New("data URL 缺少数据段")
	}
	header := payload[:comma]
	if !strings.Contains(header, "base64") {
		return nil, errors.New("仅支持 base64 编码的 data URL")
	}
	raw := payload[comma+1:]
	data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		return nil, fmt.Errorf("解码图片数据失败: %w", err)
	}
	return data, nil
}

// canvasBatchID TOS 对象键的批次段：同一画布项目的产出物归档到同一目录。
func canvasBatchID(projectID int) string {
	if projectID > 0 {
		return fmt.Sprintf("canvas%d", projectID)
	}
	return "canvas"
}

// uploadToStorage 把字节流写入对象存储并返回可访问 URL。
// 生产实现为自有 TOS；测试注入本地存储替身，避免测试链路依赖真实云存储凭证。
// CANVAS_LOCAL_STORAGE_DIR 显式开启本地替身时走本地目录（本地验收用），
// 未开启时行为与之前完全一致。
var uploadToStorage = func(data []byte, filename string, userID, projectID int) (string, error) {
	if dir := localStorageDir(); dir != "" {
		url, _, err := storeToLocalStorage(dir, data, filename)
		return url, err
	}
	url, _, err := common.UploadBytesToTOS(data, filename, userID, canvasBatchID(projectID))
	return url, err
}

// storeBytesFromCanvas 上传字节流到对象存储，返回可访问 URL。
func storeBytesFromCanvas(data []byte, filename string, userID, projectID int) (string, error) {
	if len(data) == 0 {
		return "", errors.New("空文件内容")
	}
	return uploadToStorage(data, filename, userID, projectID)
}

// storeRemoteToCanvasBucket 把上游临时结果（有效期通常 24h）转存到自有 TOS，
// 防止素材在用户下次打开画布时失效。
func storeRemoteToCanvasBucket(remoteURL, filename string, userID, projectID int) (string, error) {
	if !isHTTPURL(remoteURL) {
		return "", fmt.Errorf("结果地址不可直接读取: %s", remoteURL)
	}
	// 本地存储替身的结果直接读盘复制，避免自请求 401
	if localPath, ok := localAssetPathFor(remoteURL); ok {
		data, err := os.ReadFile(localPath)
		if err != nil {
			return "", fmt.Errorf("读取结果失败: %w", err)
		}
		return storeBytesFromCanvas(data, filename, userID, projectID)
	}
	resp, err := canvasHTTPClient.Get(remoteURL)
	if err != nil {
		return "", fmt.Errorf("下载结果失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("下载结果失败: HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxUploadBytes()))
	if err != nil {
		return "", err
	}
	return storeBytesFromCanvas(data, filename, userID, projectID)
}

// storeMaskToTOS 校验并转存蒙版：蒙版必须是图片，且尺寸与工具要求的原图尺寸逐像素一致。
// 返回可公开访问的蒙版 URL 与蒙版尺寸。
func storeMaskToTOS(maskPayload string, expectedWidth, expectedHeight, userID, projectID int) (string, ImageInfo, error) {
	data, err := decodeDataURL(maskPayload)
	if err != nil {
		return "", ImageInfo{}, err
	}
	if int64(len(data)) > maxUploadBytes() {
		return "", ImageInfo{}, fmt.Errorf("蒙版超过体积上限 %dMB", maxUploadBytes()>>20)
	}
	info, err := DecodeImageConfig(bytes.NewReader(data))
	if err != nil {
		return "", ImageInfo{}, err
	}
	if expectedWidth > 0 && expectedHeight > 0 {
		if info.Width != expectedWidth || info.Height != expectedHeight {
			return "", ImageInfo{}, fmt.Errorf("%w: 蒙版 %dx%d，原图 %dx%d",
				ErrMaskSizeMismatch, info.Width, info.Height, expectedWidth, expectedHeight)
		}
	}
	url, err := storeBytesFromCanvas(data, fmt.Sprintf("mask_%d.png", time.Now().UnixNano()), userID, projectID)
	if err != nil {
		return "", ImageInfo{}, err
	}
	return url, info, nil
}

// resolveTaskImages 解析任务输入图：既接受自有 TOS/公网 URL，也接受素材库引用
// （asset:<refId> 或素材库记录的 https URL）。返回真实可访问地址与像素信息。
// 归属校验：素材库引用必须是当前用户（或同企业共享）的素材，避免越权读取他人私有资源。
func resolveTaskImages(userID int, inputs []string) ([]string, []ImageInfo, error) {
	if len(inputs) > maxCanvasRefImages {
		return nil, nil, fmt.Errorf("参考图最多 %d 张", maxCanvasRefImages)
	}
	urls := make([]string, 0, len(inputs))
	infos := make([]ImageInfo, 0, len(inputs))
	for _, raw := range inputs {
		input := strings.TrimSpace(raw)
		if input == "" {
			return nil, nil, errors.New("图片地址不能为空")
		}
		url := input
		if refID, ok := strings.CutPrefix(input, "asset:"); ok {
			asset, err := model.GetSourceAssetByRefId(strings.TrimSpace(refID))
			if err != nil {
				return nil, nil, fmt.Errorf("素材不存在: %s", refID)
			}
			if asset.UserID != userID {
				return nil, nil, fmt.Errorf("素材不存在: %s", refID)
			}
			url = asset.SourceURL
		}
		if !isHTTPURL(url) {
			return nil, nil, fmt.Errorf("不支持的图片地址: %s", url)
		}
		info, err := fetchRemoteImageInfo(url)
		if err != nil {
			return nil, nil, err
		}
		if info.Width*info.Height > maxCanvasSide*maxCanvasSide {
			return nil, nil, fmt.Errorf("图片像素过大（上限 %dx%d）", maxCanvasSide, maxCanvasSide)
		}
		urls = append(urls, url)
		infos = append(infos, info)
	}
	return urls, infos, nil
}
