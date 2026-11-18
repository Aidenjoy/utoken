package controller

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestMembershipHTTPRealtimeUsesRawUsageAndClosesAtBudget runs only two local
// websocket servers. It verifies in-session bounds and final ledger completion.
func TestMembershipHTTPRealtimeUsesRawUsageAndClosesAtBudget(t *testing.T) {
	for _, mode := range []string{"completed", "missing_usage", "disconnect_inflight"} {
		missing := mode != "completed"
		t.Run(mode, func(t *testing.T) {
			var responses atomic.Int32
			r, db, key, subID := membershipAudioFixture(t, "gpt-4o-realtime-preview", model.MembershipRealtimeProfile, model.MembershipUnitTokens, 1, func(w http.ResponseWriter, req *http.Request) {
				upgrade := websocket.Upgrader{}
				conn, err := upgrade.Upgrade(w, req, nil)
				if !assert.NoError(t, err) {
					return
				}
				defer conn.Close()
				assert.Equal(t, "gpt-4o-realtime-preview", req.URL.Query().Get("model"))
				_, configuration, err := conn.ReadMessage()
				if !assert.NoError(t, err) {
					return
				}
				var event struct {
					Type    string      `json:"type"`
					Session interface{} `json:"session"`
				}
				if !assert.NoError(t, common.Unmarshal(configuration, &event)) {
					return
				}
				ack, err := common.Marshal(struct {
					Type    string      `json:"type"`
					Session interface{} `json:"session"`
				}{"session.updated", event.Session})
				if !assert.NoError(t, err) {
					return
				}
				if !assert.NoError(t, conn.WriteMessage(websocket.TextMessage, ack)) {
					return
				}
				for {
					_, body, err := conn.ReadMessage()
					if err != nil {
						return
					}
					var inbound struct {
						Type     string `json:"type"`
						Response *struct {
							Limit int64 `json:"max_output_tokens"`
						} `json:"response"`
					}
					if common.Unmarshal(body, &inbound) != nil {
						return
					}
					if inbound.Type == "response.create" {
						responses.Add(1)
						if mode == "disconnect_inflight" {
							return
						}
						if assert.NotNil(t, inbound.Response) {
							assert.EqualValues(t, 1, inbound.Response.Limit)
						}
						reply := `{"type":"response.done","response":{"id":"mock-response","status":"completed","usage":{"input_tokens":12,"output_tokens":1,"total_tokens":13}}}`
						if missing {
							reply = `{"type":"response.done","response":{"id":"mock-response","status":"completed"}}`
						}
						_ = conn.WriteMessage(websocket.TextMessage, []byte(reply))
					}
				}
			})
			r.GET("/v1/realtime", middleware.TokenAuth(), middleware.Distribute(), func(c *gin.Context) { Relay(c, types.RelayFormatOpenAIRealtime) })
			server := httptest.NewServer(r)
			defer server.Close()
			var before model.User
			require.NoError(t, db.First(&before, 8101).Error)
			header := http.Header{}
			header.Set("Authorization", "Bearer sk-"+key.Key)
			conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/v1/realtime?model=gpt-4o-realtime-preview", header)
			require.NoError(t, err)
			defer conn.Close()
			require.NoError(t, conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"input_audio_buffer.append","audio":"`+base64.StdEncoding.EncodeToString([]byte{0, 0, 1, 0})+`"}`)))
			require.NoError(t, conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"input_audio_buffer.commit"}`)))
			require.NoError(t, conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","response":{"max_output_tokens":99999,"instructions":"must be discarded"}}`)))
			_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
			if !missing {
				_, body, err := conn.ReadMessage()
				require.NoError(t, err)
				assert.Contains(t, string(body), `"input_tokens":12`)
			}
			_, _, _ = conn.ReadMessage() // bounded session closes on exhaustion or unverifiable usage
			var ledger model.SubscriptionChannelRequest
			require.Eventually(t, func() bool {
				return db.Where("user_subscription_id = ?", subID).First(&ledger).Error == nil && (ledger.Status == "settled" || ledger.Status == "pending")
			}, time.Second, 5*time.Millisecond)
			var grant model.SubscriptionChannelQuota
			require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&grant).Error)
			if missing {
				assert.Equal(t, "pending", ledger.Status)
				assert.EqualValues(t, 10000, grant.InputReserved)
				assert.EqualValues(t, 1, grant.OutputReserved)
				assert.Zero(t, grant.OutputUsed)
			} else {
				assert.Equal(t, "settled", ledger.Status)
				assert.EqualValues(t, 12, grant.InputUsed)
				assert.EqualValues(t, 1, grant.OutputUsed)
				assert.Zero(t, grant.InputReserved)
				assert.Zero(t, grant.OutputReserved)
			}
			assert.EqualValues(t, 1, responses.Load())
			var after model.User
			require.NoError(t, db.First(&after, 8101).Error)
			assert.Equal(t, before.Quota, after.Quota)
		})
	}
}
