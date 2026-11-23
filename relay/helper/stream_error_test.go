package helper

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// TestStreamErrorEventAfterCommittedPing 锁定已提交 SSE 流的失败补发契约：
// keepalive PING 写出后响应即已提交，状态码与 Content-Type 不可再改，relay
// 错误路径只能补发 event: error + [DONE]（前端据此抛上游原文），而不是追加
// 一段会被流客户端忽略的 JSON 错误体、让页面误报「未返回图片」。
func TestStreamErrorEventAfterCommittedPing(t *testing.T) {
	oldMode := gin.Mode()
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() { gin.SetMode(oldMode) })

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)

	require.False(t, IsStreamCommitted(c))
	SetEventStreamHeaders(c)
	// 只设置头部映射不算提交，第一个字节写出后才算。
	require.False(t, IsStreamCommitted(c))
	require.NoError(t, PingData(c))
	require.True(t, IsStreamCommitted(c))

	StreamErrorEvent(c, "image area must be at most 4624220 pixels")
	out := recorder.Body.String()
	require.Contains(t, out, ": PING")
	require.Contains(t, out, "event: error")
	require.Contains(t, out, `"message":"image area must be at most 4624220 pixels"`)
	require.Contains(t, out, `"type":"upstream_error"`)
	require.Contains(t, out, "data: [DONE]")
	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, "text/event-stream", recorder.Header().Get("Content-Type"))
}
