package service

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func chatInfo(stream bool) *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		RelayMode:       relayconstant.RelayModeChatCompletions,
		OriginModelName: "gpt-4o",
		IsStream:        stream,
	}
}

func textChat(content string) *dto.GeneralOpenAIRequest {
	return &dto.GeneralOpenAIRequest{
		Model:    "gpt-4o",
		Messages: []dto.Message{{Role: "user", Content: content}},
	}
}

// TestResponseCacheFingerprintDeterministic 校验相同纯文本请求得到稳定指纹，
// 而模型、消息内容、是否流式任一不同都产生不同指纹（否则会错误命中他人缓存）。
func TestResponseCacheFingerprintDeterministic(t *testing.T) {
	base := textChat("hello world")

	fp1, ok1 := responseCacheFingerprint(chatInfo(false), base)
	require.True(t, ok1)
	assert.NotEmpty(t, fp1)

	fp2, ok2 := responseCacheFingerprint(chatInfo(false), textChat("hello world"))
	require.True(t, ok2)
	assert.Equal(t, fp1, fp2, "identical requests must share a fingerprint")

	// 不同消息内容
	fpOther, ok := responseCacheFingerprint(chatInfo(false), textChat("goodbye"))
	require.True(t, ok)
	assert.NotEqual(t, fp1, fpOther, "different content must not collide")

	// 不同模型
	infoOtherModel := chatInfo(false)
	infoOtherModel.OriginModelName = "claude-3-7-sonnet"
	fpModel, ok := responseCacheFingerprint(infoOtherModel, textChat("hello world"))
	require.True(t, ok)
	assert.NotEqual(t, fp1, fpModel, "different model must not collide")

	// 流式与非流式
	fpStream, ok := responseCacheFingerprint(chatInfo(true), textChat("hello world"))
	require.True(t, ok)
	assert.NotEqual(t, fp1, fpStream, "stream flag is part of the fingerprint")
}

// TestResponseCacheFingerprintDistinguishesExplicitZero 守护可选标量的指针语义：
// 显式 temperature=0 与不传 temperature 必须产生不同指纹，否则归一化会把两者混为一条缓存。
func TestResponseCacheFingerprintDistinguishesExplicitZero(t *testing.T) {
	absent := textChat("same prompt")
	_, okAbsent := responseCacheFingerprint(chatInfo(false), absent)
	require.True(t, okAbsent)
	fpAbsent, _ := responseCacheFingerprint(chatInfo(false), absent)

	explicitZero := textChat("same prompt")
	zero := 0.0
	explicitZero.Temperature = &zero
	fpZero, okZero := responseCacheFingerprint(chatInfo(false), explicitZero)
	require.True(t, okZero)

	assert.NotEqual(t, fpAbsent, fpZero, "temperature=0 and omitted temperature must differ")
}

// TestResponseCacheRejectsNonReproducibleRequests 校验带工具、图片、工具结果或空消息的请求
// 不可缓存：它们的结果依赖调用方后续动作或多模态输入，回放会给出错误答案。
func TestResponseCacheRejectsNonReproducibleRequests(t *testing.T) {
	t.Run("with tools", func(t *testing.T) {
		req := textChat("what is the weather")
		req.Tools = []dto.ToolCallRequest{{Type: "function"}}
		_, ok := responseCacheFingerprint(chatInfo(false), req)
		assert.False(t, ok)
	})

	t.Run("with image content", func(t *testing.T) {
		req := &dto.GeneralOpenAIRequest{
			Model: "gpt-4o",
			Messages: []dto.Message{{
				Role: "user",
				Content: []any{
					map[string]any{"type": "text", "text": "describe"},
					map[string]any{"type": "image_url", "image_url": map[string]any{"url": "https://example.com/a.png"}},
				},
			}},
		}
		_, ok := responseCacheFingerprint(chatInfo(false), req)
		assert.False(t, ok)
	})

	t.Run("with tool result message", func(t *testing.T) {
		req := &dto.GeneralOpenAIRequest{
			Model: "gpt-4o",
			Messages: []dto.Message{
				{Role: "user", Content: "hi"},
				{Role: "tool", Content: "call result", ToolCallId: "call_1"},
			},
		}
		_, ok := responseCacheFingerprint(chatInfo(false), req)
		assert.False(t, ok)
	})

	t.Run("empty messages", func(t *testing.T) {
		req := &dto.GeneralOpenAIRequest{Model: "gpt-4o"}
		_, ok := responseCacheFingerprint(chatInfo(false), req)
		assert.False(t, ok)
	})

	t.Run("array content all text is cacheable", func(t *testing.T) {
		req := &dto.GeneralOpenAIRequest{
			Model: "gpt-4o",
			Messages: []dto.Message{{
				Role: "user",
				Content: []any{
					map[string]any{"type": dto.ContentTypeText, "text": "part one"},
					map[string]any{"type": dto.ContentTypeText, "text": "part two"},
				},
			}},
		}
		_, ok := responseCacheFingerprint(chatInfo(false), req)
		assert.True(t, ok, "multi-part pure-text content is reproducible and cacheable")
	})
}

// TestResponseCacheFingerprintResponsesMode 校验 responses 模式：纯文本输入可缓存，带工具则不可。
func TestResponseCacheFingerprintResponsesMode(t *testing.T) {
	info := &relaycommon.RelayInfo{
		RelayMode:       relayconstant.RelayModeResponses,
		OriginModelName: "gpt-4o",
	}

	pureText := &dto.OpenAIResponsesRequest{Model: "gpt-4o", Input: []byte(`"hello responses"`)}
	fp, ok := responseCacheFingerprint(info, pureText)
	require.True(t, ok)
	assert.NotEmpty(t, fp)

	withTools := &dto.OpenAIResponsesRequest{Model: "gpt-4o", Input: []byte(`"hello"`)}
	withTools.Tools = []byte(`[{"type":"function"}]`)
	_, ok = responseCacheFingerprint(info, withTools)
	assert.False(t, ok)
}
