package moonshot

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConvertOpenAIRequestKimiK26UsesOnlyAllowedTemperature(t *testing.T) {
	request := &dto.GeneralOpenAIRequest{
		Model:       "kimi-k2.6",
		Temperature: common.GetPointer[float64](0.7),
	}
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "kimi-k2.6",
		},
	}

	converted, err := (&Adaptor{}).ConvertOpenAIRequest(nil, info, request)

	require.NoError(t, err)
	convertedRequest, ok := converted.(*dto.GeneralOpenAIRequest)
	require.True(t, ok)
	require.NotNil(t, convertedRequest.Temperature)
	require.Equal(t, 1.0, *convertedRequest.Temperature)
}

func TestConvertOpenAIRequestKimiK26KeepsOmittedTemperatureOmitted(t *testing.T) {
	request := &dto.GeneralOpenAIRequest{
		Model: "kimi-k2.6",
	}
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "kimi-k2.6",
		},
	}

	converted, err := (&Adaptor{}).ConvertOpenAIRequest(nil, info, request)

	require.NoError(t, err)
	convertedRequest, ok := converted.(*dto.GeneralOpenAIRequest)
	require.True(t, ok)
	require.Nil(t, convertedRequest.Temperature)
}

func TestConvertOpenAIRequestOtherMoonshotModelKeepsTemperature(t *testing.T) {
	request := &dto.GeneralOpenAIRequest{
		Model:       "kimi-k2.5",
		Temperature: common.GetPointer[float64](0.7),
	}
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "kimi-k2.5",
		},
	}

	converted, err := (&Adaptor{}).ConvertOpenAIRequest(nil, info, request)

	require.NoError(t, err)
	convertedRequest, ok := converted.(*dto.GeneralOpenAIRequest)
	require.True(t, ok)
	require.NotNil(t, convertedRequest.Temperature)
	require.Equal(t, 0.7, *convertedRequest.Temperature)
}

// Moonshot 校验器拒绝递归工具 schema（"detected infinite recursion without
// termination condition"），chat 路径转发前必须内联 $ref 并断环，
// 与 volcengine/openai 适配器行为一致。
func TestConvertOpenAIRequestBreaksRecursiveKimiToolSchema(t *testing.T) {
	var tools []dto.ToolCallRequest
	require.NoError(t, common.Unmarshal([]byte(`[{
		"type": "function",
		"function": {
			"name": "update_plan",
			"parameters": {
				"type": "object",
				"properties": {
					"steps": {"type": "array", "items": {"$ref": "#/$defs/PlanStep"}}
				},
				"required": ["steps"],
				"$defs": {
					"PlanStep": {
						"type": "object",
						"properties": {
							"title": {"type": "string"},
							"substeps": {"type": "array", "items": {"$ref": "#/$defs/PlanStep"}}
						},
						"required": ["title"]
					}
				}
			}
		}
	}]`), &tools))
	request := &dto.GeneralOpenAIRequest{
		Model: "kimi-k3.1-pro",
		Tools: tools,
	}
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "kimi-k3.1-pro",
		},
	}

	converted, err := (&Adaptor{}).ConvertOpenAIRequest(nil, info, request)

	require.NoError(t, err)
	convertedRequest, ok := converted.(*dto.GeneralOpenAIRequest)
	require.True(t, ok)
	raw, err := common.Marshal(convertedRequest.Tools)
	require.NoError(t, err)
	toolsJSON := string(raw)
	assert.NotContains(t, toolsJSON, `"$ref"`, "recursive refs must be inlined")
	assert.NotContains(t, toolsJSON, `"$defs"`, "defs block must be removed")
	assert.True(t, strings.Contains(toolsJSON, `"title"`), "non-recursive schema content must survive")
}
