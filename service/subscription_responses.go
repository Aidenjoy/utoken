package service

import (
	"encoding/json"
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

// PrepareMembershipResponses shares the existing channel text grant across chat
// and Responses. Only self-contained string input is admitted in this contract.
func PrepareMembershipResponses(c *gin.Context, info *relaycommon.RelayInfo, body []byte, maxLimit uint) (*MembershipSession, error) {
	var fields map[string]json.RawMessage
	if err := common.Unmarshal(body, &fields); err != nil {
		return nil, err
	}
	for key := range fields {
		switch key {
		case "model", "input", "instructions", "max_output_tokens", "stream", "store", "temperature", "top_p":
		default:
			return nil, errors.New("membership Responses requires self-contained plain text without tools")
		}
	}
	var req struct {
		Model        string `json:"model"`
		Input        string `json:"input"`
		Instructions string `json:"instructions"`
		Max          *uint  `json:"max_output_tokens"`
		Stream       *bool  `json:"stream"`
		Store        *bool  `json:"store"`
	}
	if err := common.Unmarshal(body, &req); err != nil {
		return nil, err
	}
	if !model.MembershipTextModelSupported(req.Model) || req.Model != info.UpstreamModelName || req.Input == "" || req.Max == nil || *req.Max == 0 || *req.Max > maxLimit || (req.Stream != nil && *req.Stream) != info.IsStream || (req.Store != nil && *req.Store) {
		return nil, errors.New("invalid bounded membership Responses request")
	}
	bound := int64(len(req.Input)) + int64(len(req.Instructions)) + 256
	if bound > model.MembershipMaxTokens {
		return nil, errors.New("Responses input too large")
	}
	session := &MembershipSession{Request: model.SubscriptionChannelRequest{RequestId: common.GetUUID(), UserId: info.UserId, TokenId: info.TokenId, UserSubscriptionId: c.GetInt("membership_subscription_id"), ChannelId: info.ChannelId, Model: info.OriginModelName, InputReserved: bound, OutputReserved: int64(*req.Max)}}
	if err := model.ReserveMembership(&session.Request); err != nil {
		return nil, err
	}
	c.Set("membership_session", session)
	c.Set("membership_responses_stream", info.IsStream)
	return session, nil
}

// ObserveMembershipResponses requires completed native Responses usage, including
// explicit total consistency. Reasoning output stays output; no cache price ratios apply.
func ObserveMembershipResponses(c *gin.Context, body []byte) {
	value, ok := c.Get("membership_session")
	session, valid := value.(*MembershipSession)
	if !ok || !valid {
		return
	}
	type rawUsage struct {
		Input  *int64 `json:"input_tokens"`
		Output *int64 `json:"output_tokens"`
		Total  *int64 `json:"total_tokens"`
	}
	type response struct {
		ID     string    `json:"id"`
		Status string    `json:"status"`
		Usage  *rawUsage `json:"usage"`
	}
	var event struct {
		Type string `json:"type"`
		response
		Response *response `json:"response"`
	}
	if common.Unmarshal(body, &event) != nil {
		session.InvalidUsage = true
		return
	}
	if event.Type == "error" || event.Type == "response.failed" || event.Type == "response.incomplete" {
		session.InvalidUsage = true
		return
	}
	if c.GetBool("membership_responses_stream") && event.Type != "response.completed" {
		return
	}
	receipt := &event.response
	if event.Type != "" {
		if event.Type != "response.completed" {
			return
		}
		receipt = event.Response
	}
	if receipt == nil || receipt.ID == "" || receipt.Status != "completed" || receipt.Usage == nil {
		return
	}
	u := receipt.Usage
	if u.Input == nil || u.Output == nil || u.Total == nil || *u.Input < 0 || *u.Output < 0 || *u.Input > model.MembershipMaxTokens || *u.Output > model.MembershipMaxTokens || *u.Total != *u.Input+*u.Output {
		session.InvalidUsage = true
		return
	}
	if session.HasUsage && (session.Input != *u.Input || session.Output != *u.Output) {
		session.InvalidUsage = true
		return
	}
	session.Input = *u.Input
	session.Output = *u.Output
	session.HasUsage = true
	session.TransportComplete = true
	session.UsageReceipt, _ = common.Marshal(receipt)
}
