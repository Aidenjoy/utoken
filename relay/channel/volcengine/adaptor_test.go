package volcengine

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
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

// TestConvertRequestKimiTemperatureOneOnly Kimi K2.6/K3 系列（含火山方舟
// coding plan 转售的 kimi-k3.1-pro）上游温度固定为 1，非 1 值会被 400
// 拒绝；chat 与 Responses 两条转发路径都必须归一化，其他模型不受影响，
// 客户端未传温度时保持省略。
func TestConvertRequestKimiTemperatureOneOnly(t *testing.T) {
	tests := []struct {
		name        string
		model       string
		temperature *float64
		want        *float64
	}{
		{"kimi-k3.1-pro 非 1 归一化", "kimi-k3.1-pro", common.GetPointer[float64](0.7), common.GetPointer[float64](1.0)},
		{"kimi-k3 非 1 归一化", "kimi-k3", common.GetPointer[float64](0.2), common.GetPointer[float64](1.0)},
		{"kimi-k2.6 非 1 归一化", "kimi-k2.6", common.GetPointer[float64](0.7), common.GetPointer[float64](1.0)},
		{"kimi-k3.1-pro 已是 1 不变", "kimi-k3.1-pro", common.GetPointer[float64](1.0), common.GetPointer[float64](1.0)},
		{"kimi-k3.1-pro 省略保持省略", "kimi-k3.1-pro", nil, nil},
		{"豆包模型不受影响", "doubao-seed-2.1-pro", common.GetPointer[float64](0.7), common.GetPointer[float64](0.7)},
		{"kimi-k2.5 不受影响", "kimi-k2.5", common.GetPointer[float64](0.7), common.GetPointer[float64](0.7)},
	}
	for _, tt := range tests {
		t.Run("chat/"+tt.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{
				ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: tt.model},
			}
			request := &dto.GeneralOpenAIRequest{Model: tt.model, Temperature: tt.temperature}
			converted, err := (&Adaptor{}).ConvertOpenAIRequest(nil, info, request)
			require.NoError(t, err)
			convertedRequest, ok := converted.(*dto.GeneralOpenAIRequest)
			require.True(t, ok)
			assert.Equal(t, tt.want, convertedRequest.Temperature)
		})
		t.Run("responses/"+tt.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{
				ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: tt.model},
			}
			request := dto.OpenAIResponsesRequest{Model: tt.model, Temperature: tt.temperature}
			converted, err := (&Adaptor{}).ConvertOpenAIResponsesRequest(nil, info, request)
			require.NoError(t, err)
			convertedRequest, ok := converted.(dto.OpenAIResponsesRequest)
			require.True(t, ok)
			assert.Equal(t, tt.want, convertedRequest.Temperature)
		})
	}
}

// TestConvertRequestKimiFixedSamplingParams Kimi 推理模型上游 top_p 固定
// 0.95、presence_penalty/frequency_penalty 固定 0（官方参数参考 + Ark
// coding plan 实测）；体验页默认 top_p=1 会被 400 拒绝。chat 与 Responses
// 双路径归一化，未传保持省略，其他模型不受影响。
func TestConvertRequestKimiFixedSamplingParams(t *testing.T) {
	tests := []struct {
		name             string
		model            string
		topP             *float64
		presencePenalty  *float64
		frequencyPenalty *float64
		wantTopP         *float64
		wantPresence     *float64
		wantFrequency    *float64
	}{
		{"kimi-k3.1-pro 默认值归一化", "kimi-k3.1-pro",
			common.GetPointer[float64](1), common.GetPointer[float64](0.5), common.GetPointer[float64](0.5),
			common.GetPointer[float64](0.95), common.GetPointer[float64](0), common.GetPointer[float64](0)},
		{"kimi-k3.1-pro 合法值不变", "kimi-k3.1-pro",
			common.GetPointer[float64](0.95), common.GetPointer[float64](0), common.GetPointer[float64](0),
			common.GetPointer[float64](0.95), common.GetPointer[float64](0), common.GetPointer[float64](0)},
		{"kimi-k3.1-pro 省略保持省略", "kimi-k3.1-pro", nil, nil, nil, nil, nil, nil},
		{"kimi-k2.7-code 同样归一化", "kimi-k2.7-code",
			common.GetPointer[float64](0.9), nil, nil,
			common.GetPointer[float64](0.95), nil, nil},
		{"豆包模型不受影响", "doubao-seed-2.1-pro",
			common.GetPointer[float64](1), common.GetPointer[float64](0.5), common.GetPointer[float64](0.5),
			common.GetPointer[float64](1), common.GetPointer[float64](0.5), common.GetPointer[float64](0.5)},
		{"kimi-k2.5 不受影响", "kimi-k2.5",
			common.GetPointer[float64](1), nil, nil,
			common.GetPointer[float64](1), nil, nil},
	}
	for _, tt := range tests {
		t.Run("chat/"+tt.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{
				ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: tt.model},
			}
			request := &dto.GeneralOpenAIRequest{
				Model: tt.model, TopP: tt.topP,
				PresencePenalty: tt.presencePenalty, FrequencyPenalty: tt.frequencyPenalty,
			}
			converted, err := (&Adaptor{}).ConvertOpenAIRequest(nil, info, request)
			require.NoError(t, err)
			convertedRequest, ok := converted.(*dto.GeneralOpenAIRequest)
			require.True(t, ok)
			assert.Equal(t, tt.wantTopP, convertedRequest.TopP)
			assert.Equal(t, tt.wantPresence, convertedRequest.PresencePenalty)
			assert.Equal(t, tt.wantFrequency, convertedRequest.FrequencyPenalty)
		})
		t.Run("responses/"+tt.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{
				ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: tt.model},
			}
			request := dto.OpenAIResponsesRequest{Model: tt.model, TopP: tt.topP}
			converted, err := (&Adaptor{}).ConvertOpenAIResponsesRequest(nil, info, request)
			require.NoError(t, err)
			convertedRequest, ok := converted.(dto.OpenAIResponsesRequest)
			require.True(t, ok)
			assert.Equal(t, tt.wantTopP, convertedRequest.TopP)
		})
	}
}

// TestConvertResponsesRequestRepairsOrphanToolCalls 保护 Kimi Responses 路径的
// 工具调用历史修复契约：客户端工具循环被中断后留下的孤立 function_call
// 会被上游泛化 400 拒绝，转发前必须补占位输出；孤立输出必须删除；
// 完整配对/非 Kimi 模型/字符串 input 不受影响。
func TestConvertResponsesRequestRepairsOrphanToolCalls(t *testing.T) {
	orphanCallInput := json.RawMessage(`[{"role":"user","content":"北京天气?"},{"type":"function_call","call_id":"call_1","name":"get_weather","arguments":"{}"}]`)
	tests := []struct {
		name      string
		model     string
		input     json.RawMessage
		wantTypes []string
		unchanged bool
	}{
		{"孤立调用补占位输出", "kimi-k3.1-pro", orphanCallInput,
			[]string{"", "function_call", "function_call_output"}, false},
		{"孤立输出被删除", "kimi-k3.1-pro",
			json.RawMessage(`[{"role":"user","content":"hi"},{"type":"function_call_output","call_id":"call_x","output":"晴"}]`),
			[]string{""}, false},
		{"完整配对不动", "kimi-k3.1-pro",
			json.RawMessage(`[{"role":"user","content":"hi"},{"type":"function_call","call_id":"call_1","name":"f","arguments":"{}"},{"type":"function_call_output","call_id":"call_1","output":"ok"}]`),
			nil, true},
		{"字符串input不动", "kimi-k3.1-pro", json.RawMessage(`"说:好"`), nil, true},
		{"非Kimi模型不修复", "doubao-seed-2.1-pro", orphanCallInput, nil, true},
		{"两个call只补缺失的一个", "kimi-k3.1-pro",
			json.RawMessage(`[{"type":"function_call","call_id":"c1","name":"f","arguments":"{}"},{"type":"function_call","call_id":"c2","name":"f","arguments":"{}"},{"type":"function_call_output","call_id":"c1","output":"ok"}]`),
			[]string{"function_call", "function_call", "function_call_output", "function_call_output"}, false},
		{"custom_tool_call同样修复", "kimi-k3.1-pro",
			json.RawMessage(`[{"type":"custom_tool_call","call_id":"c1","name":"t","input":"x"}]`),
			[]string{"custom_tool_call", "custom_tool_call_output"}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{
				ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: tt.model},
			}
			request := dto.OpenAIResponsesRequest{Model: tt.model, Input: tt.input}
			converted, err := (&Adaptor{}).ConvertOpenAIResponsesRequest(nil, info, request)
			require.NoError(t, err)
			convertedRequest, ok := converted.(dto.OpenAIResponsesRequest)
			require.True(t, ok)
			if tt.unchanged {
				assert.JSONEq(t, string(tt.input), string(convertedRequest.Input))
				return
			}
			var items []struct {
				Type   string `json:"type"`
				CallID string `json:"call_id"`
				Output string `json:"output"`
			}
			require.NoError(t, common.Unmarshal(convertedRequest.Input, &items))
			require.Len(t, items, len(tt.wantTypes))
			for i, wantType := range tt.wantTypes {
				assert.Equal(t, wantType, items[i].Type, "item %d", i)
			}
			// 占位输出必须紧跟对应调用项且 call_id 一致（既有正常输出不受此约束）
			for i, item := range items {
				if !strings.Contains(item.Output, "interrupted") {
					continue
				}
				require.Greater(t, i, 0)
				assert.Equal(t, items[i-1].CallID, item.CallID)
			}
		})
	}
}
