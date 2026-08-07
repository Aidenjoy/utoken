package model

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/stretchr/testify/assert"
)

// TestToVideoStatus 保护对外 video status 映射契约：任何已受理的任务状态
// （包括刚提交还未被轮询首次更新的 NOT_START）都必须映射为可识别的 OpenAI
// video 状态，否则下游 New API 轮询时无法识别状态，会把任务误判为 FAILURE。
func TestToVideoStatus(t *testing.T) {
	tests := []struct {
		status TaskStatus
		want   string
	}{
		{TaskStatusNotStart, dto.VideoStatusQueued},
		{TaskStatusSubmitted, dto.VideoStatusQueued},
		{TaskStatusQueued, dto.VideoStatusQueued},
		{TaskStatusInProgress, dto.VideoStatusInProgress},
		{TaskStatusSuccess, dto.VideoStatusCompleted},
		{TaskStatusFailure, dto.VideoStatusFailed},
		{TaskStatusUnknown, dto.VideoStatusUnknown},
	}
	for _, tt := range tests {
		t.Run(string(tt.status), func(t *testing.T) {
			assert.Equal(t, tt.want, tt.status.ToVideoStatus())
		})
	}
}
