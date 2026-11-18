package service

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

// MembershipSession owns one reservation and its provider usage receipt.
// It deliberately does not implement wallet billing or use normalized quota usage.
type MembershipSession struct {
	GeminiImage        bool
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
func PrepareMembershipText(c *gin.Context, info *relaycommon.RelayInfo, body []byte, maxOutputLimit uint) (*MembershipSession, error) {
	var req dto.GeneralOpenAIRequest
	if err := common.Unmarshal(body, &req); err != nil {
		return nil, err
	}
	if !model.MembershipTextModelSupported(req.Model) || req.Model != info.UpstreamModelName || len(req.Messages) == 0 || len(req.Tools) > 0 || len(req.Functions) > 0 || len(req.Audio) > 0 || len(req.Modalities) > 0 || len(req.ExtraBody) > 0 || req.WebSearchOptions != nil || req.Prompt != nil || req.Input != nil || req.ResponseFormat != nil || req.ToolChoice != nil || len(req.FunctionCall) > 0 || (req.N != nil && *req.N != 1) {
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
	session := &MembershipSession{Request: model.SubscriptionChannelRequest{
		RequestId: common.GetUUID(), UserId: info.UserId, TokenId: info.TokenId,
		UserSubscriptionId: c.GetInt("membership_subscription_id"), ChannelId: info.ChannelId,
		Model: info.OriginModelName, InputReserved: inputBound, OutputReserved: int64(*limit),
	}}
	if err := model.ReserveMembership(&session.Request); err != nil {
		return nil, err
	}
	c.Set("membership_session", session)
	logger.LogInfo(c, fmt.Sprintf("membership reserved request=%s subscription=%d channel=%d input_bound=%d output_limit=%d", session.Request.RequestId, session.Request.UserSubscriptionId, info.ChannelId, inputBound, *limit))
	return session, nil
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
	model.RecordConsumeLog(c, info.UserId, model.RecordConsumeLogParams{
		ChannelId: info.ChannelId, TokenId: info.TokenId, TokenName: c.GetString("token_name"), ModelName: info.OriginModelName,
		PromptTokens: int(input), CompletionTokens: int(output), IsStream: info.IsStream, Group: info.UsingGroup,
		Content: "channel membership " + outcome,
		Other:   map[string]interface{}{"billing_source": "channel_membership", "membership_status": outcome, "membership_request_id": session.Request.RequestId, "user_subscription_id": session.Request.UserSubscriptionId, "metering_unit": session.Request.Unit, "quantity_used": quantity},
	})
	logger.LogInfo(c, fmt.Sprintf("membership request=%s outcome=%s input=%d output=%d quantity=%d unit=%s", session.Request.RequestId, outcome, input, output, quantity, session.Request.Unit))
}
