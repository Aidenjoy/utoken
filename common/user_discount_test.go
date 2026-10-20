package common

import (
	"math"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestResolveUserModelDiscount 覆盖折扣匹配的优先级规则：精确键命中、
// 前缀通配（"*" 结尾）、最长前缀优先，以及任何异常输入都退化为原价 1。
// 这条不变量很关键：折扣配置损坏时最坏情况是按原价扣费，绝不免费。
func TestResolveUserModelDiscount(t *testing.T) {
	tests := []struct {
		name          string
		discountsJSON string
		modelName     string
		want          float64
	}{
		{
			name:          "精确命中",
			discountsJSON: `{"doubao-seedance-2.0":0.8,"doubao-seedance-2.5":0.9}`,
			modelName:     "doubao-seedance-2.0",
			want:          0.8,
		},
		{
			name:          "精确键优先于前缀通配",
			discountsJSON: `{"seedance":0.5,"seedance*":0.9}`,
			modelName:     "seedance",
			want:          0.5,
		},
		{
			name:          "前缀通配命中",
			discountsJSON: `{"doubao-seedance-*":0.85}`,
			modelName:     "doubao-seedance-2.0-lite",
			want:          0.85,
		},
		{
			name:          "最长前缀优先",
			discountsJSON: `{"seedance*":0.9,"seedance-2.0*":0.8,"seedance-2.0-i2v*":0.7}`,
			modelName:     "seedance-2.0-i2v-720p",
			want:          0.7,
		},
		{
			name:          "最长前缀优先-次长命中",
			discountsJSON: `{"seedance*":0.9,"seedance-2.0*":0.8}`,
			modelName:     "seedance-2.0-t2v",
			want:          0.8,
		},
		{
			name:          "无匹配返回原价",
			discountsJSON: `{"gpt-4o":0.8,"seedance*":0.9}`,
			modelName:     "claude-sonnet-4",
			want:          NoModelDiscount,
		},
		{
			name:          "通配符不在末尾时不作前缀匹配",
			discountsJSON: `{"*seedance":0.8}`,
			modelName:     "seedance",
			want:          NoModelDiscount,
		},
		{
			name:          "空配置",
			discountsJSON: "",
			modelName:     "gpt-4o",
			want:          NoModelDiscount,
		},
		{
			name:          "空白配置",
			discountsJSON: "   \n ",
			modelName:     "gpt-4o",
			want:          NoModelDiscount,
		},
		{
			name:          "坏 JSON",
			discountsJSON: `{"gpt-4o":`,
			modelName:     "gpt-4o",
			want:          NoModelDiscount,
		},
		{
			name:          "非对象 JSON（数组）",
			discountsJSON: `[{"gpt-4o":0.8}]`,
			modelName:     "gpt-4o",
			want:          NoModelDiscount,
		},
		{
			name:          "模型名为空",
			discountsJSON: `{"gpt-4o":0.8,"*":0.1}`,
			modelName:     "",
			want:          NoModelDiscount,
		},
		{
			name:          "折扣为 0 非法，按原价",
			discountsJSON: `{"gpt-4o":0}`,
			modelName:     "gpt-4o",
			want:          NoModelDiscount,
		},
		{
			name:          "折扣为负非法，按原价",
			discountsJSON: `{"gpt-4o":-0.5}`,
			modelName:     "gpt-4o",
			want:          NoModelDiscount,
		},
		{
			name:          "折扣大于 1 非法，按原价",
			discountsJSON: `{"gpt-4o":1.5}`,
			modelName:     "gpt-4o",
			want:          NoModelDiscount,
		},
		{
			name:          "折扣为 1 等同原价",
			discountsJSON: `{"gpt-4o":1}`,
			modelName:     "gpt-4o",
			want:          NoModelDiscount,
		},
		{
			name:          "非法通配值不影响其它合法条目",
			discountsJSON: `{"seedance*":0,"seedance-2.0*":0.8}`,
			modelName:     "seedance-2.0",
			want:          0.8,
		},
		{
			name:          "全局通配 * 不参与匹配",
			discountsJSON: `{"*":0.1}`,
			modelName:     "whatever-model",
			want:          NoModelDiscount,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ResolveUserModelDiscount(tt.discountsJSON, tt.modelName)
			assert.InDelta(t, tt.want, got, 1e-9)
		})
	}
}

// TestIsValidModelDiscount 直接校验取值边界：JSON 无法表达 NaN/Inf，
// 但历史脏数据或反序列化旁路可能带进来，必须在进入乘法前拦掉。
func TestIsValidModelDiscount(t *testing.T) {
	assert.True(t, isValidModelDiscount(0.8))
	assert.True(t, isValidModelDiscount(1))
	assert.True(t, isValidModelDiscount(math.SmallestNonzeroFloat64))

	assert.False(t, isValidModelDiscount(0))
	assert.False(t, isValidModelDiscount(-0.1))
	assert.False(t, isValidModelDiscount(1.0000001))
	assert.False(t, isValidModelDiscount(math.NaN()))
	assert.False(t, isValidModelDiscount(math.Inf(1)))
	assert.False(t, isValidModelDiscount(math.Inf(-1)))
}

// TestParseModelDiscounts 校验解析层的容错：坏数据返回 nil 而不是 panic。
func TestParseModelDiscounts(t *testing.T) {
	assert.Nil(t, ParseModelDiscounts(""))
	assert.Nil(t, ParseModelDiscounts("not-json"))

	discounts := ParseModelDiscounts(`{"gpt-4o":0.8}`)
	require.Len(t, discounts, 1)
	assert.InDelta(t, 0.8, discounts["gpt-4o"], 1e-9)

	// 空对象是合法配置（表示清空折扣）。
	assert.Empty(t, ParseModelDiscounts(`{}`))
}

// TestHasModelDiscounts 支撑前端「原价/折扣」两列的默认可见性：
// 只要有一条合法折扣就应默认展示。
func TestHasModelDiscounts(t *testing.T) {
	assert.False(t, HasModelDiscounts(""))
	assert.False(t, HasModelDiscounts("{}"))
	assert.False(t, HasModelDiscounts("broken"))
	assert.False(t, HasModelDiscounts(`{"gpt-4o":0}`))
	assert.False(t, HasModelDiscounts(`{"gpt-4o":1}`), "折扣 1 等价原价，不应触发默认展示")
	assert.True(t, HasModelDiscounts(`{"gpt-4o":0.8}`))
	assert.True(t, HasModelDiscounts(`{"seedance*":0.9}`))
}

// TestNormalizeModelDiscounts 校验管理端写入前的规范化：值域、条目数、
// 键长度、键去空白，以及四舍五入到 4 位小数。
func TestNormalizeModelDiscounts(t *testing.T) {
	// 空输入 → 空 map（视为清空折扣），不报错。
	normalized, err := NormalizeModelDiscounts(nil)
	require.NoError(t, err)
	assert.Empty(t, normalized)

	normalized, err = NormalizeModelDiscounts(map[string]float64{})
	require.NoError(t, err)
	assert.Empty(t, normalized)

	// 正常配置：键去空白 + 4 位小数。
	normalized, err = NormalizeModelDiscounts(map[string]float64{
		"  doubao-seedance-2.0  ": 0.8,
		"seedance*":               0.855555,
		"gpt-4o":                  1,
	})
	require.NoError(t, err)
	require.Len(t, normalized, 3)
	assert.InDelta(t, 0.8, normalized["doubao-seedance-2.0"], 1e-9)
	assert.InDelta(t, 0.8556, normalized["seedance*"], 1e-9)
	assert.InDelta(t, 1, normalized["gpt-4o"], 1e-9)

	tests := []struct {
		name      string
		discounts map[string]float64
		wantErr   error
	}{
		{name: "折扣为 0", discounts: map[string]float64{"gpt-4o": 0}, wantErr: errModelDiscountInvalidRate},
		{name: "折扣为负", discounts: map[string]float64{"gpt-4o": -0.1}, wantErr: errModelDiscountInvalidRate},
		{name: "折扣大于 1", discounts: map[string]float64{"gpt-4o": 1.01}, wantErr: errModelDiscountInvalidRate},
		{name: "折扣为 NaN", discounts: map[string]float64{"gpt-4o": math.NaN()}, wantErr: errModelDiscountInvalidRate},
		{name: "折扣为 Inf", discounts: map[string]float64{"gpt-4o": math.Inf(1)}, wantErr: errModelDiscountInvalidRate},
		{name: "空键", discounts: map[string]float64{"   ": 0.8}, wantErr: errModelDiscountEmptyKey},
		{name: "全局通配", discounts: map[string]float64{"*": 0.8}, wantErr: errModelDiscountGlobalWild},
		{
			name:      "键过长",
			discounts: map[string]float64{strings.Repeat("a", MaxModelDiscountKeyLength+1): 0.8},
			wantErr:   errModelDiscountKeyTooLong,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NormalizeModelDiscounts(tt.discounts)
			require.ErrorIs(t, err, tt.wantErr)
			assert.Nil(t, got)
		})
	}

	// 键长度上限本身是合法的（边界）。
	normalized, err = NormalizeModelDiscounts(map[string]float64{
		strings.Repeat("a", MaxModelDiscountKeyLength): 0.8,
	})
	require.NoError(t, err)
	assert.Len(t, normalized, 1)

	// 条目数超限。
	tooMany := make(map[string]float64, MaxModelDiscountEntries+1)
	for i := 0; i <= MaxModelDiscountEntries; i++ {
		tooMany["model-"+strconv.Itoa(i)] = 0.8
	}
	require.Greater(t, len(tooMany), MaxModelDiscountEntries)
	_, err = NormalizeModelDiscounts(tooMany)
	assert.ErrorIs(t, err, errModelDiscountTooMany)

	// 去空白后键重复应报错，避免后写入者静默覆盖。
	_, err = NormalizeModelDiscounts(map[string]float64{"gpt-4o": 0.8, " gpt-4o ": 0.9})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "gpt-4o")
}

// TestNormalizeAgentModelFloors 覆盖代理商授权配置（{模型名: 折扣下限}）的校验。
// 与 NormalizeModelDiscounts 的两处关键差异是这里的重点：不允许为空、不允许通配键。
func TestNormalizeAgentModelFloors(t *testing.T) {
	// 正常配置：键去空白、值保留 4 位小数。
	normalized, err := NormalizeAgentModelFloors(map[string]float64{" gpt-4o ": 0.81254, "claude-3-5-sonnet": 1})
	require.NoError(t, err)
	assert.Equal(t, map[string]float64{"gpt-4o": 0.8125, "claude-3-5-sonnet": 1}, normalized)

	// 空授权等于“成员一个模型都调不通”，必须在写入时就拦住。
	_, err = NormalizeAgentModelFloors(nil)
	assert.ErrorIs(t, err, ErrAgentModelsEmpty)
	_, err = NormalizeAgentModelFloors(map[string]float64{})
	assert.ErrorIs(t, err, ErrAgentModelsEmpty)

	// 通配键在白名单语义下会过度放行，一律拒绝。
	_, err = NormalizeAgentModelFloors(map[string]float64{"*": 0.8})
	assert.ErrorIs(t, err, errAgentModelWildcard)
	_, err = NormalizeAgentModelFloors(map[string]float64{"seedance*": 0.8})
	assert.ErrorIs(t, err, errAgentModelWildcard)

	// 值域与键约束复用按模型折扣那套规则。
	_, err = NormalizeAgentModelFloors(map[string]float64{"gpt-4o": 0})
	assert.ErrorIs(t, err, errModelDiscountInvalidRate)
	_, err = NormalizeAgentModelFloors(map[string]float64{"gpt-4o": 1.2})
	assert.ErrorIs(t, err, errModelDiscountInvalidRate)
	_, err = NormalizeAgentModelFloors(map[string]float64{"gpt-4o": math.NaN()})
	assert.ErrorIs(t, err, errModelDiscountInvalidRate)
	_, err = NormalizeAgentModelFloors(map[string]float64{"   ": 0.8})
	assert.ErrorIs(t, err, errModelDiscountEmptyKey)
	_, err = NormalizeAgentModelFloors(map[string]float64{strings.Repeat("m", MaxModelDiscountKeyLength+1): 0.8})
	assert.ErrorIs(t, err, errModelDiscountKeyTooLong)

	tooMany := make(map[string]float64, MaxModelDiscountEntries+1)
	for i := 0; i <= MaxModelDiscountEntries; i++ {
		tooMany["model-"+strconv.Itoa(i)] = 0.8
	}
	_, err = NormalizeAgentModelFloors(tooMany)
	assert.ErrorIs(t, err, errModelDiscountTooMany)

	// 一个键违规就整体拒绝：授权清单是原子的，半套清单落库会造成“能看见却调不通”。
	_, err = NormalizeAgentModelFloors(map[string]float64{"gpt-4o": 0.8, "seedance*": 0.9})
	assert.ErrorIs(t, err, errAgentModelWildcard)
}

// TestValidateModelDiscountsWithinFloors 覆盖代理商给成员设折扣的边界：
// 未授权模型被拒、低于下限被拒、恰好等于下限必须通过。
// 返回出错的模型名，供 controller 填 i18n 的 {{.Model}} 占位。
func TestValidateModelDiscountsWithinFloors(t *testing.T) {
	floors := map[string]float64{"gpt-4o": 0.8, "claude-3-5-sonnet": 0.95}

	tests := []struct {
		name      string
		discounts map[string]float64
		wantModel string
		wantErr   error
	}{
		{
			name:      "empty discount set is allowed",
			discounts: map[string]float64{},
		},
		{
			name:      "nil discount set is allowed",
			discounts: nil,
		},
		{
			name:      "at the floor passes",
			discounts: map[string]float64{"gpt-4o": 0.8},
		},
		{
			name:      "above the floor passes",
			discounts: map[string]float64{"gpt-4o": 0.9, "claude-3-5-sonnet": 1},
		},
		{
			// 二进制浮点尾差不能把“恰好等于下限”误判成越界。
			name:      "floor equality survives float noise",
			discounts: map[string]float64{"gpt-4o": 0.8000000001},
		},
		{
			name:      "below the floor rejected",
			discounts: map[string]float64{"gpt-4o": 0.7999},
			wantModel: "gpt-4o",
			wantErr:   ErrAgentDiscountBelowFloor,
		},
		{
			name:      "zero rejected as below floor",
			discounts: map[string]float64{"claude-3-5-sonnet": 0},
			wantModel: "claude-3-5-sonnet",
			wantErr:   ErrAgentDiscountBelowFloor,
		},
		{
			name:      "unauthorized model rejected",
			discounts: map[string]float64{"gpt-4o-mini": 1},
			wantModel: "gpt-4o-mini",
			wantErr:   ErrAgentModelNotAuthorized,
		},
		{
			name:      "unauthorized model rejected even at full price",
			discounts: map[string]float64{"gpt-4o": 0.9, "doubao-seedance": 1},
			wantModel: "doubao-seedance",
			wantErr:   ErrAgentModelNotAuthorized,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			model, err := ValidateModelDiscountsWithinFloors(tc.discounts, floors)
			if tc.wantErr == nil {
				assert.NoError(t, err)
				assert.Empty(t, model)
				return
			}
			assert.ErrorIs(t, err, tc.wantErr)
			assert.Equal(t, tc.wantModel, model, "the offending model name feeds the i18n placeholder")
		})
	}

	// 授权清单为空（代理配置损坏）时任何折扣都算未授权，而不是全部放行。
	model, err := ValidateModelDiscountsWithinFloors(map[string]float64{"gpt-4o": 1}, nil)
	assert.ErrorIs(t, err, ErrAgentModelNotAuthorized)
	assert.Equal(t, "gpt-4o", model)
}

// TestApplyModelDiscount 校验计费不变量：折扣只减不增、非法折扣与
// 非正额度原样返回（绝不产生负扣费或免费额度）。
func TestApplyModelDiscount(t *testing.T) {
	assert.Equal(t, 800, ApplyModelDiscount(1000, 0.8))
	assert.Equal(t, 86, ApplyModelDiscount(100, 0.855))
	assert.Equal(t, 42, ApplyModelDiscount(42, 0.999))
	// 四舍五入：0.5 进位。
	assert.Equal(t, 1, ApplyModelDiscount(1, 0.5))
	assert.Equal(t, 3, ApplyModelDiscount(5, 0.5))

	// 折扣 1（或越界）→ 原价。
	assert.Equal(t, 1000, ApplyModelDiscount(1000, NoModelDiscount))
	assert.Equal(t, 1000, ApplyModelDiscount(1000, 0))
	assert.Equal(t, 1000, ApplyModelDiscount(1000, -0.5))
	assert.Equal(t, 1000, ApplyModelDiscount(1000, 1.5))
	assert.Equal(t, 1000, ApplyModelDiscount(1000, math.NaN()))
	assert.Equal(t, 1000, ApplyModelDiscount(1000, math.Inf(1)))

	// 非正额度原样返回（退款/零额度日志不应被折扣改写成负数）。
	assert.Equal(t, 0, ApplyModelDiscount(0, 0.8))
	assert.Equal(t, -100, ApplyModelDiscount(-100, 0.8))

	// 极小折扣下仍不越过下界。
	assert.Equal(t, MinQuota, ApplyModelDiscount(MinQuota, 0.8))
	assert.Equal(t, MaxQuota, ApplyModelDiscount(MaxQuota, 1))
}

// TestApplyModelDiscountNeverNegative 是一次快速性质检查：任意正额度配上
// 合法折扣后结果必须仍在 [0, 原额度] 区间内。
func TestApplyModelDiscountNeverNegative(t *testing.T) {
	quotas := []int{1, 2, 7, 100, 12345, MaxQuota}
	discounts := []float64{0.0001, 0.1, 0.5, 0.7999, 0.9999}
	for _, quota := range quotas {
		for _, discount := range discounts {
			got := ApplyModelDiscount(quota, discount)
			assert.GreaterOrEqual(t, got, 0, "quota=%d discount=%v", quota, discount)
			assert.LessOrEqual(t, got, quota, "quota=%d discount=%v", quota, discount)
		}
	}
}
