package doubao

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 中转站可能用 /api/v2 代替官方 /api/v3 版本前缀（如 ai-tokenhub 文档
// https://ai-tokenhub.com/api/v2/contents/generations/tasks），
// baseURL 带版本后缀时直接拼任务路径，不带时拼官方默认 /api/v3。
func TestBuildTaskURL(t *testing.T) {
	tests := []struct {
		name    string
		baseURL string
		want    string
	}{
		{"官方无后缀拼默认 api/v3", "https://ark.cn-beijing.volces.com", "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"},
		{"尾斜杠先去掉", "https://ark.cn-beijing.volces.com/", "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks"},
		{"中转站 api/v2 后缀不叠版本", "https://ai-tokenhub.com/api/v2", "https://ai-tokenhub.com/api/v2/contents/generations/tasks"},
		{"api/v3 后缀不重复拼", "https://example.com/api/v3", "https://example.com/api/v3/contents/generations/tasks"},
		{"非版本路径拼默认", "https://example.com/ark", "https://example.com/ark/api/v3/contents/generations/tasks"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, buildTaskURL(tt.baseURL, "/contents/generations/tasks"))
		})
	}
}

func TestBuildTaskURLFetch(t *testing.T) {
	assert.Equal(t,
		"https://ai-tokenhub.com/api/v2/contents/generations/tasks/cgt-123",
		buildTaskURL("https://ai-tokenhub.com/api/v2", "/contents/generations/tasks/cgt-123"))
	assert.Equal(t,
		"https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/cgt-123",
		buildTaskURL("https://ark.cn-beijing.volces.com", "/contents/generations/tasks/cgt-123"))
}

// 前端 Playground 传大写分辨率（480P/1080P/4K），火山方舟枚举为小写，
// convertToRequestPayload 必须归一化后再发给上游，否则官方 Ark 或严格透传的
// 中转站会拒绝请求。
func TestConvertToRequestPayloadNormalizesResolution(t *testing.T) {
	tests := []struct {
		name       string
		resolution string
		want       string
	}{
		{"大写 480P 归一化为 480p", "480P", "480p"},
		{"大写 1080P 归一化为 1080p", "1080P", "1080p"},
		{"大写 4K 归一化为 4k", "4K", "4k"},
		{"已是小写保持不变", "720p", "720p"},
		{"空值保持为空走上游默认", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := &relaycommon.TaskSubmitReq{
				Model:    "doubao-seedance-2-0-260128",
				Prompt:   "跳舞",
				Metadata: map[string]interface{}{"resolution": tt.resolution},
			}
			payload, err := (&TaskAdaptor{}).convertToRequestPayload(req)
			require.NoError(t, err)
			assert.Equal(t, tt.want, payload.Resolution)
		})
	}
}

// 查询响应必须同时兼容官方火山格式（顶层 content/usage、数字时间戳）与
// 中转站包装格式（resultSummary.content/resultSummary.usage、ISO 字符串时间戳、
// 字符串 duration）。中转站样本来自 ai-tokenhub 真实响应，任何字段类型不匹配
// 都会导致整体反序列化失败，任务永久卡在进行中。
func TestParseTaskResult(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantStatus string
		wantURL    string
		wantTokens int
	}{
		{
			name: "官方格式 succeeded",
			body: `{"id":"cgt-123","model":"doubao-seedance-2-0-260128","status":"succeeded","content":{"video_url":"https://ark.example.com/v.mp4"},"usage":{"completion_tokens":100,"total_tokens":120},"created_at":1755432000,"updated_at":1755432060,"duration":4}`, 
			wantStatus: string(model.TaskStatusSuccess),
			wantURL:    "https://ark.example.com/v.mp4",
			wantTokens: 100,
		},
		{
			name: "中转站 resultSummary 包装 succeeded",
			body: `{"id":"01a00fbf-3cf9-70a5-adc6-9b93a5ffd848","upstreamTaskId":"cgt-20260817204306-fskqb","status":"succeeded","model":"doubao-seedance-2-0-mini-260615","resultSummary":{"content":{"video_url":"https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/doubao-seedance-2-0-mini/demo.mp4?X-Tos-Signature=abc"},"duration":"4","resolution":"480p","upstreamStatus":"succeeded","usage":{"completion_tokens":40594,"total_tokens":40594}},"createdAt":"2026-08-17T20:43:06.359411+08:00","updatedAt":"2026-08-17T20:45:03.595838+08:00"}`, 
			wantStatus: string(model.TaskStatusSuccess),
			wantURL:    "https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/doubao-seedance-2-0-mini/demo.mp4?X-Tos-Signature=abc",
			wantTokens: 40594,
		},
		{
			name: "中转站 resultSummary 包装 running",
			body: `{"id":"01a00fbf-3cf9-70a5-adc6-9b93a5ffd848","upstreamTaskId":"cgt-20260817204306-fskqb","status":"running","model":"doubao-seedance-2-0-mini-260615","resultSummary":{"upstreamStatus":"running"},"createdAt":"2026-08-17T20:43:06.359411+08:00","updatedAt":"2026-08-17T20:43:30.348118+08:00"}`, 
			wantStatus: string(model.TaskStatusInProgress),
			wantURL:    "",
			wantTokens: 0,
		},
		{
			name:       "官方格式 failed",
			body:       `{"id":"cgt-123","status":"failed","error":{"code":"InternalServiceError","message":"boom"}}`, 
			wantStatus: string(model.TaskStatusFailure),
			wantURL:    "",
			wantTokens: 0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ti, err := (&TaskAdaptor{}).ParseTaskResult([]byte(tt.body))
			require.NoError(t, err)
			require.NotNil(t, ti)
			assert.Equal(t, tt.wantStatus, ti.Status)
			assert.Equal(t, tt.wantURL, ti.Url)
			assert.Equal(t, tt.wantTokens, ti.CompletionTokens)
		})
	}
}
