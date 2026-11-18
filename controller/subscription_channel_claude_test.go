package controller

import (
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestMembershipHTTPNativeClaudeCatalogue covers every local native Claude model
// name with raw cache-input counters, output caps, streams and wallet isolation.
func TestMembershipHTTPNativeClaudeCatalogue(t *testing.T) {
	for _, name := range []string{"claude-fable-5", "claude-fable-5-1", "claude-opus-5", "claude-opus-5-5", "claude-sonnet-5", "claude-sonnet-5-5"} {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/stream_%v", name, stream), func(t *testing.T) {
				var calls atomic.Int32
				r, db, key, subID := membershipAudioFixture(t, name, model.MembershipClaudeProfile, model.MembershipUnitTokens, 0, func(w http.ResponseWriter, req *http.Request) {
					calls.Add(1)
					assert.Equal(t, "/v1/messages", req.URL.Path)
					var sent struct {
						Model string `json:"model"`
						Limit uint   `json:"max_tokens"`
					}
					if !assert.NoError(t, common.DecodeJson(req.Body, &sent)) {
						return
					}
					assert.Equal(t, name, sent.Model)
					assert.EqualValues(t, 20, sent.Limit)
					if stream {
						w.Header().Set("Content-Type", "text/event-stream")
						_, _ = fmt.Fprint(w, "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"mock\",\"model\":\""+name+"\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"usage\":{\"input_tokens\":12,\"output_tokens\":0,\"cache_read_input_tokens\":3,\"cache_creation_input_tokens\":2}}}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":15}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n")
					} else {
						w.Header().Set("Content-Type", "application/json")
						_, _ = fmt.Fprintf(w, `{"id":"mock","model":%q,"type":"message","role":"assistant","content":[{"type":"text","text":"mock"}],"stop_reason":"end_turn","usage":{"input_tokens":12,"output_tokens":15,"cache_read_input_tokens":3,"cache_creation_input_tokens":2}}`, name)
					}
				})
				r.POST("/v1/messages", middleware.TokenAuth(), middleware.Distribute(), func(c *gin.Context) { Relay(c, types.RelayFormatClaude) })
				var before model.User
				require.NoError(t, db.First(&before, 8101).Error)
				body := fmt.Sprintf(`{"model":%q,"system":"brief","messages":[{"role":"user","content":"mock"}],"max_tokens":20,"stream":%v}`, name, stream)
				response := membershipHTTPRequest(r, "/v1/messages", key.Key, body)
				require.Equal(t, http.StatusOK, response.Code, response.Body.String())
				var grant model.SubscriptionChannelQuota
				require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&grant).Error)
				assert.EqualValues(t, 17, grant.InputUsed)
				assert.EqualValues(t, 15, grant.OutputUsed)
				assert.Zero(t, grant.InputReserved)
				assert.Zero(t, grant.OutputReserved)
				assert.Equal(t, http.StatusForbidden, membershipHTTPRequest(r, "/v1/messages", key.Key, body).Code)
				assert.EqualValues(t, 1, calls.Load())
				var after model.User
				require.NoError(t, db.First(&after, 8101).Error)
				assert.Equal(t, before.Quota, after.Quota)
			})
		}
	}
}

// TestMembershipHTTPClaudeIncompleteStreamIsPending forbids treating an OpenAI
// DONE marker as a native Claude terminal receipt.
func TestMembershipHTTPClaudeIncompleteStreamIsPending(t *testing.T) {
	var calls atomic.Int32
	r, db, key, subID := membershipAudioFixture(t, "claude-sonnet-5", model.MembershipClaudeProfile, model.MembershipUnitTokens, 0, func(w http.ResponseWriter, req *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, "data: {\"type\":\"message_start\",\"message\":{\"id\":\"mock\",\"usage\":{\"input_tokens\":12,\"output_tokens\":0}}}\n\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":15}}\n\ndata: [DONE]\n\n")
	})
	r.POST("/v1/messages", middleware.TokenAuth(), middleware.Distribute(), func(c *gin.Context) { Relay(c, types.RelayFormatClaude) })
	rejected := membershipHTTPRequest(r, "/v1/messages", key.Key, `{"model":"claude-sonnet-5","messages":[{"role":"user","content":[{"type":"text","text":"mock","cache_control":{"type":"ephemeral"}}]}],"max_tokens":20}`)
	assert.Equal(t, http.StatusForbidden, rejected.Code, rejected.Body.String())
	assert.Zero(t, calls.Load())
	response := membershipHTTPRequest(r, "/v1/messages", key.Key, `{"model":"claude-sonnet-5","messages":[{"role":"user","content":"mock"}],"max_tokens":20,"stream":true}`)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var ledger model.SubscriptionChannelRequest
	require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&ledger).Error)
	assert.Equal(t, "pending", ledger.Status)
	assert.Zero(t, ledger.OutputUsed)
	var grant model.SubscriptionChannelQuota
	require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&grant).Error)
	assert.EqualValues(t, 20, grant.OutputReserved)
}
