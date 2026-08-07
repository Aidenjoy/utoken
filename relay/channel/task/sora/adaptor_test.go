package sora

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestParseTaskResultStatusMapping 保护跨实例中转契约：当 OpenAI 渠道的上游
// 是另一套 New API（GET /v1/videos/{id}）时，其返回的 video status 必须被
// 正确映射。特别是 "unknown"（上游任务刚提交、状态还是 NOT_START 时产生）
// 必须视为排队中继续轮询，而不是返回空状态导致任务被判为失败。
func TestParseTaskResultStatusMapping(t *testing.T) {
	tests := []struct {
		name         string
		respBody     string
		wantStatus   model.TaskStatus
		wantProgress string
		wantReason   string
	}{
		{
			name:       "unknown status from fresh upstream task is queued",
			respBody:   `{"id":"task_1","object":"video","model":"m","status":"unknown","progress":0}`,
			wantStatus: model.TaskStatusQueued,
		},
		{
			name:       "queued",
			respBody:   `{"id":"task_1","object":"video","status":"queued","progress":0}`,
			wantStatus: model.TaskStatusQueued,
		},
		{
			name:         "in_progress with progress",
			respBody:     `{"id":"task_1","object":"video","status":"in_progress","progress":50}`,
			wantStatus:   model.TaskStatusInProgress,
			wantProgress: "50%",
		},
		{
			name:       "completed",
			respBody:   `{"id":"task_1","object":"video","status":"completed","progress":100}`,
			wantStatus: model.TaskStatusSuccess,
		},
		{
			name:       "failed carries upstream error message",
			respBody:   `{"id":"task_1","object":"video","status":"failed","error":{"message":"boom","code":"e"}}`,
			wantStatus: model.TaskStatusFailure,
			wantReason: "boom",
		},
	}

	adaptor := &TaskAdaptor{}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			taskResult, err := adaptor.ParseTaskResult([]byte(tt.respBody))
			require.NoError(t, err)
			require.NotEmpty(t, taskResult.Status, "empty status makes the poller fail the task")
			assert.Equal(t, string(tt.wantStatus), taskResult.Status)
			assert.Equal(t, tt.wantProgress, taskResult.Progress)
			assert.Equal(t, tt.wantReason, taskResult.Reason)
		})
	}
}
