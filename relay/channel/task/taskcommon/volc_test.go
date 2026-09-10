package taskcommon

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/QuantumNous/new-api/model"
)

// relayStringUsageBody 取自线上中转站真实响应：usage 内除 token 数外全部字段
// 为字符串（无值时为空串），tool_usage 为字符串而非官方的对象。
const relayStringUsageBody = `{"content":{"video_url":"https://example.com/v.mp4"},"created_at":1789027723,"duration":4,"execution_expires_after":172800,"framespersecond":24,"generate_audio":true,"id":"task_4OkPvm0DFx7Pn1T8L5t3RZ8ZTCJe5c73","model":"doubao-seedance-2-0-260128","ratio":"16:9","resolution":"480p","seed":56834,"status":"succeeded","tools":[],"updated_at":1789027908,"usage":{"SR":"","completion_tokens":40594,"fps":"","input_audio_seconds":"","input_image_count":"","input_video_duration":"","output_video_duration":"","ratio":"","tool_usage":"","total_seconds":0,"total_tokens":40594,"video_count":""},"vendor_task_id":"cgt-20260910160849-vsss9"}`

func TestParseVolcTaskResultRelayStringUsage(t *testing.T) {
	info, err := ParseVolcTaskResult([]byte(relayStringUsageBody), "[ArkNative]")
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusSuccess, info.Status)
	require.Equal(t, "100%", info.Progress)
	require.Equal(t, "https://example.com/v.mp4", info.Url)
	require.Equal(t, 40594, info.CompletionTokens)
	require.Equal(t, 40594, info.TotalTokens)
	require.Equal(t, "480p", info.Resolution)
}

func TestParseVolcTaskResultOfficialUsage(t *testing.T) {
	body := `{"id":"t-official","status":"succeeded","content":{"video_url":"https://example.com/o.mp4"},"resolution":"720p","usage":{"completion_tokens":100,"total_tokens":120,"tool_usage":{"web_search":2}}}`
	info, err := ParseVolcTaskResult([]byte(body), "[DoubaoVideo]")
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusSuccess, info.Status)
	require.Equal(t, 100, info.CompletionTokens)
	require.Equal(t, 120, info.TotalTokens)
	require.Equal(t, "720p", info.Resolution)
}

func TestParseVolcTaskResultDegradedUsageShapes(t *testing.T) {
	// usage 整体为字符串/数组等异常形态时仍应推进状态，token 记 0
	for _, usage := range []string{`""`, `[]`, `null`} {
		body := `{"id":"t-degraded","status":"succeeded","content":{"video_url":"https://example.com/d.mp4"},"usage":` + usage + `}`
		info, err := ParseVolcTaskResult([]byte(body), "[ArkNative]")
		require.NoError(t, err, "usage=%s", usage)
		require.Equal(t, model.TaskStatusSuccess, info.Status)
		require.Equal(t, 0, info.TotalTokens)
	}

	// token 为数字字符串时仍应解析出数值；空串记 0
	body := `{"id":"t-string-tokens","status":"succeeded","content":{"video_url":"u"},"usage":{"completion_tokens":"88","total_tokens":""}}`
	info, err := ParseVolcTaskResult([]byte(body), "[ArkNative]")
	require.NoError(t, err)
	require.Equal(t, 88, info.CompletionTokens)
	require.Equal(t, 0, info.TotalTokens)
}

func TestParseVolcTaskResultFallbackOnBrokenField(t *testing.T) {
	// 单个未声明兼容的字段类型异常时，兜底解析仍应推进状态并保留视频地址
	body := `{"id":"t-fallback","status":"succeeded","content":{"video_url":"https://example.com/f.mp4"},"tools":"not-a-list"}`
	info, err := ParseVolcTaskResult([]byte(body), "[ArkNative]")
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusSuccess, info.Status)
	require.Equal(t, "https://example.com/f.mp4", info.Url)

	// 兜底也解析不了时保持报错
	_, err = ParseVolcTaskResult([]byte(`{"id":"t-broken","status":123}`), "[ArkNative]")
	require.Error(t, err)
}

func TestParseVolcTaskResultRunningStatus(t *testing.T) {
	body := `{"id":"t-running","model":"doubao-seedance-2-0-260128","status":"running","created_at":1788948969,"updated_at":1788948969}`
	info, err := ParseVolcTaskResult([]byte(body), "[ArkNative]")
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusInProgress, info.Status)
	require.Equal(t, "50%", info.Progress)
}
