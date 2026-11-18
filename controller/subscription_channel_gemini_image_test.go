package controller

import (
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Image output uses raw candidate plus raw thinking counters, never a per-image
// placeholder. The final native cap also bounds these two output categories.
func TestMembershipHTTPGeminiNativeImages(t *testing.T) {
	for _, name := range []string{"gemini-3-pro-image", "gemini-3.1-flash-image"} {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/stream_%v", name, stream), func(t *testing.T) {
				var calls atomic.Int32
				r, db, key, subID := membershipAudioFixture(t, name, model.MembershipGeminiImageProfile, model.MembershipUnitTokens, 0, func(w http.ResponseWriter, req *http.Request) {
					calls.Add(1)
					assert.Contains(t, req.URL.Path, name+":")
					var sent dto.GeminiChatRequest
					if !assert.NoError(t, common.DecodeJson(req.Body, &sent)) {
						return
					}
					require.NotNil(t, sent.GenerationConfig.MaxOutputTokens)
					assert.EqualValues(t, 20, *sent.GenerationConfig.MaxOutputTokens)
					assert.Contains(t, sent.GenerationConfig.ResponseModalities, "IMAGE")
					raw := `{"candidates":[{"content":{"role":"model","parts":[{"inlineData":{"mimeType":"image/png","data":"bW9jaw=="}}]},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":15,"thoughtsTokenCount":3,"totalTokenCount":30}}`
					if stream {
						w.Header().Set("Content-Type", "text/event-stream")
						_, _ = fmt.Fprintf(w, "data: %s\n\n", raw)
					} else {
						w.Header().Set("Content-Type", "application/json")
						_, _ = fmt.Fprint(w, raw)
					}
				})
				r.POST("/v1beta/models/*path", middleware.TokenAuth(), middleware.Distribute(), func(c *gin.Context) { Relay(c, types.RelayFormatGemini) })
				path := "/v1beta/models/" + name + ":generateContent"
				if stream {
					path = "/v1beta/models/" + name + ":streamGenerateContent?alt=sse"
				}
				var before model.User
				require.NoError(t, db.First(&before, 8101).Error)
				invalid := `{"contents":[{"role":"user","parts":[{"fileData":{"fileUri":"https://mock.invalid/input.png","mimeType":"image/png"}}]}],"generationConfig":{"maxOutputTokens":20,"responseModalities":["IMAGE"]}}`
				assert.Equal(t, http.StatusForbidden, membershipHTTPRequest(r, path, key.Key, invalid).Code)
				assert.Zero(t, calls.Load())
				body := `{"contents":[{"role":"user","parts":[{"text":"mock"}]}],"generationConfig":{"maxOutputTokens":20,"responseModalities":["TEXT","IMAGE"]}}`
				response := membershipHTTPRequest(r, path, key.Key, body)
				require.Equal(t, http.StatusOK, response.Code, response.Body.String())
				var grant model.SubscriptionChannelQuota
				require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&grant).Error)
				assert.EqualValues(t, 12, grant.InputUsed)
				assert.EqualValues(t, 18, grant.OutputUsed)
				assert.Zero(t, grant.InputReserved)
				assert.Zero(t, grant.OutputReserved)
				assert.Equal(t, http.StatusForbidden, membershipHTTPRequest(r, path, key.Key, body).Code)
				assert.EqualValues(t, 1, calls.Load())
				var after model.User
				require.NoError(t, db.First(&after, 8101).Error)
				assert.Equal(t, before.Quota, after.Quota)
			})
		}
	}
}

func TestMembershipHTTPGeminiImageMissingUsageRetainsReservation(t *testing.T) {
	for _, usage := range []string{`{"promptTokenCount":12,"totalTokenCount":30}`, `{"promptTokenCount":12,"candidatesTokenCount":15,"thoughtsTokenCount":3,"totalTokenCount":27}`} {
		t.Run(usage, func(t *testing.T) {
			r, db, key, subID := membershipAudioFixture(t, "gemini-3.1-flash-image", model.MembershipGeminiImageProfile, model.MembershipUnitTokens, 0, func(w http.ResponseWriter, req *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = fmt.Fprintf(w, `{"candidates":[{"content":{"role":"model","parts":[{"inlineData":{"mimeType":"image/png","data":"bW9jaw=="}}]},"finishReason":"STOP"}],"usageMetadata":%s}`, usage)
			})
			r.POST("/v1beta/models/*path", middleware.TokenAuth(), middleware.Distribute(), func(c *gin.Context) { Relay(c, types.RelayFormatGemini) })
			res := membershipHTTPRequest(r, "/v1beta/models/gemini-3.1-flash-image:generateContent", key.Key, `{"contents":[{"role":"user","parts":[{"text":"mock"}]}],"generationConfig":{"maxOutputTokens":20,"responseModalities":["IMAGE"]}}`)
			require.Equal(t, http.StatusOK, res.Code, res.Body.String())
			var record model.SubscriptionChannelRequest
			require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&record).Error)
			assert.Equal(t, "pending", record.Status)
			assert.Zero(t, record.OutputUsed)
			var grant model.SubscriptionChannelQuota
			require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&grant).Error)
			assert.EqualValues(t, 20, grant.OutputReserved)
		})
	}
}
