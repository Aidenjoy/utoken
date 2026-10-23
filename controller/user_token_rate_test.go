package controller

import (
	"math"
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestResolveTokenRateFromDiscounts 守护「设置费率」由渠道采购折扣（分子）/客户期望折扣（分母）反算费率的
// 计算与校验契约：费率 = 分子/分母（即 采购/期望）；两者皆 0 表示清除；单边 0、负值、NaN/Inf、折扣超上限、费率越界一律拒绝。
// 该费率是 seedance 视频任务的计费倍率，错误放行会直接导致多扣或少扣额度，因此每条边界都必须显式覆盖。
func TestResolveTokenRateFromDiscounts(t *testing.T) {
	tests := []struct {
		name     string
		expected float64
		purchase float64
		wantRate float64
		wantOK   bool
	}{
		{name: "both zero clears rate", expected: 0, purchase: 0, wantRate: 0, wantOK: true},
		{name: "numerator over denominator", expected: 0.6, purchase: 0.9, wantRate: 1.5, wantOK: true},
		{name: "denominator one keeps rate", expected: 1, purchase: 1.5, wantRate: 1.5, wantOK: true},
		{name: "small ratio within bounds", expected: 100, purchase: 1, wantRate: 0.01, wantOK: true},
		{name: "long ratio ceils to two decimals", expected: 0.78, purchase: 0.9, wantRate: 1.16, wantOK: true},
		{name: "zero denominator rejected", expected: 0, purchase: 1, wantRate: 0, wantOK: false},
		{name: "zero numerator rejected", expected: 1, purchase: 0, wantRate: 0, wantOK: false},
		{name: "negative numerator rejected", expected: 1, purchase: -1, wantRate: 0, wantOK: false},
		{name: "negative denominator rejected", expected: -1, purchase: 1, wantRate: 0, wantOK: false},
		{name: "NaN numerator rejected", expected: 1, purchase: math.NaN(), wantRate: 0, wantOK: false},
		{name: "Inf denominator rejected", expected: math.Inf(1), purchase: 1, wantRate: 0, wantOK: false},
		{name: "numerator above max rejected", expected: 1, purchase: 101, wantRate: 0, wantOK: false},
		{name: "denominator above max rejected", expected: 101, purchase: 1, wantRate: 0, wantOK: false},
		{name: "rate above max rejected", expected: 0.5, purchase: 100, wantRate: 0, wantOK: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rate, ok := resolveTokenRateFromDiscounts(tt.expected, tt.purchase)
			assert.Equal(t, tt.wantOK, ok)
			if tt.wantOK {
				assert.InDelta(t, tt.wantRate, rate, 1e-9)
			} else {
				assert.Zero(t, rate)
			}
		})
	}
}

// TestCeilTokenRate 守护费率向上取整到 2 位小数的计费安全语义：只进不舍（避免截断少收/扩损），
// 且本就是两位小数的值不因浮点噪声（如 0.07*100=7.000…1）被误进位。
func TestCeilTokenRate(t *testing.T) {
	tests := []struct {
		name string
		in   float64
		want float64
	}{
		{name: "long repeating decimal rounds up", in: 1.1538461538461537, want: 1.16},
		{name: "third decimal below five still rounds up", in: 1.821, want: 1.83},
		{name: "third decimal five rounds up", in: 1.275, want: 1.28},
		{name: "clean one decimal unchanged", in: 1.5, want: 1.5},
		{name: "integer unchanged", in: 2, want: 2},
		{name: "fp noise above integer not bumped", in: 0.07, want: 0.07},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.InDelta(t, tt.want, ceilTokenRate(tt.in), 1e-9)
		})
	}
}
