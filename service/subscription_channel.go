package service

import (
	"errors"
	"fmt"
	"math"
	"net/http"

	"github.com/QuantumNous/new-api/types"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

// MembershipSession owns one reservation and its provider usage receipt.
// It deliberately does not implement wallet billing or use normalized quota usage.
type MembershipSession struct {
	TokenQuotaReserved int
	WalletTextUsage    *dto.Usage
	GeminiImage        bool
	SeedreamImage      bool
	ClaudeInputReceipt []byte
	TransportComplete  bool
	ClaudeInputSeen    bool
	ClaudeOutputSeen   bool
	Quantity           int64
	Request            model.SubscriptionChannelRequest
	Input              int64
	Output             int64
	HasUsage           bool
	InvalidUsage       bool
	Dispatched         bool
	UsageReceipt       []byte
}

// PrepareMembershipText validates the final outbound body and reserves both token dimensions.
// The conservative UTF-8 byte bound avoids under-reserving a provider-specific tokenizer;
// it is only a reservation, never presented as provider input usage.
var errSharedTextUnsupported = errors.New("request does not support shared token settlement")

func PrepareMembershipText(c *gin.Context, info *relaycommon.RelayInfo, body []byte, maxOutputLimit uint) (session *MembershipSession, err error) {
	shared := c.GetBool("membership_shared_tokens")
	validated := false
	defer func() {
		if shared && !validated && err != nil {
			err = fmt.Errorf("%w: %v", errSharedTextUnsupported, err)
		}
	}()

	var req dto.GeneralOpenAIRequest
	if err := common.Unmarshal(body, &req); err != nil {
		return nil, err
	}
	if (!shared && !model.MembershipTextModelSupported(req.Model)) || req.Model != info.UpstreamModelName || len(req.Messages) == 0 || len(req.Tools) > 0 || len(req.Functions) > 0 || len(req.Audio) > 0 || len(req.Modalities) > 0 || len(req.ExtraBody) > 0 || req.WebSearchOptions != nil || req.Prompt != nil || req.Input != nil || req.ResponseFormat != nil || req.ToolChoice != nil || len(req.FunctionCall) > 0 || (req.N != nil && *req.N != 1) {
		return nil, errors.New("membership profile supports plain text chat with one output only")
	}
	if info.ChannelType == constant.ChannelTypeVolcEngine && (req.MaxTokens != nil || req.MaxCompletionTokens == nil) {
		return nil, errors.New("Ark membership requires a total completion token cap including thinking")
	}
	if req.MaxTokens != nil && req.MaxCompletionTokens != nil {
		return nil, errors.New("membership requires one unambiguous output limit")
	}
	limit := req.MaxCompletionTokens
	if limit == nil {
		limit = req.MaxTokens
	}
	if limit == nil || *limit == 0 || *limit > maxOutputLimit {
		return nil, errors.New("membership requires a valid explicit output token limit")
	}
	stream := req.Stream != nil && *req.Stream
	if stream != info.IsStream || (stream && (req.StreamOptions == nil || !req.StreamOptions.IncludeUsage)) {
		return nil, errors.New("membership stream settings must preserve provider usage")
	}
	inputBound := int64(3)
	for _, message := range req.Messages {
		if !message.IsStringContent() || len(message.ToolCalls) > 0 || message.ToolCallId != "" || message.Prefix != nil || message.Reasoning != nil || message.ReasoningContent != nil || (message.Role != "system" && message.Role != "user" && message.Role != "assistant" && message.Role != "developer") {
			return nil, errors.New("membership profile does not yet support media or tool messages")
		}
		inputBound += int64(len(message.StringContent()) + len(message.Role) + 64)
		if message.Name != nil {
			inputBound += int64(len(*message.Name))
		}
		if inputBound > model.MembershipMaxTokens {
			return nil, errors.New("membership input is too large")
		}
	}
	session = &MembershipSession{Request: model.SubscriptionChannelRequest{
		RequestId: common.GetUUID(), UserId: info.UserId, TokenId: info.TokenId,
		UserSubscriptionId: c.GetInt("membership_subscription_id"), ChannelId: info.ChannelId,
		Model: info.OriginModelName, InputReserved: inputBound, OutputReserved: int64(*limit),
	}}
	if shared {
		price := info.PriceData
		if price.UsePrice || info.TieredBillingSnapshot != nil || billing_setting.GetBillingMode(info.OriginModelName) == billing_setting.BillingModeSeedream {
			return nil, errors.New("shared membership requires separable token ratio pricing")
		}
		// Use the highest applicable input coefficient for the final bounded prompt.
		ratios := []float64{price.ModelRatio, price.GroupRatioInfo.GroupRatio, price.CompletionRatio, price.CacheRatio, price.CacheCreationRatio, price.CacheCreation5mRatio, price.CacheCreation1hRatio}
		for _, ratio := range ratios {
			if ratio < 0 || math.IsNaN(ratio) || math.IsInf(ratio, 0) {
				return nil, errors.New("invalid shared membership price ratio")
			}
		}
		ratio := decimal.NewFromFloat(price.ModelRatio).Mul(decimal.NewFromFloat(price.GroupRatioInfo.GroupRatio))
		cache := max(1, price.CacheRatio, price.CacheCreationRatio, price.CacheCreation5mRatio, price.CacheCreation1hRatio)
		input := price.ApplyOtherRatiosToDecimal(decimal.NewFromInt(inputBound).Mul(ratio).Mul(decimal.NewFromFloat(cache))).Ceil()
		output := price.ApplyOtherRatiosToDecimal(decimal.NewFromInt(int64(*limit)).Mul(ratio).Mul(decimal.NewFromFloat(price.CompletionRatio))).Ceil()
		// Reserve one extra output unit for rounding and minimum-charge allocation.
		in, inClamp := common.QuotaFromDecimalChecked(input)
		out, outClamp := common.QuotaFromDecimalChecked(output.Add(decimal.NewFromInt(1)))
		if inClamp != nil || outClamp != nil {
			return nil, errors.New("shared membership reservation exceeds supported range")
		}
		session.Request.ChannelId = 0
		session.Request.InputReserved = int64(max(1, in))
		session.Request.OutputReserved = int64(max(1, out))
	}
	validated = true
	if err := model.ReserveMembership(&session.Request); err != nil {
		return nil, err
	}
	c.Set("membership_session", session)
	logger.LogInfo(c, fmt.Sprintf("membership reserved request=%s subscription=%d channel=%d input_bound=%d output_limit=%d", session.Request.RequestId, session.Request.UserSubscriptionId, info.ChannelId, inputBound, *limit))
	return session, nil
}

// TrySharedTextSubscription runs inside the existing subscription source selection.
func TrySharedTextSubscription(c *gin.Context, info *relaycommon.RelayInfo, body []byte, maxOutputLimit uint) (bool, *types.NewAPIError) {
	value, _ := c.Get("shared_subscription_candidates")
	ids, _ := value.([]int)
	for _, id := range ids {
		c.Set("membership_subscription_id", id)
		c.Set("membership_shared_tokens", true)
		session, err := PrepareMembershipText(c, info, body, maxOutputLimit)
		if err != nil {
			c.Set("membership_subscription_id", 0)
			c.Set("membership_shared_tokens", false)
			if errors.Is(err, errSharedTextUnsupported) {
				return false, nil
			}
			if errors.Is(err, model.ErrMembershipQuota) {
				continue
			}
			return false, types.NewError(err, types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
		}
		if !info.IsPlayground && !info.TokenUnlimited {
			reserved := session.Request.InputReserved + session.Request.OutputReserved
			if reserved > model.MembershipMaxTokens {
				err = errors.New("shared token reservation exceeds key quota range")
			} else {
				err = PreConsumeTokenQuota(info, int(reserved))
			}
			if err != nil {
				if releaseErr := model.FinishMembership(session.Request.RequestId, 0, 0, "released", "key quota reservation failed"); releaseErr != nil {
					logger.LogError(c, releaseErr.Error())
				}
				c.Set("membership_session", nil)
				c.Set("membership_subscription_id", 0)
				c.Set("membership_shared_tokens", false)
				return false, types.NewErrorWithStatusCode(err, types.ErrorCodePreConsumeTokenQuotaFailed, http.StatusForbidden, types.ErrOptionWithSkipRetry())
			}
			session.TokenQuotaReserved = int(reserved)
		}
		return true, nil
	}
	return false, nil
}

// ObserveMembershipUsage captures explicit raw provider counters before any fallback or ratio conversion.
func ObserveMembershipUsage(c *gin.Context, body []byte) {
	value, ok := c.Get("membership_session")
	session, valid := value.(*MembershipSession)
	if !ok || !valid {
		return
	}
	var response struct {
		Usage *struct {
			Input  *int64 `json:"prompt_tokens"`
			Output *int64 `json:"completion_tokens"`
			Total  *int64 `json:"total_tokens"`
		} `json:"usage"`
	}
	if common.Unmarshal(body, &response) != nil {
		session.InvalidUsage = true
		return
	}
	if response.Usage == nil {
		return
	}
	session.UsageReceipt, _ = common.Marshal(response.Usage)
	u := response.Usage
	if u.Input == nil || u.Output == nil || u.Total == nil || *u.Input < 0 || *u.Output < 0 || *u.Input > model.MembershipMaxTokens || *u.Output > model.MembershipMaxTokens || *u.Total != *u.Input+*u.Output {
		session.InvalidUsage = true
		return
	}
	if session.HasUsage && (session.Input != *u.Input || session.Output != *u.Output) {
		session.InvalidUsage = true
		return
	}
	session.Input, session.Output, session.HasUsage = *u.Input, *u.Output, true
}

// FinishMembershipRequest records unknown outcomes without returning potentially consumed capacity.
// Called once by TextHelper's defer on success, network errors, local errors and stream termination.
func FinishMembershipRequest(c *gin.Context, info *relaycommon.RelayInfo, session *MembershipSession, succeeded bool) {
	if len(session.UsageReceipt) > 0 {
		if err := model.SaveMembershipUsageReceipt(session.Request.RequestId, session.UsageReceipt); err != nil {
			logger.LogError(c, "membership usage evidence could not be saved: "+err.Error())
			session.InvalidUsage = true
		}
	}
	outcome, reason := "pending", "upstream outcome unknown"
	input, output, quantity := int64(0), int64(0), int64(0)
	if !session.Dispatched {
		outcome, reason = "released", "request was not dispatched"
	} else if succeeded && c.Request.Context().Err() == nil && session.HasUsage && !session.InvalidUsage && ((session.TransportComplete && (info.StreamStatus == nil || !info.StreamStatus.HasErrors())) || !info.IsStream || (info.StreamStatus != nil && info.StreamStatus.EndReason == relaycommon.StreamEndReasonDone && !info.StreamStatus.HasErrors())) {
		outcome, reason = "settled", "raw provider usage receipt"
		input, output, quantity = session.Input, session.Output, session.Quantity
	}
	if outcome == "settled" && c.GetBool("membership_shared_tokens") {
		usage := session.WalletTextUsage
		if usage == nil || usage.PromptTokensDetails.ImageTokens != 0 || usage.PromptTokensDetails.AudioTokens != 0 || usage.CompletionTokenDetails.AudioTokens != 0 {
			outcome, reason, input, output = "pending", "missing or unsupported split usage", 0, 0
		} else if in, out, ok := calculateTextQuotaParts(c, info, usage); ok {
			input, output, reason = int64(in), int64(out), "wallet pricing split"
		} else {
			outcome, reason, input, output = "pending", "wallet pricing cannot be split", 0, 0
		}
	}
	var err error
	if session.Request.Unit != model.MembershipUnitTokens {
		err = model.FinishMembershipQuantity(session.Request.RequestId, quantity, outcome, reason)
	} else {
		err = model.FinishMembership(session.Request.RequestId, input, output, outcome, reason)
	}
	if err != nil {
		logger.LogError(c, "membership settlement requires reconciliation: "+err.Error())
		if pendingErr := model.FinishMembership(session.Request.RequestId, 0, 0, "pending", "settlement failed or exceeded reservation"); pendingErr != nil {
			logger.LogError(c, pendingErr.Error())
		}
		outcome, input, output, quantity = "pending", 0, 0, 0
	}
	if session.TokenQuotaReserved > 0 && (outcome == "settled" || outcome == "released") {
		if refund := session.TokenQuotaReserved - int(input+output); refund > 0 {
			if err := model.IncreaseTokenQuota(info.TokenId, info.TokenKey, refund); err != nil {
				logger.LogError(c, "membership key quota release failed: "+err.Error())
			}
		}
	}
	model.RecordConsumeLog(c, info.UserId, model.RecordConsumeLogParams{
		ChannelId: info.ChannelId, TokenId: info.TokenId, TokenName: c.GetString("token_name"), ModelName: info.OriginModelName,
		PromptTokens: int(input), CompletionTokens: int(output), IsStream: info.IsStream, Group: info.UsingGroup,
		Content: "channel membership " + outcome,
		Other:   map[string]interface{}{"billing_source": "channel_membership", "membership_status": outcome, "membership_request_id": session.Request.RequestId, "user_subscription_id": session.Request.UserSubscriptionId, "metering_unit": session.Request.Unit, "quantity_used": quantity},
	})
	logger.LogInfo(c, fmt.Sprintf("membership request=%s outcome=%s input=%d output=%d quantity=%d unit=%s", session.Request.RequestId, outcome, input, output, quantity, session.Request.Unit))
}
