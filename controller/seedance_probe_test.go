package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 上游真实的 succeeded 响应（seedance 2.0 / 4K），作为保真比较的基准。
const seedanceProbeUpstreamSucceeded = `{
    "id": "cgt-20261016173418-sl9rf",
    "model": "doubao-seedance-2-0-mini-260128",
    "status": "succeeded",
    "content": {
        "video_url": "https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/doubao-seedance-2-0-mini/abc.mp4?X-Tos-Expires=86400"
    },
    "usage": {
        "completion_tokens": 785700,
        "total_tokens": 785700
    },
    "created_at": 1792143258,
    "updated_at": 1792143501,
    "seed": 6156,
    "resolution": "4k",
    "ratio": "16:9",
    "duration": 4,
    "framespersecond": 24,
    "service_tier": "default",
    "execution_expires_after": 172800,
    "generate_audio": true,
    "draft": false,
    "priority": 0,
    "output_format": "mp4"
}`

func newSeedanceProbeContext() (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/probe/seedance/contents/generations/tasks/x", nil)
	return c, w
}

// TestSeedanceProbeWritePreservesUpstreamFields 锁定探针的核心承诺：除了把
// content.video_url 换成转存地址、附加 _probe 诊断块之外，上游响应的每一个
// 字段都原样透传。model 与 usage 必须是上游真实值——探针不得编造任何一个字段，
// 否则客户端拿到的就是一份与实际调用不符的账单凭据。
func TestSeedanceProbeWritePreservesUpstreamFields(t *testing.T) {
	cfg := seedanceProbeConfig{targetModel: "doubao-seedance-2-0-mini"}
	rehosted := "https://my-bucket.tos-cn-beijing.volces.com/2026-10-22/1_seedance-probe/cgt.mp4"

	c, w := newSeedanceProbeContext()
	seedanceProbeWrite(c, http.StatusOK, []byte(seedanceProbeUpstreamSucceeded), rehosted,
		newSeedanceProbe(cfg, "doubao-seedance-2.0", "succeeded"))

	require.Equal(t, http.StatusOK, w.Code)

	var upstream, out map[string]any
	require.NoError(t, common.Unmarshal([]byte(seedanceProbeUpstreamSucceeded), &upstream))
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &out))

	outProbe, ok := out["_probe"].(map[string]any)
	require.True(t, ok, "_probe must be attached")
	assert.Equal(t, "doubao-seedance-2.0", outProbe["requested_model"])
	assert.Equal(t, "doubao-seedance-2-0-mini", outProbe["target_model"])
	// upstream_model 取自上游响应本身：跑的是 mini，就报 mini 的真实 ID。
	assert.Equal(t, "doubao-seedance-2-0-mini-260128", outProbe["upstream_model"])

	outContent, ok := out["content"].(map[string]any)
	require.True(t, ok, "content must stay an object")
	assert.Equal(t, rehosted, outContent["video_url"], "video_url is the only field the probe may rewrite")

	upstreamContent, ok := upstream["content"].(map[string]any)
	require.True(t, ok)

	// 还原被改写的字段、摘掉附加块之后，整份文档必须与上游逐字段相等。
	outContent["video_url"] = upstreamContent["video_url"]
	delete(out, "_probe")
	assert.Equal(t, upstream, out)
}

// TestSeedanceProbeWriteKeepsUpstreamURLWhenRehostFails 校验降级路径：转存失败时
// video_url 必须保持上游原值（24 小时内仍可下载），失败原因写进 _probe，
// 而不是返回一个客户端拿不到内容的空地址。
func TestSeedanceProbeWriteKeepsUpstreamURLWhenRehostFails(t *testing.T) {
	cfg := seedanceProbeConfig{targetModel: "doubao-seedance-2-0-mini"}

	c, w := newSeedanceProbeContext()
	probe := newSeedanceProbe(cfg, "doubao-seedance-2.5", "succeeded")
	probe["rehosted"] = false
	probe["rehost_error"] = "TOS not configured"
	seedanceProbeWrite(c, http.StatusOK, []byte(seedanceProbeUpstreamSucceeded), "", probe)

	var out map[string]any
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &out))

	outContent, ok := out["content"].(map[string]any)
	require.True(t, ok)
	assert.Contains(t, outContent["video_url"], "ark-acg-cn-beijing.tos-cn-beijing.volces.com")

	outProbe, ok := out["_probe"].(map[string]any)
	require.True(t, ok, "_probe must be attached")
	assert.Equal(t, false, outProbe["rehosted"])
	assert.Equal(t, "TOS not configured", outProbe["rehost_error"])
	assert.Equal(t, "doubao-seedance-2.5", outProbe["requested_model"])
	assert.Equal(t, "doubao-seedance-2-0-mini", outProbe["target_model"])
	// upstream_model 取自上游响应本身，不是客户端请求的那个名字。
	assert.Equal(t, "doubao-seedance-2-0-mini-260128", outProbe["upstream_model"])
}

// TestSeedanceProbeEnabled 锁定「不影响线上」这个前提：开关与独立 Ark key
// 必须同时就位路由才会注册，缺一个都视为关闭。
func TestSeedanceProbeEnabled(t *testing.T) {
	tests := []struct {
		name    string
		enabled string
		arkKey  string
		want    bool
	}{
		{"off by default", "", "", false},
		{"flag without key stays off", "true", "", false},
		{"key without flag stays off", "", "ark-key", false},
		{"flag and key turns it on", "true", "ark-key", true},
		{"blank key stays off", "true", "   ", false},
		{"explicit false stays off", "false", "ark-key", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("SEEDANCE_PROBE_ENABLED", tc.enabled)
			t.Setenv("SEEDANCE_PROBE_ARK_KEY", tc.arkKey)
			assert.Equal(t, tc.want, SeedanceProbeEnabled())
		})
	}
}
