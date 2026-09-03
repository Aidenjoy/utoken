package asset

import (
	"strings"
)

// 星枢无极（郑州移动）素材库协议：与火山方舟完全一致
// （service=ark，region=cn-beijing，Version=2024-01-01，
// Action=CreateAssetGroup/CreateAsset/GetAsset，ResponseMetadata/Result 信封，V4 签名），
// 仅网关不同（mintel.591ll.com/render/api），且签名时 host 值含路径前缀。
//
// 签名怪癖：官方 Demo 把 "mintel.591ll.com/render/api" 整体作为 host 头参与签名，
// canonical URI 仅用 "/assets/"（不含 /render/api 前缀）。
// 因此复用 ArkOfficialProtocol 并通过 signHost/signPath 覆写签名字段。
//
// AK/SK 由星枢无极平台签发，与视频任务的 Bearer Token 相互独立。
const (
	xswjOfficialEndpoint = "https://mintel.591ll.com/render/api/assets/"
	// xswjSignHost 签名规范请求中 host 头的值（含路径前缀，与官方 Demo 一致）。
	xswjSignHost = "mintel.591ll.com/render/api"
	// xswjSignPath 签名规范请求中的 URI 路径（不含 /render/api 前缀）。
	xswjSignPath = "/assets/"
	// xswjDefaultProject 未配置 ProjectName 时显式落 default 项目。
	xswjDefaultProject = "default"
)

// newXswjOfficialProtocol 构造星枢无极官方素材协议。
// 素材网关是固定服务，与渠道 base_url（视频中转用）无关，
// 恒用官方 endpoint——与 ark_official/bit_official 忽略 base_url 的先例一致。
func newXswjOfficialProtocol(cfg ChannelConfig) *ArkOfficialProtocol {
	cfg.Settings.AssetProjectName = strings.TrimSpace(cfg.Settings.AssetProjectName)
	if cfg.Settings.AssetProjectName == "" {
		cfg.Settings.AssetProjectName = xswjDefaultProject
	}
	return &ArkOfficialProtocol{
		cfg:      cfg,
		endpoint: xswjOfficialEndpoint,
		signHost: xswjSignHost,
		signPath: xswjSignPath,
	}
}
