package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// setupDiscountPricing 固定计价相关设置并注册清理，令四个渠道的计价可预测。
// 统一使用 USD 展示类型（amount 即金额单位，不做 tokens 换算），聚焦档位折扣。
func setupDiscountPricing(t *testing.T) {
	t.Helper()

	origPrice := operation_setting.Price
	origWaffo := setting.WaffoUnitPrice
	origPancake := setting.WaffoPancakeUnitPrice
	origStripe := setting.StripeUnitPrice
	origDisplay := operation_setting.GetGeneralSetting().QuotaDisplayType
	origGroupRatio := common.TopupGroupRatio2JSONString()
	origDiscounts := make(map[int]float64, len(operation_setting.GetPaymentSetting().AmountDiscount))
	for k, v := range operation_setting.GetPaymentSetting().AmountDiscount {
		origDiscounts[k] = v
	}

	t.Cleanup(func() {
		operation_setting.Price = origPrice
		setting.WaffoUnitPrice = origWaffo
		setting.WaffoPancakeUnitPrice = origPancake
		setting.StripeUnitPrice = origStripe
		operation_setting.GetGeneralSetting().QuotaDisplayType = origDisplay
		operation_setting.GetPaymentSetting().AmountDiscount = origDiscounts
		require.NoError(t, common.UpdateTopupGroupRatioByJSONString(origGroupRatio))
	})

	operation_setting.Price = 2.0
	setting.WaffoUnitPrice = 2.0
	setting.WaffoPancakeUnitPrice = 2.5
	setting.StripeUnitPrice = 8.0
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeUSD
	// 预设折扣：充值 10 命中 0.8；其余金额无预设（等效 1.0）。
	operation_setting.GetPaymentSetting().AmountDiscount = map[int]float64{10: 0.8}
	require.NoError(t, common.UpdateTopupGroupRatioByJSONString(`{"default":1,"vip":1.2}`))
}

// 以下四个用例覆盖「用户个人充值立减」下线后剩下的唯一折扣路径：
// 全局档位折扣（payment_setting.amount_discount）按充值面值命中，与分组倍率相乘。
// 四个 getXxxPayMoney 的签名都不再接收 userDiscount —— 少一个参数就是少一条价格来源。

// TestGetPayMoney_AmountTierDiscount 验证 Epay 计价。
func TestGetPayMoney_AmountTierDiscount(t *testing.T) {
	setupDiscountPricing(t)

	tests := []struct {
		name     string
		amount   int64
		group    string
		expected float64
	}{
		{name: "tier hit", amount: 10, group: "default", expected: 16.0},              // 10*2*1*0.8
		{name: "tier hit with group ratio", amount: 10, group: "vip", expected: 19.2}, // 10*2*1.2*0.8
		{name: "no tier configured", amount: 20, group: "default", expected: 40.0},    // 20*2*1*1
		{name: "no tier with group ratio", amount: 20, group: "vip", expected: 48.0},  // 20*2*1.2*1
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.InDelta(t, tc.expected, getPayMoney(tc.amount, tc.group), 1e-9)
		})
	}
}

// TestGetWaffoPayMoney_AmountTierDiscount 验证 Waffo 计价。
func TestGetWaffoPayMoney_AmountTierDiscount(t *testing.T) {
	setupDiscountPricing(t)

	tests := []struct {
		name     string
		amount   float64
		group    string
		expected float64
	}{
		{name: "tier hit", amount: 10, group: "default", expected: 16.0},
		{name: "tier hit with group ratio", amount: 10, group: "vip", expected: 19.2},
		{name: "no tier configured", amount: 20, group: "default", expected: 40.0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.InDelta(t, tc.expected, getWaffoPayMoney(tc.amount, tc.group), 1e-9)
		})
	}
}

// TestGetStripePayMoney_AmountTierDiscount 验证 Stripe 计价（实付）。
func TestGetStripePayMoney_AmountTierDiscount(t *testing.T) {
	setupDiscountPricing(t)

	tests := []struct {
		name     string
		amount   float64
		group    string
		expected float64
	}{
		{name: "tier hit", amount: 10, group: "default", expected: 64.0},              // 10*8*1*0.8
		{name: "tier hit with group ratio", amount: 10, group: "vip", expected: 76.8}, // 10*8*1.2*0.8
		{name: "no tier configured", amount: 20, group: "default", expected: 160.0},   // 20*8*1*1
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.InDelta(t, tc.expected, getStripePayMoney(tc.amount, tc.group), 1e-9)
		})
	}
}

// TestGetWaffoPancakePayMoney_AmountTierDiscount 验证 WaffoPancake 计价。
// 更完整的展示类型/单位价矩阵见 topup_waffo_pancake_test.go，此处聚焦档位折扣对齐。
func TestGetWaffoPancakePayMoney_AmountTierDiscount(t *testing.T) {
	setupDiscountPricing(t)

	tests := []struct {
		name     string
		amount   int64
		group    string
		expected float64
	}{
		{name: "tier hit", amount: 10, group: "default", expected: 20.0},              // 10*2.5*1*0.8
		{name: "tier hit with group ratio", amount: 10, group: "vip", expected: 24.0}, // 10*2.5*1.2*0.8
		{name: "no tier configured", amount: 20, group: "default", expected: 50.0},    // 20*2.5*1*1
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.InDelta(t, tc.expected, getWaffoPancakePayMoney(tc.amount, tc.group), 1e-9)
		})
	}
}

// TestDiscountReducesPayNotQuotaBase 验证核心计费安全不变量：
// 折扣只降低"实付金额"，"额度基数"（面值 / Stripe Money）恒不随折扣变化。
func TestDiscountReducesPayNotQuotaBase(t *testing.T) {
	setupDiscountPricing(t)

	// 1) 各渠道：单位面值实付之比恰为档位折扣——10 命中 0.8，20 未配置（等效 1.0）。
	//    比值口径消除了单价与分组倍率的影响，剩下的只能是折扣这一个变量。
	const discounted, plain = float64(10), float64(20)
	ratio := func(payDiscounted, payPlain float64) float64 {
		return (payDiscounted / discounted) / (payPlain / plain)
	}
	assert.InDelta(t, 0.8, ratio(getPayMoney(10, "default"), getPayMoney(20, "default")), 1e-9, "epay pay scales with tier discount")
	assert.InDelta(t, 0.8, ratio(getWaffoPayMoney(10, "default"), getWaffoPayMoney(20, "default")), 1e-9, "waffo pay scales with tier discount")
	assert.InDelta(t, 0.8, ratio(getWaffoPancakePayMoney(10, "default"), getWaffoPancakePayMoney(20, "default")), 1e-9, "pancake pay scales with tier discount")
	assert.InDelta(t, 0.8, ratio(getStripePayMoney(10, "default"), getStripePayMoney(20, "default")), 1e-9, "stripe pay scales with tier discount")

	// 2) Stripe 额度基数 Money = amount × groupRatio，结构上不接收折扣参数，
	//    因此命中档位折扣的充值与未命中的充值，入账基数口径完全一致。
	user := model.User{Group: "vip"}
	baseMoney := GetChargedAmount(discounted, user)
	assert.InDelta(t, 12.0, baseMoney, 1e-9) // 10 * 1.2，与 AmountDiscount[10]=0.8 无关
	assert.InDelta(t, baseMoney/discounted, GetChargedAmount(plain, user)/plain, 1e-9, "stripe quota base must not depend on discount")
}
