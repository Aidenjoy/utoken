package service

import (
	"encoding/json"
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

// membershipClaudeTextBound only admits text without cache annotations or media.
func membershipClaudeTextBound(raw json.RawMessage) (int64, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return 0, nil
	}
	var text string
	if common.Unmarshal(raw, &text) == nil {
		return int64(len(text)), nil
	}
	var blocks []map[string]json.RawMessage
	if err := common.Unmarshal(raw, &blocks); err != nil {
		return 0, err
	}
	var bound int64
	for _, block := range blocks {
		for key := range block {
			if key != "type" && key != "text" {
				return 0, errors.New("membership Claude block is not plain uncached text")
			}
		}
		var kind, value string
		if common.Unmarshal(block["type"], &kind) != nil || kind != "text" || common.Unmarshal(block["text"], &value) != nil {
			return 0, errors.New("unsupported Claude content")
		}
		bound += int64(len(value)) + 64
	}
	return bound, nil
}

// PrepareMembershipClaude reserves the final native Messages body after system
// prompt and overrides. Raw cache input counters remain input, never output estimates.
func PrepareMembershipClaude(c *gin.Context, info *relaycommon.RelayInfo, body []byte, maxLimit uint) (*MembershipSession, error) {
	var fields map[string]json.RawMessage
	if err := common.Unmarshal(body, &fields); err != nil {
		return nil, err
	}
	for key := range fields {
		switch key {
		case "model", "messages", "system", "max_tokens", "stream", "temperature", "top_p", "top_k", "stop_sequences":
		default:
			return nil, errors.New("membership Claude supports plain text Messages only")
		}
	}
	var req struct {
		Model    string          `json:"model"`
		System   json.RawMessage `json:"system"`
		Messages []struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
		} `json:"messages"`
		MaxTokens *uint `json:"max_tokens"`
		Stream    *bool `json:"stream"`
	}
	if err := common.Unmarshal(body, &req); err != nil {
		return nil, err
	}
	if !model.MembershipClaudeModelSupported(req.Model) || req.Model != info.UpstreamModelName || req.MaxTokens == nil || *req.MaxTokens == 0 || *req.MaxTokens > maxLimit || len(req.Messages) == 0 || (req.Stream != nil && *req.Stream) != info.IsStream {
		return nil, errors.New("invalid bounded Claude membership request")
	}
	bound, err := membershipClaudeTextBound(req.System)
	if err != nil {
		return nil, err
	}
	bound += 3
	for _, message := range req.Messages {
		if message.Role != "user" && message.Role != "assistant" {
			return nil, errors.New("invalid Claude role")
		}
		value, err := membershipClaudeTextBound(message.Content)
		if err != nil {
			return nil, err
		}
		bound += value + 64
		if bound > model.MembershipMaxTokens {
			return nil, errors.New("Claude input too large")
		}
	}
	session := &MembershipSession{Request: model.SubscriptionChannelRequest{RequestId: common.GetUUID(), UserId: info.UserId, TokenId: info.TokenId, UserSubscriptionId: c.GetInt("membership_subscription_id"), ChannelId: info.ChannelId, Model: info.OriginModelName, InputReserved: bound, OutputReserved: int64(*req.MaxTokens)}}
	if err := model.ReserveMembership(&session.Request); err != nil {
		return nil, err
	}
	c.Set("membership_session", session)
	return session, nil
}

// ObserveMembershipClaude reads provider fields before legacy cache normalization.
// Stream output is cumulative, not a sum of deltas; message_stop is required.
func ObserveMembershipClaude(c *gin.Context, body []byte) {
	value, ok := c.Get("membership_session")
	session, valid := value.(*MembershipSession)
	if !ok || !valid {
		return
	}
	type rawUsage struct {
		Input       *int64 `json:"input_tokens"`
		Output      *int64 `json:"output_tokens"`
		CacheRead   *int64 `json:"cache_read_input_tokens"`
		CacheCreate *int64 `json:"cache_creation_input_tokens"`
	}
	var event struct {
		Type    string    `json:"type"`
		Usage   *rawUsage `json:"usage"`
		Message *struct {
			Usage *rawUsage `json:"usage"`
		} `json:"message"`
	}
	if common.Unmarshal(body, &event) != nil {
		session.InvalidUsage = true
		return
	}
	if event.Type == "error" {
		session.InvalidUsage = true
		return
	}
	if event.Type == "message_stop" {
		session.TransportComplete = true
		session.HasUsage = session.ClaudeInputSeen && session.ClaudeOutputSeen
		return
	}
	usage := event.Usage
	if event.Type == "message_start" && event.Message != nil {
		usage = event.Message.Usage
	}
	if usage == nil {
		return
	}
	if usage.Input != nil {
		input := *usage.Input
		if input < 0 || input > model.MembershipMaxTokens {
			session.InvalidUsage = true
			return
		}
		for _, cache := range []*int64{usage.CacheRead, usage.CacheCreate} {
			if cache != nil {
				if *cache < 0 || *cache > model.MembershipMaxTokens {
					session.InvalidUsage = true
					return
				}
				input += *cache
			}
		}
		if input > model.MembershipMaxTokens || (session.ClaudeInputSeen && session.Input != input) {
			session.InvalidUsage = true
			return
		}
		session.Input = input
		session.ClaudeInputSeen = true
		session.ClaudeInputReceipt, _ = common.Marshal(usage)
	}
	if usage.Output != nil {
		if *usage.Output < 0 || *usage.Output > model.MembershipMaxTokens || *usage.Output < session.Output {
			session.InvalidUsage = true
			return
		}
		session.Output = *usage.Output
		if event.Type != "message_start" {
			session.ClaudeOutputSeen = true
		}
	}
	session.HasUsage = session.ClaudeInputSeen && session.ClaudeOutputSeen
	session.UsageReceipt, _ = common.Marshal(struct {
		Input   int64           `json:"input_tokens_including_raw_cache"`
		Output  int64           `json:"output_tokens"`
		Raw     *rawUsage       `json:"latest_raw_usage"`
		Initial json.RawMessage `json:"initial_raw_usage"`
	}{session.Input, session.Output, usage, json.RawMessage(session.ClaudeInputReceipt)})
}
