package canvas

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ===== 智能画布：本地存储替身（仅用于本地验收）=====
// 设置 CANVAS_LOCAL_STORAGE_DIR 后，画布产物写入该目录，并通过
// /api/canvas/local-asset/<相对路径> 提供访问；这样可以在不配置、也不触碰
// 真实对象存储的前提下跑通「上传 → 生成 → 转存 → 导出」全链路。
// 未设置该变量时完全沿用生产路径（TOS），不存在任何默认回退。
// 可选 CANVAS_LOCAL_STORAGE_BASE 指定对外可访问的基地址（默认取本机回环地址），
// 因为服务端自身需要通过 HTTP 读取这些图片的像素信息。

const envCanvasLocalStorageDir = "CANVAS_LOCAL_STORAGE_DIR"

var canvasLocalAssetExts = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".bmp": true, ".webp": true,
}

// localStorageEnabled 是否启用了本地存储替身
func localStorageEnabled() bool { return localStorageDir() != "" }

func localStorageDir() string {
	return strings.TrimSpace(os.Getenv(envCanvasLocalStorageDir))
}

func localAssetBaseURL() string {
	if v := strings.TrimSpace(os.Getenv("CANVAS_LOCAL_STORAGE_BASE")); v != "" {
		return strings.TrimRight(v, "/")
	}
	return relayBaseURL()
}

// storeToLocalStorage 写入本地目录，返回可访问 URL 与相对路径。
func storeToLocalStorage(dir string, data []byte, filename string) (string, string, error) {
	if len(data) == 0 {
		return "", "", errors.New("空文件内容")
	}
	ext := strings.ToLower(filepath.Ext(filename))
	if !canvasLocalAssetExts[ext] {
		return "", "", fmt.Errorf("本地存储替身不接受的文件类型: %s", ext)
	}
	rel := filepath.Join(time.Now().Format("2006-01-02"), sanitizeCanvasFilename(filename, strings.TrimPrefix(ext, ".")))
	full := filepath.Join(dir, rel)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return "", "", err
	}
	if err := os.WriteFile(full, data, 0o644); err != nil {
		return "", "", err
	}
	urlPath := strings.ReplaceAll(rel, string(filepath.Separator), "/")
	return localAssetBaseURL() + "/api/canvas/local-asset/" + urlPath, urlPath, nil
}

// FetchLocalAsset 读取本地替身文件（供 /api/canvas/local-asset 使用）。
// 只允许访问配置目录内的图片，拒绝路径穿越。
func FetchLocalAsset(relPath string) (string, []byte, error) {
	dir := localStorageDir()
	if dir == "" {
		return "", nil, errors.New("本地存储替身未启用")
	}
	clean := filepath.Clean(strings.ReplaceAll(strings.TrimPrefix(relPath, "/"), "/", string(filepath.Separator)))
	if clean == "." || strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		return "", nil, errors.New("非法路径")
	}
	if !canvasLocalAssetExts[strings.ToLower(filepath.Ext(clean))] {
		return "", nil, errors.New("不支持的文件类型")
	}
	full := filepath.Join(dir, clean)
	absDir, err := filepath.Abs(dir)
	if err != nil {
		return "", nil, err
	}
	absFile, err := filepath.Abs(full)
	if err != nil {
		return "", nil, err
	}
	if !strings.HasPrefix(absFile, absDir+string(filepath.Separator)) {
		return "", nil, errors.New("非法路径")
	}
	data, err := os.ReadFile(absFile)
	if err != nil {
		return "", nil, err
	}
	contentType := "image/png"
	switch strings.ToLower(filepath.Ext(clean)) {
	case ".jpg", ".jpeg":
		contentType = "image/jpeg"
	case ".gif":
		contentType = "image/gif"
	case ".bmp":
		contentType = "image/bmp"
	case ".webp":
		contentType = "image/webp"
	}
	return contentType, data, nil
}

// localAssetPathFor 把本地替身的 URL 还原成本机文件路径。
// 服务端自己读图（像素探测/转存）时直接读盘，避免再走一次带鉴权的 HTTP 回环。
func localAssetPathFor(rawURL string) (string, bool) {
	if !localStorageEnabled() {
		return "", false
	}
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return "", false
	}
	base, err := url.Parse(localAssetBaseURL())
	if err != nil {
		return "", false
	}
	if !strings.EqualFold(parsed.Host, base.Host) {
		return "", false
	}
	const prefix = "/api/canvas/local-asset/"
	if !strings.HasPrefix(parsed.Path, prefix) {
		return "", false
	}
	rel := strings.TrimPrefix(parsed.Path, prefix)
	dir := localStorageDir()
	clean := filepath.Clean(filepath.Join(dir, strings.ReplaceAll(rel, "/", string(filepath.Separator))))
	absDir, err := filepath.Abs(dir)
	if err != nil {
		return "", false
	}
	absFile, err := filepath.Abs(clean)
	if err != nil {
		return "", false
	}
	if !strings.HasPrefix(absFile, absDir+string(filepath.Separator)) {
		return "", false
	}
	return absFile, true
}

// localAssetHostAllowed 判断给定 host 是否属于本地存储替身（供图片代理放行）。
func localAssetHostAllowed(host string) bool {
	if !localStorageEnabled() {
		return false
	}
	base := localAssetBaseURL()
	trimmed := strings.TrimPrefix(strings.TrimPrefix(base, "https://"), "http://")
	if slash := strings.IndexByte(trimmed, '/'); slash >= 0 {
		trimmed = trimmed[:slash]
	}
	return host == trimmed
}
