package director

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// ===== 云导演：网关回环调用 =====
// 所有 AI 调用不直连任何第三方，而是带着用户专属内部令牌
// 回环请求网关自身的 /v1/* 端点：限额、计费、日志与真实请求完全一致，
// 费用计到调用者本人账户。

// relayBaseURL 回环地址：默认本机网关监听地址，可用 DIRECTOR_RELAY_BASE 覆盖
func relayBaseURL() string {
	if base := strings.TrimSpace(os.Getenv("DIRECTOR_RELAY_BASE")); base != "" {
		return strings.TrimRight(base, "/")
	}
	port := os.Getenv("PORT")
	if port == "" && common.Port != nil {
		port = strconv.Itoa(*common.Port)
	}
	if port == "" {
		port = "3000"
	}
	return "http://127.0.0.1:" + port
}

// directorCallConfig 一次回环调用所需的鉴权与模型配置
type directorCallConfig struct {
	APIKey string // 用户内部令牌（Bearer）
	Model  string // 用户模型设定中对应服务的模型名
}

// getDirectorTextConfig 文本服务回环配置（未设置文本模型时报错引导）
func getDirectorTextConfig(userID int) (directorCallConfig, error) {
	return getDirectorConfig(userID, "text")
}

// getDirectorImageConfig 图片生成服务回环配置
func getDirectorImageConfig(userID int) (directorCallConfig, error) {
	return getDirectorConfig(userID, "image")
}

// getDirectorVideoConfig 视频生成服务回环配置
func getDirectorConfig(userID int, serviceType string) (directorCallConfig, error) {
	settings, err := model.GetDirectorModelSettings(userID)
	if err != nil {
		return directorCallConfig{}, err
	}
	var modelName string
	switch serviceType {
	case "image":
		modelName = strings.TrimSpace(settings.ImageModel)
	case "video":
		modelName = strings.TrimSpace(settings.VideoModel)
	default:
		modelName = strings.TrimSpace(settings.TextModel)
	}
	if modelName == "" {
		return directorCallConfig{}, errors.New("还未设置云导演模型，请先在「模型设定」中选择模型")
	}
	key, err := model.GetDirectorTokenKey(userID)
	if err != nil {
		return directorCallConfig{}, err
	}
	return directorCallConfig{APIKey: key, Model: modelName}, nil
}

var directorHTTPClient = &http.Client{Timeout: 300 * time.Second}

// relayPost 以用户令牌向回环地址发起 POST JSON 请求（路径形如 /v1/chat/completions）
func relayPost(cfg directorCallConfig, path string, body any, out any) error {
	payload, err := common.Marshal(body)
	if err != nil {
		return err
	}
	url := relayBaseURL() + path
	common.SysLog(fmt.Sprintf("云导演请求: url=%s, model=%s, bytes=%d", url, cfg.Model, len(payload)))
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(payload)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	resp, err := directorHTTPClient.Do(req)
	if err != nil {
		common.SysError(fmt.Sprintf("云导演请求失败: url=%s, err=%v", url, err))
		return fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		common.SysError(fmt.Sprintf("云导演响应异常: url=%s, status=%d, body=%s", url, resp.StatusCode, truncate(string(respBody), 600)))
		return fmt.Errorf("接口返回 %d: %s", resp.StatusCode, truncate(string(respBody), 300))
	}
	if out == nil {
		return nil
	}
	if err = common.Unmarshal(respBody, out); err != nil {
		return fmt.Errorf("解析响应失败: %w", err)
	}
	return nil
}

// relayGet 以用户令牌向回环地址发起 GET 请求并解析 JSON
func relayGet(cfg directorCallConfig, url string, out any) error {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	resp, err := directorHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("查询接口返回 %d: %s", resp.StatusCode, truncate(string(respBody), 200))
	}
	return common.Unmarshal(respBody, out)
}
