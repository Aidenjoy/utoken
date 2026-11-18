package controller

import (
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestMembershipHTTPCatalogOpenAIChatModels verifies the actual local catalogue's
// OpenAI-compatible text model names against the same reservation/usage contract.
// All model calls terminate at httptest servers, not the configured business channels.
func TestMembershipHTTPCatalogOpenAIChatModels(t *testing.T) {
	for _, name := range []string{"gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-6-astra", "gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol", "kimi-k3.1-pro", "grok-4.6-latest", "grok-4.7-latest"} {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/stream_%v", name, stream), func(t *testing.T) {
				var calls atomic.Int32
				r, db, key, subID := membershipHTTPFixture(t, func(w http.ResponseWriter, req *http.Request) {
					calls.Add(1)
					var request dto.GeneralOpenAIRequest
					if !assert.NoError(t, common.DecodeJson(req.Body, &request)) {
						return
					}
					assert.Equal(t, name, request.Model)
					assert.NotNil(t, request.MaxCompletionTokens)
					if stream {
						require.NotNil(t, request.StreamOptions)
						assert.True(t, request.StreamOptions.IncludeUsage)
						w.Header().Set("Content-Type", "text/event-stream")
						_, _ = fmt.Fprint(w, "data: {\"id\":\"mock\",\"choices\":[],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":15,\"total_tokens\":27}}\n\ndata: [DONE]\n\n")
					} else {
						w.Header().Set("Content-Type", "application/json")
						_, _ = fmt.Fprint(w, `{"id":"mock","choices":[{"message":{"role":"assistant","content":"mock"}}],"usage":{"prompt_tokens":12,"completion_tokens":15,"total_tokens":27}}`)
					}
				})
				if name == "grok-4.6-latest" || name == "grok-4.7-latest" {
					require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", 8102).Update("type", constant.ChannelTypeXai).Error)
				}
				mapping, err := common.Marshal(map[string]string{"member-text": name})
				require.NoError(t, err)
				require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", 8102).Update("model_mapping", string(mapping)).Error)
				var before model.User
				require.NoError(t, db.First(&before, 8101).Error)
				body := fmt.Sprintf(`{"model":"member-text","messages":[{"role":"user","content":"mock"}],"max_completion_tokens":20,"stream":%v}`, stream)
				response := membershipHTTPRequest(r, "/v1/chat/completions", key.Key, body)
				require.Equal(t, http.StatusOK, response.Code, response.Body.String())
				var grant model.SubscriptionChannelQuota
				require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&grant).Error)
				assert.EqualValues(t, 12, grant.InputUsed)
				assert.EqualValues(t, 15, grant.OutputUsed)
				assert.Zero(t, grant.InputReserved)
				assert.Zero(t, grant.OutputReserved)
				assert.Equal(t, http.StatusForbidden, membershipHTTPRequest(r, "/v1/chat/completions", key.Key, body).Code)
				assert.EqualValues(t, 1, calls.Load())
				var after model.User
				require.NoError(t, db.First(&after, 8101).Error)
				assert.Equal(t, before.Quota, after.Quota)
			})
		}
	}
}

// TestMembershipHTTPXaiNeverUsesSplitTotalAsRealOutput protects the adapter boundary:
// xAI's legacy total-minus-input fallback must not become member output usage.
func TestMembershipHTTPXaiNeverUsesSplitTotalAsRealOutput(t *testing.T) {
	r, db, key, subID := membershipHTTPFixture(t, func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"id":"mock","choices":[{"message":{"role":"assistant","content":"mock"}}],"usage":{"prompt_tokens":12,"total_tokens":27}}`)
	})
	require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", 8102).Updates(map[string]interface{}{"type": constant.ChannelTypeXai, "model_mapping": `{"member-text":"grok-4.6-latest"}`}).Error)
	response := membershipHTTPRequest(r, "/v1/chat/completions", key.Key, `{"model":"member-text","messages":[{"role":"user","content":"mock"}],"max_completion_tokens":20}`)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var ledger model.SubscriptionChannelRequest
	require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&ledger).Error)
	assert.Equal(t, "pending", ledger.Status)
	assert.Zero(t, ledger.OutputUsed)
	var grant model.SubscriptionChannelQuota
	require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&grant).Error)
	assert.EqualValues(t, 20, grant.OutputReserved)
	assert.Zero(t, grant.OutputUsed)
}
