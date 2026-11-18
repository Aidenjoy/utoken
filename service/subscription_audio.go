package service

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"math"
	"mime"
	"mime/multipart"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

const MembershipMaxShortAudioBytes = 6 * 1024 * 1024

// PrepareMembershipAudio reserves the final outbound audio contract. Short Whisper
// requests use validated PCM WAV duration; legacy TTS uses Unicode input characters.
// Neither path invents input/output token counters from prices or audio headers.
func PrepareMembershipAudio(c *gin.Context, info *relaycommon.RelayInfo, body []byte) (*MembershipSession, error) {
	if info.ChannelType != constant.ChannelTypeOpenAI || info.IsStream || len(body) > MembershipMaxShortAudioBytes {
		return nil, errors.New("membership audio contract unsupported")
	}
	var quantity int64
	switch c.Request.URL.Path {
	case "/v1/audio/speech":
		var request struct {
			Model  string   `json:"model"`
			Input  string   `json:"input"`
			Voice  string   `json:"voice"`
			Format string   `json:"response_format"`
			Speed  *float64 `json:"speed"`
		}
		if err := common.Unmarshal(body, &request); err != nil {
			return nil, err
		}
		var fields map[string]interface{}
		if err := common.Unmarshal(body, &fields); err != nil {
			return nil, err
		}
		for key := range fields {
			switch key {
			case "model", "input", "voice", "response_format", "speed":
			default:
				return nil, errors.New("membership TTS requires a bounded plain text request")
			}
		}
		if (request.Model != "tts-1" && request.Model != "tts-1-hd") || request.Model != info.UpstreamModelName || request.Format != "pcm" || !utf8.ValidString(request.Input) {
			return nil, errors.New("membership TTS requires tts-1/tts-1-hd and PCM output")
		}
		switch request.Voice {
		case "alloy", "echo", "fable", "onyx", "nova", "shimmer":
		default:
			return nil, errors.New("unsupported TTS voice")
		}
		if request.Speed != nil && (math.IsNaN(*request.Speed) || math.IsInf(*request.Speed, 0) || *request.Speed < 0.25 || *request.Speed > 4) {
			return nil, errors.New("invalid TTS speed")
		}
		quantity = int64(utf8.RuneCountInString(request.Input))
		if quantity < 1 || quantity > 1024 {
			return nil, errors.New("short membership TTS input must contain 1 to 1024 characters")
		}
	case "/v1/audio/transcriptions":
		contentType, params, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
		if err != nil || contentType != "multipart/form-data" {
			return nil, errors.New("membership transcription requires multipart WAV")
		}
		reader := multipart.NewReader(bytes.NewReader(body), params["boundary"])
		fields := make(map[string][]byte)
		for {
			part, err := reader.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				return nil, err
			}
			name := part.FormName()
			if _, exists := fields[name]; exists {
				return nil, errors.New("duplicate transcription field")
			}
			switch name {
			case "model", "response_format", "file":
			default:
				return nil, errors.New("unsupported transcription field")
			}
			data, err := io.ReadAll(part)
			if err != nil {
				return nil, err
			}
			fields[name] = data
		}
		if string(fields["model"]) != "whisper-1" || info.UpstreamModelName != "whisper-1" || string(fields["response_format"]) != "verbose_json" {
			return nil, errors.New("membership transcription requires whisper-1 verbose_json")
		}
		quantity, err = membershipPCMReservation(fields["file"])
		if err != nil {
			return nil, err
		}
	default:
		return nil, errors.New("membership audio endpoint unsupported")
	}
	session := &MembershipSession{Request: model.SubscriptionChannelRequest{RequestId: common.GetUUID(), UserId: info.UserId, TokenId: info.TokenId, UserSubscriptionId: c.GetInt("membership_subscription_id"), ChannelId: info.ChannelId, Model: info.OriginModelName, QuantityReserved: quantity}}
	if err := model.ReserveMembership(&session.Request); err != nil {
		return nil, err
	}
	c.Set("membership_session", session)
	return session, nil
}

// membershipPCMReservation accepts canonical mono 16-bit PCM WAV only, checking
// actual sample bytes against every header field. This bound is not provider usage.
func membershipPCMReservation(wav []byte) (int64, error) {
	invalid := errors.New("short transcription requires canonical mono 16-bit PCM WAV, at most 60 seconds")
	if len(wav) < 46 || string(wav[:4]) != "RIFF" || string(wav[8:16]) != "WAVEfmt " || string(wav[36:40]) != "data" {
		return 0, invalid
	}
	rate := int64(binary.LittleEndian.Uint32(wav[24:28]))
	size := int64(len(wav) - 44)
	if (rate != 16000 && rate != 24000 && rate != 48000) || size%2 != 0 || size > rate*2*60 || int64(binary.LittleEndian.Uint32(wav[4:8])) != int64(len(wav)-8) || binary.LittleEndian.Uint32(wav[16:20]) != 16 || binary.LittleEndian.Uint16(wav[20:22]) != 1 || binary.LittleEndian.Uint16(wav[22:24]) != 1 || int64(binary.LittleEndian.Uint32(wav[28:32])) != rate*2 || binary.LittleEndian.Uint16(wav[32:34]) != 2 || binary.LittleEndian.Uint16(wav[34:36]) != 16 || int64(binary.LittleEndian.Uint32(wav[40:44])) != size {
		return 0, invalid
	}
	return (size*1000+rate*2-1)/(rate*2) + 1000, nil // one-second allowance for provider duration rounding
}

// ObserveMembershipAudio captures duration directly from Whisper, or successful
// nonempty PCM output for the final TTS input. Missing evidence remains pending.
func ObserveMembershipAudio(c *gin.Context, body []byte) {
	value, ok := c.Get("membership_session")
	session, valid := value.(*MembershipSession)
	if !ok || !valid {
		return
	}
	switch session.Request.Unit {
	case model.MembershipUnitAudioMillis:
		var receipt struct {
			Duration *decimal.Decimal `json:"duration"`
			Text     *string          `json:"text"`
		}
		if common.Unmarshal(body, &receipt) != nil || receipt.Duration == nil || receipt.Text == nil || !receipt.Duration.IsPositive() || receipt.Duration.GreaterThan(decimal.NewFromInt(61)) {
			session.InvalidUsage = true
			return
		}
		session.Quantity = receipt.Duration.Mul(decimal.NewFromInt(1000)).Ceil().IntPart() // bounded above by 61000
		session.UsageReceipt, _ = common.Marshal(receipt)
	case model.MembershipUnitCharacters:
		if len(body) == 0 || len(body) > MembershipMaxShortAudioBytes || len(body)%2 != 0 {
			session.InvalidUsage = true
			return
		}
		session.Quantity = session.Request.QuantityReserved
		session.UsageReceipt, _ = common.Marshal(struct {
			Characters int64 `json:"input_characters"`
			PCMBytes   int   `json:"pcm_bytes"`
		}{session.Quantity, len(body)})
	default:
		return
	}
	session.HasUsage = true
}
