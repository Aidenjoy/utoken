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

// TestMembershipHTTPGeminiPlainText uses only loopback fixtures and verifies
// explicit native counters: cached input is already included, not added twice.
func TestMembershipHTTPGeminiPlainText(t *testing.T) {
	for _, format := range []string{"native", "chat"} {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/stream_%v", format, stream), func(t *testing.T) {
				var calls atomic.Int32
				r, db, key, subID := membershipAudioFixture(t, "gemini-3.8-flash", model.MembershipGeminiProfile, model.MembershipUnitTokens, 0, func(w http.ResponseWriter, req *http.Request) {
					calls.Add(1)
					assert.Contains(t, req.URL.Path, "gemini-3.8-flash:")
					var sent dto.GeminiChatRequest
					if !assert.NoError(t, common.DecodeJson(req.Body, &sent)) {
						return
					}
					require.NotNil(t, sent.GenerationConfig.MaxOutputTokens)
					assert.EqualValues(t, 20, *sent.GenerationConfig.MaxOutputTokens)
					require.NotNil(t, sent.GenerationConfig.ThinkingConfig)
					require.NotNil(t, sent.GenerationConfig.ThinkingConfig.ThinkingBudget)
					assert.Zero(t, *sent.GenerationConfig.ThinkingConfig.ThinkingBudget)
					raw := `{"candidates":[{"content":{"role":"model","parts":[{"text":"mock"}]},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":15,"totalTokenCount":27,"cachedContentTokenCount":3,"thoughtsTokenCount":0}}`
					if stream {
						w.Header().Set("Content-Type", "text/event-stream")
						_, _ = fmt.Fprintf(w, "data: %s\n\n", raw)
					} else {
						w.Header().Set("Content-Type", "application/json")
						_, _ = fmt.Fprint(w, raw)
					}
				})
				r.POST("/v1beta/models/*path", middleware.TokenAuth(), middleware.Distribute(), func(c *gin.Context) { Relay(c, types.RelayFormatGemini) })
				endpoint := "/v1beta/models/gemini-3.8-flash:generateContent"
				if stream {
					endpoint = "/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse"
				}
				body := `{"contents":[{"role":"user","parts":[{"text":"mock"}]}],"generationConfig":{"maxOutputTokens":20,"candidateCount":1,"thinkingConfig":{"thinkingBudget":0}}}`
				if format == "chat" {
					endpoint = "/v1/chat/completions"
					body = fmt.Sprintf(`{"model":"gemini-3.8-flash","messages":[{"role":"user","content":"mock"}],"max_tokens":20,"stream":%v}`, stream)
				}
				var before model.User
				require.NoError(t, db.First(&before, 8101).Error)
				response := membershipHTTPRequest(r, endpoint, key.Key, body)
				require.Equal(t, http.StatusOK, response.Code, response.Body.String())
				var grant model.SubscriptionChannelQuota
				require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&grant).Error)
				assert.EqualValues(t, 12, grant.InputUsed)
				assert.EqualValues(t, 15, grant.OutputUsed)
				assert.Zero(t, grant.InputReserved)
				assert.Zero(t, grant.OutputReserved)
				assert.Equal(t, http.StatusForbidden, membershipHTTPRequest(r, endpoint, key.Key, body).Code)
				assert.EqualValues(t, 1, calls.Load())
				var after model.User
				require.NoError(t, db.First(&after, 8101).Error)
				assert.Equal(t, before.Quota, after.Quota)
			})
		}
	}
}

func TestMembershipHTTPGeminiMissingCountersOrThinkingRemainsPending(t *testing.T) {
	for _, usage := range []string{`{"promptTokenCount":12,"totalTokenCount":27}`, `{"promptTokenCount":12,"candidatesTokenCount":15,"thoughtsTokenCount":3,"totalTokenCount":30}`} {
		t.Run(fmt.Sprintf("receipt_%d", len(usage)), func(t *testing.T) {
			var calls atomic.Int32
			r, db, key, subID := membershipAudioFixture(t, "gemini-3.8-flash", model.MembershipGeminiProfile, model.MembershipUnitTokens, 0, func(w http.ResponseWriter, req *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "application/json")
				_, _ = fmt.Fprintf(w, `{"candidates":[{"content":{"role":"model","parts":[{"text":"mock"}]},"finishReason":"STOP"}],"usageMetadata":%s}`, usage)
			})
			r.POST("/v1beta/models/*path", middleware.TokenAuth(), middleware.Distribute(), func(c *gin.Context) { Relay(c, types.RelayFormatGemini) })
			endpoint := "/v1beta/models/gemini-3.8-flash:generateContent"
			rejected := membershipHTTPRequest(r, endpoint, key.Key, `{"contents":[{"role":"user","parts":[{"text":"mock"}]}],"generationConfig":{"maxOutputTokens":20,"candidateCount":2,"thinkingConfig":{"thinkingBudget":0}}}`)
			assert.Equal(t, http.StatusForbidden, rejected.Code, rejected.Body.String())
			assert.Zero(t, calls.Load())
			response := membershipHTTPRequest(r, endpoint, key.Key, `{"contents":[{"role":"user","parts":[{"text":"mock"}]}],"generationConfig":{"maxOutputTokens":20,"thinkingConfig":{"thinkingBudget":0}}}`)
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())
			var ledger model.SubscriptionChannelRequest
			require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&ledger).Error)
			assert.Equal(t, "pending", ledger.Status)
			assert.Zero(t, ledger.OutputUsed)
		})
	}
}
