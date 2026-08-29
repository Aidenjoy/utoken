package asset

import (
	"strings"
)

// TokenBit 官方素材库（渠道名 bit）：协议与火山方舟完全一致
// （service=ark，Version=2024-01-01，Action=CreateAssetGroup/CreateAsset/GetAsset，
// ResponseMetadata/Result 信封），仅网关不同（/seedance25/openapi/），
// 因此直接复用 ArkOfficialProtocol，只替换 endpoint。
// AK/SK 为该网关控制台签发（ak_/sk_ 前缀），与视频任务的 Bearer API Key 相互独立。
const (
	bitOfficialDefaultEndpoint = "https://www.tokenbit.com.cn/seedance25/openapi/"
	bitOfficialAssetPath       = "/seedance25/openapi/"
	// bitOfficialDefaultProject 未配置 ProjectName 时显式落 default 项目
	// （实测显式传 "default" 与文档缺省行为一致）。
	bitOfficialDefaultProject = "default"
)

// newBitOfficialProtocol 构造 TokenBit 官方素材协议：
// 渠道 base_url 非空时素材网关取 {base}/seedance25/openapi/，否则用官方默认域名。
func newBitOfficialProtocol(cfg ChannelConfig) *ArkOfficialProtocol {
	endpoint := bitOfficialDefaultEndpoint
	if base := strings.TrimSpace(cfg.BaseURL); base != "" {
		endpoint = strings.TrimSuffix(base, "/") + bitOfficialAssetPath
	}
	if strings.TrimSpace(cfg.Settings.AssetProjectName) == "" {
		cfg.Settings.AssetProjectName = bitOfficialDefaultProject
	}
	return &ArkOfficialProtocol{cfg: cfg, endpoint: endpoint}
}
