package service

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestShouldCopyUpstreamHeaderWhitelist 守护上游响应头透传白名单：只转发标准功能头
// （Content-Type/Content-Disposition/Content-Encoding、媒体范围与缓存头），
// 丢弃可能暴露上游供应商/渠道指纹的头（Server、Via、供应商 X-*、CDN 追踪、限流计数、
// 重定向 Location、上游 Set-Cookie），并把上游 X-Oneapi-Request-Id 记入上下文供日志、
// 但不回传客户端。该契约被 IOCopyBytesGracefully 与音频 TTS 透传共用，是普通用户
// F12 响应头可见的安全边界。
func TestShouldCopyUpstreamHeaderWhitelist(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())

	forwarded := []string{
		"Content-Type", "Content-Disposition", "Content-Encoding",
		"Content-Range", "Accept-Ranges", "Cache-Control", "Expires", "ETag", "Last-Modified",
	}
	for _, k := range forwarded {
		assert.True(t, ShouldCopyUpstreamHeader(c, k, []string{"v"}), "%s 属于功能必需头，应转发", k)
	}
	// 大小写不敏感：上游头虽已规范化，仍确认非规范写法同样命中白名单。
	assert.True(t, ShouldCopyUpstreamHeader(c, "content-type", []string{"application/json"}))

	blocked := []string{
		"Server", "Via", "X-Amzn-Requestid", "Cf-Ray", "X-Kling-Trace-Id",
		"X-Ratelimit-Limit-Requests", "Location", "Set-Cookie", "Content-Length",
	}
	for _, k := range blocked {
		assert.False(t, ShouldCopyUpstreamHeader(c, k, []string{"v"}), "%s 可能泄露上游指纹，必须丢弃", k)
	}

	// 上游 request-id 记入上下文供日志，但不回传客户端。
	require.False(t, ShouldCopyUpstreamHeader(c, common.RequestIdKey, []string{"upstream-123"}))
	assert.Equal(t, "upstream-123", c.GetString(common.UpstreamRequestIdKey))
}
