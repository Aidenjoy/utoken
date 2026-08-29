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
	// bitOfficialDefaultProject 未配置 ProjectName 时显式落 default 项目
	// （实测显式传 "default" 与文档缺省行为一致）。
	bitOfficialDefaultProject = "default"
)

// newBitOfficialProtocol 构造 TokenBit 官方素材协议。
// 素材网关是固定服务，与渠道 base_url（视频中转用）无关，
// 恒用官方 endpoint——与 ark_official 忽略 base_url 的先例一致，
// 避免 base_url 带版本路径时把素材请求拼进视频鉴权区。
func newBitOfficialProtocol(cfg ChannelConfig) *ArkOfficialProtocol {
	cfg.Settings.AssetProjectName = strings.TrimSpace(cfg.Settings.AssetProjectName)
	if cfg.Settings.AssetProjectName == "" {
		cfg.Settings.AssetProjectName = bitOfficialDefaultProject
	}
	return &ArkOfficialProtocol{cfg: cfg, endpoint: bitOfficialDefaultEndpoint}
}
