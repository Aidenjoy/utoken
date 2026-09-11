package volcengine

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestGetRequestURLVersionedBase 保护火山方舟 base_url 的版本路径拼接契约：
// 裸官方域名拼默认 /api/v3；已带版本路径的 base（Agent Plan 的
// /api/plan/v3、中转站的 /v1）必须原样使用，不能叠出双重版本路径。
func TestGetRequestURLVersionedBase(t *testing.T) {
	tests := []struct {
		name      string
		baseURL   string
		relayMode int
		modelName string
		want      string
	}{
		{
			name:      "裸官方域名拼默认 api/v3",
			baseURL:   "https://ark.cn-beijing.volces.com",
			relayMode: constant.RelayModeChatCompletions,
			want:      "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
		},
		{
			name:      "Agent Plan 版本基址不叠路径",
			baseURL:   "https://ark.cn-beijing.volces.com/api/plan/v3",
			relayMode: constant.RelayModeChatCompletions,
			want:      "https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions",
		},
		{
			name:      "Agent Plan 尾斜杠不影响拼接",
			baseURL:   "https://ark.cn-beijing.volces.com/api/plan/v3/",
			relayMode: constant.RelayModeChatCompletions,
			want:      "https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions",
		},
		{
			name:      "Agent Plan bot 模型",
			baseURL:   "https://ark.cn-beijing.volces.com/api/plan/v3",
			relayMode: constant.RelayModeChatCompletions,
			modelName: "bot-agent",
			want:      "https://ark.cn-beijing.volces.com/api/plan/v3/bots/chat/completions",
		},
		{
			name:      "Agent Plan 图像接口",
			baseURL:   "https://ark.cn-beijing.volces.com/api/plan/v3",
			relayMode: constant.RelayModeImagesGenerations,
			want:      "https://ark.cn-beijing.volces.com/api/plan/v3/images/generations",
		},
		{
			name:      "中转站 /v1 基址不叠路径",
			baseURL:   "https://relay.example.com/v1",
			relayMode: constant.RelayModeChatCompletions,
			want:      "https://relay.example.com/v1/chat/completions",
		},
		{
			name:      "无版本后缀的自定义基址仍拼默认 api/v3",
			baseURL:   "https://relay.example.com/ark",
			relayMode: constant.RelayModeChatCompletions,
			want:      "https://relay.example.com/ark/api/v3/chat/completions",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adaptor := &Adaptor{}
			info := &relaycommon.RelayInfo{
				ChannelMeta: &relaycommon.ChannelMeta{
					ChannelBaseUrl:    tt.baseURL,
					UpstreamModelName: tt.modelName,
				},
				RelayMode: tt.relayMode,
			}
			got, err := adaptor.GetRequestURL(info)
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

// TestGetRequestURLClaudeFormatVersionedBase 保证 Claude 格式在版本基址下
// 同样不叠路径（走 OpenAI 兼容 chat 端点 + openai 转换器）。
func TestGetRequestURLClaudeFormatVersionedBase(t *testing.T) {
	adaptor := &Adaptor{}
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelBaseUrl:    "https://ark.cn-beijing.volces.com/api/plan/v3",
			UpstreamModelName: "doubao-seed-2-0",
		},
		RelayFormat: types.RelayFormatClaude,
		RelayMode:   constant.RelayModeChatCompletions,
	}
	got, err := adaptor.GetRequestURL(info)
	require.NoError(t, err)
	assert.Equal(t, "https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions", got)
}
