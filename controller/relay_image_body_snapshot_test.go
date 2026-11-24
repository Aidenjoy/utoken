package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSaveRelayBodySnapshotPrefersUpstreamResponse 锁定「计费成功但输出参数为空」
// 修复：客户端断开时旁路捕获只有心跳评论，输出侧必须改用 info.ResponseSnapshot
// （上游原始响应）；未填写时仍回退客户端捕获（其余 relay 格式行为不变）。
func TestSaveRelayBodySnapshotPrefersUpstreamResponse(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.LogBody{}))

	newCtx := func(requestId string) (*gin.Context, *relayBodyWriter) {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/pg/images/generations", strings.NewReader(`{"prompt":"draw a cat"}`))
		c.Request.Header.Set("Content-Type", "application/json")
		return c, newRelayBodyWriter(c)
	}

	t.Run("client gone capture only pings", func(t *testing.T) {
		c, w := newCtx("req-img-snapshot-gone")
		_, _ = w.Write([]byte(": PING\n\n"))
		info := &relaycommon.RelayInfo{
			ResponseSnapshot: []byte(`{"data":[{"url":"https://example.com/final.png"}]}`),
		}
		saveRelayBodySnapshot(c, "req-img-snapshot-gone", w, info)

		require.Eventually(t, func() bool {
			_, ok, err := model.GetLogBodyByRequestId("req-img-snapshot-gone")
			return err == nil && ok
		}, time.Second, 10*time.Millisecond)
		body, ok, err := model.GetLogBodyByRequestId("req-img-snapshot-gone")
		require.NoError(t, err)
		require.True(t, ok)
		assert.Contains(t, body.ResponseData, "https://example.com/final.png")
		assert.NotContains(t, body.ResponseData, ": PING")
		assert.Contains(t, body.RequestData, "draw a cat")
	})

	t.Run("no snapshot falls back to capture", func(t *testing.T) {
		c, w := newCtx("req-img-snapshot-live")
		_, _ = w.Write([]byte(`{"data":[{"url":"https://example.com/live.png"}]}`))
		saveRelayBodySnapshot(c, "req-img-snapshot-live", w, nil)

		require.Eventually(t, func() bool {
			_, ok, err := model.GetLogBodyByRequestId("req-img-snapshot-live")
			return err == nil && ok
		}, time.Second, 10*time.Millisecond)
		body, ok, err := model.GetLogBodyByRequestId("req-img-snapshot-live")
		require.NoError(t, err)
		require.True(t, ok)
		assert.Contains(t, body.ResponseData, "https://example.com/live.png")
	})
}