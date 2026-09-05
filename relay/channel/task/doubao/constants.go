package doubao

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/billing_setting"
)

var ModelList = []string{
	"doubao-seedance-1-0-pro-250528",
	"doubao-seedance-1-0-lite-t2v",
	"doubao-seedance-1-0-lite-i2v",
	"doubao-seedance-1-5-pro-251215",
	"doubao-seedance-2-0-260128",
	"doubao-seedance-2-0-fast-260128",
}

var ChannelName = "doubao-video"

// videoPriceKey 价格表的键：输出分辨率档（is1080p/is4k 均为 false 即 480p/720p 基准档）、输入是否含视频。
type videoPriceKey struct {
	is1080p  bool
	is4k     bool
	hasVideo bool
}

// videoPriceTable 各模型在不同 (输出分辨率档, 是否含视频输入) 下的单价（元/百万 token）。
// 其中零值键 {480p/720p, 不含视频} 为基准价，等于管理员应配置的 ModelRatio；
// 计费时取 实际单价/基准价 作为 OtherRatio。
var videoPriceTable = map[string]map[videoPriceKey]float64{
	"doubao-seedance-2-0-260128": {
		{hasVideo: false}:                46.0,
		{hasVideo: true}:                 28.0,
		{is1080p: true, hasVideo: false}: 51.0,
		{is1080p: true, hasVideo: true}:  31.0,
		{is4k: true, hasVideo: false}:    26.0,
		{is4k: true, hasVideo: true}:     16.0,
	},
	"doubao-seedance-2-0-fast-260128": {
		{hasVideo: false}: 37.0,
		{hasVideo: true}:  22.0,
	},
}

// seedanceBaseResolution 是档间倍率的基准档：480p 不含视频输入，
// 对应管理员为该模型配置的 ModelRatio；其余档单价均相对此档换算倍率。
const seedanceBaseResolution = "480p"

// VideoRatioStatus 描述 GetVideoInputRatio 的计费倍率解析结果，区分
// 「命中配置」「模型未配置」「已配置但不支持该分辨率」三种语义。
type VideoRatioStatus int

const (
	// VideoRatioNotConfigured 模型既无 billing_setting.seedance_config 配置，
	// 也无硬编码 videoPriceTable 条目：无法计算档间倍率，调用方按基准价计费。
	VideoRatioNotConfigured VideoRatioStatus = iota
	// VideoRatioOK 命中单价配置，返回的倍率相对基准价有效（基准档为 1.0）。
	VideoRatioOK
	// VideoRatioUnsupportedResolution 模型已配置单价，但不支持所请求的分辨率：
	// 调用方必须拒绝请求（400 该模型不支持此分辨率），不得回退基准价。
	VideoRatioUnsupportedResolution
)

// GetVideoInputRatio 返回指定模型在给定输出分辨率/是否含视频输入下，相对基准价的计费倍率。
// 优先读管理员配置 billing_setting.seedance_config（480p/720p/1080p/4k 四档独立），
// 未配置该模型时回退硬编码 videoPriceTable（三档，480p/720p 共享基准）保持向后兼容。
// 基准价 base 固定为「480p 不含视频」档，对应管理员为该模型配置的 ModelRatio。
// 返回状态：
//   - VideoRatioOK: ratio = 实际单价/基准价（基准档为 1.0），可作 video_input OtherRatio；
//   - VideoRatioUnsupportedResolution: 模型已配置单价但不支持该分辨率，调用方必须拒绝请求；
//   - VideoRatioNotConfigured: 模型无任何单价配置，调用方按基准价计费（不追加 OtherRatio）。
func GetVideoInputRatio(modelName, resolution string, hasVideo bool) (float64, VideoRatioStatus) {
	res := strings.ToLower(strings.TrimSpace(resolution))

	// 1. 优先读管理员配置（4 档分辨率独立）
	if cfg, ok := billing_setting.GetSeedanceConfig(modelName); ok {
		basePrice := cfg[seedanceBaseResolution].WithoutVideo
		if basePrice > 0 {
			// 用户未指定分辨率时按基准档（480p）预估，结算时用响应分辨率重算
			lookup := res
			if lookup == "" {
				lookup = seedanceBaseResolution
			}
			tier, found := cfg[lookup]
			if !found {
				return 0, VideoRatioUnsupportedResolution
			}
			price := tier.WithoutVideo
			if hasVideo {
				price = tier.WithVideo
			}
			if price <= 0 {
				// 该分辨率下对应「含/不含视频」档未配置有效单价，视为不支持
				return 0, VideoRatioUnsupportedResolution
			}
			return price / basePrice, VideoRatioOK
		}
		common.SysError(fmt.Sprintf("[seedance] model %q config missing valid base price (480p without_video); falling back to builtin table", modelName))
	}

	// 2. 回退硬编码单价表（向后兼容，保持原有三档语义）
	prices, ok := videoPriceTable[modelName]
	base := prices[videoPriceKey{}] // 零值键 = {480p/720p, 不含视频} 基准价
	if !ok || base <= 0 {
		return 0, VideoRatioNotConfigured
	}
	price, found := prices[videoPriceKey{is1080p: res == "1080p", is4k: res == "4k", hasVideo: hasVideo}]
	if !found {
		// 硬编码表未覆盖的组合（如 fast 无 1080p/4k，上游会自行报错）按基准价计费即可。
		return 1.0, VideoRatioOK
	}
	return price / base, VideoRatioOK
}

// ValidateResolutionSupported 校验模型是否支持用户请求的分辨率。
// resolution 为空（用户未指定，走上游默认）时不拦截；模型已配置单价但不支持
// 该分辨率时返回 error，供上层转 400「该模型不支持此分辨率」。
func ValidateResolutionSupported(modelName, resolution string, hasVideo bool) error {
	if strings.TrimSpace(resolution) == "" {
		return nil
	}
	if _, status := GetVideoInputRatio(modelName, resolution, hasVideo); status == VideoRatioUnsupportedResolution {
		return fmt.Errorf("该模型不支持此分辨率: %s", resolution)
	}
	return nil
}
