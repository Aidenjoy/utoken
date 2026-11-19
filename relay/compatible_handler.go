package relay

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/samber/lo"

	"github.com/gin-gonic/gin"
)

func TextHelper(c *gin.Context, info *relaycommon.RelayInfo) (newAPIError *types.NewAPIError) {
	info.InitChannelMeta(c)

	textReq, ok := info.Request.(*dto.GeneralOpenAIRequest)
	if !ok {
		return types.NewErrorWithStatusCode(fmt.Errorf("invalid request type, expected dto.GeneralOpenAIRequest, got %T", info.Request), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	request, err := common.DeepCopy(textReq)
	if err != nil {
		return types.NewError(fmt.Errorf("failed to copy request to GeneralOpenAIRequest: %w", err), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}

	if request.WebSearchOptions != nil {
		c.Set("chat_completion_web_search_context_size", request.WebSearchOptions.SearchContextSize)
	}

	err = helper.ModelMappedHelper(c, info, request)
	if err != nil {
		return types.NewError(err, types.ErrorCodeChannelModelMappedError, types.ErrOptionWithSkipRetry())
	}

	includeUsage := true
	// 判断用户是否需要返回使用情况
	if request.StreamOptions != nil {
		includeUsage = request.StreamOptions.IncludeUsage
	}

	// 如果不支持StreamOptions，将StreamOptions设置为nil
	if !info.SupportStreamOptions || !lo.FromPtrOr(request.Stream, false) {
		request.StreamOptions = nil
	} else {
		// 如果支持StreamOptions，且请求中没有设置StreamOptions，根据配置文件设置StreamOptions
		if constant.ForceStreamOption {
			request.StreamOptions = &dto.StreamOptions{
				IncludeUsage: true,
			}
		}
	}

	info.ShouldIncludeUsage = includeUsage

	adaptor := GetAdaptor(info.ApiType)
	if adaptor == nil {
		return types.NewError(fmt.Errorf("invalid api type: %d", info.ApiType), types.ErrorCodeInvalidApiType, types.ErrOptionWithSkipRetry())
	}
	adaptor.Init(info)

	var membership *service.MembershipSession
	deferredBilling := c.GetBool("defer_shared_subscription_billing") && info.Billing == nil && c.GetInt("membership_subscription_id") == 0
	defer func() {
		if deferredBilling && membership != nil {
			service.FinishMembershipRequest(c, info, membership, newAPIError == nil)
		}
	}()

	if c.GetInt("membership_subscription_id") > 0 {
		shared := c.GetBool("membership_shared_tokens")
		channelSupported := model.MembershipTextChannelSupported(info.ChannelType)
		if shared {
			channelSupported = channelSupported || info.ChannelType == constant.ChannelTypeCustom
		} else {
			channelSupported = channelSupported || info.ChannelType == constant.ChannelTypeAnthropic || info.ChannelType == constant.ChannelTypeGemini
		}
		if !channelSupported || info.RelayMode != relayconstant.RelayModeChatCompletions || model_setting.GetGlobalSettings().PassThroughRequestEnabled || info.ChannelSetting.PassThroughBodyEnabled || service.ShouldChatCompletionsUseResponsesGlobal(info.ChannelId, info.ChannelType, info.OriginModelName) {
			return types.NewErrorWithStatusCode(fmt.Errorf("membership channel or protocol conversion is not supported"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
		if (request.MaxTokens == nil && request.MaxCompletionTokens == nil) || (request.MaxTokens != nil && request.MaxCompletionTokens != nil) || (request.N != nil && *request.N != 1) || len(request.Tools) > 0 || len(request.Functions) > 0 || request.ToolChoice != nil || len(request.FunctionCall) > 0 {
			return types.NewErrorWithStatusCode(fmt.Errorf("membership requires one explicit output limit and a single plain text result"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
		if info.ChannelType == constant.ChannelTypeAnthropic || info.ChannelType == constant.ChannelTypeGemini {
			for _, message := range request.Messages {
				if !message.IsStringContent() || (message.Role != "user" && message.Role != "assistant" && message.Role != "system") {
					return types.NewErrorWithStatusCode(fmt.Errorf("membership Chat conversion supports string text messages only"), types.ErrorCodeInvalidRequest, http.StatusForbidden, types.ErrOptionWithSkipRetry())
				}
			}
		}
		if info.IsStream && info.ChannelType != constant.ChannelTypeAnthropic && info.ChannelType != constant.ChannelTypeGemini {
			if !info.SupportStreamOptions {
				return types.NewErrorWithStatusCode(fmt.Errorf("membership requires stream usage support"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
			}
			request.StreamOptions = &dto.StreamOptions{IncludeUsage: true}
		}
		defer func() {
			if membership != nil {
				if (info.ChannelType == constant.ChannelTypeAnthropic && info.IsStream || info.ChannelType == constant.ChannelTypeGemini) && !membership.TransportComplete {
					membership.InvalidUsage = true
				}
				service.FinishMembershipRequest(c, info, membership, newAPIError == nil)
			}
		}()
	}
	passThroughGlobal := model_setting.GetGlobalSettings().PassThroughRequestEnabled
	if info.RelayMode == relayconstant.RelayModeChatCompletions &&
		!passThroughGlobal &&
		!info.ChannelSetting.PassThroughBodyEnabled &&
		service.ShouldChatCompletionsUseResponsesGlobal(info.ChannelId, info.ChannelType, info.OriginModelName) {
		if deferredBilling {
			if err := service.PreConsumeBilling(c, info.PriceData.QuotaToPreConsume, info); err != nil {
				return err
			}
		}
		applySystemPromptIfNeeded(c, info, request)
		usage, newApiErr := chatCompletionsViaResponses(c, info, adaptor, request)
		if newApiErr != nil {
			return newApiErr
		}

		var containAudioTokens = usage.CompletionTokenDetails.AudioTokens > 0 || usage.PromptTokensDetails.AudioTokens > 0
		var containsAudioRatios = ratio_setting.ContainsAudioRatio(info.OriginModelName) || ratio_setting.ContainsAudioCompletionRatio(info.OriginModelName)

		if containAudioTokens && containsAudioRatios {
			service.PostAudioConsumeQuota(c, info, usage, "")
		} else {
			service.PostTextConsumeQuota(c, info, usage, nil)
		}
		return nil
	}

	var requestBody io.Reader

	if passThroughGlobal || info.ChannelSetting.PassThroughBodyEnabled {
		storage, err := common.GetBodyStorage(c)
		if err != nil {
			return types.NewErrorWithStatusCode(err, types.ErrorCodeReadRequestBodyFailed, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
		if common.DebugEnabled {
			if debugBytes, bErr := storage.Bytes(); bErr == nil {
				logger.LogDebugJSON(c, "requestBody: %s", debugBytes)
			}
		}
		requestBody = common.ReaderOnly(storage)
	} else {
		if c.GetInt("membership_subscription_id") > 0 && (info.ChannelType == constant.ChannelTypeAnthropic || info.ChannelType == constant.ChannelTypeGemini) {
			applySystemPromptIfNeeded(c, info, request)
		}
		convertedRequest, err := adaptor.ConvertOpenAIRequest(c, info, request)
		if err != nil {
			return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
		}
		relaycommon.AppendRequestConversionFromRequest(info, convertedRequest)

		if info.ChannelSetting.SystemPrompt != "" {
			// 如果有系统提示，则将其添加到请求中
			request, ok := convertedRequest.(*dto.GeneralOpenAIRequest)
			if ok {
				containSystemPrompt := false
				for _, message := range request.Messages {
					if message.Role == request.GetSystemRoleName() {
						containSystemPrompt = true
						break
					}
				}
				if !containSystemPrompt {
					// 如果没有系统提示，则添加系统提示
					systemMessage := dto.Message{
						Role:    request.GetSystemRoleName(),
						Content: info.ChannelSetting.SystemPrompt,
					}
					request.Messages = append([]dto.Message{systemMessage}, request.Messages...)
				} else if info.ChannelSetting.SystemPromptOverride {
					common.SetContextKey(c, constant.ContextKeySystemPromptOverride, true)
					// 如果有系统提示，且允许覆盖，则拼接到前面
					for i, message := range request.Messages {
						if message.Role == request.GetSystemRoleName() {
							if message.IsStringContent() {
								request.Messages[i].SetStringContent(info.ChannelSetting.SystemPrompt + "\n" + message.StringContent())
							} else {
								contents := message.ParseContent()
								contents = append([]dto.MediaContent{
									{
										Type: dto.ContentTypeText,
										Text: info.ChannelSetting.SystemPrompt,
									},
								}, contents...)
								request.Messages[i].Content = contents
							}
							break
						}
					}
				}
			}
		}

		jsonData, err := common.Marshal(convertedRequest)
		if err != nil {
			return types.NewError(err, types.ErrorCodeJsonMarshalFailed, types.ErrOptionWithSkipRetry())
		}

		// remove disabled fields for OpenAI API
		jsonData, err = relaycommon.RemoveDisabledFields(jsonData, info.ChannelOtherSettings, info.ChannelSetting.PassThroughBodyEnabled)
		if err != nil {
			return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
		}

		// apply param override
		if len(info.ParamOverride) > 0 {
			jsonData, err = relaycommon.ApplyParamOverrideWithRelayInfo(jsonData, info)
			if err != nil {
				return newAPIErrorFromParamOverride(err)
			}
		}

		if c.GetInt("membership_subscription_id") > 0 {
			// Reserve the converted provider body, including its actual output cap.
			if info.ChannelType == constant.ChannelTypeAnthropic {
				membership, err = service.PrepareMembershipClaude(c, info, jsonData, uint(helper.MaxTokensLimit))
			} else if info.ChannelType == constant.ChannelTypeGemini {
				membership, err = service.PrepareMembershipGemini(c, info, jsonData, uint(helper.MaxTokensLimit))
			} else {
				membership, err = service.PrepareMembershipText(c, info, jsonData, uint(helper.MaxTokensLimit))
			}
			if err != nil {
				return types.NewErrorWithStatusCode(err, types.ErrorCodeInvalidRequest, http.StatusForbidden, types.ErrOptionWithSkipRetry())
			}
		}
		if deferredBilling && (model.MembershipTextChannelSupported(info.ChannelType) || info.ChannelType == constant.ChannelTypeCustom) {
			if err := service.PreConsumeBilling(c, info.PriceData.QuotaToPreConsume, info, func() (bool, *types.NewAPIError) {
				return service.TrySharedTextSubscription(c, info, jsonData, uint(helper.MaxTokensLimit))
			}); err != nil {
				return err
			}
			value, _ := c.Get("membership_session")
			membership, _ = value.(*service.MembershipSession)
		}
		logger.LogDebugJSON(c, "text request body: %s", jsonData)

		body, size, closer, err := relaycommon.NewOutboundJSONBody(jsonData)
		if err != nil {
			return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
		}
		defer closer.Close()
		jsonData = nil
		info.UpstreamRequestBodySize = size
		requestBody = body
	}

	if deferredBilling && membership == nil && info.Billing == nil {
		if err := service.PreConsumeBilling(c, info.PriceData.QuotaToPreConsume, info); err != nil {
			return err
		}
	}
	var httpResp *http.Response
	if membership != nil {
		if err := model.DispatchMembership(membership.Request.RequestId); err != nil {
			return types.NewErrorWithStatusCode(err, types.ErrorCodeInvalidRequest, http.StatusInternalServerError, types.ErrOptionWithSkipRetry())
		}
		membership.Dispatched = true
	}
	resp, err := adaptor.DoRequest(c, info, requestBody)
	if err != nil {
		return types.NewOpenAIError(err, types.ErrorCodeDoRequestFailed, http.StatusInternalServerError)
	}

	statusCodeMappingStr := c.GetString("status_code_mapping")

	if resp != nil {
		httpResp = resp.(*http.Response)
		info.IsStream = info.IsStream || strings.HasPrefix(httpResp.Header.Get("Content-Type"), "text/event-stream")
		if httpResp.StatusCode != http.StatusOK {
			newApiErr := service.RelayErrorHandler(c.Request.Context(), httpResp, false)
			// reset status code 重置状态码
			service.ResetStatusCode(newApiErr, statusCodeMappingStr)
			return newApiErr
		}
	}

	usage, newApiErr := adaptor.DoResponse(c, httpResp, info)
	if newApiErr != nil {
		// reset status code 重置状态码
		service.ResetStatusCode(newApiErr, statusCodeMappingStr)
		return newApiErr
	}

	if membership != nil {
		if c.GetBool("membership_shared_tokens") {
			membership.WalletTextUsage, _ = usage.(*dto.Usage)
		}
		return nil
	} // The deferred membership settlement owns this request.
	var containAudioTokens = usage.(*dto.Usage).CompletionTokenDetails.AudioTokens > 0 || usage.(*dto.Usage).PromptTokensDetails.AudioTokens > 0
	var containsAudioRatios = ratio_setting.ContainsAudioRatio(info.OriginModelName) || ratio_setting.ContainsAudioCompletionRatio(info.OriginModelName)

	if containAudioTokens && containsAudioRatios {
		service.PostAudioConsumeQuota(c, info, usage.(*dto.Usage), "")
	} else {
		service.PostTextConsumeQuota(c, info, usage.(*dto.Usage), nil)
	}
	return nil
}
