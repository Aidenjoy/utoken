package doubao

import (
	"fmt"
	"strings"

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

// VideoRatioStatus 描述 GetVideoInputRatio 的计费倍率解析结果，区分
// 「模型未配置」「命中配置」两种语义。
type VideoRatioStatus int

const (
	// VideoRatioNotConfigured 模型无硬编码 videoPriceTable 条目：
	// 无法计算档间倍率，调用方按基准价计费。
	VideoRatioNotConfigured VideoRatioStatus = iota
	// VideoRatioOK 命中单价配置，返回的倍率相对基准价有效（基准档为 1.0）。
	VideoRatioOK
)

// GetVideoInputRatio 返回指定模型在给定输出分辨率/是否含视频输入下，相对基准价的计费倍率。
// 仅服务于未配置管理员单价（billing_setting.seedance_config）的 legacy 模型：查硬编码
// videoPriceTable（三档，480p/720p 共享基准），基准价对应管理员为该模型配置的 ModelRatio。
// 管理员已配置 seedance_config 的模型走绝对单价模式（见 billing_setting.GetSeedanceTierPrice），
// 不使用本函数。
// 返回状态：
//   - VideoRatioOK: ratio = 实际单价/基准价（基准档为 1.0），可作 video_input OtherRatio；
//   - VideoRatioNotConfigured: 模型不在内置表，调用方按基准价计费（不追加 OtherRatio）。
func GetVideoInputRatio(modelName, resolution string, hasVideo bool) (float64, VideoRatioStatus) {
	res := strings.ToLower(strings.TrimSpace(resolution))

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
// resolution 为空（用户未指定，走上游默认）时不拦截。管理员已配置 seedance_config 的
// 模型以配置为准：所请求分辨率档（含/不含视频输入）无有效单价即视为不支持，返回 error
// 供上层转 400「此模型暂不支持该参数」；未配置管理员单价的 legacy 模型不拦截（内置表
// 未覆盖的组合由上游自行报错）。
func ValidateResolutionSupported(modelName, resolution string, hasVideo bool) error {
	if strings.TrimSpace(resolution) == "" {
		return nil
	}
	if _, hasCfg := billing_setting.GetSeedanceConfig(modelName); hasCfg {
		if _, ok := billing_setting.GetSeedanceTierPrice(modelName, resolution, hasVideo); !ok {
			return fmt.Errorf("此模型暂不支持该参数: %s", resolution)
		}
	}
	return nil
}
