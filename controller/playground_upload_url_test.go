package controller

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// 渠道 baseURL 带版本后缀时只拼 /files，不带时拼火山默认 /api/v3/files，
// 防止拼出 /api/v2/api/v3/files 这类双重路径（线上真实 404 根因）。
func TestFilesUploadURL(t *testing.T) {
	tests := []struct {
		name    string
		baseURL string
		want    string
	}{
		{"无版本后缀拼默认路径", "https://ark.cn-beijing.volces.com", "https://ark.cn-beijing.volces.com/api/v3/files"},
		{"尾斜杠先去掉", "https://ark.cn-beijing.volces.com/", "https://ark.cn-beijing.volces.com/api/v3/files"},
		{"api/v2 后缀只拼 files", "https://ai-tokenhub.com/api/v2", "https://ai-tokenhub.com/api/v2/files"},
		{"api/v3 后缀只拼 files", "https://example.com/api/v3", "https://example.com/api/v3/files"},
		{"api/v1 后缀只拼 files", "https://example.com/api/v1", "https://example.com/api/v1/files"},
		{"v1 后缀只拼 files", "https://example.com/v1", "https://example.com/v1/files"},
		{"v2 后缀只拼 files", "https://example.com/v2", "https://example.com/v2/files"},
		{"v3 后缀只拼 files", "https://example.com/v3", "https://example.com/v3/files"},
		{"非版本路径拼默认", "https://example.com/custom", "https://example.com/custom/api/v3/files"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, filesUploadURL(tt.baseURL))
		})
	}
}
