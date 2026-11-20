package wannative

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/config"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const officialWanBody = `{
	"model": "wan3.0-video",
	"input": {
		"prompt": "一只小猫在月光下的屋顶上奔跑，城市的霓虹灯在远处闪烁，电影级画质，流畅运镜。"
	},
	"parameters": {
		"resolution": "480P",
		"ratio": "adaptive",
		"duration": 5
	}
}`

func newTestContext(t *testing.T, method, path, body string) *gin.Context {
	t.Helper()
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(method, path, strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	return c
}

func newWanRelayInfo() *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		ChannelMeta:   &relaycommon.ChannelMeta{},
		TaskRelayInfo: &relaycommon.TaskRelayInfo{},
	}
}

// wanBillingFixture 注入 wan 按秒计费配置：1080p 档 $0.25/s，480p 档 $0.1/s，720p 未配置。
func wanBillingFixture(t *testing.T) {
	t.Helper()
	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		saved[key] = value
		return nil
	}))
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
	})
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode":    `{"wan-settle-model":"wan"}`,
		"billing_setting.wan_config":      `{"wan-settle-model":"{\"1080p\":0.25,\"480p\":0.1}"}`,
		"group_ratio_setting.group_ratio": `{"default":1}`,
	}))
}

// 官方请求体除 model 按映射替换外必须原样透传（所见即所发，不注入 watermark 等参数）。
func TestBuildRequestBodyPassthroughWithModelMapping(t *testing.T) {
	a := &TaskAdaptor{}
	a.rawBody = []byte(officialWanBody)

	info := newWanRelayInfo()
	info.UpstreamModelName = "mapped-upstream-model"
	reader, err := a.BuildRequestBody(nil, info)
	require.NoError(t, err)
	out, err := io.ReadAll(reader)
	require.NoError(t, err)

	var parsed map[string]any
	require.NoError(t, common.Unmarshal(out, &parsed))
	assert.Equal(t, "mapped-upstream-model", parsed["model"])
	input, _ := parsed["input"].(map[string]any)
	require.NotNil(t, input)
	assert.Contains(t, input["prompt"], "一只小猫")
	params, _ := parsed["parameters"].(map[string]any)
	require.NotNil(t, params)
	assert.Equal(t, "480P", params["resolution"])
	assert.Equal(t, "adaptive", params["ratio"])
	assert.Equal(t, float64(5), params["duration"])
	_, hasWatermark := params["watermark"]
	assert.False(t, hasWatermark, "官方体透传不得注入 watermark")

	// 未配置模型映射时 model 字段保持原样
	a2 := &TaskAdaptor{rawBody: []byte(officialWanBody)}
	reader, err = a2.BuildRequestBody(nil, newWanRelayInfo())
	require.NoError(t, err)
	out, err = io.ReadAll(reader)
	require.NoError(t, err)
	require.NoError(t, common.Unmarshal(out, &parsed))
	assert.Equal(t, "wan3.0-video", parsed["model"])
}

func TestValidateOfficialBody(t *testing.T) {
	tests := []struct {
		name    string
		body    string
		wantErr bool
	}{
		{"official body accepted", officialWanBody, false},
		{"missing model rejected", `{"input":{"prompt":"p"}}`, true},
		{"missing input rejected", `{"model":"wan3.0-video"}`, true},
		{"empty input rejected", `{"model":"wan3.0-video","input":{"prompt":"  "}}`, true},
		{"img_url only accepted", `{"model":"wan3.0-video","input":{"img_url":"https://example.com/a.png"}}`, false},
		{"duration -1 accepted (smart duration)", `{"model":"m","input":{"prompt":"p"},"parameters":{"duration":-1}}`, false},
		{"oversized duration rejected", `{"model":"m","input":{"prompt":"p"},"parameters":{"duration":999999}}`, true},
		{"negative duration below -1 rejected", `{"model":"m","input":{"prompt":"p"},"parameters":{"duration":-2}}`, true},
		{"malformed json rejected", `{`, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := newTestContext(t, http.MethodPost, "/api/v1/services/aigc/video-generation/video-synthesis", tt.body)
			a := &TaskAdaptor{}
			taskErr := a.ValidateRequestAndSetAction(c, newWanRelayInfo())
			if tt.wantErr {
				require.NotNil(t, taskErr)
				assert.Equal(t, http.StatusBadRequest, taskErr.StatusCode)
				return
			}
			require.Nil(t, taskErr)
			assert.False(t, a.arkContent)
		})
	}
}

// wan 计费模式下显式指定未配置单价的分辨率档必须提前 400；
// 归一化档写入 info.WanResolution 供预扣按档计费，未指定留空按最高档兜底。
func TestValidateWanResolution(t *testing.T) {
	wanBillingFixture(t)

	tests := []struct {
		name       string
		body       string
		wantErr    bool
		wantRes    string
		wantOrigin string
	}{
		{
			name:    "configured tier normalized",
			body:    `{"model":"wan-settle-model","input":{"prompt":"p"},"parameters":{"resolution":"480P"}}`,
			wantRes: "480p",
		},
		{
			name:    "bare number resolution normalized",
			body:    `{"model":"wan-settle-model","input":{"prompt":"p"},"parameters":{"resolution":"1080"}}`,
			wantRes: "1080p",
		},
		{
			name:    "unconfigured tier rejected",
			body:    `{"model":"wan-settle-model","input":{"prompt":"p"},"parameters":{"resolution":"720p"}}`,
			wantErr: true,
		},
		{
			name:    "unspecified resolution left empty",
			body:    `{"model":"wan-settle-model","input":{"prompt":"p"}}`,
			wantRes: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := newTestContext(t, http.MethodPost, "/api/v1/services/aigc/video-generation/video-synthesis", tt.body)
			a := &TaskAdaptor{}
			info := newWanRelayInfo()
			info.OriginModelName = "wan-settle-model"
			taskErr := a.ValidateRequestAndSetAction(c, info)
			if tt.wantErr {
				require.NotNil(t, taskErr)
				assert.Equal(t, http.StatusBadRequest, taskErr.StatusCode)
				return
			}
			require.Nil(t, taskErr)
			assert.Equal(t, tt.wantRes, a.resolution)
			assert.Equal(t, tt.wantRes, info.WanResolution)
		})
	}
}

// Playground 方舟 content 协议体必须转换为 wan3 官方 input.media 数组协议：
// 首尾帧模式 → first_frame/last_frame；参考模式 → reference_image/reference_video/
// reference_audio；不得残留 wan2 legacy 字段（img_url/last_frame_url/audio_url）。
func TestArkContentConvertedToOfficial(t *testing.T) {
	t.Run("首尾帧模式", func(t *testing.T) {
		body := `{
			"model": "wan3.0-video",
			"content": [
				{"type": "text", "text": "一只小猫在月光下的屋顶上奔跑"},
				{"type": "image_url", "image_url": {"url": "https://example.com/first.png"}, "role": "first_frame"},
				{"type": "image_url", "image_url": {"url": "https://example.com/last.png"}, "role": "last_frame"}
			],
			"resolution": "480p",
			"ratio": "adaptive",
			"duration": 5,
			"generate_audio": true
		}`
		c := newTestContext(t, http.MethodPost, "/v1/video/generations", body)
		a := &TaskAdaptor{}
		info := newWanRelayInfo()
		info.UpstreamModelName = "mapped-model"
		info.IsModelMapped = true
		require.Nil(t, a.ValidateRequestAndSetAction(c, info))
		assert.True(t, a.arkContent)
		assert.Equal(t, "480p", a.resolution)

		reader, err := a.BuildRequestBody(c, info)
		require.NoError(t, err)
		out, err := io.ReadAll(reader)
		require.NoError(t, err)

		var parsed map[string]any
		require.NoError(t, common.Unmarshal(out, &parsed))
		assert.Equal(t, "mapped-model", parsed["model"])
		_, hasContent := parsed["content"]
		assert.False(t, hasContent, "转换后不得残留方舟 content 数组")
		input, _ := parsed["input"].(map[string]any)
		require.NotNil(t, input)
		assert.Equal(t, "一只小猫在月光下的屋顶上奔跑", input["prompt"])
		assert.Equal(t, []any{
			map[string]any{"type": "first_frame", "url": "https://example.com/first.png"},
			map[string]any{"type": "last_frame", "url": "https://example.com/last.png"},
		}, input["media"])
		for _, legacy := range []string{"img_url", "last_frame_url", "audio_url"} {
			_, has := input[legacy]
			assert.False(t, has, "wan3 不得发送 legacy 字段 %s", legacy)
		}
		params, _ := parsed["parameters"].(map[string]any)
		require.NotNil(t, params)
		assert.Equal(t, "480P", params["resolution"])
		assert.Equal(t, "adaptive", params["ratio"])
		assert.Equal(t, float64(5), params["duration"])
		assert.Equal(t, true, params["audio"])
		// watermark 未显式传时不注入 true（omitempty 丢弃 false，wan3 上游默认即无水印）
		assert.NotEqual(t, true, params["watermark"], "未显式传 watermark 不得盖水印")
	})

	t.Run("参考模式含参考视频", func(t *testing.T) {
		body := `{
			"model": "wan3.0-video",
			"content": [
				{"type": "text", "text": "参考图1的风格生成视频"},
				{"type": "image_url", "image_url": {"url": "https://example.com/ref.png"}, "role": "reference_image"},
				{"type": "video_url", "video_url": {"url": "https://example.com/ref.mp4"}, "role": "reference_video"},
				{"type": "audio_url", "audio_url": {"url": "https://example.com/ref.mp3"}, "role": "reference_audio"}
			],
			"resolution": "720p",
			"duration": -1
		}`
		c := newTestContext(t, http.MethodPost, "/v1/video/generations", body)
		a := &TaskAdaptor{}
		info := newWanRelayInfo()
		require.Nil(t, a.ValidateRequestAndSetAction(c, info))

		reader, err := a.BuildRequestBody(c, info)
		require.NoError(t, err)
		out, err := io.ReadAll(reader)
		require.NoError(t, err)

		var parsed map[string]any
		require.NoError(t, common.Unmarshal(out, &parsed))
		input, _ := parsed["input"].(map[string]any)
		require.NotNil(t, input)
		assert.Equal(t, []any{
			map[string]any{"type": "reference_image", "url": "https://example.com/ref.png"},
			map[string]any{"type": "reference_video", "url": "https://example.com/ref.mp4"},
			map[string]any{"type": "reference_audio", "url": "https://example.com/ref.mp3"},
		}, input["media"])
		params, _ := parsed["parameters"].(map[string]any)
		require.NotNil(t, params)
		assert.Equal(t, float64(-1), params["duration"], "wan3 智能时长 -1 必须透传上游")
	})

	t.Run("首尾帧与参考素材互斥", func(t *testing.T) {
		body := `{
			"model": "wan3.0-video",
			"content": [
				{"type": "text", "text": "p"},
				{"type": "image_url", "image_url": {"url": "https://example.com/first.png"}, "role": "first_frame"},
				{"type": "image_url", "image_url": {"url": "https://example.com/ref.png"}, "role": "reference_image"}
			]
		}`
		c := newTestContext(t, http.MethodPost, "/v1/video/generations", body)
		a := &TaskAdaptor{}
		require.Nil(t, a.ValidateRequestAndSetAction(c, newWanRelayInfo()))
		_, err := a.BuildRequestBody(c, newWanRelayInfo())
		require.Error(t, err)
		assert.Contains(t, err.Error(), "首尾帧与参考素材不能同时使用")
	})
}

func TestValidateArkContentBody(t *testing.T) {
	tests := []struct {
		name    string
		body    string
		wantErr bool
	}{
		{
			name:    "content text accepted",
			body:    `{"model":"m","content":[{"type":"text","text":"p"}]}`,
			wantErr: false,
		},
		{
			name:    "reference video accepted for wan3",
			body:    `{"model":"wan3.0-video","content":[{"type":"text","text":"p"},{"type":"video_url","video_url":{"url":"https://example.com/ref.mp4"}}]}`,
			wantErr: false,
		},
		{
			name:    "reference video rejected for legacy wan model",
			body:    `{"model":"wan2.6-i2v","content":[{"type":"text","text":"p"},{"type":"video_url","video_url":{"url":"https://example.com/ref.mp4"}}]}`,
			wantErr: true,
		},
		{
			name:    "wan3 4k resolution rejected",
			body:    `{"model":"wan3.0-video","resolution":"4k","content":[{"type":"text","text":"p"}]}`,
			wantErr: true,
		},
		{
			name:    "top-level duration -1 accepted",
			body:    `{"model":"m","duration":-1,"content":[{"type":"text","text":"p"}]}`,
			wantErr: false,
		},
		{
			name:    "oversized top-level duration rejected",
			body:    `{"model":"m","duration":999999,"content":[{"type":"text","text":"p"}]}`,
			wantErr: true,
		},
		{
			name:    "negative top-level duration below -1 rejected",
			body:    `{"model":"m","duration":-2,"content":[{"type":"text","text":"p"}]}`,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := newTestContext(t, http.MethodPost, "/v1/video/generations", tt.body)
			a := &TaskAdaptor{}
			taskErr := a.ValidateRequestAndSetAction(c, newWanRelayInfo())
			if tt.wantErr {
				require.NotNil(t, taskErr)
				assert.Equal(t, http.StatusBadRequest, taskErr.StatusCode)
				return
			}
			require.Nil(t, taskErr)
			assert.True(t, a.arkContent)
		})
	}
}

// EstimateBilling 注入 seconds 倍率：-1 智能时长/未指定按 5 秒预估，超大值截断到上界。
func TestEstimateBillingSeconds(t *testing.T) {
	tests := []struct {
		duration int
		want     float64
	}{
		{5, 5},
		{15, 15},
		{-1, 5},
		{0, 5},
		{relaycommon.MaxTaskDurationSeconds + 1, float64(relaycommon.MaxTaskDurationSeconds)},
	}
	for _, tt := range tests {
		a := &TaskAdaptor{duration: tt.duration}
		assert.Equal(t, map[string]float64{"seconds": tt.want}, a.EstimateBilling(nil, nil))
	}
}

// 提交响应必须原样透传，公开任务 ID 采用上游 output.task_id（客户端用它查询）。
func TestDoResponsePassthrough(t *testing.T) {
	rec := httptest.NewRecorder()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/services/aigc/video-generation/video-synthesis", nil)

	upstreamBody := `{"output":{"task_id":"a8532587-fa8c-4ef8-82be-0c46b17950d1","task_status":"PENDING"},"request_id":"7574ee8f"}`
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(upstreamBody)),
	}

	a := &TaskAdaptor{}
	info := newWanRelayInfo()
	taskID, taskData, taskErr := a.DoResponse(c, resp, info)

	require.Nil(t, taskErr)
	assert.Equal(t, "a8532587-fa8c-4ef8-82be-0c46b17950d1", taskID)
	assert.Equal(t, "a8532587-fa8c-4ef8-82be-0c46b17950d1", info.PublicTaskID)
	assert.JSONEq(t, upstreamBody, rec.Body.String())
	assert.JSONEq(t, upstreamBody, string(taskData))
}

func TestDoResponseUpstreamError(t *testing.T) {
	rec := httptest.NewRecorder()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/services/aigc/video-generation/video-synthesis", nil)

	resp := &http.Response{
		StatusCode: http.StatusBadRequest,
		Body:       io.NopCloser(strings.NewReader(`{"code":"InvalidParameter","message":"duration out of range","request_id":"x"}`)),
	}

	a := &TaskAdaptor{}
	_, _, taskErr := a.DoResponse(c, resp, newWanRelayInfo())

	require.NotNil(t, taskErr)
	assert.Equal(t, http.StatusBadRequest, taskErr.StatusCode)
	require.NotNil(t, taskErr.Error)
	assert.Contains(t, taskErr.Error.Error(), "InvalidParameter")
	assert.Contains(t, taskErr.Error.Error(), "duration out of range")
}

func TestBuildRequestURL(t *testing.T) {
	tests := []struct {
		baseURL string
		want    string
	}{
		{"https://dashscope.aliyuncs.com", "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis"},
		{"https://dashscope.aliyuncs.com/", "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis"},
		{"https://llm-apiv1example.cn-beijing.maas.aliyuncs.com", "https://llm-apiv1example.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis"},
		// 用户常把 base_url 配成含版本路径后缀的地址，不得拼出双重路径
		{"https://llm-apiv1example.cn-beijing.maas.aliyuncs.com/api", "https://llm-apiv1example.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis"},
		{"https://llm-apiv1example.cn-beijing.maas.aliyuncs.com/api/v1", "https://llm-apiv1example.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis"},
		{"https://dashscope.aliyuncs.com/api/v1/", "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis"},
	}
	for _, tt := range tests {
		a := &TaskAdaptor{baseURL: tt.baseURL}
		got, err := a.BuildRequestURL(nil)
		require.NoError(t, err)
		assert.Equal(t, tt.want, got)
	}
}

func TestFetchTaskUsesOfficialMethodPathAndBearerKey(t *testing.T) {
	service.InitHttpClient()
	var gotMethod, gotPath, gotAuthorization string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.EscapedPath()
		gotAuthorization = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()

	a := &TaskAdaptor{}
	resp, err := a.FetchTask(server.URL, "secret", map[string]any{"task_id": "wan-task/part"}, "")
	require.NoError(t, err)
	require.NotNil(t, resp)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, http.MethodGet, gotMethod)
	assert.Equal(t, "/api/v1/tasks/wan-task%2Fpart", gotPath)
	assert.Equal(t, "Bearer secret", gotAuthorization)
}

// ParseTaskResult / AdjustBillingOnComplete 委托 ali：DashScope 查询响应解析与
// wan 按秒结算行为必须与 ali 渠道完全一致。
func TestDelegatedParseAndSettlement(t *testing.T) {
	wanBillingFixture(t)
	a := &TaskAdaptor{}

	respBody := []byte(`{
		"output": {"task_id": "t-1", "task_status": "SUCCEEDED", "video_url": "https://example.com/v.mp4"},
		"usage": {"duration": 5, "video_count": 1, "SR": 1080}
	}`)
	ti, err := a.ParseTaskResult(respBody)
	require.NoError(t, err)
	require.NotNil(t, ti)
	assert.Equal(t, model.TaskStatusSuccess, ti.Status)
	assert.Equal(t, "1080p", ti.Resolution)
	assert.Equal(t, float64(5), ti.Duration)

	task := &model.Task{
		Group: "default",
		Properties: model.Properties{
			OriginModelName: "wan-settle-model",
		},
		PrivateData: model.TaskPrivateData{
			BillingContext: &model.TaskBillingContext{
				OriginModelName: "wan-settle-model",
			},
		},
	}
	// 5s × $0.25/s × 500000 = 625000
	assert.Equal(t, 625_000, a.AdjustBillingOnComplete(task, ti))
}
