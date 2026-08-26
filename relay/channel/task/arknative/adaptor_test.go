package arknative

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const officialSubmitBody = `{
	"model": "doubao-seedance-2-5-260628",
	"content": [
		{"type": "text", "text": "一只橘猫在草地上奔跑"},
		{"type": "image_url", "image_url": {"url": "https://example.com/ref.png"}, "role": "reference_image"},
		{"type": "video_url", "video_url": {"url": "https://example.com/ref.mp4"}, "role": "reference_video"}
	],
	"generate_audio": true,
	"ratio": "16:9",
	"duration": 15,
	"resolution": "1080p",
	"omni_reference_task_type": "reference",
	"output_format": "mov"
}`

func newTestContext(t *testing.T, method, path, body string) *gin.Context {
	t.Helper()
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(method, path, strings.NewReader(body))
	return c
}

// 官方格式请求体除 model 按映射替换外必须原样透传，
// 包括官方新参数（output_format / omni_reference_task_type）与 content 数组。
func TestBuildRequestBodyPassthroughWithModelMapping(t *testing.T) {
	a := &TaskAdaptor{}
	a.rawBody = []byte(officialSubmitBody)

	info := &relaycommon.RelayInfo{
		ChannelMeta:   &relaycommon.ChannelMeta{UpstreamModelName: "mapped-upstream-model"},
		TaskRelayInfo: &relaycommon.TaskRelayInfo{},
	}
	reader, err := a.BuildRequestBody(nil, info)
	require.NoError(t, err)

	out, err := io.ReadAll(reader)
	require.NoError(t, err)

	var parsed map[string]any
	require.NoError(t, common.Unmarshal(out, &parsed))

	assert.Equal(t, "mapped-upstream-model", parsed["model"])
	assert.Equal(t, "mov", parsed["output_format"])
	assert.Equal(t, "reference", parsed["omni_reference_task_type"])
	assert.Equal(t, true, parsed["generate_audio"])
	assert.Equal(t, "16:9", parsed["ratio"])
	assert.Equal(t, float64(15), parsed["duration"])
	content, ok := parsed["content"].([]any)
	require.True(t, ok)
	require.Len(t, content, 3)
	first, _ := content[1].(map[string]any)
	assert.Equal(t, "reference_image", first["role"])
}

func TestValidateRequestAndSetAction(t *testing.T) {
	tests := []struct {
		name    string
		body    string
		wantErr bool
	}{
		{
			name:    "official body accepted",
			body:    officialSubmitBody,
			wantErr: false,
		},
		{
			name:    "missing model rejected",
			body:    `{"content": [{"type": "text", "text": "x"}]}`,
			wantErr: true,
		},
		{
			name:    "oversized duration rejected",
			body:    `{"model": "m", "duration": 999999}`,
			wantErr: true,
		},
		{
			name:    "negative duration rejected",
			body:    `{"model": "m", "duration": -1}`,
			wantErr: true,
		},
		{
			name:    "malformed json rejected",
			body:    `{`,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := newTestContext(t, http.MethodPost, "/api/v3/contents/generations/tasks", tt.body)
			a := &TaskAdaptor{}
			info := &relaycommon.RelayInfo{TaskRelayInfo: &relaycommon.TaskRelayInfo{}}

			taskErr := a.ValidateRequestAndSetAction(c, info)
			if tt.wantErr {
				require.NotNil(t, taskErr)
				assert.Equal(t, http.StatusBadRequest, taskErr.StatusCode)
				return
			}
			require.Nil(t, taskErr)
			// 计费相关字段已从原始 body 提取
			assert.Equal(t, "1080p", a.resolution)
			assert.True(t, a.hasVideo)
		})
	}
}

func TestBuildRequestURL(t *testing.T) {
	tests := []struct {
		baseURL string
		want    string
	}{
		// 火山官方域名：任务 API 固定挂在 /api/v3，/v1（OpenAI 兼容聊天路径）或裸域名归一
		{"https://ark.cn-beijing.volces.com/api/v3", "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"},
		{"https://ark.cn-beijing.volces.com/v1", "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"},
		{"https://ark.cn-beijing.volces.com", "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"},
		{"https://ark.ap-southeast.bytepluses.com/v1", "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks"},
		// 中转站域名保持所见即所发，原样拼版本路径
		{"https://ai-tokenhub.com/api/v2", "https://ai-tokenhub.com/api/v2/contents/generations/tasks"},
		{"https://ai.ctaigw.cn/v1", "https://ai.ctaigw.cn/v1/contents/generations/tasks"},
		// 末尾斜杠不影响拼接
		{"https://ark.cn-beijing.volces.com/api/v3/", "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"},
	}

	for _, tt := range tests {
		a := &TaskAdaptor{baseURL: tt.baseURL}
		got, err := a.BuildRequestURL(nil)
		require.NoError(t, err)
		assert.Equal(t, tt.want, got)
	}
}

// 提交响应必须原样透传，且公开任务 ID 采用上游 ID（客户端用它查询）。
func TestDoResponsePassthrough(t *testing.T) {
	rec := httptest.NewRecorder()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v3/contents/generations/tasks", nil)

	upstreamBody := `{"id":"cgt-20260817204306-fskqb"}`
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(upstreamBody)),
	}

	a := &TaskAdaptor{}
	info := &relaycommon.RelayInfo{TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
	taskID, taskData, taskErr := a.DoResponse(c, resp, info)

	require.Nil(t, taskErr)
	assert.Equal(t, "cgt-20260817204306-fskqb", taskID)
	assert.Equal(t, "cgt-20260817204306-fskqb", info.PublicTaskID)
	assert.JSONEq(t, upstreamBody, rec.Body.String())
	assert.JSONEq(t, upstreamBody, string(taskData))
}

func TestDoResponseUpstreamError(t *testing.T) {
	rec := httptest.NewRecorder()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v3/contents/generations/tasks", nil)

	resp := &http.Response{
		StatusCode: http.StatusBadRequest,
		Body:       io.NopCloser(strings.NewReader(`{"error":{"code":"InvalidParameter","message":"duration out of range"}}`)),
	}

	a := &TaskAdaptor{}
	info := &relaycommon.RelayInfo{TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
	_, _, taskErr := a.DoResponse(c, resp, info)

	require.NotNil(t, taskErr)
	assert.Equal(t, http.StatusBadRequest, taskErr.StatusCode)
	require.NotNil(t, taskErr.Error)
	assert.Contains(t, taskErr.Error.Error(), "duration out of range")
}
