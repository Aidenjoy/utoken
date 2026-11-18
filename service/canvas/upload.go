package canvas

import (
	"bytes"
	"errors"
	"fmt"
	"path"
	"strings"
)

// ===== 智能画布：用户上传图片 =====

// CanvasUpload 上传后的图片信息。前端据此建立图层并记录原始像素尺寸，
// 后续蒙版尺寸、扩图比例都以此为准。
type CanvasUpload struct {
	URL    string `json:"url"`
	Name   string `json:"name"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Format string `json:"format"`
	Bytes  int64  `json:"bytes"`
}

// 允许上传的图片格式（与 DecodeImageConfig 注册的格式保持一致）。
var canvasUploadFormats = map[string]string{
	"png":  "png",
	"jpeg": "jpg",
	"gif":  "gif",
	"bmp":  "bmp",
	"webp": "webp",
}

// sanitizeCanvasFilename 生成对象存储用的安全文件名：
// 去掉路径分隔符与控制字符，限制长度，并按真实格式纠正扩展名。
func sanitizeCanvasFilename(raw, ext string) string {
	base := path.Base(strings.TrimSpace(raw))
	// path.Base("") == "."，path.Base("../") == ".."，都不是可用的文件名
	if base == "." || base == ".." {
		base = ""
	}
	if idx := strings.LastIndexByte(base, '.'); idx > 0 {
		base = base[:idx]
	}
	base = strings.Map(func(r rune) rune {
		switch {
		case r < 0x20 || r == 0x7f:
			return -1
		case r == '/' || r == '\\' || r == ':' || r == '*' || r == '?' ||
			r == '"' || r == '<' || r == '>' || r == '|':
			return '_'
		default:
			return r
		}
	}, base)
	base = strings.TrimSpace(base)
	if base == "" {
		base = "canvas_upload"
	}
	if runes := []rune(base); len(runes) > 40 {
		base = string(runes[:40])
	}
	return fmt.Sprintf("%s.%s", base, ext)
}

// UploadImage 校验并保存一张用户上传的图片。
// 校验项与任务提交时的输入校验保持一致（格式、体积、单边像素），
// 避免出现「能上传、提交任务时却被拒」的割裂。
func UploadImage(userID, projectID int, filename string, data []byte) (CanvasUpload, error) {
	if len(data) == 0 {
		return CanvasUpload{}, errors.New("文件内容为空")
	}
	if int64(len(data)) > maxUploadBytes() {
		return CanvasUpload{}, fmt.Errorf("图片超过体积上限 %dMB", maxUploadBytes()>>20)
	}
	info, err := DecodeImageConfig(bytes.NewReader(data))
	if err != nil {
		return CanvasUpload{}, err
	}
	ext, ok := canvasUploadFormats[info.Format]
	if !ok || info.Width <= 0 || info.Height <= 0 {
		return CanvasUpload{}, ErrUnsupportedImage
	}
	if info.Width > maxCanvasSide || info.Height > maxCanvasSide {
		return CanvasUpload{}, fmt.Errorf("图片单边上限 %dpx，当前 %dx%d",
			maxCanvasSide, info.Width, info.Height)
	}
	name := sanitizeCanvasFilename(filename, ext)
	url, err := storeBytesFromCanvas(data, name, userID, projectID)
	if err != nil {
		return CanvasUpload{}, err
	}
	return CanvasUpload{
		URL:    url,
		Name:   name,
		Width:  info.Width,
		Height: info.Height,
		Format: info.Format,
		Bytes:  int64(len(data)),
	}, nil
}
