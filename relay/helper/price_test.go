package helper

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestModelPriceHelperTieredUsesPreloadedRequestInput(t *testing.T) {
	gin.SetMode(gin.TestMode)

	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		saved[key] = value
		return nil
	}))
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
	})

	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode": `{"tiered-test-model":"tiered_expr"}`,
		"billing_setting.billing_expr": `{"tiered-test-model":"param(\"stream\") == true ? tier(\"stream\", p * 3) : tier(\"base\", p * 2)"}`,
	}))

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	req := httptest.NewRequest(http.MethodPost, "/api/channel/test/1", nil)
	req.Body = nil
	req.ContentLength = 0
	req.Header.Set("Content-Type", "application/json")
	ctx.Request = req
	ctx.Set("group", "default")

	info := &relaycommon.RelayInfo{
		OriginModelName: "tiered-test-model",
		UserGroup:       "default",
		UsingGroup:      "default",
		RequestHeaders:  map[string]string{"Content-Type": "application/json"},
		BillingRequestInput: &billingexpr.RequestInput{
			Headers: map[string]string{"Content-Type": "application/json"},
			Body:    []byte(`{"stream":true}`),
		},
	}

	priceData, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
	require.NoError(t, err)
	require.Equal(t, 1500, priceData.QuotaToPreConsume)
	require.NotNil(t, info.TieredBillingSnapshot)
	require.Equal(t, "stream", info.TieredBillingSnapshot.EstimatedTier)
	require.Equal(t, billing_setting.BillingModeTieredExpr, info.TieredBillingSnapshot.BillingMode)
	require.Equal(t, common.QuotaPerUnit, info.TieredBillingSnapshot.QuotaPerUnit)
}

func TestModelPriceHelperTieredPreConsumeMaxTokensFallback(t *testing.T) {
	gin.SetMode(gin.TestMode)

	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		saved[key] = value
		return nil
	}))
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
	})

	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode":    `{"tiered-fallback-model":"tiered_expr"}`,
		"billing_setting.billing_expr":    `{"tiered-fallback-model":"tier(\"base\", p * 3 + c * 15)"}`,
		"group_ratio_setting.group_ratio": `{"default":1,"free":0}`,
	}))

	const promptTokens = 1000

	cases := []struct {
		name      string
		group     string
		maxTokens int
		expected  int
	}{
		{
			// max_tokens omitted in a paid group -> fall back to 8192 completion tokens.
			// p*3 + c*15 = 1000*3 + 8192*15 = 125880 -> /1e6 * 500000 = 62940
			name:      "non-free group falls back to 8192 completion tokens",
			group:     "default",
			maxTokens: 0,
			expected:  62940,
		},
		{
			// explicit max_tokens is used verbatim, no fallback.
			// 1000*3 + 100*15 = 4500 -> /1e6 * 500000 = 2250
			name:      "explicit max_tokens is used verbatim",
			group:     "default",
			maxTokens: 100,
			expected:  2250,
		},
		{
			// free group (ratio 0) stays zero; fallback is gated on non-zero group ratio.
			name:      "free group stays zero without fallback",
			group:     "free",
			maxTokens: 0,
			expected:  0,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			req.Header.Set("Content-Type", "application/json")
			ctx.Request = req
			ctx.Set("group", tc.group)

			info := &relaycommon.RelayInfo{
				OriginModelName: "tiered-fallback-model",
				UserGroup:       tc.group,
				UsingGroup:      tc.group,
				RequestHeaders:  map[string]string{"Content-Type": "application/json"},
				BillingRequestInput: &billingexpr.RequestInput{
					Headers: map[string]string{"Content-Type": "application/json"},
					Body:    []byte(`{}`),
				},
			}

			priceData, err := ModelPriceHelper(ctx, info, promptTokens, &types.TokenCountMeta{MaxTokens: tc.maxTokens})
			require.NoError(t, err)
			require.Equal(t, tc.expected, priceData.QuotaToPreConsume)
		})
	}
}

// TestModelPriceHelperPerCallSeedanceAbsolutePrice 锁定 seedance 绝对单价模式的预扣边界：
// 档价（每百万 token 实际单价）/2 合成模型倍率，预扣 = 倍率/2 × QuotaPerUnit × groupRatio，
// 无需配置 ModelRatio；空分辨率取该变体最高档价兜底；配置了 seedance_config 但档价无法
// 解析时才回落常规 ModelPrice/ModelRatio 逻辑。
func TestModelPriceHelperPerCallSeedanceAbsolutePrice(t *testing.T) {
	gin.SetMode(gin.TestMode)

	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		saved[key] = value
		return nil
	}))
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
	})

	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode":    `{"seedance-abs-model":"seedance"}`,
		"billing_setting.seedance_config": `{"seedance-abs-model":"{\"480p\":{\"with_video\":0,\"without_video\":10},\"1080p\":{\"with_video\":33.12,\"without_video\":55.44}}"}`,
		"group_ratio_setting.group_ratio": `{"default":1}`,
	}))

	cases := []struct {
		name         string
		resolution   string
		hasVideo     bool
		wantRatio    float64
		wantQuota    int
		wantUsePrice bool
	}{
		// 55.44/2=27.72；预扣 27.72/2×500000×1 = 6_930_000
		{name: "1080p不含视频", resolution: "1080p", hasVideo: false, wantRatio: 27.72, wantQuota: 6_930_000},
		// 33.12/2=16.56；8.28×500000 浮点尾数截断为 4_139_999（QuotaFromFloat 截断语义）
		{name: "1080p含视频", resolution: "1080p", hasVideo: true, wantRatio: 16.56, wantQuota: 4_139_999},
		// 空分辨率取不含视频变体最高档 55.44
		{name: "空分辨率取最高档兜底", resolution: "", hasVideo: false, wantRatio: 27.72, wantQuota: 6_930_000},
		// 空分辨率含视频：跳过零价 480p，取 33.12
		{name: "空分辨率含视频跳过零价档", resolution: "", hasVideo: true, wantRatio: 16.56, wantQuota: 4_139_999},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			req := httptest.NewRequest(http.MethodPost, "/v1/video/generations", nil)
			req.Header.Set("Content-Type", "application/json")
			ctx.Request = req
			ctx.Set("group", "default")

			info := &relaycommon.RelayInfo{
				OriginModelName: "seedance-abs-model",
				UserGroup:       "default",
				UsingGroup:      "default",
				TaskRelayInfo: &relaycommon.TaskRelayInfo{
					SeedanceResolution: tc.resolution,
					HasVideoInput:      tc.hasVideo,
				},
			}

			priceData, err := ModelPriceHelperPerCall(ctx, info)
			require.NoError(t, err)
			assert.InDelta(t, tc.wantRatio, priceData.ModelRatio, 1e-9)
			assert.Equal(t, tc.wantQuota, priceData.Quota)
			assert.Equal(t, tc.wantUsePrice, priceData.UsePrice)
			assert.Equal(t, -1.0, priceData.ModelPrice)
		})
	}
}

// TestModelPriceHelperPerCallSeedanceFallsBackWithoutTierPrice 配置了 seedance 计费模式
// 但模型无任何档单价配置时，回落常规逻辑：既无 ModelPrice 也无 ModelRatio 则报价格未配置。
func TestModelPriceHelperPerCallSeedanceFallsBackWithoutTierPrice(t *testing.T) {
	gin.SetMode(gin.TestMode)

	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		saved[key] = value
		return nil
	}))
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
	})

	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode":    `{"seedance-no-price-model":"seedance"}`,
		"group_ratio_setting.group_ratio": `{"default":1}`,
	}))

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	req := httptest.NewRequest(http.MethodPost, "/v1/video/generations", nil)
	req.Header.Set("Content-Type", "application/json")
	ctx.Request = req
	ctx.Set("group", "default")

	info := &relaycommon.RelayInfo{
		OriginModelName: "seedance-no-price-model",
		UserGroup:       "default",
		UsingGroup:      "default",
		TaskRelayInfo: &relaycommon.TaskRelayInfo{
			SeedanceResolution: "1080p",
		},
	}

	_, err := ModelPriceHelperPerCall(ctx, info)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "seedance-no-price-model 的价格")
}

// TestModelPriceHelperPerCallWanAbsolutePrice 锁定 wan 按秒档价模式的预扣边界，尤其是
// UsePrice 必须为 false：控制器据 PriceData.UsePrice 置 BillingContext.PerCallBilling，
// 轮询结算遇 PerCallBilling=true 会跳过差额结算，扣费永远停在预扣的预估秒数（如 5 秒），
// 无法按上游真实 usage.duration（输入+输出总时长）重算。预扣额度 = 每秒档价 × QuotaPerUnit
// × groupRatio（1 秒基础，秒数由 EstimateBilling 注入的 seconds 倍率另乘）；空分辨率取最高档兜底。
func TestModelPriceHelperPerCallWanAbsolutePrice(t *testing.T) {
	gin.SetMode(gin.TestMode)

	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		saved[key] = value
		return nil
	}))
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
	})

	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode":    `{"wan-abs-model":"wan"}`,
		"billing_setting.wan_config":      `{"wan-abs-model":"{\"480p\":0.4,\"720p\":0.6,\"1080p\":1}"}`,
		"group_ratio_setting.group_ratio": `{"default":1}`,
	}))

	cases := []struct {
		name       string
		resolution string
		wantPrice  float64
		wantQuota  int
	}{
		// 0.6×500000×1 = 300000（1 秒基础预扣）
		{name: "720p档价", resolution: "720p", wantPrice: 0.6, wantQuota: 300_000},
		{name: "480p档价", resolution: "480p", wantPrice: 0.4, wantQuota: 200_000},
		// 空分辨率取最高档 1.0 兜底
		{name: "空分辨率取最高档兜底", resolution: "", wantPrice: 1, wantQuota: 500_000},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			req := httptest.NewRequest(http.MethodPost, "/v1/video/generations", nil)
			req.Header.Set("Content-Type", "application/json")
			ctx.Request = req
			ctx.Set("group", "default")

			info := &relaycommon.RelayInfo{
				OriginModelName: "wan-abs-model",
				UserGroup:       "default",
				UsingGroup:      "default",
				TaskRelayInfo: &relaycommon.TaskRelayInfo{
					WanResolution: tc.resolution,
				},
			}

			priceData, err := ModelPriceHelperPerCall(ctx, info)
			require.NoError(t, err)
			// 核心契约：UsePrice=false，否则任务被标 PerCallBilling 而跳过差额结算
			assert.False(t, priceData.UsePrice)
			assert.InDelta(t, tc.wantPrice, priceData.ModelPrice, 1e-9)
			assert.Equal(t, tc.wantQuota, priceData.Quota)
		})
	}
}
