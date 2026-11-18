package controller

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// membershipAudioFixture activates only synthetic wallet funds against a loopback mock.
func membershipAudioFixture(t *testing.T, modelName, profile, unit string, limit int64, handler http.HandlerFunc) (*gin.Engine, *gorm.DB, *model.Token, int) {
	t.Helper()
	r, db, _, _ := membershipHTTPFixture(t, handler)
	var text model.Channel
	require.NoError(t, db.First(&text, 8102).Error)
	channelKind := constant.ChannelTypeOpenAI
	if profile == model.MembershipClaudeProfile {
		channelKind = constant.ChannelTypeAnthropic
	}
	if profile == model.MembershipGeminiProfile || profile == model.MembershipGeminiImageProfile {
		channelKind = constant.ChannelTypeGemini
	}
	require.NoError(t, db.Create(&model.Channel{Id: 8120, Name: "mock-audio", Type: channelKind, Key: "mock-only", BaseURL: text.BaseURL, Models: modelName, Group: "default", Status: common.ChannelStatusEnabled}).Error)
	configValue := model.SubscriptionChannelConfig{ChannelId: 8120, Profile: profile, Unit: unit, Models: []string{modelName}, QuantityLimit: limit}
	if profile == model.MembershipClaudeProfile || profile == model.MembershipGeminiProfile || profile == model.MembershipGeminiImageProfile {
		configValue.QuantityLimit = 0
		configValue.InputLimit = 2000
		configValue.OutputLimit = 30
	}
	if profile == model.MembershipRealtimeProfile {
		configValue.QuantityLimit = 0
		configValue.InputLimit = 10000
		configValue.OutputLimit = limit
	}
	config, err := common.Marshal([]model.SubscriptionChannelConfig{configValue})
	require.NoError(t, err)
	require.NoError(t, db.Create(&model.SubscriptionPlan{Id: 8121, Title: "mock audio", MeterType: model.SubscriptionMeterChannel, ChannelQuotas: model.JSONValue(config), PriceAmount: 1, DurationUnit: model.SubscriptionDurationDay, DurationValue: 1, Enabled: true}).Error)
	paid := membershipHTTPRequest(r, "/api/subscription/balance/pay", "", `{"plan_id":8121}`)
	var result struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(paid.Body.Bytes(), &result))
	require.True(t, result.Success, paid.Body.String())
	var sub model.UserSubscription
	require.NoError(t, db.Where("plan_id = ?", 8121).First(&sub).Error)
	keyType := "language"
	if profile == model.MembershipGeminiImageProfile {
		keyType = "image"
	}
	created := membershipHTTPRequest(r, "/api/token", "", fmt.Sprintf(`{"name":"mock-member-audio","key_type":%q,"user_subscription_id":%d,"channel_id":8120,"expired_time":-1}`, keyType, sub.Id))
	require.NoError(t, common.Unmarshal(created.Body.Bytes(), &result))
	require.True(t, result.Success, created.Body.String())
	var key model.Token
	require.NoError(t, db.Where("user_subscription_id = ?", sub.Id).First(&key).Error)
	for _, path := range []string{"/v1/audio/speech", "/v1/audio/transcriptions", "/v1/audio/translations"} {
		r.POST(path, middleware.TokenAuth(), middleware.Distribute(), func(c *gin.Context) { Relay(c, types.RelayFormatOpenAIAudio) })
	}
	return r, db, &key, sub.Id
}

func TestMembershipHTTPSpeechCharactersAndWalletIsolation(t *testing.T) {
	for _, modelName := range []string{"tts-1", "tts-1-hd"} {
		t.Run(modelName, func(t *testing.T) {
			var calls atomic.Int32
			r, db, key, subID := membershipAudioFixture(t, modelName, model.MembershipSpeechProfile, model.MembershipUnitCharacters, 3, func(w http.ResponseWriter, req *http.Request) {
				calls.Add(1)
				assert.Equal(t, "/v1/audio/speech", req.URL.Path)
				w.Header().Set("Content-Type", "audio/pcm")
				_, _ = w.Write([]byte{0, 0, 1, 0})
			})
			var before model.User
			require.NoError(t, db.First(&before, 8101).Error)
			body := fmt.Sprintf(`{"model":%q,"input":"hi你","voice":"alloy","response_format":"pcm"}`, modelName)
			response := membershipHTTPRequest(r, "/v1/audio/speech", key.Key, body)
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())
			var grant model.SubscriptionChannelQuota
			require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&grant).Error)
			assert.EqualValues(t, 3, grant.QuantityUsed)
			assert.Zero(t, grant.QuantityReserved)
			assert.Zero(t, grant.InputUsed)
			assert.Zero(t, grant.OutputUsed)
			response = membershipHTTPRequest(r, "/v1/audio/speech", key.Key, body)
			assert.Equal(t, http.StatusForbidden, response.Code)
			assert.EqualValues(t, 1, calls.Load())
			response = membershipHTTPRequest(r, "/v1/audio/translations", key.Key, `{"model":"whisper-1"}`)
			assert.Equal(t, http.StatusForbidden, response.Code)
			var after model.User
			require.NoError(t, db.First(&after, 8101).Error)
			assert.Equal(t, before.Quota, after.Quota)
		})
	}
}

// membershipWAVRequest creates one second of canonical PCM without media tools or network inputs.
func membershipWAVRequest(t *testing.T, key string, corrupt bool) *http.Request {
	t.Helper()
	wav := make([]byte, 44+32000)
	copy(wav, "RIFF")
	binary.LittleEndian.PutUint32(wav[4:8], uint32(len(wav)-8))
	copy(wav[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(wav[16:20], 16)
	binary.LittleEndian.PutUint16(wav[20:22], 1)
	binary.LittleEndian.PutUint16(wav[22:24], 1)
	binary.LittleEndian.PutUint32(wav[24:28], 16000)
	binary.LittleEndian.PutUint32(wav[28:32], 32000)
	binary.LittleEndian.PutUint16(wav[32:34], 2)
	binary.LittleEndian.PutUint16(wav[34:36], 16)
	copy(wav[36:], "data")
	binary.LittleEndian.PutUint32(wav[40:44], 32000)
	if corrupt {
		binary.LittleEndian.PutUint32(wav[40:44], 1)
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	require.NoError(t, writer.WriteField("model", "whisper-1"))
	require.NoError(t, writer.WriteField("response_format", "verbose_json"))
	part, err := writer.CreateFormFile("file", "mock.wav")
	require.NoError(t, err)
	_, err = part.Write(wav)
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	req := httptest.NewRequest(http.MethodPost, "/v1/audio/transcriptions", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer sk-"+key)
	return req
}

func TestMembershipHTTPTranscriptionDurationAndMissingEvidence(t *testing.T) {
	for _, missing := range []bool{false, true} {
		t.Run(fmt.Sprintf("missing_%v", missing), func(t *testing.T) {
			var calls atomic.Int32
			r, db, key, subID := membershipAudioFixture(t, "whisper-1", model.MembershipTranscriptionProfile, model.MembershipUnitAudioMillis, 2000, func(w http.ResponseWriter, req *http.Request) {
				calls.Add(1)
				require.NoError(t, req.ParseMultipartForm(1<<20))
				assert.Equal(t, "verbose_json", req.FormValue("response_format"))
				w.Header().Set("Content-Type", "application/json")
				if missing {
					_, _ = fmt.Fprint(w, `{"text":"mock"}`)
				} else {
					_, _ = fmt.Fprint(w, `{"duration":1,"text":"mock"}`)
				}
			})
			invalid := httptest.NewRecorder()
			r.ServeHTTP(invalid, membershipWAVRequest(t, key.Key, true))
			assert.Equal(t, http.StatusForbidden, invalid.Code, invalid.Body.String())
			assert.Zero(t, calls.Load())
			var before model.User
			require.NoError(t, db.First(&before, 8101).Error)
			response := httptest.NewRecorder()
			r.ServeHTTP(response, membershipWAVRequest(t, key.Key, false))
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())
			var grant model.SubscriptionChannelQuota
			require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&grant).Error)
			var ledger model.SubscriptionChannelRequest
			require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&ledger).Error)
			if missing {
				assert.EqualValues(t, 2000, grant.QuantityReserved)
				assert.Zero(t, grant.QuantityUsed)
				assert.Equal(t, "pending", ledger.Status)
			} else {
				assert.EqualValues(t, 1000, grant.QuantityUsed)
				assert.Zero(t, grant.QuantityReserved)
				assert.Equal(t, "settled", ledger.Status)
			}
			assert.Zero(t, grant.InputUsed)
			assert.Zero(t, grant.OutputUsed)
			exhausted := httptest.NewRecorder()
			r.ServeHTTP(exhausted, membershipWAVRequest(t, key.Key, false))
			assert.Equal(t, http.StatusForbidden, exhausted.Code)
			assert.EqualValues(t, 1, calls.Load())
			var after model.User
			require.NoError(t, db.First(&after, 8101).Error)
			assert.Equal(t, before.Quota, after.Quota)
		})
	}
}
