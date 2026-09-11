package taskcommon

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/pkg/errors"
	"github.com/samber/lo"
)

// volcLenientInt 容忍数字、数字字符串与空值（""、null、无法解析一律记 0）。
// 个别中转站会把数字字段降级为字符串（无值时给空串），严格 int 会让整个
// 任务响应反序列化失败，任务被永久卡在进行中，这里统一降级兜底。
type volcLenientInt int

func (v *volcLenientInt) UnmarshalJSON(data []byte) error {
	switch strings.TrimSpace(string(data)) {
	case "", "null", `""`:
		return nil
	}
	var n int
	if err := common.Unmarshal(data, &n); err == nil {
		*v = volcLenientInt(n)
		return nil
	}
	var s string
	if err := common.Unmarshal(data, &s); err == nil {
		if parsed, convErr := strconv.Atoi(strings.TrimSpace(s)); convErr == nil {
			*v = volcLenientInt(parsed)
		}
	}
	return nil
}

// volcUsage 兼容官方与中转站的 usage：官方为数字对象，部分中转站把全部字段
// 降级为字符串（无值时为空串），tool_usage 可能是对象或字符串。仅提取计费
// 用到的两个 token 字段，任何异常形态都降级为 0，不阻断任务状态解析。
type volcUsage struct {
	CompletionTokens int
	TotalTokens      int
}

func (u *volcUsage) UnmarshalJSON(data []byte) error {
	var raw map[string]json.RawMessage
	if err := common.Unmarshal(data, &raw); err != nil {
		return nil
	}
	for key, target := range map[string]*int{
		"completion_tokens": &u.CompletionTokens,
		"total_tokens":      &u.TotalTokens,
	} {
		var v volcLenientInt
		if err := common.Unmarshal(raw[key], &v); err == nil {
			*target = int(v)
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Volcengine Ark shared protocol helpers — used by both the common-format
// doubao adapter and the official-protocol passthrough (arknative) adapter.
// ---------------------------------------------------------------------------

// HasVolcVersionPathSuffix 判断 baseURL 是否已带版本路径后缀
// （/v1、/api/v2、/api/plan/v3 等）。自行拼接版本路径的调用方命中时
// 必须跳过拼接，避免叠出 /api/plan/v3/api/v3/... 双重路径。
func HasVolcVersionPathSuffix(baseURL string) bool {
	return volcVersionPathSuffixRE.MatchString(strings.TrimSuffix(baseURL, "/"))
}

// BuildVolcTaskURL 按渠道 baseURL 构造火山方舟任务地址。
// baseURL 已带版本路径后缀（如中转站用 /api/v2 代替官方 /api/v3）时直接拼任务路径，
// 避免拼出 /api/v2/api/v3/... 双重路径；无版本后缀视为火山官方，拼默认 /api/v3。
func BuildVolcTaskURL(baseURL, taskPath string) string {
	trimmed := strings.TrimSuffix(baseURL, "/")
	if HasVolcVersionPathSuffix(trimmed) {
		return trimmed + taskPath
	}
	return trimmed + "/api/v3" + taskPath
}

var volcVersionPathSuffixRE = regexp.MustCompile(`/(?:api/)?v\d+$`)

// VolcTaskResponse 火山方舟任务查询响应结构。
// 同时兼容两种格式：官方顶层 content/usage，以及中转站（如 ai-tokenhub）
// 的 resultSummary 包装格式（video_url / usage 位于 resultSummary 内，
// duration 为字符串而非官方的数字）。
type VolcTaskResponse struct {
	ID      string `json:"id"`
	Model   string `json:"model"`
	Status  string `json:"status"`
	Content struct {
		VideoURL string `json:"video_url"`
	} `json:"content"`
	ResultSummary struct {
		Content struct {
			VideoURL string `json:"video_url"`
		} `json:"content"`
		Usage      volcUsage `json:"usage"`
		Resolution string    `json:"resolution"`
	} `json:"resultSummary"`
	Seed            volcLenientInt `json:"seed"`
	Resolution      string         `json:"resolution"`
	Duration        volcLenientInt `json:"duration"`
	Ratio           string         `json:"ratio"`
	FramesPerSecond volcLenientInt `json:"framespersecond"`
	ServiceTier     string         `json:"service_tier"`
	Tools           []struct {
		Type string `json:"type"`
	} `json:"tools"`
	Usage volcUsage `json:"usage"`
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
	// 注意：不解析 created_at / updated_at —— 官方为 unix 数字，中转站为 ISO 字符串，
	// 且包内无使用方；声明为 int64 会在中转站响应上整体反序列化失败。
}

// VideoURL 返回任务结果视频地址：官方顶层 content 优先，中转站 resultSummary 兜底。
func (r *VolcTaskResponse) VideoURL() string {
	return lo.CoalesceOrEmpty(r.Content.VideoURL, r.ResultSummary.Content.VideoURL)
}

// CompletionTokens 返回 completion tokens：官方顶层 usage 优先，中转站 resultSummary 兜底。
func (r *VolcTaskResponse) CompletionTokens() int {
	return lo.CoalesceOrEmpty(r.Usage.CompletionTokens, r.ResultSummary.Usage.CompletionTokens)
}

// TotalTokens 返回 total tokens：官方顶层 usage 优先，中转站 resultSummary 兜底。
func (r *VolcTaskResponse) TotalTokens() int {
	return lo.CoalesceOrEmpty(r.Usage.TotalTokens, r.ResultSummary.Usage.TotalTokens)
}

// OutputResolution 返回任务实际输出分辨率：官方顶层 resolution 优先，中转站 resultSummary 兜底。
// 用于 seedance 按分辨率结算（转小写比较）。方法名避开与顶层 Resolution 字段重名。
func (r *VolcTaskResponse) OutputResolution() string {
	return lo.CoalesceOrEmpty(r.Resolution, r.ResultSummary.Resolution)
}

// ParseVolcTaskResult 解析火山方舟任务查询响应为内部 TaskInfo。
// logPrefix 用于日志归因（如 "[DoubaoVideo]" / "[ArkNative]"）。
func ParseVolcTaskResult(respBody []byte, logPrefix string) (*relaycommon.TaskInfo, error) {
	logBody := string(respBody)
	if len(logBody) > 2000 {
		logBody = logBody[:2000] + "...(truncated)"
	}
	common.SysLog(fmt.Sprintf("%s Fetch task response: %s", logPrefix, logBody))

	resTask := VolcTaskResponse{}
	if err := common.Unmarshal(respBody, &resTask); err != nil {
		common.SysError(fmt.Sprintf("%s Failed to unmarshal task result: %v, body: %s", logPrefix, err, logBody))
		// 兜底：仅解析推进状态所需的关键字段，避免单个异常字段把任务永久卡在进行中
		fallback := struct {
			ID      string `json:"id"`
			Status  string `json:"status"`
			Content struct {
				VideoURL string `json:"video_url"`
			} `json:"content"`
		}{}
		if fbErr := common.Unmarshal(respBody, &fallback); fbErr != nil {
			return nil, errors.Wrap(err, "unmarshal task result failed")
		}
		resTask.ID = fallback.ID
		resTask.Status = fallback.Status
		resTask.Content.VideoURL = fallback.Content.VideoURL
	}

	common.SysLog(fmt.Sprintf("%s Task status: id=%s status=%s error=%s",
		logPrefix, resTask.ID, resTask.Status, resTask.Error.Message))

	taskResult := relaycommon.TaskInfo{
		Code: 0,
	}

	// Map Volc status to internal status
	switch resTask.Status {
	case "pending", "queued":
		taskResult.Status = model.TaskStatusQueued
		taskResult.Progress = "10%"
	case "processing", "running":
		taskResult.Status = model.TaskStatusInProgress
		taskResult.Progress = "50%"
	case "succeeded":
		taskResult.Status = model.TaskStatusSuccess
		taskResult.Progress = "100%"
		taskResult.Url = resTask.VideoURL()
		// 解析 usage 信息用于按倍率计费
		taskResult.CompletionTokens = resTask.CompletionTokens()
		taskResult.TotalTokens = resTask.TotalTokens()
		// 解析实际输出分辨率用于 seedance 按分辨率结算
		taskResult.Resolution = resTask.OutputResolution()
	case "failed":
		taskResult.Status = model.TaskStatusFailure
		taskResult.Progress = "100%"
		taskResult.Reason = resTask.Error.Message
	default:
		// Unknown status, treat as processing
		taskResult.Status = model.TaskStatusInProgress
		taskResult.Progress = "30%"
	}

	return &taskResult, nil
}
