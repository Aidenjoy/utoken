package billing_setting

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/samber/lo"
	"github.com/shopspring/decimal"
)

const (
	BillingModeRatio      = "ratio"
	BillingModeTieredExpr = "tiered_expr"
	BillingModeSeedance   = "seedance"
	BillingModeSeedream   = "seedream"
	BillingModeField      = "billing_mode"
	BillingExprField      = "billing_expr"
	SeedanceConfigField   = "seedance_config"
	SeedreamConfigField   = "seedream_config"
)

// BillingSetting is managed by config.GlobalConfig.Register.
// DB keys: billing_setting.billing_mode, billing_setting.billing_expr,
// billing_setting.seedance_config, billing_setting.seedream_config
type BillingSetting struct {
	BillingMode map[string]string `json:"billing_mode"`
	BillingExpr map[string]string `json:"billing_expr"`
	// SeedanceConfig / SeedreamConfig 的 value 为 JSON 字符串，读取时手动反序列化，
	// 与 BillingExpr 同构，避免 config 框架处理嵌套结构。
	SeedanceConfig map[string]string `json:"seedance_config"`
	SeedreamConfig map[string]string `json:"seedream_config"`
}

var billingSetting = BillingSetting{
	BillingMode:    make(map[string]string),
	BillingExpr:    make(map[string]string),
	SeedanceConfig: make(map[string]string),
	SeedreamConfig: make(map[string]string),
}

// SeedanceResolutionPrice 是 seedance 单模型单分辨率档的单价（元/百万 token，
// 与硬编码 videoPriceTable 同量纲）。WithVideo=含视频输入，WithoutVideo=不含视频输入。
type SeedanceResolutionPrice struct {
	WithVideo    float64 `json:"with_video"`
	WithoutVideo float64 `json:"without_video"`
}

// SeedreamConfig 是 seedream 单模型的按张单价（单位跟随系统币种设置，
// 与按次 ModelPrice 同量纲，经 QuotaPerUnit 换算为额度）。
type SeedreamConfig struct {
	InputImagePrice  float64 `json:"input_image_price"`
	OutputImagePrice float64 `json:"output_image_price"`
}

func init() {
	config.GlobalConfig.Register("billing_setting", &billingSetting)
}

// ---------------------------------------------------------------------------
// Read accessors (hot path, must be fast)
// ---------------------------------------------------------------------------

func GetBillingMode(model string) string {
	if mode, ok := billingSetting.BillingMode[model]; ok {
		return mode
	}
	return BillingModeRatio
}

func GetBillingExpr(model string) (string, bool) {
	expr, ok := billingSetting.BillingExpr[model]
	return expr, ok
}

// GetSeedanceConfig 返回模型 seedance 分辨率单价配置（key 为分辨率，已归一化为小写去空格）。
// 未配置该模型或解析失败时返回 ok=false，调用方据此回退硬编码单价表。
func GetSeedanceConfig(model string) (map[string]SeedanceResolutionPrice, bool) {
	raw, ok := billingSetting.SeedanceConfig[model]
	if !ok || raw == "" {
		return nil, false
	}
	var parsed map[string]SeedanceResolutionPrice
	if err := common.UnmarshalJsonStr(raw, &parsed); err != nil {
		common.SysError(fmt.Sprintf("billing_setting: parse seedance_config for %q failed: %v", model, err))
		return nil, false
	}
	normalized := make(map[string]SeedanceResolutionPrice, len(parsed))
	for res, price := range parsed {
		key := strings.ToLower(strings.TrimSpace(res))
		if key == "" {
			continue
		}
		normalized[key] = price
	}
	if len(normalized) == 0 {
		return nil, false
	}
	return normalized, true
}

// GetSeedreamConfig 返回模型 seedream 按张单价配置；未配置该模型或解析失败时返回 ok=false。
func GetSeedreamConfig(model string) (SeedreamConfig, bool) {
	raw, ok := billingSetting.SeedreamConfig[model]
	if !ok || raw == "" {
		return SeedreamConfig{}, false
	}
	var parsed SeedreamConfig
	if err := common.UnmarshalJsonStr(raw, &parsed); err != nil {
		common.SysError(fmt.Sprintf("billing_setting: parse seedream_config for %q failed: %v", model, err))
		return SeedreamConfig{}, false
	}
	return parsed, true
}

// ComputeSeedreamQuota 按张计费：
//
//	(inputImages × InputImagePrice + generatedImages × OutputImagePrice) × QuotaPerUnit × groupRatio
//
// 单价单位与按次 ModelPrice 一致。图张数无论来自请求估算还是上游 usage，都先钳制到
// [0, dto.MaxImageN]，防止上游上报的异常张数把额度算成溢出/负数；额度换算经
// common.QuotaFromDecimalChecked 饱和，返回的 clamp 供调用方审计。模型未配置 seedream
// 单价时返回 ok=false，调用方据此回退常规计费。
func ComputeSeedreamQuota(model string, inputImages, generatedImages int, groupRatio float64) (int, *common.QuotaClamp, bool) {
	cfg, ok := GetSeedreamConfig(model)
	if !ok {
		return 0, nil, false
	}
	in := min(max(inputImages, 0), dto.MaxImageN)
	out := min(max(generatedImages, 0), dto.MaxImageN)
	quotaDecimal := decimal.NewFromFloat(cfg.InputImagePrice).Mul(decimal.NewFromInt(int64(in))).
		Add(decimal.NewFromFloat(cfg.OutputImagePrice).Mul(decimal.NewFromInt(int64(out)))).
		Mul(decimal.NewFromFloat(common.QuotaPerUnit)).
		Mul(decimal.NewFromFloat(groupRatio))
	quota, clamp := common.QuotaFromDecimalChecked(quotaDecimal)
	return quota, clamp, true
}

func GetBillingModeCopy() map[string]string {
	return lo.Assign(billingSetting.BillingMode)
}

func GetBillingExprCopy() map[string]string {
	return lo.Assign(billingSetting.BillingExpr)
}

func GetSeedanceConfigCopy() map[string]string {
	return lo.Assign(billingSetting.SeedanceConfig)
}

func GetSeedreamConfigCopy() map[string]string {
	return lo.Assign(billingSetting.SeedreamConfig)
}

func GetPricingSyncData(base map[string]any) map[string]any {
	extra := make(map[string]any, 4)
	if modes := GetBillingModeCopy(); len(modes) > 0 {
		extra[BillingModeField] = modes
	}
	if exprs := GetBillingExprCopy(); len(exprs) > 0 {
		extra[BillingExprField] = exprs
	}
	if cfg := GetSeedanceConfigCopy(); len(cfg) > 0 {
		extra[SeedanceConfigField] = cfg
	}
	if cfg := GetSeedreamConfigCopy(); len(cfg) > 0 {
		extra[SeedreamConfigField] = cfg
	}
	return lo.Assign(base, extra)
}

// ---------------------------------------------------------------------------
// Smoke test (called externally for validation before save)
// ---------------------------------------------------------------------------

func SmokeTestExpr(exprStr string) error {
	return smokeTestExpr(exprStr)
}

func smokeTestExpr(exprStr string) error {
	vectors := []billingexpr.TokenParams{
		{P: 0, C: 0, Len: 0},
		{P: 1000, C: 1000, Len: 1000},
		{P: 100000, C: 100000, Len: 100000},
		{P: 1000000, C: 1000000, Len: 1000000},
	}
	requests := []billingexpr.RequestInput{
		{},
		{
			Headers: map[string]string{
				"anthropic-beta": "fast-mode-2026-02-01",
			},
			Body: []byte(`{"service_tier":"fast","stream_options":{"include_usage":true},"messages":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21]}`),
		},
	}

	for _, v := range vectors {
		for _, request := range requests {
			result, _, err := billingexpr.RunExprWithRequest(exprStr, v, request)
			if err != nil {
				return fmt.Errorf("vector {p=%g, c=%g}: run failed: %w", v.P, v.C, err)
			}
			if result < 0 {
				return fmt.Errorf("vector {p=%g, c=%g}: result %f < 0", v.P, v.C, result)
			}
		}
	}
	return nil
}
