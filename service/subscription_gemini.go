package service

import (
	"encoding/json"
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

// membershipGeminiContent bounds text-only parts without files, tools or thought signatures.
type membershipGeminiContent struct {
	Role  string                       `json:"role"`
	Parts []map[string]json.RawMessage `json:"parts"`
}

func membershipGeminiTextBound(content membershipGeminiContent) (int64, error) {
	bound := int64(64)
	for _, part := range content.Parts {
		if len(part) != 1 {
			return 0, errors.New("membership Gemini requires text-only parts")
		}
		var text string
		if common.Unmarshal(part["text"], &text) != nil {
			return 0, errors.New("unsupported Gemini part")
		}
		bound += int64(len(text)) + 64
	}
	return bound, nil
}

// PrepareMembershipGemini admits a single text candidate with an explicit cap
// and disabled thinking, after mapping/system instructions/overrides are final.
func PrepareMembershipGemini(c *gin.Context, info *relaycommon.RelayInfo, body []byte, maxLimit uint) (*MembershipSession, error) {
	image := model.MembershipGeminiImageModelSupported(info.UpstreamModelName)
	var fields map[string]json.RawMessage
	if err := common.Unmarshal(body, &fields); err != nil {
		return nil, err
	}
	for key := range fields {
		switch key {
		case "contents", "systemInstruction", "generationConfig", "safetySettings":
		default:
			return nil, errors.New("membership Gemini does not support cached context, tools or media")
		}
	}
	var req struct {
		Contents []membershipGeminiContent `json:"contents"`
		System   *membershipGeminiContent  `json:"systemInstruction"`
		Config   struct {
			Modalities []string `json:"responseModalities"`
			Max        *uint    `json:"maxOutputTokens"`
			Count      *int     `json:"candidateCount"`
			Thinking   *struct {
				Budget  *int   `json:"thinkingBudget"`
				Level   string `json:"thinkingLevel"`
				Include bool   `json:"includeThoughts"`
			} `json:"thinkingConfig"`
		} `json:"generationConfig"`
	}
	if err := common.Unmarshal(body, &req); err != nil {
		return nil, err
	}
	var configFields map[string]json.RawMessage
	if common.Unmarshal(fields["generationConfig"], &configFields) != nil {
		return nil, errors.New("explicit Gemini generationConfig required")
	}
	for key := range configFields {
		switch key {
		case "maxOutputTokens", "candidateCount", "thinkingConfig", "temperature", "topP", "topK", "stopSequences":
		case "responseModalities", "imageConfig":
			if !image {
				return nil, errors.New("image output requires an image membership")
			}
		default:
			return nil, errors.New("unsupported Gemini generation option")
		}
	}
	cfg := req.Config
	if (!image && info.UpstreamModelName != "gemini-3.8-flash") || len(req.Contents) == 0 || cfg.Max == nil || *cfg.Max == 0 || *cfg.Max > maxLimit || (cfg.Count != nil && *cfg.Count != 1) || (!image && (cfg.Thinking == nil || cfg.Thinking.Budget == nil || *cfg.Thinking.Budget != 0 || cfg.Thinking.Include || cfg.Thinking.Level != "")) {
		return nil, errors.New("membership Gemini requires one bounded non-thinking text candidate")
	}
	if image {
		hasImage := false
		for _, modality := range cfg.Modalities {
			if modality != "IMAGE" && modality != "TEXT" {
				return nil, errors.New("unsupported image response modality")
			}
			hasImage = hasImage || modality == "IMAGE"
		}
		if !hasImage {
			return nil, errors.New("image membership requires explicit IMAGE output")
		}
	}
	bound := int64(3)
	if req.System != nil {
		value, err := membershipGeminiTextBound(*req.System)
		if err != nil {
			return nil, err
		}
		bound += value
	}
	for _, content := range req.Contents {
		if content.Role != "user" && content.Role != "model" {
			return nil, errors.New("unsupported Gemini role")
		}
		value, err := membershipGeminiTextBound(content)
		if err != nil {
			return nil, err
		}
		bound += value
		if bound > model.MembershipMaxTokens {
			return nil, errors.New("Gemini input too large")
		}
	}
	session := &MembershipSession{GeminiImage: image, Request: model.SubscriptionChannelRequest{RequestId: common.GetUUID(), UserId: info.UserId, TokenId: info.TokenId, UserSubscriptionId: c.GetInt("membership_subscription_id"), ChannelId: info.ChannelId, Model: info.OriginModelName, InputReserved: bound, OutputReserved: int64(*cfg.Max)}}
	if err := model.ReserveMembership(&session.Request); err != nil {
		return nil, err
	}
	c.Set("membership_session", session)
	return session, nil
}

// ObserveMembershipGemini only settles a terminal candidate with explicit raw
// prompt/candidate/total counters. Cached input is a subset, never added twice.
func ObserveMembershipGemini(c *gin.Context, body []byte) {
	value, ok := c.Get("membership_session")
	session, valid := value.(*MembershipSession)
	if !ok || !valid {
		return
	}
	var response struct {
		Candidates []struct {
			Finish string `json:"finishReason"`
		} `json:"candidates"`
		Usage *struct {
			Input    *int64 `json:"promptTokenCount"`
			Output   *int64 `json:"candidatesTokenCount"`
			Total    *int64 `json:"totalTokenCount"`
			Thoughts *int64 `json:"thoughtsTokenCount"`
			Tool     *int64 `json:"toolUsePromptTokenCount"`
			Cached   *int64 `json:"cachedContentTokenCount"`
		} `json:"usageMetadata"`
	}
	if common.Unmarshal(body, &response) != nil {
		session.InvalidUsage = true
		return
	}
	if len(response.Candidates) != 1 || response.Usage == nil {
		return
	}
	if response.Candidates[0].Finish != "STOP" && response.Candidates[0].Finish != "MAX_TOKENS" {
		return
	}
	u := response.Usage
	var thoughts int64
	if u.Thoughts != nil {
		thoughts = *u.Thoughts
	}
	if u.Input == nil || u.Output == nil || u.Total == nil || *u.Input < 0 || *u.Output < 0 || *u.Input > model.MembershipMaxTokens || *u.Output > model.MembershipMaxTokens || *u.Total != *u.Input+*u.Output+thoughts || thoughts < 0 || thoughts > model.MembershipMaxTokens || (!session.GeminiImage && thoughts != 0) || (u.Tool != nil && *u.Tool != 0) || (u.Cached != nil && (*u.Cached < 0 || *u.Cached > *u.Input)) {
		session.InvalidUsage = true
		return
	}
	if session.HasUsage && (session.Input != *u.Input || session.Output != *u.Output+thoughts) {
		session.InvalidUsage = true
		return
	}
	session.Input = *u.Input
	// Thinking is a provider-reported output category, never total-minus-input.
	session.Output = *u.Output + thoughts
	session.HasUsage = true
	session.TransportComplete = true
	session.UsageReceipt, _ = common.Marshal(u)
}
