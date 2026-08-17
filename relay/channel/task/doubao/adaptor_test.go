package doubao

import (
	"testing"

	"github.com/stretchr/testify/assert"
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
