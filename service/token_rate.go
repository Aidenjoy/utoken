package service

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/billing_setting"
)

// ScaleSeedanceTaskUsageByUserRate 按用户 token 费率缩放 seedance 视频任务查询响应中的
// usage token 数。调用点必须位于 ParseTaskResult / ApplyUpstreamTaskResult 之前，
// 这样计费结算、task.Data 快照与客户端可见 JSON 全部自动使用缩放后的值，
// 计费链路本身无需任何改动。
//
// 范围严格限定为「按 seedance 计费」的任务：仅当 taskModelName(task) 的计费模式为
// BillingModeSeedance 时才缩放。语言模型按 token（ratio）、按次、Seedream 按张、
// 以及其它视频平台一律原样返回。
//
// 费率未设置（<=0）或恰好为 1 时同样原样返回，不做任何修改与日志输出。
//
// 注意：任务提交时的预扣费仍按原价估算，结算差额按缩放后 token 补扣，
// 属既有预扣/结算机制；管理员修改费率只影响之后发生的查询/结算。
func ScaleSeedanceTaskUsageByUserRate(body []byte, task *model.Task, logPrefix string) []byte {
	if task == nil {
		return body
	}
	if billing_setting.GetBillingMode(taskModelName(task)) != billing_setting.BillingModeSeedance {
		return body
	}
	rate := model.GetUserTokenRate(task.UserId)
	return scaleVolcUsageByRate(body, rate, task.UserId, logPrefix)
}

// scaleVolcUsageByRate 是纯粹的响应体缩放逻辑（不依赖计费模式与费率查询），
// 便于独立测试。费率 <=0 或 ==1、以及任何解析/回写失败均 fail-open 返回原始 body，
// 绝不阻断任务查询与结算。
func scaleVolcUsageByRate(body []byte, rate float64, userId int, logPrefix string) []byte {
	if rate <= 0 || rate == 1 {
		return body
	}

	var payload map[string]any
	if err := common.UnmarshalUseNumber(body, &payload); err != nil {
		return body
	}

	// 定位 usage 对象：官方顶层 usage 优先，中转站 result_summary.usage 兜底
	//（与 taskcommon.VolcTaskResponse 的解析优先级一致）。
	usage := locateVolcUsage(payload)
	if usage == nil {
		return body
	}

	oldCompletion, hasCompletion := readUsageTokens(usage, "completion_tokens")
	oldTotal, hasTotal := readUsageTokens(usage, "total_tokens")
	if !hasCompletion && !hasTotal {
		return body
	}

	newCompletion := scaleTokensByRate(oldCompletion, rate, userId, logPrefix)
	newTotal := scaleTokensByRate(oldTotal, rate, userId, logPrefix)
	if hasCompletion {
		writeUsageTokens(usage, "completion_tokens", newCompletion)
	}
	if hasTotal {
		writeUsageTokens(usage, "total_tokens", newTotal)
	}

	scaled, err := common.Marshal(payload)
	if err != nil {
		return body
	}

	// 原始响应日志已由 taskcommon.ParseVolcTaskResult 输出（"Fetch task response"），
	// 这里补充改后响应与计算日志，便于用接口调用核算费率是否生效。
	scaledLog := string(scaled)
	if len(scaledLog) > 2000 {
		scaledLog = scaledLog[:2000] + "...(truncated)"
	}
	common.SysLog(fmt.Sprintf("%s Fetch task response (after token rate): %s", logPrefix, scaledLog))
	common.SysLog(fmt.Sprintf("%s Token rate applied: user=%d rate=%.4f completion_tokens %d -> %d, total_tokens %d -> %d",
		logPrefix, userId, rate, oldCompletion, newCompletion, oldTotal, newTotal))
	return scaled
}

// locateVolcUsage 返回响应中的 usage 对象：顶层优先，result_summary.usage 兜底。
func locateVolcUsage(payload map[string]any) map[string]any {
	if usage, ok := payload["usage"].(map[string]any); ok && usage != nil {
		return usage
	}
	if summary, ok := payload["result_summary"].(map[string]any); ok {
		if usage, ok := summary["usage"].(map[string]any); ok {
			return usage
		}
	}
	return nil
}

// readUsageTokens 读取 usage 中的 token 数。上游存在数字与字符串两种形态
// （见 taskcommon 的宽容整数解析），非法/负值视为不可缩放。
func readUsageTokens(usage map[string]any, key string) (value int64, ok bool) {
	raw, exists := usage[key]
	if !exists {
		return 0, false
	}
	var str string
	switch v := raw.(type) {
	case json.Number:
		str = v.String()
	case string:
		str = v
	default:
		return 0, false
	}
	parsed, err := strconv.ParseInt(str, 10, 64)
	if err != nil || parsed < 0 {
		return 0, false
	}
	return parsed, true
}

// writeUsageTokens 按原始类型写回缩放后的 token 数（数字→数字，字符串→字符串）。
func writeUsageTokens(usage map[string]any, key string, value int64) {
	if _, isString := usage[key].(string); isString {
		usage[key] = strconv.FormatInt(value, 10)
		return
	}
	usage[key] = json.Number(strconv.FormatInt(value, 10))
}

// scaleTokensByRate 计算 value*rate 并四舍五入；结果钳制在 [0, MaxInt32]
// （token 数列在数据库为 32 位整数），钳制属防御性兜底，正常流量不会触发。
func scaleTokensByRate(value int64, rate float64, userId int, logPrefix string) int64 {
	scaled := math.Round(float64(value) * rate)
	if scaled < 0 || math.IsNaN(scaled) {
		common.SysError(fmt.Sprintf("%s token rate produced invalid value, clamped to 0: user=%d rate=%.4f tokens=%d", logPrefix, userId, rate, value))
		return 0
	}
	if scaled > math.MaxInt32 {
		common.SysError(fmt.Sprintf("%s token rate overflowed int32, clamped: user=%d rate=%.4f tokens=%d", logPrefix, userId, rate, value))
		return math.MaxInt32
	}
	return int64(scaled)
}
