package controller

import (
	"fmt"
	"net/http"
	"strings"
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
)

// TestMembershipHTTPVolcCatalogueText verifies channel 32's model names through
// the existing VolcEngine adaptor, never its actual URL/key or paid endpoints.
func TestMembershipHTTPVolcCatalogueText(t *testing.T) {
	for _, name := range []string{"deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4.1-flash", "doubao-seed-2.1-lite", "doubao-seed-2.1-pro", "glm-5.3", "glm-5.3-flash", "kimi-k3", "kimi-k3.1-pro"} {
		for _, responses := range []bool{false, true} {
			for _, stream := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/responses_%v/stream_%v", name, responses, stream), func(t *testing.T) {
					var calls atomic.Int32
					r, db, key, subID := membershipHTTPFixture(t, func(w http.ResponseWriter, req *http.Request) {
						calls.Add(1)
						var sent struct {
							Model         string   `json:"model"`
							Max           *uint    `json:"max_tokens"`
							MaxCompletion *uint    `json:"max_completion_tokens"`
							MaxOutput     *uint    `json:"max_output_tokens"`
							Temperature   *float64 `json:"temperature"`
						}
						if !assert.NoError(t, common.DecodeJson(req.Body, &sent)) {
							return
						}
						assert.Equal(t, name, sent.Model)
						if strings.HasPrefix(name, "kimi-") {
							require.NotNil(t, sent.Temperature)
							assert.Equal(t, 1.0, *sent.Temperature)
						}
						if responses {
							assert.Equal(t, "/api/v3/responses", req.URL.Path)
							require.NotNil(t, sent.MaxOutput)
							assert.EqualValues(t, 20, *sent.MaxOutput)
						} else {
							assert.Equal(t, "/api/v3/chat/completions", req.URL.Path)
							assert.Nil(t, sent.Max)
							require.NotNil(t, sent.MaxCompletion)
							assert.EqualValues(t, 20, *sent.MaxCompletion)
						}
						raw := `{"id":"mock","choices":[{"message":{"role":"assistant","content":"mock"}}],"usage":{"prompt_tokens":12,"completion_tokens":15,"total_tokens":27}}`
						if responses {
							raw = `{"id":"mock","object":"response","status":"completed","output":[{"id":"m","type":"message","role":"assistant","content":[{"type":"output_text","text":"mock","annotations":[]}]}],"usage":{"input_tokens":12,"output_tokens":15,"total_tokens":27}}`
						}
						if stream {
							w.Header().Set("Content-Type", "text/event-stream")
							if responses {
								_, _ = fmt.Fprintf(w, "data: {\"type\":\"response.completed\",\"response\":%s}\n\ndata: [DONE]\n\n", raw)
							} else {
								_, _ = fmt.Fprint(w, "data: {\"id\":\"mock\",\"choices\":[],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":15,\"total_tokens\":27}}\n\ndata: [DONE]\n\n")
							}
						} else {
							w.Header().Set("Content-Type", "application/json")
							_, _ = fmt.Fprint(w, raw)
						}
					})
					r.POST("/v1/responses", middleware.TokenAuth(), middleware.Distribute(), func(c *gin.Context) { Relay(c, types.RelayFormatOpenAIResponses) })
					mapping, err := common.Marshal(map[string]string{"member-text": name})
					require.NoError(t, err)
					require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", 8102).Updates(map[string]interface{}{"type": constant.ChannelTypeVolcEngine, "model_mapping": string(mapping)}).Error)
					endpoint := "/v1/chat/completions"
					body := fmt.Sprintf(`{"model":"member-text","messages":[{"role":"user","content":"mock"}],"max_tokens":20,"temperature":0.7,"stream":%v}`, stream)
					if responses {
						endpoint = "/v1/responses"
						body = fmt.Sprintf(`{"model":"member-text","input":"mock","max_output_tokens":20,"temperature":0.7,"stream":%v}`, stream)
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
}
