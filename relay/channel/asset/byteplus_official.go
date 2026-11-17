package asset

import (
	"strings"
)

// BytePlus ModelArk（火山方舟海外版）素材库协议：与火山方舟完全一致
// （service=ark，Version=2024-01-01，Action=CreateAssetGroup/CreateAsset/GetAsset，
// ResponseMetadata/Result 信封，V4 签名，SignedHeaders 也相同），
// 仅网关与区域不同：host 为 ark.ap-southeast-1.byteplusapi.com，
// 签名 Credential scope 的 region 为 ap-southeast-1（国内是 cn-beijing）。
// 因此直接复用 ArkOfficialProtocol，只替换 endpoint 与 region。
//
// AK/SK 为 BytePlus 控制台签发（AKLT 前缀），与国内火山 AK/SK 账号体系独立，
// 与视频任务的 Bearer API Key（ark.ap-southeast.bytepluses.com）也相互独立。
const (
	byteplusOfficialEndpoint = "https://ark.ap-southeast-1.byteplusapi.com"
	// byteplusOfficialRegion 网关固定挂在 ap-southeast-1，签名 region 必须与之一致。
	byteplusOfficialRegion = "ap-southeast-1"
	// byteplusDefaultProject 未配置 ProjectName 时显式落 default 项目（与官方缺省一致）。
	byteplusDefaultProject = "default"
)

// newByteplusOfficialProtocol 构造 BytePlus ModelArk 素材协议。
// 素材网关是固定服务，与渠道 base_url（视频中转用）无关，
// 恒用官方 endpoint——与 ark_official/bit_official 忽略 base_url 的先例一致。
// region 恒为 ap-southeast-1：网关域名已锁定区域，开放配置只会造成签名不一致。
func newByteplusOfficialProtocol(cfg ChannelConfig) *ArkOfficialProtocol {
	cfg.Settings.AssetProjectName = strings.TrimSpace(cfg.Settings.AssetProjectName)
	if cfg.Settings.AssetProjectName == "" {
		cfg.Settings.AssetProjectName = byteplusDefaultProject
	}
	cfg.Settings.AssetRegion = byteplusOfficialRegion
	return &ArkOfficialProtocol{cfg: cfg, endpoint: byteplusOfficialEndpoint}
}
