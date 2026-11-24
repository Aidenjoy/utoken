package openai

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

// OpenaiImageHandler handles non-streaming OpenAI image responses
// (generations/edits), returning the parsed usage for billing.
func OpenaiImageHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}

	var usageResp dto.SimpleResponse
	err = common.Unmarshal(responseBody, &usageResp)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}

	if oaiError := usageResp.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, types.WithOpenAIError(*oaiError, resp.StatusCode)
	}

	// 写入新的 response body
	service.IOCopyBytesGracefully(c, resp, responseBody)

	var imageResp dto.ImageResponse
	if err := common.Unmarshal(responseBody, &imageResp); err == nil {
		recordReturnedImageCount(info, len(imageResp.Data))
	}

	normalizeOpenAIUsage(&usageResp.Usage)
	applyUsagePostProcessing(info, &usageResp.Usage, responseBody)
	return &usageResp.Usage, nil
}

// recordReturnedImageCount bills by the number of images the upstream actually
// returned. Providers that decide the count server-side (Volcengine Ark
// sequential_image_generation) can return more images than the requested n, and
// relay.ImageHelper only falls back to the request value while no adaptor has set
// the ratio yet. Guarded by UsePrice for the same reason as that fallback: on the
// ratio-based path the upstream usage tokens already account for every returned
// image, so multiplying by the count would double-charge.
func recordReturnedImageCount(info *relaycommon.RelayInfo, imageCount int) {
	if info == nil || imageCount <= 0 || !info.PriceData.UsePrice {
		return
	}
	info.PriceData.AddOtherRatio("n", float64(imageCount))
}

// normalizeOpenAIUsage maps the OpenAI Images usage shape (input_tokens /
// output_tokens / input_tokens_details) onto the canonical prompt/completion
// fields. It is used only on the OpenAI image relay paths (generations/edits,
// streaming and non-streaming): the image API never returns prompt_tokens /
// completion_tokens, so the overwrite (=) semantics here are equivalent to the
// previous additive (+=) behavior while avoiding any future double-counting if
// both field sets are ever populated. Do not reuse this on chat/embedding paths
// without revisiting the overwrite semantics.
func normalizeOpenAIUsage(usage *dto.Usage) {
	if usage == nil {
		return
	}
	if usage.InputTokens != 0 {
		usage.PromptTokens = usage.InputTokens
	}
	if usage.OutputTokens != 0 {
		usage.CompletionTokens = usage.OutputTokens
	}
	if usage.InputTokensDetails != nil {
		usage.PromptTokensDetails.CachedTokens = usage.InputTokensDetails.CachedTokens
		usage.PromptTokensDetails.CachedCreationTokens = usage.InputTokensDetails.CachedCreationTokens
		usage.PromptTokensDetails.ImageTokens = usage.InputTokensDetails.ImageTokens
		usage.PromptTokensDetails.TextTokens = usage.InputTokensDetails.TextTokens
		usage.PromptTokensDetails.AudioTokens = usage.InputTokensDetails.AudioTokens
	}
	if usage.TotalTokens == 0 {
		usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	}
}

func OpenaiImageStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		logger.LogError(c, "invalid image stream response")
		return nil, types.NewOpenAIError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}

	contentType := strings.ToLower(resp.Header.Get("Content-Type"))
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return OpenaiImageHandler(c, info, resp)
	}
	if !strings.Contains(contentType, "text/event-stream") {
		return OpenaiImageJSONAsStreamHandler(c, info, resp)
	}
	// Reuse the shared streaming engine (helper.StreamScannerHandler) so the
	// image streaming path gets the same ping keepalive, streaming-timeout
	// watchdog, client-disconnect detection, panic recovery and goroutine
	// cleanup as every other relay stream. The scanner delivers only the
	// "data:" payload, so the SSE "event:" line is rebuilt from the JSON "type"
	// field (real OpenAI image events keep event == type).
	usage := &dto.Usage{}
	var lastStreamData []byte

	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {
		raw := common.StringToByteSlice(data)
		lastStreamData = raw
		if isOpenAIImageStreamErrorEvent(raw) {
			// Record the error as a soft error; the scanner drives the final
			// EndReason. HasErrors() flags the failure for logging/handling.
			sr.Error(fmt.Errorf("%s", extractOpenAIImageStreamErrorMessage(raw)))
		}
		var usageResp dto.SimpleResponse
		if err := common.Unmarshal(raw, &usageResp); err == nil {
			normalizeOpenAIUsage(&usageResp.Usage)
			if service.ValidUsage(&usageResp.Usage) {
				usage = &usageResp.Usage
			}
		}
		writeOpenaiImageStreamChunk(c, raw)
	})

	// StreamScannerHandler consumes the upstream [DONE]; re-emit it so the
	// client still receives a terminal data: [DONE].
	if info != nil && info.StreamStatus != nil && info.StreamStatus.EndReason == relaycommon.StreamEndReasonDone {
		helper.Done(c)
	}

	applyUsagePostProcessing(info, usage, lastStreamData)
	return usage, nil
}

// writeOpenaiImageStreamChunk rebuilds the SSE frame for an image stream chunk:
// it emits an "event:" line derived from the JSON "type" field (when present)
// followed by the verbatim "data:" payload, mirroring helper.ResponseChunkData.
func writeOpenaiImageStreamChunk(c *gin.Context, data []byte) {
	var payload struct {
		Type string `json:"type"`
	}
	_ = common.Unmarshal(data, &payload)
	if eventName := strings.TrimSpace(payload.Type); eventName != "" {
		_ = helper.ResponseChunkData(c, dto.ResponsesStreamResponse{Type: eventName}, string(data))
		return
	}
	_ = helper.StringData(c, string(data))
}

// isOpenAIImageStreamErrorEvent detects upstream error chunks by JSON content
// only ("type" of error/upstream_error, or a non-empty "error" field). The SSE
// "event:" line is not available here: StreamScannerHandler delivers only the
// "data:" payload. A payload carrying just a "message" key is deliberately NOT
// treated as an error to avoid false positives.
func isOpenAIImageStreamErrorEvent(data []byte) bool {
	if !json.Valid(data) {
		return false
	}
	var payload struct {
		Type  string          `json:"type"`
		Error json.RawMessage `json:"error"`
	}
	if err := common.Unmarshal(data, &payload); err != nil {
		return false
	}
	payloadType := strings.ToLower(strings.TrimSpace(payload.Type))
	return payloadType == "error" || payloadType == "upstream_error" || len(payload.Error) > 0
}

func extractOpenAIImageStreamErrorMessage(data []byte) string {
	if len(data) == 0 || !json.Valid(data) {
		return "upstream image stream returned error event"
	}
	var payload struct {
		Message string          `json:"message"`
		Error   json.RawMessage `json:"error"`
	}
	if err := common.Unmarshal(data, &payload); err != nil {
		return "upstream image stream returned error event"
	}
	if msg := strings.TrimSpace(payload.Message); msg != "" {
		return msg
	}
	if len(payload.Error) > 0 {
		var nested struct {
			Message string `json:"message"`
		}
		if err := common.Unmarshal(payload.Error, &nested); err == nil {
			if msg := strings.TrimSpace(nested.Message); msg != "" {
				return msg
			}
		}
		if msg := strings.TrimSpace(common.JsonRawMessageToString(payload.Error)); msg != "" {
			return msg
		}
	}
	return "upstream image stream returned error event"
}

// OpenaiImageJSONAsStreamHandler wraps a non-streaming upstream JSON answer as
// a client-side SSE stream. The upstream only answers once the image is fully
// rendered (Seedream regularly takes over a minute), which outlives typical
// reverse-proxy read timeouts: the SSE headers are committed immediately and
// comment pings keep the connection warm while the body is read, so a slow but
// successful generation never surfaces to the browser as a 504. The keepalive
// is unconditional — it guards the transport, unlike the optional user-facing
// ping feature (PingIntervalEnabled) on real upstream streams.
func OpenaiImageJSONAsStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)

	helper.SetEventStreamHeaders(c)
	c.Status(http.StatusOK)
	_ = helper.PingData(c)
	if info != nil {
		info.SetFirstResponseTime()
	}

	type upstreamResult struct {
		body []byte
		err  error
	}
	resultCh := make(chan upstreamResult, 1)
	go func() {
		body, err := io.ReadAll(resp.Body)
		resultCh <- upstreamResult{body: body, err: err}
	}()

	pingInterval := helper.TransportPingInterval(time.Duration(operation_setting.GetGeneralSetting().PingIntervalSeconds) * time.Second)
	pingTicker := time.NewTicker(pingInterval)
	defer pingTicker.Stop()

	clientGone := false
	var result upstreamResult
waitUpstream:
	for {
		select {
		case result = <-resultCh:
			break waitUpstream
		case <-pingTicker.C:
			if clientGone {
				continue
			}
			if err := helper.PingData(c); err != nil {
				// 客户端已断开，但上游仍在出图且必须计费：停写不停等，
				// 拿到完整响应后照常结算。
				clientGone = true
				if info != nil && info.StreamStatus != nil {
					info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonClientGone, err)
				}
			}
		}
	}

	// 200 头已发出，失败不能再改状态码：向客户端补一个 SSE error 事件，
	// 同时返回 SkipRetry 错误（响应已提交，换渠道重试会往同一条流里写第二份
	// 响应），由 relay 错误路径退预扣费并落错误日志。
	if result.err != nil {
		apiErr := types.NewOpenAIError(result.err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError, types.ErrOptionWithSkipRetry())
		writeOpenaiImageStreamErrorEvent(c, clientGone, apiErr)
		return &dto.Usage{}, apiErr
	}

	// 协议快照以原始上游响应为权威输出参数：客户端断开时下面停写，
	// 旁路捕获只有心跳评论，会让计费成功的日志「输出参数」为空。
	if info != nil {
		info.ResponseSnapshot = result.body
	}

	var imageResp dto.ImageResponse
	if err := common.Unmarshal(result.body, &imageResp); err != nil {
		apiErr := types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError, types.ErrOptionWithSkipRetry())
		writeOpenaiImageStreamErrorEvent(c, clientGone, apiErr)
		return &dto.Usage{}, apiErr
	}

	var usageResp dto.SimpleResponse
	_ = common.Unmarshal(result.body, &usageResp)
	if oaiError := usageResp.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		apiErr := types.WithOpenAIError(*oaiError, resp.StatusCode, types.ErrOptionWithSkipRetry())
		writeOpenaiImageStreamErrorEvent(c, clientGone, apiErr)
		return &usageResp.Usage, apiErr
	}
	normalizeOpenAIUsage(&usageResp.Usage)
	applyUsagePostProcessing(info, &usageResp.Usage, result.body)

	created := imageResp.Created
	if created == 0 {
		created = time.Now().Unix()
	}
	recordReturnedImageCount(info, len(imageResp.Data))
	if !clientGone {
		for _, image := range imageResp.Data {
			payload := map[string]any{
				"type":       "image_generation.completed",
				"created_at": created,
			}
			if image.Url != "" {
				payload["url"] = image.Url
			}
			if image.B64Json != "" {
				payload["b64_json"] = image.B64Json
			}
			if image.RevisedPrompt != "" {
				payload["revised_prompt"] = image.RevisedPrompt
			}
			if service.ValidUsage(&usageResp.Usage) {
				payload["usage"] = usageResp.Usage
			}
			if err := writeOpenaiImageStreamPayload(c, "image_generation.completed", payload); err != nil {
				clientGone = true
				if info != nil && info.StreamStatus != nil {
					info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonClientGone, err)
				}
				break
			}
		}
	}
	if !clientGone {
		if err := writeOpenaiImageStreamDone(c); err != nil {
			clientGone = true
			if info != nil && info.StreamStatus != nil {
				info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonClientGone, err)
			}
		}
	}
	if info != nil {
		info.ReceivedResponseCount += len(imageResp.Data)
		if info.StreamStatus == nil {
			info.StreamStatus = relaycommon.NewStreamStatus()
		}
		if !clientGone {
			info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonDone, nil)
		}
	}
	return &usageResp.Usage, nil
}

// writeOpenaiImageStreamErrorEvent surfaces a post-commit failure as an SSE
// error event so the stream client can read the message; the event shape is
// shared with the relay error defer via helper.StreamErrorEvent.
func writeOpenaiImageStreamErrorEvent(c *gin.Context, clientGone bool, apiErr *types.NewAPIError) {
	if clientGone {
		return
	}
	helper.StreamErrorEvent(c, apiErr.Error())
}

func writeOpenaiImageStreamPayload(c *gin.Context, eventName string, payload any) error {
	data, err := common.Marshal(payload)
	if err != nil {
		return err
	}
	if eventName != "" {
		return helper.ResponseChunkData(c, dto.ResponsesStreamResponse{Type: eventName}, string(data))
	}
	return helper.StringData(c, string(data))
}

func writeOpenaiImageStreamDone(c *gin.Context) error {
	return helper.StringData(c, "[DONE]")
}
