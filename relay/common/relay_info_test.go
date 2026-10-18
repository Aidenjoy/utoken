package common

import (
	"math"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/require"
)

func TestRelayInfoGetFinalRequestRelayFormatPrefersExplicitFinal(t *testing.T) {
	info := &RelayInfo{
		RelayFormat:             types.RelayFormatOpenAI,
		RequestConversionChain:  []types.RelayFormat{types.RelayFormatOpenAI, types.RelayFormatClaude},
		FinalRequestRelayFormat: types.RelayFormatOpenAIResponses,
	}

	require.Equal(t, types.RelayFormat(types.RelayFormatOpenAIResponses), info.GetFinalRequestRelayFormat())
}

func TestRelayInfoGetFinalRequestRelayFormatFallsBackToConversionChain(t *testing.T) {
	info := &RelayInfo{
		RelayFormat:            types.RelayFormatOpenAI,
		RequestConversionChain: []types.RelayFormat{types.RelayFormatOpenAI, types.RelayFormatClaude},
	}

	require.Equal(t, types.RelayFormat(types.RelayFormatClaude), info.GetFinalRequestRelayFormat())
}

func TestRelayInfoGetFinalRequestRelayFormatFallsBackToRelayFormat(t *testing.T) {
	info := &RelayInfo{
		RelayFormat: types.RelayFormatGemini,
	}

	require.Equal(t, types.RelayFormat(types.RelayFormatGemini), info.GetFinalRequestRelayFormat())
}

func TestRelayInfoGetFinalRequestRelayFormatNilReceiver(t *testing.T) {
	var info *RelayInfo
	require.Equal(t, types.RelayFormat(""), info.GetFinalRequestRelayFormat())
}

// TestRelayInfoModelDiscountRatio 锁定折扣读取的防御性回退：未初始化、
// 越界与 NaN 一律按原价，避免折扣为 0 时整条计费链免费。
func TestRelayInfoModelDiscountRatio(t *testing.T) {
	require.InDelta(t, 0.8, (&RelayInfo{UserModelDiscount: 0.8}).ModelDiscountRatio(), 1e-9)
	require.InDelta(t, 1.0, (&RelayInfo{UserModelDiscount: 1}).ModelDiscountRatio(), 1e-9)

	// 空构造（如任务轮询路径）与非法值均回退原价。
	require.InDelta(t, common.NoModelDiscount, (&RelayInfo{}).ModelDiscountRatio(), 1e-9)
	require.InDelta(t, common.NoModelDiscount, (&RelayInfo{UserModelDiscount: 0}).ModelDiscountRatio(), 1e-9)
	require.InDelta(t, common.NoModelDiscount, (&RelayInfo{UserModelDiscount: -0.5}).ModelDiscountRatio(), 1e-9)
	require.InDelta(t, common.NoModelDiscount, (&RelayInfo{UserModelDiscount: 1.5}).ModelDiscountRatio(), 1e-9)
	require.InDelta(t, common.NoModelDiscount, (&RelayInfo{UserModelDiscount: math.NaN()}).ModelDiscountRatio(), 1e-9)
	require.InDelta(t, common.NoModelDiscount, (&RelayInfo{UserModelDiscount: math.Inf(1)}).ModelDiscountRatio(), 1e-9)
}

// TestRelayInfoModelDiscountResolution 校验 NewRelayInfo 之外的解析入口：
// 折扣按请求模型名匹配，任务路径在模型名确定后会重新解析。
func TestRelayInfoModelDiscountResolution(t *testing.T) {
	const discounts = `{"doubao-seedance-2.0":0.8,"doubao-seedance-*":0.9}`

	info := &RelayInfo{ModelDiscounts: discounts, OriginModelName: "doubao-seedance-2.0"}
	info.UserModelDiscount = common.ResolveUserModelDiscount(info.ModelDiscounts, info.OriginModelName)
	require.InDelta(t, 0.8, info.ModelDiscountRatio(), 1e-9)

	// 模型名变化后重新解析 → 命中通配。
	info.OriginModelName = "doubao-seedance-2.5"
	info.UserModelDiscount = common.ResolveUserModelDiscount(info.ModelDiscounts, info.OriginModelName)
	require.InDelta(t, 0.9, info.ModelDiscountRatio(), 1e-9)

	// 未配置的模型保持原价。
	info.OriginModelName = "gpt-4o"
	info.UserModelDiscount = common.ResolveUserModelDiscount(info.ModelDiscounts, info.OriginModelName)
	require.InDelta(t, common.NoModelDiscount, info.ModelDiscountRatio(), 1e-9)
}
