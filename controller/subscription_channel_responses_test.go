package controller

import (
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestMembershipHTTPNativeResponses shares one channel grant with chat while
// verifying native Responses usage and final output limits independently.
func TestMembershipHTTPNativeResponses(t *testing.T) {
	for _, name := range []string{"gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-6-astra", "gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol", "kimi-k3.1-pro", "grok-4.6-latest", "grok-4.7-latest"} {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/stream_%v", name, stream), func(t *testing.T) {
				var calls atomic.Int32
				r, db, key, subID := membershipHTTPFixture(t, func(w http.ResponseWriter, req *http.Request) {
					calls.Add(1)
					assert.Equal(t, "/v1/responses", req.URL.Path)
					var sent dto.OpenAIResponsesRequest
					if !assert.NoError(t, common.DecodeJson(req.Body, &sent)) {
						return
					}
					assert.Equal(t, name, sent.Model)
					require.NotNil(t, sent.MaxOutputTokens)
					assert.EqualValues(t, 20, *sent.MaxOutputTokens)
					assert.Contains(t, string(sent.Instructions), "test system prompt")
					response := fmt.Sprintf(`{"id":"mock-response","object":"response","model":%q,"status":"completed","output":[{"id":"m","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"mock","annotations":[]}]}],"usage":{"input_tokens":12,"output_tokens":15,"total_tokens":27}}`, name)
					if stream {
						w.Header().Set("Content-Type", "text/event-stream")
						_, _ = fmt.Fprintf(w, "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":%s}\n\ndata: [DONE]\n\n", response)
					} else {
						w.Header().Set("Content-Type", "application/json")
						_, _ = fmt.Fprint(w, response)
					}
				})
				r.POST("/v1/responses", middleware.TokenAuth(), middleware.Distribute(), func(c *gin.Context) { Relay(c, types.RelayFormatOpenAIResponses) })
				mapping, err := common.Marshal(map[string]string{"member-text": name})
				require.NoError(t, err)
				kind := constant.ChannelTypeOpenAI
				if name == "grok-4.6-latest" || name == "grok-4.7-latest" {
					kind = constant.ChannelTypeXai
				}
				require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", 8102).Updates(map[string]interface{}{"type": kind, "model_mapping": string(mapping)}).Error)
				invalid := membershipHTTPRequest(r, "/v1/responses", key.Key, `{"model":"member-text","input":"mock","max_output_tokens":20,"previous_response_id":"unbounded-remote-context"}`)
				assert.Equal(t, http.StatusForbidden, invalid.Code, invalid.Body.String())
				assert.Zero(t, calls.Load())
				var before model.User
				require.NoError(t, db.First(&before, 8101).Error)
				body := fmt.Sprintf(`{"model":"member-text","input":"mock","max_output_tokens":20,"store":false,"stream":%v}`, stream)
				response := membershipHTTPRequest(r, "/v1/responses", key.Key, body)
				require.Equal(t, http.StatusOK, response.Code, response.Body.String())
				var grant model.SubscriptionChannelQuota
				require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&grant).Error)
				assert.EqualValues(t, 12, grant.InputUsed)
				assert.EqualValues(t, 15, grant.OutputUsed)
				assert.Zero(t, grant.InputReserved)
				assert.Zero(t, grant.OutputReserved)
				assert.Equal(t, http.StatusForbidden, membershipHTTPRequest(r, "/v1/responses", key.Key, body).Code)
				assert.EqualValues(t, 1, calls.Load())
				var after model.User
				require.NoError(t, db.First(&after, 8101).Error)
				assert.Equal(t, before.Quota, after.Quota)
			})
		}
	}
}

// TestMembershipHTTPResponsesUnverifiableStreamKeepsReservation makes terminal
// evidence mandatory even when an upstream sends the generic DONE marker.
func TestMembershipHTTPResponsesUnverifiableStreamKeepsReservation(t *testing.T) {
	for _, raw := range []string{
		`{"type":"response.completed","response":{"id":"mock","status":"completed","usage":{"input_tokens":12,"total_tokens":27}}}`,
		`{"id":"mock","status":"completed","usage":{"input_tokens":12,"output_tokens":15,"total_tokens":27}}`,
	} {
		t.Run(fmt.Sprintf("receipt_%d", len(raw)), func(t *testing.T) {
			r, db, key, subID := membershipHTTPFixture(t, func(w http.ResponseWriter, req *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", raw)
			})
			r.POST("/v1/responses", middleware.TokenAuth(), middleware.Distribute(), func(c *gin.Context) { Relay(c, types.RelayFormatOpenAIResponses) })
			_ = membershipHTTPRequest(r, "/v1/responses", key.Key, `{"model":"gpt-4o-mini","input":"mock","max_output_tokens":20,"stream":true}`)
			var ledger model.SubscriptionChannelRequest
			require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&ledger).Error)
			assert.Equal(t, "pending", ledger.Status)
			assert.Zero(t, ledger.OutputUsed)
			var grant model.SubscriptionChannelQuota
			require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&grant).Error)
			assert.EqualValues(t, 20, grant.OutputReserved)
		})
	}
}
