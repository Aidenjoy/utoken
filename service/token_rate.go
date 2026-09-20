package service

import (
	"fmt"
	"math"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
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

	usagePath := locateVolcUsagePath(body)
	if usagePath == "" {
		return body
	}

	oldCompletion, hasCompletion := readUsageToken(body, usagePath+".completion_tokens")
	oldTotal, hasTotal := readUsageToken(body, usagePath+".total_tokens")
	if !hasCompletion && !hasTotal {
		return body
	}

	newCompletion := scaleTokensByRate(oldCompletion, rate, userId, logPrefix)
	newTotal := scaleTokensByRate(oldTotal, rate, userId, logPrefix)

	// 用 sjson 原地替换这两个 token 值：整个文档的字段顺序、缩进与其余字段
	// 保持上游原样，避免缩放后键序重排被客户端察觉异常。
	scaled := body
	var err error
	if hasCompletion {
		if scaled, err = writeUsageToken(scaled, usagePath+".completion_tokens", newCompletion); err != nil {
			return body
		}
	}
	if hasTotal {
		if scaled, err = writeUsageToken(scaled, usagePath+".total_tokens", newTotal); err != nil {
			return body
		}
	}

	// 说明：本函数在 ParseTaskResult 之前缩放 body，因此 taskcommon.ParseVolcTaskResult
	// 输出的 "Fetch task response" 已是缩放后的响应体（即客户端最终收到的 JSON），
	// 无需再重复打印一次改后 body。这里只补一条计算日志，给出「原 token → 费率
	// → 新 token」，便于用接口调用核算费率是否生效。
	common.SysLog(fmt.Sprintf("%s Token rate applied: user=%d rate=%.4f completion_tokens %d -> %d, total_tokens %d -> %d",
		logPrefix, userId, rate, oldCompletion, newCompletion, oldTotal, newTotal))
	return scaled
}

// locateVolcUsagePath 返回 usage 对象的 gjson/sjson 路径：顶层优先，
// result_summary.usage 兜底（与 taskcommon.VolcTaskResponse 的解析优先级一致）。
func locateVolcUsagePath(body []byte) string {
	if gjson.GetBytes(body, "usage").IsObject() {
		return "usage"
	}
	if gjson.GetBytes(body, "result_summary.usage").IsObject() {
		return "result_summary.usage"
	}
	return ""
}

// readUsageToken 读取指定路径的 token 数。上游存在数字与字符串两种形态
// （见 taskcommon 的宽容整数解析），非法/负值视为不可缩放。
func readUsageToken(body []byte, path string) (value int64, ok bool) {
	r := gjson.GetBytes(body, path)
	var str string
	switch r.Type {
	case gjson.Number:
		str = r.Raw
	case gjson.String:
		str = r.Str
	default:
		return 0, false
	}
	parsed, err := strconv.ParseInt(str, 10, 64)
	if err != nil || parsed < 0 {
		return 0, false
	}
	return parsed, true
}

// writeUsageToken 用 sjson 原地替换指定路径的 token 数，保持原始类型
// （数字→数字，字符串→字符串）且不扰动文档其余部分与字段顺序。
func writeUsageToken(body []byte, path string, value int64) ([]byte, error) {
	if gjson.GetBytes(body, path).Type == gjson.String {
		return sjson.SetBytes(body, path, strconv.FormatInt(value, 10))
	}
	return sjson.SetBytes(body, path, value)
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
