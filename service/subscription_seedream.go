package service

import (
	"encoding/json"
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

// seedreamAllowedPayloadKeys is the bounded single-image text-to-image contract. Any other
// final upstream key (sequential_image_generation, layer_decomposition, tools, image, stream,
// max_tokens, ...) is rejected before dispatch so the model can never return more than one
// billable image. Ark has no output-token cap parameter; the count bound is enforced here.
var seedreamAllowedPayloadKeys = map[string]struct{}{
	"model": {}, "prompt": {}, "n": {}, "size": {}, "response_format": {}, "watermark": {},
}

// PrepareMembershipSeedream validates the final Ark image payload (after model mapping and
// parameter override) and reserves exactly one image. Official Ark Seedream billing is per
// successfully generated image, so the reservation unit is image count, never synthetic tokens.
func PrepareMembershipSeedream(c *gin.Context, info *relaycommon.RelayInfo, body []byte) (*MembershipSession, error) {
	var payload map[string]json.RawMessage
	if err := common.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	for key := range payload {
		if _, ok := seedreamAllowedPayloadKeys[key]; !ok {
			return nil, errors.New("membership Seedream contract supports single-image text-to-image only")
		}
	}
	var modelName string
	if err := common.Unmarshal(payload["model"], &modelName); err != nil || !model.MembershipSeedreamImageModelSupported(modelName) || modelName != info.UpstreamModelName {
		return nil, errors.New("membership Seedream model is not supported")
	}
	var prompt string
	if err := common.Unmarshal(payload["prompt"], &prompt); err != nil || prompt == "" {
		return nil, errors.New("membership Seedream requires a text prompt")
	}
	var n uint
	if raw, ok := payload["n"]; !ok || common.Unmarshal(raw, &n) != nil || n != 1 {
		return nil, errors.New("membership Seedream requires exactly one image (n=1)")
	}
	session := &MembershipSession{SeedreamImage: true, Request: model.SubscriptionChannelRequest{
		RequestId: common.GetUUID(), UserId: info.UserId, TokenId: info.TokenId,
		UserSubscriptionId: c.GetInt("membership_subscription_id"), ChannelId: info.ChannelId,
		Model: info.OriginModelName, QuantityReserved: 1,
	}}
	if err := model.ReserveMembership(&session.Request); err != nil {
		return nil, err
	}
	c.Set("membership_session", session)
	return session, nil
}

// ObserveMembershipSeedream settles only from the raw usage.generated_images receipt, the
// official Ark per-image billing basis. output_tokens/total_tokens are preserved as evidence
// (they are a pixel-derived reference, not the billing unit); no input_tokens field exists.
// Missing or inconsistent usage stays pending and never falls back to a placeholder count.
func ObserveMembershipSeedream(c *gin.Context, body []byte) {
	value, ok := c.Get("membership_session")
	session, valid := value.(*MembershipSession)
	if !ok || !valid || !session.SeedreamImage || session.Request.Unit != model.MembershipUnitImages {
		return
	}
	var response struct {
		Data []struct {
			Url     string `json:"url"`
			B64Json string `json:"b64_json"`
		} `json:"data"`
		Usage *struct {
			GeneratedImages *int64 `json:"generated_images"`
			OutputTokens    *int64 `json:"output_tokens"`
			TotalTokens     *int64 `json:"total_tokens"`
			InputImages     *int64 `json:"input_images"`
			ToolUsage       *struct {
				WebSearch *int64 `json:"web_search"`
			} `json:"tool_usage"`
		} `json:"usage"`
	}
	if common.Unmarshal(body, &response) != nil || response.Usage == nil || response.Usage.GeneratedImages == nil || response.Usage.OutputTokens == nil || response.Usage.TotalTokens == nil {
		session.InvalidUsage = true
		return
	}
	u := response.Usage
	generated := *u.GeneratedImages
	if generated < 0 || generated > session.Request.QuantityReserved || *u.OutputTokens < 0 || *u.OutputTokens > model.MembershipMaxTokens || *u.TotalTokens != *u.OutputTokens {
		session.InvalidUsage = true
		return
	}
	if (generated == 0) != (*u.OutputTokens == 0) || int64(len(response.Data)) != generated {
		session.InvalidUsage = true
		return
	}
	if u.InputImages != nil && *u.InputImages != 0 {
		session.InvalidUsage = true
		return
	}
	if u.ToolUsage != nil && u.ToolUsage.WebSearch != nil && *u.ToolUsage.WebSearch != 0 {
		session.InvalidUsage = true
		return
	}
	for _, image := range response.Data {
		if image.Url == "" && image.B64Json == "" {
			session.InvalidUsage = true
			return
		}
	}
	session.Quantity = generated
	session.HasUsage = true
	session.UsageReceipt, _ = common.Marshal(u)
}
