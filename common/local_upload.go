package common

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

// 本地上传回退：未配置 TOS 的自托管部署仍可上传画布/素材文件。
// 文件落盘 upload/local/{userID}_{uuid}{ext}，经 /api/local-file/{name}
// 会话鉴权访问（仅归属用户可读），不暴露目录列表。

const LocalUploadDir = "upload/local"

var localUploadNamePattern = regexp.MustCompile(`^(\d+)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$`)

var localUploadExts = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".gif": true, ".bmp": true,
	".mp4": true, ".mov": true, ".webm": true, ".mkv": true, ".avi": true,
	".mp3": true, ".wav": true, ".m4a": true, ".aac": true, ".ogg": true, ".flac": true,
}

// SaveUploadLocal 落盘上传文件并返回站内访问 URL（扩展名白名单校验）
func SaveUploadLocal(content []byte, filename string, userID int) (string, error) {
	ext := strings.ToLower(filepath.Ext(filename))
	if !localUploadExts[ext] {
		return "", fmt.Errorf("unsupported file type: %s", ext)
	}
	if err := os.MkdirAll(LocalUploadDir, 0o755); err != nil {
		return "", err
	}
	name := fmt.Sprintf("%d_%s%s", userID, uuid.NewString(), ext)
	if err := os.WriteFile(filepath.Join(LocalUploadDir, name), content, 0o644); err != nil {
		return "", err
	}
	return "/api/local-file/" + name, nil
}

// LocalUploadPath 校验文件名合法性，返回磁盘路径与归属用户 ID
func LocalUploadPath(name string) (string, int, bool) {
	m := localUploadNamePattern.FindStringSubmatch(name)
	if m == nil {
		return "", 0, false
	}
	owner, err := strconv.Atoi(m[1])
	if err != nil {
		return "", 0, false
	}
	return filepath.Join(LocalUploadDir, name), owner, true
}
