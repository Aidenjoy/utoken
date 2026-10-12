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
// 统一使用 USD 展示类型（amount 即金额单位，不做 tokens 换算），聚焦折扣叠加。
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

// TestGetPayMoney_UserDiscountStacking 验证 Epay 计价：用户折扣与预设折扣乘性叠加，
// 非法用户折扣（<=0 或 >1）被忽略。
func TestGetPayMoney_UserDiscountStacking(t *testing.T) {
	setupDiscountPricing(t)

	tests := []struct {
		name         string
		amount       int64
		group        string
		userDiscount float64
		expected     float64
	}{
		{name: "preset only, no user discount", amount: 10, group: "default", userDiscount: 1.0, expected: 16.0},    // 10*2*1*0.8
		{name: "user discount stacks on preset", amount: 10, group: "default", userDiscount: 0.6, expected: 9.6},    // 16*0.6
		{name: "stacks with group ratio too", amount: 10, group: "vip", userDiscount: 0.6, expected: 11.52},         // 10*2*1.2*0.8*0.6
		{name: "no preset amount", amount: 20, group: "default", userDiscount: 0.5, expected: 20.0},                 // 20*2*1*1*0.5
		{name: "non-positive user discount ignored", amount: 10, group: "default", userDiscount: 0, expected: 16.0}, // guard: ud<=0
		{name: "above-one user discount ignored", amount: 10, group: "default", userDiscount: 1.5, expected: 16.0},  // guard: ud>1
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.InDelta(t, tc.expected, getPayMoney(tc.amount, tc.group, tc.userDiscount), 1e-9)
		})
	}
}

// TestGetWaffoPayMoney_UserDiscountStacking 验证 Waffo 计价的乘性叠加。
func TestGetWaffoPayMoney_UserDiscountStacking(t *testing.T) {
	setupDiscountPricing(t)

	tests := []struct {
		name         string
		amount       float64
		group        string
		userDiscount float64
		expected     float64
	}{
		{name: "preset only", amount: 10, group: "default", userDiscount: 1.0, expected: 16.0},
		{name: "user discount stacks", amount: 10, group: "default", userDiscount: 0.6, expected: 9.6},
		{name: "stacks with group ratio", amount: 10, group: "vip", userDiscount: 0.6, expected: 11.52},
		{name: "non-positive ignored", amount: 10, group: "default", userDiscount: -1, expected: 16.0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.InDelta(t, tc.expected, getWaffoPayMoney(tc.amount, tc.group, tc.userDiscount), 1e-9)
		})
	}
}

// TestGetStripePayMoney_UserDiscountStacking 验证 Stripe 计价（实付）的乘性叠加。
func TestStripePayMoney_UserDiscountStacking(t *testing.T) {
	setupDiscountPricing(t)

	tests := []struct {
		name         string
		amount       float64
		group        string
		userDiscount float64
		expected     float64
	}{
		{name: "preset only", amount: 10, group: "default", userDiscount: 1.0, expected: 64.0},          // 10*8*1*0.8
		{name: "user discount stacks", amount: 10, group: "default", userDiscount: 0.6, expected: 38.4}, // 64*0.6
		{name: "stacks with group ratio", amount: 10, group: "vip", userDiscount: 0.6, expected: 46.08}, // 10*8*1.2*0.8*0.6
		{name: "above-one ignored", amount: 10, group: "default", userDiscount: 2.0, expected: 64.0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.InDelta(t, tc.expected, getStripePayMoney(tc.amount, tc.group, tc.userDiscount), 1e-9)
		})
	}
}

// TestGetWaffoPancakePayMoney_UserDiscountStacking 验证 WaffoPancake 计价的乘性叠加。
// 更完整的展示类型/单位价矩阵见 topup_waffo_pancake_test.go，此处聚焦折扣叠加对齐。
func TestGetWaffoPancakePayMoney_UserDiscountStacking(t *testing.T) {
	setupDiscountPricing(t)

	tests := []struct {
		name         string
		amount       int64
		group        string
		userDiscount float64
		expected     float64
	}{
		{name: "preset only", amount: 10, group: "default", userDiscount: 1.0, expected: 20.0},          // 10*2.5*1*0.8
		{name: "user discount stacks", amount: 10, group: "default", userDiscount: 0.6, expected: 12.0}, // 20*0.6
		{name: "stacks with group ratio", amount: 10, group: "vip", userDiscount: 0.6, expected: 14.4},  // 10*2.5*1.2*0.8*0.6
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.InDelta(t, tc.expected, getWaffoPancakePayMoney(tc.amount, tc.group, tc.userDiscount), 1e-9)
		})
	}
}

// TestDiscountReducesPayNotQuotaBase 验证核心计费安全不变量：
// 折扣只降低"实付金额"，"额度基数"（面值 / Stripe Money）恒不随折扣变化。
func TestDiscountReducesPayNotQuotaBase(t *testing.T) {
	setupDiscountPricing(t)

	const amount = 10

	// 1) 各渠道：同一 amount 下，实付随用户折扣等比例缩小（折扣只作用于 pay 侧）。
	assert.InDelta(t, getPayMoney(amount, "default", 1.0)*0.6, getPayMoney(amount, "default", 0.6), 1e-9, "epay pay scales with discount")
	assert.InDelta(t, getWaffoPayMoney(amount, "default", 1.0)*0.6, getWaffoPayMoney(amount, "default", 0.6), 1e-9, "waffo pay scales with discount")
	assert.InDelta(t, getWaffoPancakePayMoney(amount, "default", 1.0)*0.6, getWaffoPancakePayMoney(amount, "default", 0.6), 1e-9, "pancake pay scales with discount")
	assert.InDelta(t, getStripePayMoney(amount, "default", 1.0)*0.6, getStripePayMoney(amount, "default", 0.6), 1e-9, "stripe pay scales with discount")

	// 2) Stripe 额度基数 Money = amount × groupRatio，结构上不接收折扣参数，
	//    因此持有折扣的用户与无折扣用户入账基数完全一致。
	noDiscount := model.User{Group: "vip", RechargeDiscount: 0}
	withDiscount := model.User{Group: "vip", RechargeDiscount: 0.6}
	baseMoney := GetChargedAmount(amount, noDiscount)
	assert.InDelta(t, 12.0, baseMoney, 1e-9) // 10 * 1.2
	assert.InDelta(t, baseMoney, GetChargedAmount(amount, withDiscount), 1e-9, "stripe quota base must not depend on discount")
}
