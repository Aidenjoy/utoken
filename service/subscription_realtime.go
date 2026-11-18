package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// MembershipRealtimeBudget owns one bounded session, serially updated by its relay loop.
// Input counts are conservative admission bounds; settlement uses only provider counters.
type MembershipRealtimeBudget struct {
	Session       *MembershipSession
	ContextTokens int64
	FreshInput    int64
	TurnInput     int64
	TurnOutput    int64
	InFlight      bool
	AudioPending  bool
	Seen          map[string]membershipRealtimeReceipt
	Receipts      []membershipRealtimeReceipt
}

type membershipRealtimeReceipt struct {
	ID     string `json:"response_id"`
	Input  int64  `json:"input_tokens"`
	Output int64  `json:"output_tokens"`
	Total  int64  `json:"total_tokens"`
}

type membershipRealtimeEvent struct {
	Type  string `json:"type"`
	Audio string `json:"audio,omitempty"`
	Item  *struct {
		Type    string `json:"type"`
		Role    string `json:"role"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	} `json:"item,omitempty"`
	Response *struct {
		ID              string `json:"id,omitempty"`
		Status          string `json:"status,omitempty"`
		MaxOutputTokens *int64 `json:"max_output_tokens,omitempty"`
		Usage           *struct {
			Input  *int64 `json:"input_tokens"`
			Output *int64 `json:"output_tokens"`
			Total  *int64 `json:"total_tokens"`
		} `json:"usage,omitempty"`
	} `json:"response,omitempty"`
}

// PrepareMembershipRealtime holds a limited slice of the shared input/output grant
// before opening upstream. No session can spend another key's already reserved budget.
func PrepareMembershipRealtime(c *gin.Context, info *relaycommon.RelayInfo) (*MembershipRealtimeBudget, error) {
	if info.ChannelType != constant.ChannelTypeOpenAI || info.UpstreamModelName != "gpt-4o-realtime-preview" {
		return nil, errors.New("membership realtime adapter unsupported")
	}
	grant, err := model.GetMembershipGrant(model.DB, info.UserId, c.GetInt("membership_subscription_id"), info.ChannelId)
	if err != nil {
		return nil, err
	}
	input := min(grant.InputLimit-grant.InputUsed-grant.InputReserved, int64(2*1024*1024))
	output := min(grant.OutputLimit-grant.OutputUsed-grant.OutputReserved, int64(4096))
	if input <= 4096 || output <= 0 {
		return nil, model.ErrMembershipQuota
	}
	session := &MembershipSession{Request: model.SubscriptionChannelRequest{RequestId: common.GetUUID(), UserId: info.UserId, TokenId: info.TokenId, UserSubscriptionId: c.GetInt("membership_subscription_id"), ChannelId: info.ChannelId, Model: info.OriginModelName, InputReserved: input, OutputReserved: output}}
	if err := model.ReserveMembership(&session.Request); err != nil {
		return nil, err
	}
	c.Set("membership_session", session)
	return &MembershipRealtimeBudget{Session: session, Seen: make(map[string]membershipRealtimeReceipt)}, nil
}

// ForwardClient validates and reconstructs allowed events; client tools, session
// changes, auto-generation and concurrent responses cannot bypass the budget.
func (budget *MembershipRealtimeBudget) ForwardClient(body []byte) ([]byte, error) {
	var event membershipRealtimeEvent
	if err := common.Unmarshal(body, &event); err != nil {
		return nil, err
	}
	if budget.InFlight {
		return nil, errors.New("membership realtime allows one response at a time")
	}
	remainingInput := budget.Session.Request.InputReserved - budget.Session.Input
	switch event.Type {
	case "input_audio_buffer.append":
		pcm, err := base64.StdEncoding.DecodeString(event.Audio)
		if err != nil || len(pcm) == 0 || len(pcm)%2 != 0 {
			return nil, errors.New("membership realtime requires PCM16 audio")
		}
		bound := int64(len(pcm)) + 64
		if budget.ContextTokens+budget.FreshInput+bound+4096 > remainingInput {
			return nil, model.ErrMembershipQuota
		}
		budget.FreshInput += bound
		budget.AudioPending = true
		event.Item = nil
		event.Response = nil
	case "input_audio_buffer.commit":
		if !budget.AudioPending {
			return nil, errors.New("audio buffer is empty")
		}
		budget.AudioPending = false
		event.Audio = ""
		event.Item = nil
		event.Response = nil
	case "conversation.item.create":
		if event.Item == nil || event.Item.Type != "message" || event.Item.Role != "user" || len(event.Item.Content) == 0 {
			return nil, errors.New("membership realtime accepts user input text only")
		}
		bound := int64(64)
		for _, content := range event.Item.Content {
			if content.Type != "input_text" {
				return nil, errors.New("unsupported realtime content")
			}
			bound += int64(len(content.Text)) + 64
		}
		if budget.ContextTokens+budget.FreshInput+bound+4096 > remainingInput {
			return nil, model.ErrMembershipQuota
		}
		budget.FreshInput += bound
		event.Audio = ""
		event.Response = nil
	case "response.create":
		if _, err := model.GetMembershipGrant(model.DB, budget.Session.Request.UserId, budget.Session.Request.UserSubscriptionId, budget.Session.Request.ChannelId); err != nil {
			return nil, err
		}
		if budget.AudioPending || budget.FreshInput == 0 {
			return nil, errors.New("commit input before creating a response")
		}
		budget.TurnInput = budget.ContextTokens + budget.FreshInput + 4096
		budget.TurnOutput = min(int64(256), budget.Session.Request.OutputReserved-budget.Session.Output)
		if budget.TurnInput > remainingInput || budget.TurnOutput <= 0 {
			return nil, model.ErrMembershipQuota
		}
		// Construct a response without client instructions, tools or output-limit overrides.
		event = membershipRealtimeEvent{Type: "response.create"}
		event.Response = &struct {
			ID              string `json:"id,omitempty"`
			Status          string `json:"status,omitempty"`
			MaxOutputTokens *int64 `json:"max_output_tokens,omitempty"`
			Usage           *struct {
				Input  *int64 `json:"input_tokens"`
				Output *int64 `json:"output_tokens"`
				Total  *int64 `json:"total_tokens"`
			} `json:"usage,omitempty"`
		}{MaxOutputTokens: &budget.TurnOutput}
		budget.InFlight = true
	default:
		return nil, errors.New("membership realtime client event unsupported")
	}
	// Unknown fields were deliberately discarded by the typed event decoder.
	return common.Marshal(event)
}

// ObserveProvider accepts each raw response.done once and rejects inconsistent or
// over-bound usage. No fallback estimates are billable, including after a disconnect.
func (budget *MembershipRealtimeBudget) ObserveProvider(body []byte) error {
	var event membershipRealtimeEvent
	if err := common.Unmarshal(body, &event); err != nil {
		return err
	}
	if event.Type == "error" {
		return errors.New("provider realtime error")
	}
	if event.Type == "session.updated" {
		return errors.New("unexpected provider session mutation")
	}
	if event.Type == "response.created" && !budget.InFlight {
		return errors.New("unexpected automatic response")
	}
	if event.Type != "response.done" {
		return nil
	}
	r := event.Response
	if r == nil || r.ID == "" || r.Status != "completed" || r.Usage == nil || r.Usage.Input == nil || r.Usage.Output == nil || r.Usage.Total == nil {
		return errors.New("realtime response has no complete raw usage")
	}
	receipt := membershipRealtimeReceipt{ID: r.ID, Input: *r.Usage.Input, Output: *r.Usage.Output, Total: *r.Usage.Total}
	if previous, ok := budget.Seen[r.ID]; ok {
		if previous != receipt {
			return errors.New("conflicting realtime receipt")
		}
		return nil
	}
	if !budget.InFlight || receipt.Input < 0 || receipt.Output < 0 || receipt.Input > budget.TurnInput || receipt.Output > budget.TurnOutput || receipt.Total != receipt.Input+receipt.Output {
		return errors.New("realtime usage exceeds admitted response")
	}
	budget.Session.Input += receipt.Input
	budget.Session.Output += receipt.Output
	budget.ContextTokens = receipt.Total
	budget.FreshInput = 0
	budget.InFlight = false
	budget.Seen[r.ID] = receipt
	budget.Receipts = append(budget.Receipts, receipt)
	budget.Session.UsageReceipt, _ = common.Marshal(budget.Receipts)
	budget.Session.HasUsage = true
	return nil
}

// RunMembershipRealtime isolates the member protocol from legacy websocket wallet
// accounting. It disables VAD/transcription/tools before admitting client data.
func RunMembershipRealtime(c *gin.Context, info *relaycommon.RelayInfo, budget *MembershipRealtimeBudget) (resultErr error) {

	target, client := info.TargetWs, info.ClientWs
	target.SetReadLimit(MembershipMaxShortAudioBytes)
	client.SetReadLimit(MembershipMaxShortAudioBytes)
	deadline := time.Now().Add(10 * time.Second)
	_ = target.SetReadDeadline(deadline)
	_ = target.SetWriteDeadline(deadline)
	cap := min(int64(256), budget.Session.Request.OutputReserved)
	configuration := struct {
		Type    string `json:"type"`
		Session struct {
			Instructions  string      `json:"instructions"`
			TurnDetection interface{} `json:"turn_detection"`
			Transcription interface{} `json:"input_audio_transcription"`
			Tools         []string    `json:"tools"`
			InputFormat   string      `json:"input_audio_format"`
			OutputFormat  string      `json:"output_audio_format"`
			MaxOutput     int64       `json:"max_response_output_tokens"`
		} `json:"session"`
	}{Type: "session.update"}
	configuration.Session.Tools = []string{}
	configuration.Session.InputFormat = "pcm16"
	configuration.Session.OutputFormat = "pcm16"
	configuration.Session.MaxOutput = cap
	body, err := common.Marshal(configuration)
	if err != nil {
		return err
	}
	if err = target.WriteMessage(websocket.TextMessage, body); err != nil {
		return err
	}
	// Require the provider to acknowledge every control that prevents unreserved work.
	for {
		_, body, err = target.ReadMessage()
		if err != nil {
			return err
		}
		var ack struct {
			Type    string `json:"type"`
			Session *struct {
				Instructions  *string           `json:"instructions"`
				Turn          json.RawMessage   `json:"turn_detection"`
				Transcription json.RawMessage   `json:"input_audio_transcription"`
				Tools         []json.RawMessage `json:"tools"`
				Input         string            `json:"input_audio_format"`
				Output        string            `json:"output_audio_format"`
				Max           *int64            `json:"max_response_output_tokens"`
			} `json:"session"`
		}
		if common.Unmarshal(body, &ack) != nil {
			return errors.New("invalid realtime configuration receipt")
		}
		if ack.Type == "session.created" {
			continue
		}
		if ack.Type != "session.updated" || ack.Session == nil {
			return errors.New("realtime configuration was not acknowledged")
		}
		s := ack.Session
		if s.Instructions == nil || *s.Instructions != "" || string(s.Turn) != "null" || string(s.Transcription) != "null" || s.Tools == nil || len(s.Tools) != 0 || s.Input != "pcm16" || s.Output != "pcm16" || s.Max == nil || *s.Max != cap {
			return errors.New("provider did not enforce membership realtime bounds")
		}
		break
	}
	_ = target.SetReadDeadline(time.Time{})
	_ = target.SetWriteDeadline(time.Time{})
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Minute)
	defer cancel()
	type frame struct {
		body   []byte
		err    error
		client bool
	}
	frames := make(chan frame, 2)
	for _, fromClient := range []bool{true, false} {
		go func(fromClient bool) {
			connection := target
			if fromClient {
				connection = client
			}
			for {
				_, data, err := connection.ReadMessage()
				select {
				case frames <- frame{data, err, fromClient}:
				case <-ctx.Done():
					return
				}
				if err != nil {
					return
				}
			}
		}(fromClient)
	}
	defer target.Close()
	defer client.Close()
	defer func() {
		if resultErr != nil {
			message, _ := common.Marshal(struct {
				Type  string `json:"type"`
				Error struct {
					Message string `json:"message"`
				} `json:"error"`
			}{Type: "error", Error: struct {
				Message string `json:"message"`
			}{Message: resultErr.Error()}})
			_ = info.ClientWs.SetWriteDeadline(time.Now().Add(time.Second))
			_ = info.ClientWs.WriteMessage(websocket.TextMessage, message)
		}
	}()
	for {
		select {
		case <-ctx.Done():
			if !budget.InFlight && budget.FreshInput == 0 {
				budget.Session.HasUsage = true
				budget.Session.TransportComplete = true
				return nil
			}
			return ctx.Err()
		case event := <-frames:
			if event.err != nil {
				if budget.InFlight || budget.FreshInput != 0 {
					return fmt.Errorf("realtime disconnected with unverified work: %w", event.err)
				}
				budget.Session.HasUsage = true
				budget.Session.TransportComplete = true
				return nil
			}
			if event.client {
				data, err := budget.ForwardClient(event.body)
				if err != nil {
					return err
				}
				_ = target.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := target.WriteMessage(websocket.TextMessage, data); err != nil {
					return err
				}
			} else {
				if err := budget.ObserveProvider(event.body); err != nil {
					return err
				}
				_ = client.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if err := client.WriteMessage(websocket.TextMessage, event.body); err != nil {
					return err
				}
				if !budget.InFlight && (budget.Session.Output >= budget.Session.Request.OutputReserved || budget.Session.Input+budget.ContextTokens+4096 >= budget.Session.Request.InputReserved) {
					budget.Session.TransportComplete = true
					return nil
				}
			}
		}
	}
}
