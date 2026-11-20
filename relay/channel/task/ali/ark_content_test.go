package ali

import (
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

func newArkTestContext(t *testing.T, body string) *gin.Context {
	t.Helper()
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/video/generations", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	return c
}

// Playground 方舟 content 协议体经 ali 渠道（type=17）提交时，Validate 必须
// 先转换为统一协议体：prompt 从 content 文本提取，不得误报 prompt is required。
func TestValidateArkContentBodyConverted(t *testing.T) {
	body := `{
		"model": "wan3.0-video",
		"content": [
			{"type": "text", "text": "一只猫在草地上奔跑"},
			{"type": "image_url", "image_url": {"url": "https://example.com/ref.png"}, "role": "reference_image"}
		],
		"resolution": "480p",
		"duration": 5,
		"generate_audio": true,
		"watermark": false
	}`
	c := newArkTestContext(t, body)
	a := &TaskAdaptor{}
	taskErr := a.ValidateRequestAndSetAction(c, testRelayInfo())
	require.Nil(t, taskErr)

	req, err := relaycommon.GetTaskRequest(c)
	require.NoError(t, err)
	assert.Equal(t, "一只猫在草地上奔跑", req.Prompt)
	assert.Equal(t, "480P", req.Size)
	assert.Equal(t, 5, req.Duration)

	// 转换后的统一体经 convertToAliRequest 必须产出 wan3 官方 media 数组
	aliReq, err := a.convertToAliRequest(testRelayInfo(), req)
	require.NoError(t, err)
	assert.Equal(t, []AliVideoMedia{
		{Type: "reference_image", URL: "https://example.com/ref.png"},
	}, aliReq.Input.Media)
	assert.Empty(t, aliReq.Input.ImgURL)
	assert.Equal(t, "480P", aliReq.Parameters.Resolution)
	require.NotNil(t, aliReq.Parameters.Audio)
	assert.True(t, *aliReq.Parameters.Audio)

	out, err := common.Marshal(aliReq)
	require.NoError(t, err)
	assert.NotContains(t, string(out), `"img_url"`)
	assert.NotContains(t, string(out), `"content"`)
}

// wan3 分辨率白名单与参考视频支持：4k 提前 400；参考视频进入 media 数组。
func TestValidateWan3ResolutionAndReferenceVideo(t *testing.T) {
	t.Run("4k rejected", func(t *testing.T) {
		body := `{"model":"wan3.0-video","content":[{"type":"text","text":"p"}],"resolution":"4k"}`
		a := &TaskAdaptor{}
		taskErr := a.ValidateRequestAndSetAction(newArkTestContext(t, body), testRelayInfo())
		require.NotNil(t, taskErr)
		assert.Equal(t, http.StatusBadRequest, taskErr.StatusCode)
	})

	t.Run("reference video converted to media", func(t *testing.T) {
		body := `{"model":"wan3.0-video","content":[{"type":"text","text":"p"},{"type":"video_url","video_url":{"url":"https://example.com/ref.mp4"},"role":"reference_video"}],"duration":5}`
		c := newArkTestContext(t, body)
		a := &TaskAdaptor{}
		require.Nil(t, a.ValidateRequestAndSetAction(c, testRelayInfo()))
		req, err := relaycommon.GetTaskRequest(c)
		require.NoError(t, err)
		aliReq, err := a.convertToAliRequest(testRelayInfo(), req)
		require.NoError(t, err)
		assert.Equal(t, []AliVideoMedia{
			{Type: "reference_video", URL: "https://example.com/ref.mp4"},
		}, aliReq.Input.Media)
	})

	t.Run("legacy model rejects reference video", func(t *testing.T) {
		body := `{"model":"wan2.6-i2v","content":[{"type":"text","text":"p"},{"type":"video_url","video_url":{"url":"https://example.com/ref.mp4"}}]}`
		a := &TaskAdaptor{}
		taskErr := a.ValidateRequestAndSetAction(newArkTestContext(t, body), testRelayInfo())
		require.NotNil(t, taskErr)
		assert.Equal(t, http.StatusBadRequest, taskErr.StatusCode)
	})
}

// legacy wan2 模型的方舟 content 转换保持 img_url/audio_url 旧协议，
// 不得误发 wan3 media 数组或 ratio 参数。
func TestArkContentLegacyModelKeepsImgURL(t *testing.T) {
	body := `{
		"model": "wan2.5-i2v-preview",
		"content": [
			{"type": "text", "text": "p"},
			{"type": "image_url", "image_url": {"url": "https://example.com/first.png"}},
			{"type": "audio_url", "audio_url": {"url": "https://example.com/a.mp3"}}
		],
		"resolution": "720p",
		"ratio": "16:9",
		"duration": 5
	}`
	c := newArkTestContext(t, body)
	a := &TaskAdaptor{}
	require.Nil(t, a.ValidateRequestAndSetAction(c, testRelayInfo()))
	req, err := relaycommon.GetTaskRequest(c)
	require.NoError(t, err)
	aliReq, err := a.convertToAliRequest(testRelayInfo(), req)
	require.NoError(t, err)
	assert.Equal(t, "https://example.com/first.png", aliReq.Input.ImgURL)
	assert.Equal(t, "https://example.com/a.mp3", aliReq.Input.AudioURL)
	assert.Empty(t, aliReq.Input.Media)
	assert.Empty(t, aliReq.Parameters.Ratio, "ratio 仅 wan3 支持")
	assert.Equal(t, "720P", aliReq.Parameters.Resolution)
}

// wan3 智能时长 -1 透传上游，预扣按 5 秒估算；metadata 越界时长必须拒绝。
func TestWan3SmartDurationAndBounds(t *testing.T) {
	t.Run("smart duration passthrough and estimate", func(t *testing.T) {
		body := `{"model":"wan3.0-video","content":[{"type":"text","text":"p"}],"duration":-1}`
		c := newArkTestContext(t, body)
		a := &TaskAdaptor{}
		require.Nil(t, a.ValidateRequestAndSetAction(c, testRelayInfo()))
		req, err := relaycommon.GetTaskRequest(c)
		require.NoError(t, err)
		aliReq, err := a.convertToAliRequest(testRelayInfo(), req)
		require.NoError(t, err)
		assert.Equal(t, -1, aliReq.Parameters.Duration)
		assert.Equal(t, map[string]float64{"seconds": 5}, a.EstimateBilling(c, testRelayInfo()))
	})

	t.Run("metadata oversized duration rejected", func(t *testing.T) {
		req := relaycommon.TaskSubmitReq{
			Model:  "wan3.0-video",
			Prompt: "p",
			Metadata: map[string]interface{}{
				"parameters": map[string]interface{}{"duration": 999999},
			},
		}
		a := &TaskAdaptor{}
		_, err := a.convertToAliRequest(testRelayInfo(), req)
		require.Error(t, err)
	})

	t.Run("duration above wan3 limit rejected", func(t *testing.T) {
		req := relaycommon.TaskSubmitReq{
			Model:    "wan3.0-video",
			Prompt:   "p",
			Duration: 31,
		}
		a := &TaskAdaptor{}
		_, err := a.convertToAliRequest(testRelayInfo(), req)
		require.Error(t, err)
	})
}

// base_url 尾部版本路径后缀必须归一化，提交与查询都不得拼出双重路径。
func TestNormalizeWanBaseURL(t *testing.T) {
	tests := []struct {
		baseURL string
		want    string
	}{
		{"https://llm-x.cn-beijing.maas.aliyuncs.com/api", "https://llm-x.cn-beijing.maas.aliyuncs.com"},
		{"https://llm-x.cn-beijing.maas.aliyuncs.com/api/v1", "https://llm-x.cn-beijing.maas.aliyuncs.com"},
		{"https://dashscope.aliyuncs.com/api/v1/", "https://dashscope.aliyuncs.com"},
		{"https://dashscope.aliyuncs.com/", "https://dashscope.aliyuncs.com"},
		{"https://relay.example.com/dashscope", "https://relay.example.com/dashscope"},
	}
	for _, tt := range tests {
		assert.Equal(t, tt.want, NormalizeWanBaseURL(tt.baseURL))
	}

	a := &TaskAdaptor{baseURL: "https://llm-x.cn-beijing.maas.aliyuncs.com/api"}
	got, err := a.BuildRequestURL(testRelayInfo())
	require.NoError(t, err)
	assert.Equal(t, "https://llm-x.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis", got)
}
