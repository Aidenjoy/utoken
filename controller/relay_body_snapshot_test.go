package controller

import (
	"bytes"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestRelayBodyWriterCapsSnapshotAtFirstMB 锁定 capped-tee 的核心安全边界：写给客户端的
// 响应字节全部透传（客户端拿到完整响应），但旁路快照缓冲最多只保留前 maxRelayBodySnapshotBytes
// 字节——超过 1MB 的部分不再入缓冲，杜绝大响应（长上下文/大文件）撑爆内存或落库溢出。
func TestRelayBodyWriterCapsSnapshotAtFirstMB(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	bw := newRelayBodyWriter(c)

	// 先写满 1MB 的 'a'，再写 'b'：快照应只保留前 1MB（全是 'a'，不含 'b'）
	fill := bytes.Repeat([]byte("a"), maxRelayBodySnapshotBytes)
	n, err := bw.Write(fill)
	require.NoError(t, err)
	require.Equal(t, len(fill), n)

	tail := bytes.Repeat([]byte("b"), 1024)
	n, err = bw.Write(tail)
	require.NoError(t, err)
	require.Equal(t, len(tail), n) // 客户端仍拿到完整 tail

	assert.Equal(t, maxRelayBodySnapshotBytes, bw.body.Len())
	assert.NotContains(t, bw.body.String(), "b")
	// 底层客户端收到全部字节（透传未被裁剪）
	assert.Equal(t, maxRelayBodySnapshotBytes+len(tail), w.Body.Len())
}

// TestNewRelayBodyWriterWrapsContextWriter 锁定入口包装：newRelayBodyWriter 把 c.Writer
// 换成捕获器后，任何经由 c.Writer 写给客户端的字节都会被旁路复制进快照缓冲。
func TestNewRelayBodyWriterWrapsContextWriter(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	bw := newRelayBodyWriter(c)

	n, err := c.Writer.Write([]byte("via-context"))
	require.NoError(t, err)
	require.Equal(t, len("via-context"), n)
	assert.Equal(t, "via-context", bw.body.String())
	assert.Equal(t, "via-context", w.Body.String())
}

// TestRelayBodyWriterPartialCaptureAndWriteString 锁定跨边界单次写入只保留可容纳的前缀，
// 且 WriteString 与 Write 走同一 capture 路径；缓冲写满后快照停止增长，客户端仍收全量。
func TestRelayBodyWriterPartialCaptureAndWriteString(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	// 直接构造小上限，精确验证边界（避免依赖 1MB 常量）
	bw := &relayBodyWriter{
		ResponseWriter: c.Writer,
		body:           bytes.NewBuffer(nil),
		maxSize:        10,
	}

	// WriteString 超过上限：只保留前 10 字节
	n, err := bw.WriteString("0123456789abcdef") // 16 bytes > cap 10
	require.NoError(t, err)
	require.Equal(t, len("0123456789abcdef"), n)
	assert.Equal(t, "0123456789", bw.body.String())

	// 已满：快照不再增长，但客户端仍收到全部
	n, err = bw.Write([]byte("XYZ"))
	require.NoError(t, err)
	require.Equal(t, 3, n)
	assert.Equal(t, "0123456789", bw.body.String())
	assert.Equal(t, "0123456789abcdefXYZ", w.Body.String())
}

// TestTruncateRelaySnapshot 锁定落库前的截断：未超限原样返回；超限截到上限并追加
// ...(truncated) 标记，保留可用前缀（长上下文仍能看出开头内容）。
func TestTruncateRelaySnapshot(t *testing.T) {
	// 未超限：原样返回
	small := []byte("hello")
	assert.Equal(t, small, truncateRelaySnapshot(small))

	// 恰好等于上限：原样返回（不加标记）
	exact := bytes.Repeat([]byte("x"), maxRelayBodySnapshotBytes)
	assert.Equal(t, maxRelayBodySnapshotBytes, len(truncateRelaySnapshot(exact)))
	assert.NotContains(t, string(truncateRelaySnapshot(exact)), relaySnapshotTruncMark)

	// 超限：截断到上限并追加标记，前缀内容保留
	over := bytes.Repeat([]byte("y"), maxRelayBodySnapshotBytes+100)
	got := truncateRelaySnapshot(over)
	assert.Equal(t, maxRelayBodySnapshotBytes+len(relaySnapshotTruncMark), len(got))
	assert.True(t, bytes.HasSuffix(got, []byte(relaySnapshotTruncMark)))
	assert.True(t, bytes.HasPrefix(got, bytes.Repeat([]byte("y"), 100)))
}

// TestSnapshotRelayRequestBodySkipsNonJSON 锁定「传入参数」抓取只认 application/json：
// 非 JSON（如 multipart 直传二进制）返回 nil，不入库。
func TestSnapshotRelayRequestBodySkipsNonJSON(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("non-json content type is skipped", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		req := httptest.NewRequest("POST", "/v1/images/generations", strings.NewReader("binary-bytes"))
		req.Header.Set("Content-Type", "multipart/form-data; boundary=xyz")
		c.Request = req
		assert.Nil(t, snapshotRelayRequestBody(c))
	})
}
