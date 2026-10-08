/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package openai

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 上游对 gpt-6 世代（如中转站的 gpt-6-luna）会返回
// "Unsupported parameter: 'temperature' is not supported with this model."，
// 转换层必须提前归零采样参数并把 max_tokens 迁到 max_completion_tokens。
func TestConvertOpenAIRequestStripsSamplingParamsForGPT6Generation(t *testing.T) {
	request := &dto.GeneralOpenAIRequest{
		Model:       "gpt-6-luna",
		Temperature: common.GetPointer[float64](0.7),
		TopP:        common.GetPointer[float64](0.9),
		LogProbs:    common.GetPointer(true),
		MaxTokens:   common.GetPointer[uint](128),
	}
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       constant.ChannelTypeOpenAI,
			UpstreamModelName: "gpt-6-luna",
		},
	}

	converted, err := (&Adaptor{}).ConvertOpenAIRequest(nil, info, request)

	require.NoError(t, err)
	convertedRequest, ok := converted.(*dto.GeneralOpenAIRequest)
	require.True(t, ok)
	assert.Nil(t, convertedRequest.Temperature, "gpt-6 generation rejects temperature")
	assert.Nil(t, convertedRequest.TopP, "gpt-6 generation rejects top_p")
	assert.Nil(t, convertedRequest.LogProbs, "gpt-6 generation rejects logprobs")
	assert.Nil(t, convertedRequest.MaxTokens, "max_tokens must move to max_completion_tokens")
	require.NotNil(t, convertedRequest.MaxCompletionTokens)
	assert.Equal(t, uint(128), *convertedRequest.MaxCompletionTokens)
}

// 经典 chat 模型（gpt-4o 等）仍支持采样参数，不得被新世代的适配误伤。
func TestConvertOpenAIRequestKeepsSamplingParamsForClassicChatModels(t *testing.T) {
	request := &dto.GeneralOpenAIRequest{
		Model:       "gpt-4o",
		Temperature: common.GetPointer[float64](0.7),
		MaxTokens:   common.GetPointer[uint](128),
	}
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       constant.ChannelTypeOpenAI,
			UpstreamModelName: "gpt-4o",
		},
	}

	converted, err := (&Adaptor{}).ConvertOpenAIRequest(nil, info, request)

	require.NoError(t, err)
	convertedRequest, ok := converted.(*dto.GeneralOpenAIRequest)
	require.True(t, ok)
	require.NotNil(t, convertedRequest.Temperature)
	assert.Equal(t, 0.7, *convertedRequest.Temperature)
	require.NotNil(t, convertedRequest.MaxTokens)
	assert.Equal(t, uint(128), *convertedRequest.MaxTokens)
	assert.Nil(t, convertedRequest.MaxCompletionTokens)
}
