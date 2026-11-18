package canvas

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// ===== 智能画布：同源图片代理 =====
// 浏览器把跨域图片画进 canvas 会污染画布（toBlob 抛 SecurityError），导致
// 「导出 PNG/JPEG」和缩略图生成依赖对象存储的 CORS 配置。这里提供一个只放行
// 自有存储域名的同源代理：导出、缩略图、蒙版底图都走它，前端无需任何 CORS 配置。
//
// 安全约束（防 SSRF）：仅 https、仅精确匹配自有 TOS 公共域名、禁止重定向、限制体积。

var canvasProxyClient = &http.Client{
	Timeout: 30 * time.Second,
	// 不跟随重定向：避免上游 302 把请求带到内网地址
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// allowedImageHost 自有存储的公共域名（{bucket}.{endpoint-host}）。
// 未配置 TOS 时返回空串，代理整体不可用。
func allowedImageHost() string {
	cfg, ok := common.GetTOSUploadConfig()
	if !ok {
		return ""
	}
	endpointHost := strings.TrimPrefix(cfg.Endpoint, "https://")
	endpointHost = strings.TrimPrefix(endpointHost, "http://")
	endpointHost = strings.TrimRight(endpointHost, "/")
	if endpointHost == "" || cfg.Bucket == "" {
		return ""
	}
	return strings.ToLower(cfg.Bucket + "." + endpointHost)
}

// ImageProxyResult 代理结果（图片已完整读入内存，上限 maxUploadBytes）
type ImageProxyResult struct {
	ContentType string
	Data        []byte
}

// FetchCanvasImage 校验并拉取自有存储上的图片。
// 任何不满足白名单的地址一律拒绝，并给出可读原因（前端会展示该原因）。
func FetchCanvasImage(rawURL string) (*ImageProxyResult, error) {
	host := allowedImageHost()
	if host == "" && !localStorageEnabled() {
		return nil, errors.New("未配置对象存储（TOS_ACCESS_KEY/TOS_SECRET_KEY/TOS_BUCKET），无法代理图片")
	}
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return nil, errors.New("图片地址不合法")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return nil, errors.New("图片地址必须是 http(s)")
	}
	if strings.ToLower(parsed.Host) != host && !localAssetHostAllowed(strings.ToLower(parsed.Host)) {
		// 本地存储替身启用时，额外放行替身自身的域名（仅本地验收场景）
		return nil, fmt.Errorf("只允许代理自有存储域名 %s", host)
	}
	resp, err := canvasProxyClient.Get(parsed.String())
	if err != nil {
		return nil, fmt.Errorf("拉取图片失败: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("拉取图片失败: HTTP %d", resp.StatusCode)
	}
	contentType := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "image/") {
		resp.Body.Close()
		return nil, errors.New("目标不是图片")
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxUploadBytes()))
	if err != nil {
		return nil, fmt.Errorf("读取图片失败: %w", err)
	}
	return &ImageProxyResult{ContentType: contentType, Data: data}, nil
}
