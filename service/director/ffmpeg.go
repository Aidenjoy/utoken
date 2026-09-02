package director

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ffmpeg 完整版的常见安装位置（Homebrew ffmpeg-full 为 keg-only，不在 PATH 中）；
// 精简版 ffmpeg 未编译 libass/freetype，字幕滤镜不可用，故优先选完整版。
// 可用 FFMPEG_BIN 环境变量直接指定二进制。
var ffmpegFullCandidates = []string{
	"/usr/local/opt/ffmpeg-full/bin/ffmpeg",
	"/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg",
	"/usr/local/bin/ffmpeg",
	"/usr/bin/ffmpeg",
}

var (
	ffmpegPathOnce  sync.Once
	ffmpegPathValue string
	ffmpegPathErr   error
)

// ffmpegPath 检测 ffmpeg 可执行文件：优先选择支持字幕滤镜（ass/drawtext）的二进制
func ffmpegPath() (string, error) {
	ffmpegPathOnce.Do(func() {
		hasSubtitleFilter := func(bin string) bool {
			out, err := exec.Command(bin, "-hide_banner", "-filters").Output()
			if err != nil {
				return false
			}
			s := string(out)
			return strings.Contains(s, " ass ") || strings.Contains(s, " drawtext ")
		}
		// 环境变量指定的二进制优先
		if bin := strings.TrimSpace(os.Getenv("FFMPEG_BIN")); bin != "" {
			if _, err := os.Stat(bin); err == nil {
				ffmpegPathValue = bin
				return
			}
		}
		// 首选：带字幕滤镜的候选
		for _, bin := range ffmpegFullCandidates {
			if _, err := os.Stat(bin); err == nil && hasSubtitleFilter(bin) {
				ffmpegPathValue = bin
				return
			}
		}
		// 降级：PATH 中的 ffmpeg（无字幕能力时渲染仍可继续，仅跳过字幕）
		if p, err := exec.LookPath("ffmpeg"); err == nil {
			ffmpegPathValue = p
			return
		}
		ffmpegPathErr = errors.New("服务器未安装 ffmpeg，无法执行视频渲染/拼接")
	})
	return ffmpegPathValue, ffmpegPathErr
}

// materializeToLocal 将远程 URL 下载为本地文件；本地路径直接使用
func materializeToLocal(rawURL, workDir, filename string) (string, error) {
	if rawURL == "" {
		return "", errors.New("素材地址为空")
	}
	if !strings.HasPrefix(rawURL, "http://") && !strings.HasPrefix(rawURL, "https://") {
		return rawURL, nil
	}
	client := &http.Client{Timeout: 300 * time.Second}
	resp, err := client.Get(rawURL)
	if err != nil {
		return "", fmt.Errorf("下载素材失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("下载素材失败，状态码 %d", resp.StatusCode)
	}
	localPath := filepath.Join(workDir, filename)
	out, err := os.Create(localPath)
	if err != nil {
		return "", err
	}
	defer out.Close()
	if _, err = io.Copy(out, resp.Body); err != nil {
		return "", err
	}
	return localPath, nil
}

// ffmpegTail 截取 ffmpeg 输出的末尾（真正的报错信息在最后，banner 在最前）
func ffmpegTail(output []byte) string {
	s := string(output)
	const n = 2000
	if len(s) > n {
		return "..." + s[len(s)-n:]
	}
	return s
}

// escapeAssPath 转义 ass 滤镜中的路径（Windows 盘符与分隔符）
func escapeAssPath(p string) string {
	p = strings.ReplaceAll(p, "\\", "/")
	p = strings.ReplaceAll(p, ":", "\\:")
	p = strings.ReplaceAll(p, "'", "\\'")
	return p
}

// 检测 ffmpeg 滤镜能力（部分精简版 ffmpeg 未编译 libass，ass 字幕滤镜不可用）
var (
	filterDetectOnce sync.Once
	ffmpegHasAss     bool
)

func detectFFmpegFilters() {
	filterDetectOnce.Do(func() {
		ffmpeg, err := ffmpegPath()
		if err != nil {
			return
		}
		out, err := exec.Command(ffmpeg, "-hide_banner", "-filters").Output()
		if err != nil {
			return
		}
		ffmpegHasAss = strings.Contains(string(out), " ass ")
	})
}
