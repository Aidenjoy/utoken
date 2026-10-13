package controller

import (
	"math"
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestResolveTokenRateFromDiscounts 守护「设置费率」由期望折扣（分子）/采购折扣（分母）反算费率的
// 计算与校验契约：费率 = 分子/分母；两者皆 0 表示清除；单边 0、负值、NaN/Inf、折扣超上限、费率越界一律拒绝。
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
		{name: "numerator over denominator", expected: 0.9, purchase: 0.6, wantRate: 1.5, wantOK: true},
		{name: "denominator one keeps rate", expected: 1.5, purchase: 1, wantRate: 1.5, wantOK: true},
		{name: "small ratio within bounds", expected: 1, purchase: 100, wantRate: 0.01, wantOK: true},
		{name: "zero denominator rejected", expected: 1, purchase: 0, wantRate: 0, wantOK: false},
		{name: "zero numerator rejected", expected: 0, purchase: 1, wantRate: 0, wantOK: false},
		{name: "negative numerator rejected", expected: -1, purchase: 1, wantRate: 0, wantOK: false},
		{name: "negative denominator rejected", expected: 1, purchase: -1, wantRate: 0, wantOK: false},
		{name: "NaN numerator rejected", expected: math.NaN(), purchase: 1, wantRate: 0, wantOK: false},
		{name: "Inf denominator rejected", expected: 1, purchase: math.Inf(1), wantRate: 0, wantOK: false},
		{name: "numerator above max rejected", expected: 101, purchase: 1, wantRate: 0, wantOK: false},
		{name: "denominator above max rejected", expected: 1, purchase: 101, wantRate: 0, wantOK: false},
		{name: "rate above max rejected", expected: 100, purchase: 0.5, wantRate: 0, wantOK: false},
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
