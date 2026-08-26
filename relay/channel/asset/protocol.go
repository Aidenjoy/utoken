package asset

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
)

// ChannelConfig 素材协议运行所需的渠道信息。
type ChannelConfig struct {
	BaseURL  string
	ApiKey   string
	Proxy    string
	Settings dto.ChannelOtherSettings
}

// UploadRequest 素材注册请求（上游仅接受 URL，不支持 base64）。
type UploadRequest struct {
	URL       string
	AssetType string // Image/Video/Audio
	Name      string
}

// UploadResult 上游注册成功返回。
type UploadResult struct {
	AssetID     string
	GroupID     string
	ProjectName string
}

// QueryResult 上游素材状态查询返回（Status 已归一化为 model.AssetStatus*）。
type QueryResult struct {
	Status     string
	PreviewURL string
	ErrorMsg   string
}

// Protocol 素材上传协议适配器：每种中转站/官方协议一个实现。
type Protocol interface {
	Upload(req UploadRequest) (*UploadResult, error)
	Query(assetID string) (*QueryResult, error)
}

// NewProtocol 按渠道配置的协议类型构造适配器；未开启协议返回错误。
func NewProtocol(cfg ChannelConfig) (Protocol, error) {
	switch cfg.Settings.AssetUploadProtocol {
	case dto.AssetUploadProtocolRelay:
		return &RelayProtocol{cfg: cfg}, nil
	case dto.AssetUploadProtocolArkOfficial:
		if strings.TrimSpace(cfg.Settings.AssetAK) == "" || strings.TrimSpace(cfg.Settings.AssetSK) == "" {
			return nil, fmt.Errorf("ark_official asset protocol requires asset_ak and asset_sk")
		}
		return &ArkOfficialProtocol{cfg: cfg}, nil
	default:
		return nil, fmt.Errorf("asset upload protocol is not enabled on this channel")
	}
}

func httpClient(proxy string) (*http.Client, error) {
	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("create http client failed: %w", err)
	}
	if client == nil {
		// 全局 client 由 service.InitHttpClient 在启动时初始化；
		// 未初始化（如单测环境）时退回默认 client。
		client = http.DefaultClient
	}
	return client, nil
}

// NormalizeUpstreamStatus 把上游状态文案归一化为本地三态。
func NormalizeUpstreamStatus(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "active", "success", "succeeded", "completed":
		return model.AssetStatusActive
	case "failed", "error", "expired":
		return model.AssetStatusFailed
	default:
		return model.AssetStatusPending
	}
}

const defaultRequestTimeout = 30 * time.Second
