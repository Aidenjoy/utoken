package channel

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSanitizeUpstreamURL 锁定凭据不落库不变量：个别供应商把密钥放 query
// （如百度 v1 的 access_token），最终地址写入日志前必须脱敏；
// path 与非敏感 query（如任务协议的 Action/Version）原样保留。
func TestSanitizeUpstreamURL(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		raw  string
		want string
	}{
		{
			name: "无 query 原样返回",
			raw:  "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
			want: "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
		},
		{
			name: "凭据 query 脱敏、业务 query 保留",
			raw:  "https://aip.baidubce.com/rpc/2.0/chat?access_token=secret123&Action=CVSync2AsyncSubmitTask&Version=2022-08-31",
			want: "https://aip.baidubce.com/rpc/2.0/chat?Action=CVSync2AsyncSubmitTask&Version=2022-08-31&access_token=%2A%2A%2A",
		},
		{
			name: "全部非敏感原样返回",
			raw:  "https://example.com/v1/videos?Action=Query&Version=2024-01-01",
			want: "https://example.com/v1/videos?Action=Query&Version=2024-01-01",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, sanitizeUpstreamURL(tt.raw))
		})
	}
}

// TestRecordUpstreamRequestURL 校验发送入口把脱敏后的最终地址记入 RelayInfo。
func TestRecordUpstreamRequestURL(t *testing.T) {
	t.Parallel()

	info := &relaycommon.RelayInfo{}
	recordUpstreamRequestURL(info, "https://example.com/v1/chat?api_key=sk-1")
	assert.Equal(t, "https://example.com/v1/chat?api_key=%2A%2A%2A", info.UpstreamRequestURL)

	// nil info 不 panic（防御性调用点）。
	recordUpstreamRequestURL(nil, "https://example.com/v1/chat")
}

func TestProcessHeaderOverride_ChannelTestSkipsPassthroughRules(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: true,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"*": "",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Empty(t, headers)
}

func TestProcessHeaderOverride_ChannelTestSkipsClientHeaderPlaceholder(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: true,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"X-Upstream-Trace": "{client_header:X-Trace-Id}",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	_, ok := headers["x-upstream-trace"]
	require.False(t, ok)
}

func TestProcessHeaderOverride_NonTestKeepsClientHeaderPlaceholder(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: false,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"X-Upstream-Trace": "{client_header:X-Trace-Id}",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "trace-123", headers["x-upstream-trace"])
}

func TestProcessHeaderOverride_RuntimeOverrideIsFinalHeaderMap(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

	info := &relaycommon.RelayInfo{
		IsChannelTest:             false,
		UseRuntimeHeadersOverride: true,
		RuntimeHeadersOverride: map[string]any{
			"x-static":  "runtime-value",
			"x-runtime": "runtime-only",
		},
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"X-Static": "legacy-value",
				"X-Legacy": "legacy-only",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "runtime-value", headers["x-static"])
	require.Equal(t, "runtime-only", headers["x-runtime"])
	_, exists := headers["x-legacy"]
	require.False(t, exists)
}

func TestProcessHeaderOverride_PassthroughSkipsAcceptEncoding(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")
	ctx.Request.Header.Set("Accept-Encoding", "gzip")

	info := &relaycommon.RelayInfo{
		IsChannelTest: false,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"*": "",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "trace-123", headers["x-trace-id"])

	_, hasAcceptEncoding := headers["accept-encoding"]
	require.False(t, hasAcceptEncoding)
}

func TestProcessHeaderOverride_PassHeadersTemplateSetsRuntimeHeaders(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	ctx.Request.Header.Set("Originator", "Codex CLI")
	ctx.Request.Header.Set("Session_id", "sess-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: false,
		RequestHeaders: map[string]string{
			"Originator": "Codex CLI",
			"Session_id": "sess-123",
		},
		ChannelMeta: &relaycommon.ChannelMeta{
			ParamOverride: map[string]any{
				"operations": []any{
					map[string]any{
						"mode":  "pass_headers",
						"value": []any{"Originator", "Session_id", "X-Codex-Beta-Features"},
					},
				},
			},
			HeadersOverride: map[string]any{
				"X-Static": "legacy-value",
			},
		},
	}

	_, err := relaycommon.ApplyParamOverrideWithRelayInfo([]byte(`{"model":"gpt-4.1"}`), info)
	require.NoError(t, err)
	require.True(t, info.UseRuntimeHeadersOverride)
	require.Equal(t, "Codex CLI", info.RuntimeHeadersOverride["originator"])
	require.Equal(t, "sess-123", info.RuntimeHeadersOverride["session_id"])
	_, exists := info.RuntimeHeadersOverride["x-codex-beta-features"]
	require.False(t, exists)
	require.Equal(t, "legacy-value", info.RuntimeHeadersOverride["x-static"])

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "Codex CLI", headers["originator"])
	require.Equal(t, "sess-123", headers["session_id"])
	_, exists = headers["x-codex-beta-features"]
	require.False(t, exists)

	upstreamReq := httptest.NewRequest(http.MethodPost, "https://example.com/v1/responses", nil)
	applyHeaderOverrideToRequest(upstreamReq, headers)
	require.Equal(t, "Codex CLI", upstreamReq.Header.Get("Originator"))
	require.Equal(t, "sess-123", upstreamReq.Header.Get("Session_id"))
	require.Empty(t, upstreamReq.Header.Get("X-Codex-Beta-Features"))
}

// TestDoRequestTransportKeepAliveWhileUpstreamHeadersPending 锁定 504 根因修复：
// 生图上游要等整张图渲染完才发响应头，client.Do 等待期间客户端连接零字节，
// 反向代理读超时会把成功的生成误报成 504。TransportKeepAlive 必须在等待上游
// 响应头期间就发 PING（不受 PingIntervalEnabled 门控），而不是等响应头到达后
// 由 JSON-as-stream 包装器才开始保活。
func TestDoRequestTransportKeepAliveWhileUpstreamHeadersPending(t *testing.T) {
	oldMode := gin.Mode()
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() { gin.SetMode(oldMode) })

	settings := operation_setting.GetGeneralSetting()
	oldEnabled, oldSeconds := settings.PingIntervalEnabled, settings.PingIntervalSeconds
	settings.PingIntervalEnabled = false
	settings.PingIntervalSeconds = 1
	t.Cleanup(func() {
		settings.PingIntervalEnabled, settings.PingIntervalSeconds = oldEnabled, oldSeconds
	})

	// doRequest 走全局 relay HTTP client，测试环境需显式初始化。
	service.InitHttpClient()

	// 上游延迟 3s 才发响应头（模拟出图等待），body 随即一次写完。
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(3 * time.Second)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"url":"https://example.com/final.png"}]}`))
	}))
	t.Cleanup(upstream.Close)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)

	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}, IsStream: true, TransportKeepAlive: true}
	req, err := http.NewRequest(http.MethodPost, upstream.URL, strings.NewReader(`{}`))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")

	resp, err := DoRequest(c, req, info)
	require.NoError(t, err)
	defer resp.Body.Close()

	// PING 间隔 1s、上游 3s 才发响应头：等待期间至少已经发出两次保活，
	// 证明保活覆盖响应头等待阶段；修复前这段时间一个字节都不会写。
	out := recorder.Body.String()
	require.GreaterOrEqual(t, strings.Count(out, ": PING"), 2)
	require.Equal(t, "text/event-stream", recorder.Header().Get("Content-Type"))
	require.Equal(t, http.StatusOK, recorder.Code)
}

// TestDoRequestTransportKeepAliveNotDelayedByAdminPingCadence 锁定线上 504 复发根因：
// PingIntervalSeconds 默认 60s，若传输层保活复用该节奏，首个 PING 与反向代理
// 60s 读超时同时踩线，等待上游响应头期间仍然零字节。TransportKeepAlive 必须
// 把间隔封顶到 DefaultPingInterval（10s）：上游 12s 才发响应头、配置 60s 时，
// 立即首 PING + 10s tick 应至少写出两次保活。
func TestDoRequestTransportKeepAliveNotDelayedByAdminPingCadence(t *testing.T) {
	oldMode := gin.Mode()
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() { gin.SetMode(oldMode) })

	settings := operation_setting.GetGeneralSetting()
	oldEnabled, oldSeconds := settings.PingIntervalEnabled, settings.PingIntervalSeconds
	settings.PingIntervalEnabled = false
	settings.PingIntervalSeconds = 60
	t.Cleanup(func() {
		settings.PingIntervalEnabled, settings.PingIntervalSeconds = oldEnabled, oldSeconds
	})

	service.InitHttpClient()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(12 * time.Second)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"url":"https://example.com/final.png"}]}`))
	}))
	t.Cleanup(upstream.Close)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)

	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}, IsStream: true, TransportKeepAlive: true}
	req, err := http.NewRequest(http.MethodPost, upstream.URL, strings.NewReader(`{}`))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")

	resp, err := DoRequest(c, req, info)
	require.NoError(t, err)
	defer resp.Body.Close()

	out := recorder.Body.String()
	require.GreaterOrEqual(t, strings.Count(out, ": PING"), 2)
}
