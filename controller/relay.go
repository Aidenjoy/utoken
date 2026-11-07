package controller

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/QuantumNous/new-api/relay"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/samber/lo"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

func relayHandler(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	var err *types.NewAPIError
	switch info.RelayMode {
	case relayconstant.RelayModeImagesGenerations, relayconstant.RelayModeImagesEdits:
		err = relay.ImageHelper(c, info)
	case relayconstant.RelayModeAudioSpeech:
		fallthrough
	case relayconstant.RelayModeAudioTranslation:
		fallthrough
	case relayconstant.RelayModeAudioTranscription:
		err = relay.AudioHelper(c, info)
	case relayconstant.RelayModeRerank:
		err = relay.RerankHelper(c, info)
	case relayconstant.RelayModeEmbeddings:
		err = relay.EmbeddingHelper(c, info)
	case relayconstant.RelayModeResponses, relayconstant.RelayModeResponsesCompact:
		err = relay.ResponsesHelper(c, info)
	default:
		err = relay.TextHelper(c, info)
	}
	return err
}

func geminiRelayHandler(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	var err *types.NewAPIError
	if strings.Contains(c.Request.URL.Path, "embed") {
		err = relay.GeminiEmbeddingHandler(c, info)
	} else {
		err = relay.GeminiHelper(c, info)
	}
	return err
}

func Relay(c *gin.Context, relayFormat types.RelayFormat) {

	requestId := c.GetString(common.RequestIdKey)
	//group := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
	//originalModel := common.GetContextKeyString(c, constant.ContextKeyOriginalModel)

	var (
		newAPIError *types.NewAPIError
		ws          *websocket.Conn
	)

	// 使用日志「传入/传出参数」快照：包装 c.Writer 旁路捕获写给客户端的字节
	// （流式 SSE 逐块累积、非流式整包、错误体同样入缓冲），handler 返回后异步落库。
	// defer 在此注册，早于下方错误输出 defer，故按 LIFO 会在错误体写入之后执行，捕获到真实响应。
	// realtime(WebSocket) 走二进制帧、非 HTTP body，跳过捕获。
	if relayFormat != types.RelayFormatOpenAIRealtime {
		bodyWriter := newRelayBodyWriter(c)
		defer saveRelayBodySnapshot(c, requestId, bodyWriter)
	}

	if relayFormat == types.RelayFormatOpenAIRealtime {
		var err error
		ws, err = upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			helper.WssError(c, ws, types.NewError(err, types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry()).ToOpenAIError())
			return
		}
		defer ws.Close()
	}

	defer func() {
		if newAPIError != nil {
			logger.LogError(c, fmt.Sprintf("relay error: %s", common.LocalLogPreview(newAPIError.Error())))
			if service.ShouldMaskUpstreamKeywordError(newAPIError) {
				// 命中失败关键词（通常是上游渠道欠费/不可用）：对下游隐藏上游原文，统一
				// 返回「请稍后重试」。上面这行内部日志与渠道禁用通知仍保留真实原因。
				newAPIError.ReplaceClientMessage(common.MessageWithRequestId(service.UpstreamKeywordMaskMessage, requestId))
			} else {
				newAPIError.SetMessage(common.MessageWithRequestId(newAPIError.Error(), requestId))
			}
			switch relayFormat {
			case types.RelayFormatOpenAIRealtime:
				helper.WssError(c, ws, newAPIError.ToOpenAIError())
			case types.RelayFormatClaude:
				c.JSON(newAPIError.StatusCode, gin.H{
					"type":  "error",
					"error": newAPIError.ToClaudeError(),
				})
			default:
				c.JSON(newAPIError.StatusCode, gin.H{
					"error": newAPIError.ToOpenAIError(),
				})
			}
		}
	}()

	request, err := helper.GetAndValidateRequest(c, relayFormat)
	if err != nil {
		// Map "request body too large" to 413 so clients can handle it correctly
		if common.IsRequestBodyTooLargeError(err) || errors.Is(err, common.ErrRequestBodyTooLarge) {
			newAPIError = types.NewErrorWithStatusCode(err, types.ErrorCodeReadRequestBodyFailed, http.StatusRequestEntityTooLarge, types.ErrOptionWithSkipRetry())
		} else {
			newAPIError = types.NewError(err, types.ErrorCodeInvalidRequest)
		}
		return
	}

	relayInfo, err := relaycommon.GenRelayInfo(c, relayFormat, request, ws)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeGenRelayInfoFailed)
		return
	}

	needSensitiveCheck := setting.ShouldCheckPromptSensitive()
	needCountToken := constant.CountToken
	// Avoid building huge CombineText (strings.Join) when token counting and sensitive check are both disabled.
	var meta *types.TokenCountMeta
	if needSensitiveCheck || needCountToken {
		meta = request.GetTokenCountMeta()
	} else {
		meta = fastTokenCountMetaForPricing(request)
	}

	if needSensitiveCheck && meta != nil {
		contains, words := service.CheckSensitiveText(meta.CombineText)
		if contains {
			logger.LogWarn(c, fmt.Sprintf("user sensitive words detected: %s", strings.Join(words, ", ")))
			newAPIError = types.NewError(err, types.ErrorCodeSensitiveWordsDetected)
			return
		}
	}

	tokens, err := service.EstimateRequestToken(c, meta, relayInfo)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeCountTokenFailed)
		return
	}

	relayInfo.SetEstimatePromptTokens(tokens)

	priceData, err := helper.ModelPriceHelper(c, relayInfo, tokens, meta)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeModelPriceError, types.ErrOptionWithStatusCode(http.StatusBadRequest))
		return
	}

	// common.SetContextKey(c, constant.ContextKeyTokenCountMeta, meta)

	// 响应缓存命中直返：必须放在预扣费之前，命中时本次请求既不打上游也不产生任何扣费。
	// 仍走 PostTextConsumeQuota 记一条 quota=0 的日志，命中率与节省额度才有数据可算。
	if service.PrepareResponseCache(relayInfo, request) {
		if cached := service.GetResponseCache(relayInfo.ResponseCacheKey); cached != nil {
			relayInfo.CacheHit = true
			relayInfo.IsStream = cached.IsStream
			service.ReplayResponseCache(c, cached)
			service.PostTextConsumeQuota(c, relayInfo, cached.Usage, []string{"缓存命中"})
			return
		}
	}

	if priceData.FreeModel {
		logger.LogInfo(c, fmt.Sprintf("模型 %s 免费，跳过预扣费", relayInfo.OriginModelName))
	} else {
		newAPIError = service.PreConsumeBilling(c, priceData.QuotaToPreConsume, relayInfo)
		if newAPIError != nil {
			return
		}
	}

	defer func() {
		// Only return quota if downstream failed and quota was actually pre-consumed
		if newAPIError != nil {
			newAPIError = service.NormalizeViolationFeeError(newAPIError)
			if relayInfo.Billing != nil {
				relayInfo.Billing.Refund(c)
			}
			service.ChargeViolationFeeIfNeeded(c, relayInfo, newAPIError)
		}
	}()

	retryParam := &service.RetryParam{
		Ctx:         c,
		TokenGroup:  relayInfo.TokenGroup,
		ModelName:   relayInfo.OriginModelName,
		RequestPath: c.Request.URL.Path,
		Retry:       common.GetPointer(0),
	}
	relayInfo.RetryIndex = 0
	relayInfo.LastError = nil

	for ; retryParam.GetRetry() <= common.RetryTimes; retryParam.IncreaseRetry() {
		relayInfo.RetryIndex = retryParam.GetRetry()
		channel, channelErr := getChannel(c, relayInfo, retryParam)
		if channelErr != nil {
			logger.LogError(c, channelErr.Error())
			newAPIError = channelErr
			break
		}

		addUsedChannel(c, channel.Id)
		bodyStorage, bodyErr := common.GetBodyStorage(c)
		if bodyErr != nil {
			// Ensure consistent 413 for oversized bodies even when error occurs later (e.g., retry path)
			if common.IsRequestBodyTooLargeError(bodyErr) || errors.Is(bodyErr, common.ErrRequestBodyTooLarge) {
				newAPIError = types.NewErrorWithStatusCode(bodyErr, types.ErrorCodeReadRequestBodyFailed, http.StatusRequestEntityTooLarge, types.ErrOptionWithSkipRetry())
			} else {
				newAPIError = types.NewErrorWithStatusCode(bodyErr, types.ErrorCodeReadRequestBodyFailed, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
			}
			break
		}
		c.Request.Body = io.NopCloser(bodyStorage)

		// 旁路捕获本次响应，供未命中时回写缓存；每轮重试各自一份，失败轮次的残留不会污染。
		capture := service.BeginResponseCaptureIfNeeded(c, relayInfo)
		c.Set(service.ResponseCaptureContextKey, capture)

		switch relayFormat {
		case types.RelayFormatOpenAIRealtime:
			newAPIError = relay.WssHelper(c, relayInfo)
		case types.RelayFormatClaude:
			newAPIError = relay.ClaudeHelper(c, relayInfo)
		case types.RelayFormatGemini:
			newAPIError = geminiRelayHandler(c, relayInfo)
		default:
			newAPIError = relayHandler(c, relayInfo)
		}
		capture.Restore(c)

		if newAPIError == nil {
			relayInfo.LastError = nil
			// 成功即清除该渠道的失败计数与熔断标记
			service.RecordChannelSuccess(channel.Id)
			return
		}

		newAPIError = service.NormalizeViolationFeeError(newAPIError)
		relayInfo.LastError = newAPIError

		// 记录失败用于分布式熔断：同一渠道在窗口期内连续失败达到阈值后，
		// 所有节点都会暂时跳过它，避免集群同时持续撞一个故障渠道。
		// 仅对渠道侧错误计数，用户侧错误（如额度不足、参数非法）不代表渠道故障。
		if service.ShouldCountTowardCircuitBreaker(newAPIError) {
			service.RecordChannelFailure(channel.Id)
		}

		processChannelError(c, *types.NewChannelError(channel.Id, channel.Type, channel.Name, channel.ChannelInfo.IsMultiKey, common.GetContextKeyString(c, constant.ContextKeyChannelKey), channel.GetAutoBan()), newAPIError)

		if !shouldRetry(c, newAPIError, common.RetryTimes-retryParam.GetRetry()) {
			break
		}
	}

	useChannel := c.GetStringSlice("use_channel")
	if len(useChannel) > 1 {
		retryLogStr := fmt.Sprintf("重试：%s", strings.Trim(strings.Join(strings.Fields(fmt.Sprint(useChannel)), "->"), "[]"))
		logger.LogInfo(c, retryLogStr)
	}
	if newAPIError != nil {
		gopool.Go(func() {
			perfmetrics.RecordRelaySample(relayInfo, false, 0)
		})
	}
}

var upgrader = websocket.Upgrader{
	Subprotocols: []string{"realtime"}, // WS 握手支持的协议，如果有使用 Sec-WebSocket-Protocol，则必须在此声明对应的 Protocol TODO add other protocol
	CheckOrigin: func(r *http.Request) bool {
		return true // 允许跨域
	},
}

func addUsedChannel(c *gin.Context, channelId int) {
	useChannel := c.GetStringSlice("use_channel")
	useChannel = append(useChannel, fmt.Sprintf("%d", channelId))
	c.Set("use_channel", useChannel)
}

func fastTokenCountMetaForPricing(request dto.Request) *types.TokenCountMeta {
	if request == nil {
		return &types.TokenCountMeta{}
	}
	meta := &types.TokenCountMeta{
		TokenType: types.TokenTypeTokenizer,
	}
	switch r := request.(type) {
	case *dto.GeneralOpenAIRequest:
		maxCompletionTokens := lo.FromPtrOr(r.MaxCompletionTokens, uint(0))
		maxTokens := lo.FromPtrOr(r.MaxTokens, uint(0))
		if maxCompletionTokens > maxTokens {
			meta.MaxTokens = int(maxCompletionTokens)
		} else {
			meta.MaxTokens = int(maxTokens)
		}
	case *dto.OpenAIResponsesRequest:
		meta.MaxTokens = int(lo.FromPtrOr(r.MaxOutputTokens, uint(0)))
	case *dto.ClaudeRequest:
		meta.MaxTokens = int(lo.FromPtr(r.MaxTokens))
	case *dto.ImageRequest:
		// Pricing for image requests depends on ImagePriceRatio; safe to compute even when CountToken is disabled.
		return r.GetTokenCountMeta()
	default:
		// Best-effort: leave CombineText empty to avoid large allocations.
	}
	return meta
}

func getChannel(c *gin.Context, info *relaycommon.RelayInfo, retryParam *service.RetryParam) (*model.Channel, *types.NewAPIError) {
	if info.ChannelMeta == nil {
		autoBan := c.GetBool("auto_ban")
		autoBanInt := 1
		if !autoBan {
			autoBanInt = 0
		}
		return &model.Channel{
			Id:      c.GetInt("channel_id"),
			Type:    c.GetInt("channel_type"),
			Name:    c.GetString("channel_name"),
			AutoBan: &autoBanInt,
		}, nil
	}
	channel, selectGroup, err := service.CacheGetRandomSatisfiedChannel(retryParam)

	info.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, info)

	if err != nil {
		return nil, types.NewError(fmt.Errorf("获取分组 %s 下模型 %s 的可用渠道失败（retry）: %s", selectGroup, info.OriginModelName, err.Error()), types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
	}
	if channel == nil {
		if retryParam.RequiredResolution != "" {
			return nil, types.NewError(fmt.Errorf("分组 %s 下模型 %s 没有支持 %s 分辨率的可用渠道（retry）", selectGroup, info.OriginModelName, retryParam.RequiredResolution), types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
		}
		return nil, types.NewError(fmt.Errorf("分组 %s 下模型 %s 的可用渠道不存在（retry）", selectGroup, info.OriginModelName), types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
	}

	newAPIError := middleware.SetupContextForSelectedChannel(c, channel, info.OriginModelName)
	if newAPIError != nil {
		return nil, newAPIError
	}
	return channel, nil
}

func shouldRetry(c *gin.Context, openaiErr *types.NewAPIError, retryTimes int) bool {
	if openaiErr == nil {
		return false
	}
	if service.ShouldSkipRetryAfterChannelAffinityFailure(c) {
		return false
	}
	if types.IsChannelError(openaiErr) {
		return true
	}
	if types.IsSkipRetryError(openaiErr) {
		return false
	}
	if retryTimes <= 0 {
		return false
	}
	if _, ok := c.Get("specific_channel_id"); ok {
		return false
	}
	code := openaiErr.StatusCode
	if code >= 200 && code < 300 {
		return false
	}
	if code < 100 || code > 599 {
		return true
	}
	if operation_setting.IsAlwaysSkipRetryCode(openaiErr.GetErrorCode()) {
		return false
	}
	return operation_setting.ShouldRetryByStatusCode(code)
}

func processChannelError(c *gin.Context, channelError types.ChannelError, err *types.NewAPIError) {
	logger.LogError(c, fmt.Sprintf("channel error (channel #%d, status code: %d): %s", channelError.ChannelId, err.StatusCode, common.LocalLogPreview(err.Error())))
	// 不要使用context获取渠道信息，异步处理时可能会出现渠道信息不一致的情况
	// do not use context to get channel info, there may be inconsistent channel info when processing asynchronously
	if service.ShouldDisableChannel(err) && channelError.AutoBan {
		gopool.Go(func() {
			service.DisableChannel(channelError, err.ErrorWithStatusCode())
		})
	}

	if constant.ErrorLogEnabled && types.IsRecordErrorLog(err) {
		// 保存错误日志到mysql中
		// 渠道身份（id/name/type）一律取 channelError，即构造这个错误时实际在用的渠道，
		// 不读 gin context：重试循环里 context 的 channel_id 会被下一次选渠道覆盖，一旦
		// 调用时序或异步化有变动，读 context 就会把渠道 A 的错误记到渠道 B 头上。
		userId := c.GetInt("id")
		tokenName := c.GetString("token_name")
		modelName := c.GetString("original_model")
		tokenId := c.GetInt("token_id")
		userGroup := c.GetString("group")
		other := make(map[string]interface{})
		if c.Request != nil && c.Request.URL != nil {
			other["request_path"] = c.Request.URL.Path
		}
		other["error_type"] = err.GetErrorType()
		other["error_code"] = err.GetErrorCode()
		other["status_code"] = err.StatusCode
		other["channel_id"] = channelError.ChannelId
		other["channel_name"] = channelError.ChannelName
		other["channel_type"] = channelError.ChannelType
		adminInfo := make(map[string]interface{})
		adminInfo["use_channel"] = c.GetStringSlice("use_channel")
		if channelError.IsMultiKey {
			adminInfo["is_multi_key"] = true
			adminInfo["multi_key_index"] = common.GetContextKeyInt(c, constant.ContextKeyChannelMultiKeyIndex)
		}
		service.AppendChannelAffinityAdminInfo(c, adminInfo)
		other["admin_info"] = adminInfo
		startTime := common.GetContextKeyTime(c, constant.ContextKeyRequestStartTime)
		if startTime.IsZero() {
			startTime = time.Now()
		}
		useTimeSeconds := int(time.Since(startTime).Seconds())
		model.RecordErrorLog(c, userId, channelError.ChannelId, modelName, tokenName, err.MaskSensitiveErrorWithStatusCode(), tokenId, useTimeSeconds, common.GetContextKeyBool(c, constant.ContextKeyIsStream), userGroup, other)
	}

	// 熔断：仅统计视频模型的上游错误（processChannelError 仅对非本地/上游错误触达）。
	// 独立于 ErrorLogEnabled（默认关闭），否则默认部署下熔断永不计数；保留 IsRecordErrorLog
	// 以沿用「哪些上游错误值得计入」的既有口径。1 分钟窗口内累计达阈值即自动禁用该用户。
	if types.IsRecordErrorLog(err) && c.GetInt("relay_mode") == relayconstant.RelayModeVideoSubmit {
		service.RecordVideoTaskError(c.GetInt("id"))
	}
}

func RelayMidjourney(c *gin.Context) {
	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatMjProxy, nil, nil)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"description": fmt.Sprintf("failed to generate relay info: %s", err.Error()),
			"type":        "upstream_error",
			"code":        4,
		})
		return
	}

	var mjErr *dto.MidjourneyResponse
	switch relayInfo.RelayMode {
	case relayconstant.RelayModeMidjourneyNotify:
		mjErr = relay.RelayMidjourneyNotify(c)
	case relayconstant.RelayModeMidjourneyTaskFetch, relayconstant.RelayModeMidjourneyTaskFetchByCondition:
		mjErr = relay.RelayMidjourneyTask(c, relayInfo.RelayMode)
	case relayconstant.RelayModeMidjourneyTaskImageSeed:
		mjErr = relay.RelayMidjourneyTaskImageSeed(c)
	case relayconstant.RelayModeSwapFace:
		mjErr = relay.RelaySwapFace(c, relayInfo)
	default:
		mjErr = relay.RelayMidjourneySubmit(c, relayInfo)
	}
	//err = relayMidjourneySubmit(c, relayMode)
	log.Println(mjErr)
	if mjErr != nil {
		statusCode := http.StatusBadRequest
		if mjErr.Code == 30 {
			mjErr.Result = "当前分组负载已饱和，请稍后再试，或升级账户以提升服务质量。"
			statusCode = http.StatusTooManyRequests
		}
		c.JSON(statusCode, gin.H{
			"description": fmt.Sprintf("%s %s", mjErr.Description, mjErr.Result),
			"type":        "upstream_error",
			"code":        mjErr.Code,
		})
		channelId := c.GetInt("channel_id")
		logger.LogError(c, fmt.Sprintf("relay error (channel #%d, status code %d): %s", channelId, statusCode, fmt.Sprintf("%s %s", mjErr.Description, mjErr.Result)))
	}
}

func RelayNotImplemented(c *gin.Context) {
	err := types.OpenAIError{
		Message: "API not implemented",
		Type:    "new_api_error",
		Param:   "",
		Code:    "api_not_implemented",
	}
	c.JSON(http.StatusNotImplemented, gin.H{
		"error": err,
	})
}

func RelayNotFound(c *gin.Context) {
	err := types.OpenAIError{
		Message: fmt.Sprintf("Invalid URL (%s %s)", c.Request.Method, c.Request.URL.Path),
		Type:    "invalid_request_error",
		Param:   "",
		Code:    "",
	}
	c.JSON(http.StatusNotFound, gin.H{
		"error": err,
	})
}

func RelayTaskFetch(c *gin.Context) {
	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatTask, nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, &dto.TaskError{
			Code:       "gen_relay_info_failed",
			Message:    err.Error(),
			StatusCode: http.StatusInternalServerError,
		})
		return
	}
	if taskErr := relay.RelayTaskFetch(c, relayInfo.RelayMode); taskErr != nil {
		respondTaskError(c, taskErr)
	}
}

func lockTokenBoundVideoChannel(c *gin.Context, info *relaycommon.RelayInfo) *dto.TaskError {
	if info.LockedChannel != nil || info.RelayMode != relayconstant.RelayModeVideoSubmit || c.GetInt("token_id") <= 0 {
		return nil
	}
	boundChannelId := c.GetInt("token_channel_id")
	if boundChannelId <= 0 {
		return nil
	}
	channel, err := model.GetChannelById(boundChannelId, true)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "get_channel_failed", http.StatusInternalServerError)
	}
	info.LockedChannel = channel
	return nil
}

func RelayTask(c *gin.Context) {
	requestId := c.GetString(common.RequestIdKey)
	defer func() {
		// task 错误行各自持有当次上游响应（logs.content），这里只补共享的请求快照；
		// 成功任务的请求/响应已在 tasks 表，不重复写 log_bodies。
		if c.Writer.Status() >= http.StatusBadRequest {
			saveRelayBodySnapshotData(c, requestId, nil)
		}
	}()

	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatTask, nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, &dto.TaskError{
			Code:       "gen_relay_info_failed",
			Message:    err.Error(),
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	if taskErr := relay.ResolveOriginTask(c, relayInfo); taskErr != nil {
		respondTaskError(c, taskErr)
		return
	}
	if taskErr := lockTokenBoundVideoChannel(c, relayInfo); taskErr != nil {
		respondTaskError(c, taskErr)
		return
	}

	var result *relay.TaskSubmitResult
	var taskErr *dto.TaskError
	defer func() {
		if taskErr != nil && relayInfo.Billing != nil {
			relayInfo.Billing.Refund(c)
		}
	}()

	retryParam := &service.RetryParam{
		Ctx:                c,
		TokenGroup:         relayInfo.TokenGroup,
		ModelName:          relayInfo.OriginModelName,
		RequestPath:        c.Request.URL.Path,
		RequiredResolution: middleware.ExtractRequestedResolution(c),
		Retry:              common.GetPointer(0),
	}

	for ; retryParam.GetRetry() <= common.RetryTimes; retryParam.IncreaseRetry() {
		var channel *model.Channel

		if lockedCh, ok := relayInfo.LockedChannel.(*model.Channel); ok && lockedCh != nil {
			channel = lockedCh
			if retryParam.GetRetry() > 0 {
				if setupErr := middleware.SetupContextForSelectedChannel(c, channel, relayInfo.OriginModelName); setupErr != nil {
					taskErr = service.TaskErrorWrapperLocal(setupErr.Err, "setup_locked_channel_failed", http.StatusInternalServerError)
					break
				}
			}
		} else {
			var channelErr *types.NewAPIError
			channel, channelErr = getChannel(c, relayInfo, retryParam)
			if channelErr != nil {
				logger.LogError(c, channelErr.Error())
				taskErr = service.TaskErrorWrapperLocal(channelErr.Err, "get_channel_failed", http.StatusInternalServerError)
				break
			}
		}

		addUsedChannel(c, channel.Id)
		bodyStorage, bodyErr := common.GetBodyStorage(c)
		if bodyErr != nil {
			if common.IsRequestBodyTooLargeError(bodyErr) || errors.Is(bodyErr, common.ErrRequestBodyTooLarge) {
				taskErr = service.TaskErrorWrapperLocal(bodyErr, "read_request_body_failed", http.StatusRequestEntityTooLarge)
			} else {
				taskErr = service.TaskErrorWrapperLocal(bodyErr, "read_request_body_failed", http.StatusBadRequest)
			}
			break
		}
		c.Request.Body = io.NopCloser(bodyStorage)

		result, taskErr = relay.RelayTaskSubmit(c, relayInfo)
		if taskErr == nil {
			break
		}

		if channelErr := taskErrorAsChannelError(taskErr); channelErr != nil {
			processChannelError(c,
				*types.NewChannelError(channel.Id, channel.Type, channel.Name, channel.ChannelInfo.IsMultiKey,
					common.GetContextKeyString(c, constant.ContextKeyChannelKey), channel.GetAutoBan()),
				channelErr)
		}

		if !shouldRetryTaskRelay(c, channel.Id, taskErr, common.RetryTimes-retryParam.GetRetry()) {
			break
		}
	}

	useChannel := c.GetStringSlice("use_channel")
	if len(useChannel) > 1 {
		retryLogStr := fmt.Sprintf("重试：%s", strings.Trim(strings.Join(strings.Fields(fmt.Sprint(useChannel)), "->"), "[]"))
		logger.LogInfo(c, retryLogStr)
	}

	// ── 成功：结算 + 日志 + 插入任务 ──
	if taskErr == nil {
		if settleErr := service.SettleBilling(c, relayInfo, result.Quota); settleErr != nil {
			common.SysError("settle task billing error: " + settleErr.Error())
		}

		task := model.InitTask(result.Platform, relayInfo)
		task.PrivateData.UpstreamTaskID = result.UpstreamTaskID
		task.PrivateData.BillingSource = relayInfo.BillingSource
		task.PrivateData.SubscriptionId = relayInfo.SubscriptionId
		task.PrivateData.OrgId = relayInfo.OrgId
		task.PrivateData.TokenId = relayInfo.TokenId
		task.PrivateData.NodeName = common.NodeName
		task.PrivateData.BillingContext = &model.TaskBillingContext{
			ModelPrice:      relayInfo.PriceData.ModelPrice,
			GroupRatio:      relayInfo.PriceData.GroupRatioInfo.GroupRatio,
			ModelRatio:      relayInfo.PriceData.ModelRatio,
			OtherRatios:     relayInfo.PriceData.OtherRatios(),
			OriginModelName: relayInfo.OriginModelName,
			PerCallBilling:  common.StringsContains(constant.TaskPricePatches, relayInfo.OriginModelName) || relayInfo.PriceData.UsePrice,
			HasVideo:        relayInfo.HasVideoInput,
		}
		task.Quota = result.Quota
		task.Data = result.TaskData
		task.RequestData = snapshotRedactedRequestBody(c)
		task.Action = relayInfo.Action
		// 消费日志带 task_id，计费视图据此折叠后续结算/退款
		service.LogTaskConsumption(c, relayInfo, task.TaskID)
		if insertErr := task.Insert(); insertErr != nil {
			common.SysError("insert task error: " + insertErr.Error())
		}
	}

	if taskErr != nil {
		respondTaskError(c, taskErr)
	}
}

// maxTaskRequestSnapshotBytes 传入参数快照的落库上限。RedactBase64 已截断 base64 媒体，
// 仍设上限兜底（超长 prompt / 大量 URL），超限则放弃快照以免撑爆 tasks 行。
const maxTaskRequestSnapshotBytes = 256 * 1024

// snapshotRedactedRequestBody 抓取用户提交的原始 JSON 请求体并脱敏后作为「传入参数」快照。
// 与 task.Data（上游响应快照）对称落库，保证任务 ID 查询结果过期后仍可回溯入参。
// 仅快照 application/json 请求体（multipart 直传含二进制不入库）；base64 媒体按 DEBUG
// 日志同一口径截断、URL 原样保留。读取失败/超限时返回 nil（调用方落空列）。
func snapshotRedactedRequestBody(c *gin.Context) []byte {
	if !strings.Contains(c.Request.Header.Get("Content-Type"), "application/json") {
		return nil
	}
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return nil
	}
	raw, err := storage.Bytes()
	if err != nil || len(raw) == 0 {
		return nil
	}
	redacted := logger.RedactBase64(raw)
	if len(redacted) > maxTaskRequestSnapshotBytes {
		return nil
	}
	return redacted
}

// maxRelayBodySnapshotBytes 使用日志请求/返回体快照的单侧上限（1MB）。语言模型长上下文
// 足以覆盖（约 25 万 token）；超限即停抄并加截断标记，log_bodies 字段为跨库大文本
// （MySQL longtext / PG text / SQLite text），不会溢出报错。
const maxRelayBodySnapshotBytes = 1 << 20

// relaySnapshotTruncMark 快照超限截断处追加的标记，便于前端/排查者一眼看出内容被裁剪。
const relaySnapshotTruncMark = "...(truncated)"

// relayBodyWriter 包装 gin.ResponseWriter，把写给客户端的响应字节旁路复制进有限大小
// 缓冲区（仿 middleware/audit.go 的 auditResponseWriter capped-tee）：流式 SSE 逐块累积、
// 非流式整包、错误体同样入缓冲；超过上限即停抄，避免大响应占用过多内存。
type relayBodyWriter struct {
	gin.ResponseWriter
	body    *bytes.Buffer
	maxSize int
}

func (w *relayBodyWriter) Write(b []byte) (int, error) {
	w.capture(b)
	return w.ResponseWriter.Write(b)
}

func (w *relayBodyWriter) WriteString(s string) (int, error) {
	w.capture([]byte(s))
	return w.ResponseWriter.WriteString(s)
}

func (w *relayBodyWriter) capture(b []byte) {
	if w.body.Len() >= w.maxSize {
		return
	}
	if remain := w.maxSize - w.body.Len(); len(b) <= remain {
		w.body.Write(b)
	} else {
		w.body.Write(b[:remain])
	}
}

// newRelayBodyWriter 在同步中继入口包装 c.Writer 并返回捕获器。realtime(WebSocket)
// 走二进制帧不适用，调用方需自行跳过。
func newRelayBodyWriter(c *gin.Context) *relayBodyWriter {
	w := &relayBodyWriter{
		ResponseWriter: c.Writer,
		body:           bytes.NewBuffer(nil),
		maxSize:        maxRelayBodySnapshotBytes,
	}
	c.Writer = w
	return w
}

// saveRelayBodySnapshot 在 Relay handler 返回后把请求/返回体快照异步落库，不阻塞响应。
// 两侧各自 RedactBase64 + 超限截断（追加 ...(truncated) 标记）；requestId 为空或两体皆空
// 时 SaveLogBody 自身跳过。缓冲在 handler 返回后不再被写入，异步读取安全。
func saveRelayBodySnapshot(c *gin.Context, requestId string, w *relayBodyWriter) {
	if w == nil {
		return
	}
	saveRelayBodySnapshotData(c, requestId, w.body.Bytes())
}

// saveRelayBodySnapshotData 按 request_id 保存请求/响应快照，供同步中继与 task 错误
// 两种入口复用。response 可为空：task 错误的上游响应保存在各错误行的 content 中，
// 前端按行展示，避免同一 request_id 重试多个渠道时共享响应造成串渠道展示。
// 读取与脱敏在调用方 goroutine 内完成，仅把最终字节交给异步写库。
func saveRelayBodySnapshotData(c *gin.Context, requestId string, response []byte) {
	reqBody := truncateRelaySnapshot(snapshotRelayRequestBody(c))
	respBody := truncateRelaySnapshot(logger.RedactBase64(response))
	if len(reqBody) == 0 && len(respBody) == 0 {
		return
	}
	gopool.Go(func() {
		if err := model.SaveLogBody(requestId, reqBody, respBody); err != nil {
			logger.LogError(c, "failed to save relay log body: "+err.Error())
		}
	})
}

// snapshotRelayRequestBody 抓取使用日志的「传入参数」：仅 application/json 请求体
// （multipart 直传含二进制不入库），base64 媒体按 DEBUG 日志同口径截断、URL 原样保留。
// 与任务侧 snapshotRedactedRequestBody 的区别：不在超限时返回 nil，交由 truncateRelaySnapshot
// 按 maxRelayBodySnapshotBytes 截断加标记（长上下文仍需保留可用前缀）。
func snapshotRelayRequestBody(c *gin.Context) []byte {
	if !strings.Contains(c.Request.Header.Get("Content-Type"), "application/json") {
		return nil
	}
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return nil
	}
	raw, err := storage.Bytes()
	if err != nil || len(raw) == 0 {
		return nil
	}
	return logger.RedactBase64(raw)
}

// truncateRelaySnapshot 按 maxRelayBodySnapshotBytes 截断快照，超限处追加 ...(truncated) 标记。
// 截断可能破坏 JSON 合法性，但快照仅供查错、前端 pretty 失败时按原文展示即可。
func truncateRelaySnapshot(b []byte) []byte {
	if len(b) <= maxRelayBodySnapshotBytes {
		return b
	}
	out := make([]byte, 0, maxRelayBodySnapshotBytes+len(relaySnapshotTruncMark))
	out = append(out, b[:maxRelayBodySnapshotBytes]...)
	out = append(out, relaySnapshotTruncMark...)
	return out
}

// respondTaskError 统一输出 Task 错误响应（含 429 限流提示改写）
func respondTaskError(c *gin.Context, taskErr *dto.TaskError) {
	if taskErr.StatusCode == http.StatusTooManyRequests {
		taskErr.Message = "当前分组上游负载已饱和，请稍后再试"
	} else if service.ShouldMaskUpstreamKeywordError(taskErrorAsChannelError(taskErr)) {
		// 命中失败关键词（通常是上游渠道欠费/不可用）：对下游隐藏上游原文，统一返回「请稍后重试」
		taskErr.Message = service.UpstreamKeywordMaskMessage
	}
	// 火山方舟官方协议路径：错误响应也对齐官方结构，客户端无需适配两种错误格式
	if strings.HasPrefix(c.Request.URL.Path, "/api/v3/contents/generations/tasks") {
		errorBody := gin.H{
			"code":    taskErr.Code,
			"message": taskErr.Message,
		}
		switch taskErr.Code {
		case "ResourceNotFound":
			errorBody["param"] = ""
			errorBody["type"] = "NotFound"
		case "InvalidAction.RunningTaskDeletion":
			errorBody["param"] = ""
			errorBody["type"] = "Conflict"
		}
		c.JSON(taskErr.StatusCode, gin.H{"error": errorBody})
		return
	}
	c.JSON(taskErr.StatusCode, taskErr)
}

// taskErrorAsChannelError 把任务提交失败换算成「渠道视角」的错误，供 processChannelError
// 判定是否禁用渠道、是否落错误日志；返回 nil 表示这次失败不是渠道故障（LocalError，
// 如取渠道失败、读请求体失败、适配器校验不通过），不该走渠道错误处理。
//
// 本地生成的类型化错误（预扣费失败、重复 requestId 等）必须原样下传：重新包成
// bad_response_status_code 会丢掉真实 error_code 与 SkipRetry / NoRecordErrorLog 选项，
// 用户令牌余额不足就会被当成渠道故障——生产上曾因此把一次余额不足记成每个重试渠道
// 各一行文案完全相同的错误日志（channel 14/5/33/27…），看起来像所有渠道同时欠费。
// 只有来自上游响应的错误才归一化为 bad_response_status_code。
func taskErrorAsChannelError(taskErr *dto.TaskError) *types.NewAPIError {
	if taskErr == nil || taskErr.LocalError {
		return nil
	}
	if taskErr.APIError != nil {
		return taskErr.APIError
	}
	return types.NewOpenAIError(taskErr.Error, types.ErrorCodeBadResponseStatusCode, taskErr.StatusCode)
}

func shouldRetryTaskRelay(c *gin.Context, channelId int, taskErr *dto.TaskError, retryTimes int) bool {
	if taskErr == nil {
		return false
	}
	// 本地生成的类型化错误自带 SkipRetry 语义（预扣费失败、重复 requestId 等）：换渠道
	// 不可能让它成功，继续重试只会在每个渠道上各产生一行同样文案的错误日志。
	if types.IsSkipRetryError(taskErr.APIError) {
		return false
	}
	if service.ShouldSkipRetryAfterChannelAffinityFailure(c) {
		return false
	}
	if retryTimes <= 0 {
		return false
	}
	if _, ok := c.Get("specific_channel_id"); ok {
		return false
	}
	if taskErr.StatusCode == http.StatusTooManyRequests {
		return true
	}
	if taskErr.StatusCode == 307 {
		return true
	}
	if taskErr.StatusCode/100 == 5 {
		// 超时不重试
		if operation_setting.IsAlwaysSkipRetryStatusCode(taskErr.StatusCode) {
			return false
		}
		return true
	}
	if taskErr.StatusCode == http.StatusBadRequest {
		return false
	}
	if taskErr.StatusCode == 408 {
		// azure处理超时不重试
		return false
	}
	if taskErr.LocalError {
		return false
	}
	if taskErr.StatusCode/100 == 2 {
		return false
	}
	return true
}
