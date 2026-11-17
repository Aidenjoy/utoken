package common

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"

	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

type HasPrompt interface {
	GetPrompt() string
}

type HasImage interface {
	HasImage() bool
}

func GetFullRequestURL(baseURL string, requestURL string, channelType int) string {
	fullRequestURL := fmt.Sprintf("%s%s", baseURL, requestURL)

	if strings.HasPrefix(baseURL, "https://gateway.ai.cloudflare.com") {
		switch channelType {
		case constant.ChannelTypeOpenAI:
			fullRequestURL = fmt.Sprintf("%s%s", baseURL, strings.TrimPrefix(requestURL, "/v1"))
		case constant.ChannelTypeAzure:
			fullRequestURL = fmt.Sprintf("%s%s", baseURL, strings.TrimPrefix(requestURL, "/openai/deployments"))
		}
	}
	return fullRequestURL
}

func GetAPIVersion(c *gin.Context) string {
	query := c.Request.URL.Query()
	apiVersion := query.Get("api-version")
	if apiVersion == "" {
		apiVersion = c.GetString("api_version")
	}
	return apiVersion
}

// IsTemperatureOneOnlyModel 上游把采样温度固定为 1 的模型：Kimi K2.6 与
// K3 系列（kimi-k3/kimi-k3.1-pro 等）传其他值直接 400
// （"`temperature` only 1 is allowed for this model"），各渠道适配器
// 转发前需归一化为 1；客户端未传时保持省略。
func IsTemperatureOneOnlyModel(model string) bool {
	lowered := strings.ToLower(model)
	return lowered == "kimi-k2.6" || strings.HasPrefix(lowered, "kimi-k3")
}

// IsKimiFixedSamplingModel 上游固定采样参数的 Kimi 推理模型：K3 系列
// （kimi-k3/kimi-k3.1-pro 等）、kimi-k2.7-code、kimi-k2.6，官方参数参考
// 一致，火山方舟 coding plan 端点已实测。
func IsKimiFixedSamplingModel(model string) bool {
	lowered := strings.ToLower(model)
	return lowered == "kimi-k2.6" || strings.HasPrefix(lowered, "kimi-k3") || strings.HasPrefix(lowered, "kimi-k2.7-code")
}

// NormalizeKimiFixedSamplingParams 归一化 Kimi 推理模型被上游固定的其余采样
// 参数：top_p 只允许 0.95，presence_penalty/frequency_penalty 只允许 0，
// 传其他值直接 400（官方参数参考对 K3 系列/kimi-k2.7-code/kimi-k2.6 一致，
// 火山方舟 coding plan 端点已实测）。客户端未传的字段保持省略；
// n 不在此列：Ark 端点实测放行 n>1，强制改 1 会静默丢弃多选请求。
// 传 nil 指针表示该请求格式没有对应字段（如 Responses 无 penalty）。
func NormalizeKimiFixedSamplingParams(model string, topP, presencePenalty, frequencyPenalty *float64) {
	if !IsKimiFixedSamplingModel(model) {
		return
	}
	if topP != nil && *topP != 0.95 {
		*topP = 0.95
	}
	if presencePenalty != nil && *presencePenalty != 0 {
		*presencePenalty = 0
	}
	if frequencyPenalty != nil && *frequencyPenalty != 0 {
		*frequencyPenalty = 0
	}
}

// responsesToolCallOutputTypes Responses input 里工具调用项 → 配对输出项的类型映射。
var responsesToolCallOutputTypes = map[string]string{
	"function_call":    "function_call_output",
	"custom_tool_call": "custom_tool_call_output",
	"local_shell_call": "local_shell_call_output",
}

// RepairResponsesOrphanToolCalls 修复 Responses input 历史里孤立的工具调用项：
// Kimi 上游要求每个工具调用项必须有同 call_id 的配对输出项，客户端工具
// 循环被中断（取消/断连）后历史里会留下无输出的调用项，下一轮请求直接
// 被泛化 400 拒绝（"A parameter specified in the request is not valid"，
// 火山方舟 coding plan 端点已实测复现）。修复策略：给孤立调用项紧跟一条
// “已中断、无结果”的占位输出（保留调用事实，不静默删历史）；删除没有
// 对应调用项的孤立输出（上游报 tool_call_id is not found）。
// 字符串形式或非法结构的 input 不处理；无孤立项时原样返回，避免无谓重序列化。
func RepairResponsesOrphanToolCalls(input json.RawMessage) json.RawMessage {
	if len(input) == 0 {
		return input
	}
	var items []json.RawMessage
	if err := common.Unmarshal(input, &items); err != nil {
		return input
	}
	type itemMeta struct {
		itemType string
		callID   string
	}
	metas := make([]itemMeta, len(items))
	hasCall := make(map[string]bool)
	hasOutput := make(map[string]bool)
	for i, raw := range items {
		var m struct {
			Type   string `json:"type"`
			CallID string `json:"call_id"`
		}
		if err := common.Unmarshal(raw, &m); err != nil {
			continue
		}
		metas[i] = itemMeta{itemType: m.Type, callID: m.CallID}
		if m.CallID == "" {
			continue
		}
		if _, ok := responsesToolCallOutputTypes[m.Type]; ok {
			hasCall[m.Type+"|"+m.CallID] = true
		}
		for _, outputType := range responsesToolCallOutputTypes {
			if m.Type == outputType {
				hasOutput[m.Type+"|"+m.CallID] = true
				break
			}
		}
	}
	repaired := make([]json.RawMessage, 0, len(items))
	changed := false
	for i, raw := range items {
		m := metas[i]
		if outputType, ok := responsesToolCallOutputTypes[m.itemType]; ok && m.callID != "" && !hasOutput[outputType+"|"+m.callID] {
			placeholder, err := common.Marshal(map[string]string{
				"type":    outputType,
				"call_id": m.callID,
				"output":  "[tool call was interrupted before a result was returned; no output is available]",
			})
			if err == nil {
				repaired = append(repaired, raw, placeholder)
				changed = true
				continue
			}
		}
		orphanOutput := false
		for callType, outputType := range responsesToolCallOutputTypes {
			if m.itemType == outputType && m.callID != "" && !hasCall[callType+"|"+m.callID] {
				orphanOutput = true
				break
			}
		}
		if orphanOutput {
			changed = true
			continue
		}
		repaired = append(repaired, raw)
	}
	if !changed {
		return input
	}
	out, err := common.Marshal(repaired)
	if err != nil {
		return input
	}
	return out
}

func createTaskError(err error, code string, statusCode int, localError bool) *dto.TaskError {
	return &dto.TaskError{
		Code:       code,
		Message:    err.Error(),
		StatusCode: statusCode,
		LocalError: localError,
		Error:      err,
	}
}

func storeTaskRequest(c *gin.Context, info *RelayInfo, action string, requestObj TaskSubmitReq) {
	info.Action = action
	c.Set("task_request", requestObj)
}
func GetTaskRequest(c *gin.Context) (TaskSubmitReq, error) {
	v, exists := c.Get("task_request")
	if !exists {
		return TaskSubmitReq{}, fmt.Errorf("request not found in context")
	}
	req, ok := v.(TaskSubmitReq)
	if !ok {
		return TaskSubmitReq{}, fmt.Errorf("invalid task request type")
	}
	return req, nil
}

func validatePrompt(prompt string) *dto.TaskError {
	if strings.TrimSpace(prompt) == "" {
		return createTaskError(fmt.Errorf("prompt is required"), "invalid_request", http.StatusBadRequest, true)
	}
	return nil
}

// MaxTaskDurationSeconds caps user-supplied video duration. Duration is used
// as a billing multiplier (OtherRatio "seconds"); an unbounded value could
// overflow quota calculation into a negative charge.
const MaxTaskDurationSeconds = 3600

// OtherRatioUserDiscount 是任务计费 OtherRatios 中「用户按模型折扣」的键名。
// 提交时写入 PriceData，随 BillingContext 快照落库，结算侧经
// OtherRatioMultiplier 自动生效（含 seedance 绝对单价模式），因此预扣与结算天然一致。
const OtherRatioUserDiscount = "user_discount"

func validateTaskDurationBounds(req TaskSubmitReq) *dto.TaskError {
	seconds := req.Duration
	if seconds == 0 && req.Seconds != "" {
		seconds, _ = strconv.Atoi(req.Seconds)
	}
	if seconds < 0 || seconds > MaxTaskDurationSeconds {
		return createTaskError(fmt.Errorf("seconds must be between 1 and %d", MaxTaskDurationSeconds), "invalid_seconds", http.StatusBadRequest, true)
	}
	// metadata 是透传字段，可携带 duration 绕过顶层校验（如火山 metadata.duration），
	// 同样强制上下界，独立于顶层值校验
	if raw, ok := req.Metadata["duration"]; ok {
		if b, err := common.Marshal(raw); err == nil {
			var dv dto.IntValue
			if common.Unmarshal(b, &dv) == nil {
				md := int(dv)
				if md < 0 || md > MaxTaskDurationSeconds {
					return createTaskError(fmt.Errorf("seconds must be between 1 and %d", MaxTaskDurationSeconds), "invalid_seconds", http.StatusBadRequest, true)
				}
			}
		}
	}
	return nil
}

func validateMultipartTaskRequest(c *gin.Context, info *RelayInfo, action string) (TaskSubmitReq, error) {
	var req TaskSubmitReq
	if _, err := c.MultipartForm(); err != nil {
		return req, err
	}

	formData := c.Request.PostForm
	req = TaskSubmitReq{
		Prompt:   formData.Get("prompt"),
		Model:    formData.Get("model"),
		Mode:     formData.Get("mode"),
		Image:    formData.Get("image"),
		Size:     formData.Get("size"),
		Metadata: make(map[string]interface{}),
	}

	if durationStr := formData.Get("seconds"); durationStr != "" {
		if duration, err := strconv.Atoi(durationStr); err == nil {
			req.Duration = duration
		}
	}

	if images := formData["images"]; len(images) > 0 {
		req.Images = images
	}

	for key, values := range formData {
		if len(values) > 0 && !isKnownTaskField(key) {
			if intVal, err := strconv.Atoi(values[0]); err == nil {
				req.Metadata[key] = intVal
			} else if floatVal, err := strconv.ParseFloat(values[0], 64); err == nil {
				req.Metadata[key] = floatVal
			} else {
				req.Metadata[key] = values[0]
			}
		}
	}
	return req, nil
}

func ValidateMultipartDirect(c *gin.Context, info *RelayInfo) *dto.TaskError {
	var prompt string
	var model string
	var seconds int
	var size string
	var hasInputReference bool

	var req TaskSubmitReq
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		return createTaskError(err, "invalid_json", http.StatusBadRequest, true)
	}

	prompt = req.Prompt
	model = req.Model
	size = req.Size
	seconds, _ = strconv.Atoi(req.Seconds)
	if seconds == 0 {
		seconds = req.Duration
	}
	if req.InputReference != "" {
		req.Images = []string{req.InputReference}
	} else if len(req.Images) == 0 && strings.TrimSpace(req.Image) != "" {
		// 兼容单图上传
		req.Images = []string{strings.TrimSpace(req.Image)}
	}

	if strings.TrimSpace(req.Model) == "" {
		return createTaskError(fmt.Errorf("model field is required"), "missing_model", http.StatusBadRequest, true)
	}

	if req.HasImage() {
		hasInputReference = true
	}

	if taskErr := validatePrompt(prompt); taskErr != nil {
		return taskErr
	}

	if taskErr := validateTaskDurationBounds(req); taskErr != nil {
		return taskErr
	}

	action := constant.TaskActionTextGenerate
	if hasInputReference {
		action = constant.TaskActionGenerate
	}
	if strings.HasPrefix(model, "sora-2") {

		if size == "" {
			size = "720x1280"
		}

		if seconds <= 0 {
			seconds = 4
		}

		if model == "sora-2" && !lo.Contains([]string{"720x1280", "1280x720"}, size) {
			return createTaskError(fmt.Errorf("sora-2 size is invalid"), "invalid_size", http.StatusBadRequest, true)
		}
		if model == "sora-2-pro" && !lo.Contains([]string{"720x1280", "1280x720", "1792x1024", "1024x1792"}, size) {
			return createTaskError(fmt.Errorf("sora-2 size is invalid"), "invalid_size", http.StatusBadRequest, true)
		}
		// OtherRatios 已移到 Sora adaptor 的 EstimateBilling 中设置
	}

	storeTaskRequest(c, info, action, req)

	return nil
}

func isKnownTaskField(field string) bool {
	knownFields := map[string]bool{
		"prompt":          true,
		"model":           true,
		"mode":            true,
		"image":           true,
		"images":          true,
		"size":            true,
		"duration":        true,
		"input_reference": true, // Sora 特有字段
	}
	return knownFields[field]
}

func ValidateBasicTaskRequest(c *gin.Context, info *RelayInfo, action string) *dto.TaskError {
	var err error
	contentType := c.GetHeader("Content-Type")
	var req TaskSubmitReq
	if strings.HasPrefix(contentType, "multipart/form-data") {
		req, err = validateMultipartTaskRequest(c, info, action)
		if err != nil {
			return createTaskError(err, "invalid_multipart_form", http.StatusBadRequest, true)
		}
	}
	// 为了metadata字段的兼容性，统一UnmarshalBodyReusable
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		return createTaskError(err, "invalid_request", http.StatusBadRequest, true)
	}

	if taskErr := validatePrompt(req.Prompt); taskErr != nil {
		return taskErr
	}

	if taskErr := validateTaskDurationBounds(req); taskErr != nil {
		return taskErr
	}

	if len(req.Images) == 0 && strings.TrimSpace(req.Image) != "" {
		// 兼容单图上传
		req.Images = []string{req.Image}
	}

	storeTaskRequest(c, info, action, req)
	return nil
}
