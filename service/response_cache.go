package service

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// 响应缓存：把一次成功的上游响应按「请求指纹」存进 Redis，之后完全相同的请求直接回放，
// 不再打上游、不再扣费。
//
// 生效范围刻意收窄，宁可少命中也不要给出错误答案：
//   - 只覆盖 chat/completions 与 responses 两种对话模式
//   - 指纹包含 model、归一化后的 messages、全部采样参数与是否流式，任一不同即视为不同请求
//   - 带 tools / 图片 / 文件 / 音频 / 联网检索 / 请求透传的请求不缓存，其结果不可复现
//   - 命中时 quota=0，但仍写一条消费日志，并在 other 里记 cache_hit 与 cache_saved_quota，
//     供命中率与「节省额度」报表使用
//
// 依赖 Redis：common.RedisEnabled 为 false 时整个能力自动关闭，前端据此提示。

const responseCacheKeyPrefix = "resp_cache:"

// ResponseCaptureContextKey 保存本次请求的响应旁路捕获器。
// 写入方是 controller.Relay（包住整个 relay handler），读取方是 PostTextConsumeQuota
// ——只有它同时拿得到 relayInfo 与上游 usage，因此回写点收敛在那里。
const ResponseCaptureContextKey = "response_capture"

// ResponseCacheEntry 一次可回放的上游响应快照。
//
// Body 对流式请求保存完整的 SSE 文本（形如 "data: {...}\n\n" 的连续块），
// 对非流式请求保存完整的 JSON 响应体。回放时按原格式下发，
// 因此 usage、finish_reason 以及上游特有字段都不会丢，也无需二次解析。
type ResponseCacheEntry struct {
	Model     string     `json:"model"`
	IsStream  bool       `json:"is_stream"`
	Body      string     `json:"body"`
	Usage     *dto.Usage `json:"usage,omitempty"`
	CreatedAt int64      `json:"created_at"`
}

// ResponseCacheAvailable 全局总闸：管理员开关 + Redis 可用。
func ResponseCacheAvailable() bool {
	return operation_setting.GetResponseCacheSetting().Enabled && common.RedisEnabled
}

// PrepareResponseCache 在预扣费之前判定本次请求能否走缓存。
//
// 满足条件时把指纹与 TTL 写到 relayInfo 上，命中直返与未命中回写共用同一份配置；
// 返回 false 表示本次不参与缓存，调用方按原路径直连上游即可。
// 必须在 PreConsumeBilling 之前调用：命中缓存的请求不应该产生任何预扣费。
func PrepareResponseCache(info *relaycommon.RelayInfo, request dto.Request) bool {
	if info == nil || request == nil || !ResponseCacheAvailable() {
		return false
	}
	if !isCacheableRelayMode(info.RelayMode) {
		return false
	}
	// 全局透传下响应体是上游原样字节，格式无法保证与客户端请求的协议一致，不能回放
	if model_setting.GetGlobalSettings().PassThroughRequestEnabled {
		return false
	}
	ttl, ok := responseCachePolicy(info)
	if !ok {
		return false
	}
	fingerprint, ok := responseCacheFingerprint(info, request)
	if !ok {
		return false
	}
	info.ResponseCacheKey = responseCacheKeyPrefix + fingerprint
	info.ResponseCacheTTL = ttl
	return true
}

func isCacheableRelayMode(relayMode int) bool {
	switch relayMode {
	case relayconstant.RelayModeChatCompletions, relayconstant.RelayModeResponses:
		return true
	default:
		return false
	}
}

// responseCachePolicy 返回本次请求的缓存 TTL。
// 企业成员的缓存由企业自行开关与配置 TTL；非企业成员只看全局开关与全局 TTL。
// 这里每次请求读一次企业记录：主键查询且仅在全局开关打开后才会走到，开销可接受。
func responseCachePolicy(info *relaycommon.RelayInfo) (int, bool) {
	if info.OrgId <= 0 {
		return operation_setting.GetResponseCacheTTL(), true
	}
	org, err := model.GetOrganizationById(info.OrgId)
	if err != nil || org == nil || !org.CacheEnabled {
		return 0, false
	}
	return operation_setting.ClampResponseCacheTTL(org.CacheTTL), true
}

// GetResponseCache 读取缓存的响应。未命中、Redis 异常或数据损坏都返回 nil，
// 调用方按未命中继续走上游，缓存永远不能让请求失败。
func GetResponseCache(key string) *ResponseCacheEntry {
	if key == "" {
		return nil
	}
	value, err := common.RedisGet(key)
	if err != nil || value == "" {
		return nil
	}
	entry := &ResponseCacheEntry{}
	if err := common.UnmarshalJsonStr(value, entry); err != nil {
		common.SysError(fmt.Sprintf("response cache corrupted (key=%s): %s", key, err.Error()))
		return nil
	}
	if entry.Body == "" {
		return nil
	}
	return entry
}

// ReplayResponseCache 把缓存的响应按原始格式写回客户端。
// 流式按 SSE 事件块逐块下发并 flush，保持客户端的流式体验（含 [DONE] 结束标记）；
// 非流式一次性返回 JSON。
func ReplayResponseCache(c *gin.Context, entry *ResponseCacheEntry) {
	if entry == nil {
		return
	}
	if !entry.IsStream {
		c.Data(http.StatusOK, "application/json; charset=utf-8", []byte(entry.Body))
		return
	}

	header := c.Writer.Header()
	header.Set("Content-Type", "text/event-stream")
	header.Set("Cache-Control", "no-cache")
	header.Set("Connection", "keep-alive")
	header.Set("X-Accel-Buffering", "no")
	c.Writer.WriteHeader(http.StatusOK)
	for _, block := range splitSSEBlocks(entry.Body) {
		if _, err := c.Writer.WriteString(block); err != nil {
			return
		}
		c.Writer.Flush()
	}
}

// splitSSEBlocks 把完整 SSE 文本切回单个事件块。
// 上游每个事件都以 "\n\n" 结尾，切分后补回分隔符即可原样重放。
func splitSSEBlocks(body string) []string {
	parts := strings.Split(body, "\n\n")
	blocks := make([]string, 0, len(parts))
	for _, part := range parts {
		if strings.TrimSpace(part) == "" {
			continue
		}
		blocks = append(blocks, part+"\n\n")
	}
	return blocks
}

// ---------------------------------------------------------------------------
// 指纹计算
// ---------------------------------------------------------------------------

// responseCacheFingerprint 计算请求指纹。返回 false 表示该请求不适合缓存
// （含工具调用、多模态内容或联网检索），调用方按未命中处理。
//
// 指纹不按用户/令牌区分：相同输入本来就该得到相同输出，跨用户共享才能拿到命中率。
// 代价是渠道级 system prompt 差异会被忽略，这也是该能力默认关闭的原因之一。
func responseCacheFingerprint(info *relaycommon.RelayInfo, request dto.Request) (string, bool) {
	hash := sha256.New()
	write := func(format string, args ...any) {
		fmt.Fprintf(hash, format, args...)
	}
	write("mode=%d\nmodel=%s\nstream=%t\n", info.RelayMode, info.OriginModelName, info.IsStream)

	switch req := request.(type) {
	case *dto.GeneralOpenAIRequest:
		if !isPureTextChatRequest(req) {
			return "", false
		}
		for i := range req.Messages {
			write("msg[%d]=%s|%s\n", i, req.Messages[i].Role, req.Messages[i].StringContent())
		}
		write("temperature=%s\ntop_p=%s\ntop_k=%s\n",
			cacheFieldValue(req.Temperature), cacheFieldValue(req.TopP), cacheFieldValue(req.TopK))
		write("max_tokens=%s\nmax_completion_tokens=%s\nn=%s\nseed=%s\n",
			cacheFieldValue(req.MaxTokens), cacheFieldValue(req.MaxCompletionTokens),
			cacheFieldValue(req.N), cacheFieldValue(req.Seed))
		write("frequency_penalty=%s\npresence_penalty=%s\nreasoning_effort=%s\n",
			cacheFieldValue(req.FrequencyPenalty), cacheFieldValue(req.PresencePenalty), req.ReasoningEffort)
		write("stop=%s\nresponse_format=%s\nlogit_bias=%s\n",
			cacheRawField(mustMarshal(req.Stop)), cacheRawField(mustMarshal(req.ResponseFormat)), cacheRawField(req.LogitBias))
	case *dto.OpenAIResponsesRequest:
		input, ok := pureTextResponsesInput(req)
		if !ok {
			return "", false
		}
		write("input=%s\ninstructions=%s\n", input, cacheRawField(req.Instructions))
		write("temperature=%s\ntop_p=%s\nmax_output_tokens=%s\ntop_logprobs=%s\n",
			cacheFieldValue(req.Temperature), cacheFieldValue(req.TopP),
			cacheFieldValue(req.MaxOutputTokens), cacheFieldValue(req.TopLogProbs))
		write("reasoning=%s\ntext=%s\ntruncation=%s\n",
			cacheRawField(mustMarshal(req.Reasoning)), cacheRawField(req.Text), cacheRawField(req.Truncation))
	default:
		return "", false
	}

	return hex.EncodeToString(hash.Sum(nil)), true
}

// cacheFieldValue 把可选标量参数归一化成指纹片段：未传与显式零值必须区分开，
// 否则 temperature=0 与不传 temperature 会命中同一条缓存。
func cacheFieldValue[T any](value *T) string {
	if value == nil {
		return "-"
	}
	return fmt.Sprintf("%v", *value)
}

func cacheRawField(value []byte) string {
	if len(value) == 0 {
		return "-"
	}
	return string(value)
}

func mustMarshal(value any) []byte {
	if value == nil {
		return nil
	}
	data, err := common.Marshal(value)
	if err != nil {
		return nil
	}
	return data
}

// isPureTextChatRequest 判定 chat/completions 请求是否为「可复现的纯文本对话」。
func isPureTextChatRequest(req *dto.GeneralOpenAIRequest) bool {
	if len(req.Messages) == 0 {
		return false
	}
	// 工具调用与旧版 function call 的结果依赖调用方后续动作，缓存会截断对话
	if len(req.Tools) > 0 || len(req.Functions) > 0 || len(req.FunctionCall) > 0 || req.ToolChoice != nil || req.ParallelTooCalls != nil {
		return false
	}
	// 联网检索/图片返回类能力每次结果都不同，缓存会返回过期答案
	if req.WebSearchOptions != nil || len(req.EnableSearch) > 0 || len(req.SearchParameters) > 0 ||
		len(req.SearchRecencyFilter) > 0 || len(req.SearchDomainFilter) > 0 || len(req.WebSearch) > 0 ||
		req.ReturnImages != nil || req.ReturnRelatedQuestions != nil {
		return false
	}
	// 音频模态的响应体不是纯文本，回放语义不明确
	if len(req.Modalities) > 0 || len(req.Audio) > 0 {
		return false
	}
	for i := range req.Messages {
		message := &req.Messages[i]
		if message.Role == "tool" || message.ToolCallId != "" || len(message.ToolCalls) > 0 {
			return false
		}
		if !messageIsPureText(message) {
			return false
		}
	}
	return true
}

// messageIsPureText 只接受字符串内容与「全部为 text 分片」的数组内容。
// 显式遍历原始 JSON 结构而不是复用 ParseContent，避免把无法识别的分片静默当成文本。
func messageIsPureText(message *dto.Message) bool {
	switch content := message.Content.(type) {
	case string:
		return content != ""
	case []any:
		if len(content) == 0 {
			return false
		}
		for _, item := range content {
			part, ok := item.(map[string]any)
			if !ok || part["type"] != dto.ContentTypeText {
				return false
			}
			if text, _ := part["text"].(string); text == "" {
				return false
			}
		}
		return true
	default:
		return false
	}
}

// pureTextResponsesInput 校验 responses 请求可缓存并返回归一化后的输入文本。
func pureTextResponsesInput(req *dto.OpenAIResponsesRequest) (string, bool) {
	// previous_response_id 指向服务端会话状态，同一 id 在不同时刻内容可能已变化
	if req.PreviousResponseID != "" || len(req.Conversation) > 0 || len(req.ContextManagement) > 0 {
		return "", false
	}
	if len(req.Tools) > 0 || len(req.ToolChoice) > 0 || req.MaxToolCalls != nil || len(req.ParallelToolCalls) > 0 {
		return "", false
	}
	if len(req.Include) > 0 || len(req.Prompt) > 0 || len(req.Preset) > 0 || len(req.EnableThinking) > 0 {
		return "", false
	}
	inputs := req.ParseInput()
	if len(inputs) == 0 {
		return "", false
	}
	var builder strings.Builder
	for _, input := range inputs {
		if input.Type != "input_text" || input.Text == "" {
			return "", false
		}
		builder.WriteString(input.Text)
		builder.WriteByte('\n')
	}
	return builder.String(), true
}

// ---------------------------------------------------------------------------
// 响应旁路捕获
// ---------------------------------------------------------------------------

// ResponseCapture 旁路复制 relay 写出的响应字节，用于回写缓存。
//
// 复制有上限：超过 maxBytes 立即丢弃缓冲并标记 overflow，本次不写缓存，
// 既避免超长输出把 Redis 撑爆，也避免在内存里囤积大响应。
type ResponseCapture struct {
	gin.ResponseWriter
	original gin.ResponseWriter
	buf      []byte
	maxBytes int
	overflow bool
}

// BeginResponseCaptureIfNeeded 在需要回写缓存时把 c.Writer 换成带旁路缓冲的包装器。
// 返回 nil 表示本次不捕获（未参与缓存或渠道开启了请求体透传），调用方无需 Restore。
func BeginResponseCaptureIfNeeded(c *gin.Context, info *relaycommon.RelayInfo) *ResponseCapture {
	if info == nil || info.ResponseCacheKey == "" || info.CacheHit {
		return nil
	}
	// 渠道级透传的响应是上游原始字节，协议可能与客户端请求不一致，不能回放
	if info.ChannelSetting.PassThroughBodyEnabled {
		return nil
	}
	capture := &ResponseCapture{
		ResponseWriter: c.Writer,
		original:       c.Writer,
		maxBytes:       operation_setting.GetResponseCacheMaxBodyBytes(),
	}
	c.Writer = capture
	return capture
}

// Restore 还原被替换的 ResponseWriter。nil 接收者安全，调用方可以直接
// `defer capture.Restore(c)` 而不必判空。
func (rc *ResponseCapture) Restore(c *gin.Context) {
	if rc == nil {
		return
	}
	c.Writer = rc.original
}

func (rc *ResponseCapture) Write(b []byte) (int, error) {
	rc.append(b)
	return rc.ResponseWriter.Write(b)
}

func (rc *ResponseCapture) WriteString(s string) (int, error) {
	rc.append([]byte(s))
	return rc.ResponseWriter.WriteString(s)
}

func (rc *ResponseCapture) append(b []byte) {
	if rc.overflow {
		return
	}
	if len(rc.buf)+len(b) > rc.maxBytes {
		rc.overflow = true
		rc.buf = nil
		return
	}
	rc.buf = append(rc.buf, b...)
}

// Entry 把捕获到的响应组装成缓存条目。
// 超限、空响应、非 200 或上游没给 usage（无法估算节省额度）时返回 nil，本次不写缓存。
func (rc *ResponseCapture) Entry(info *relaycommon.RelayInfo, usage *dto.Usage) *ResponseCacheEntry {
	if rc == nil || rc.overflow || len(rc.buf) == 0 {
		return nil
	}
	if status := rc.Status(); status != 0 && status != http.StatusOK {
		return nil
	}
	if usage == nil || usage.TotalTokens <= 0 {
		return nil
	}
	return &ResponseCacheEntry{
		Model:     info.OriginModelName,
		IsStream:  info.IsStream,
		Body:      string(rc.buf),
		Usage:     usage,
		CreatedAt: common.GetTimestamp(),
	}
}

// StoreCapturedResponse 把本次成功响应写进 Redis。
// 写失败只记日志：缓存是加速手段，不能影响主流程。
func StoreCapturedResponse(info *relaycommon.RelayInfo, capture *ResponseCapture, usage *dto.Usage) {
	if info == nil || info.ResponseCacheKey == "" || info.CacheHit {
		return
	}
	entry := capture.Entry(info, usage)
	if entry == nil {
		return
	}
	data, err := common.Marshal(entry)
	if err != nil {
		common.SysError(fmt.Sprintf("failed to marshal response cache entry: %s", err.Error()))
		return
	}
	if err := common.RedisSet(info.ResponseCacheKey, string(data), time.Duration(info.ResponseCacheTTL)*time.Second); err != nil {
		common.SysError(fmt.Sprintf("failed to store response cache (key=%s): %s", info.ResponseCacheKey, err.Error()))
	}
}

// storeResponseCacheFromContext 从请求上下文取出捕获器并回写缓存。
// 由 PostTextConsumeQuota 在结算时调用——那里同时拿得到 relayInfo 与上游 usage。
func storeResponseCacheFromContext(ctx *gin.Context, info *relaycommon.RelayInfo, usage *dto.Usage) {
	if ctx == nil || info == nil || info.ResponseCacheKey == "" || info.CacheHit {
		return
	}
	value, exists := ctx.Get(ResponseCaptureContextKey)
	if !exists {
		return
	}
	capture, ok := value.(*ResponseCapture)
	if !ok {
		return
	}
	StoreCapturedResponse(info, capture, usage)
}
