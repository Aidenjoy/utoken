package director

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestApplyThinkingOff 保护“模型名 → 关闭思考参数”的映射契约，用例取自模型广场实际配置的文本模型：
// 已识别厂商（豆包 Seed / Qwen / GLM）必须注入对应字段，未识别模型必须不注入任何字段
// （否则会向不支持该参数的上游发送未知字段导致 400）。
func TestApplyThinkingOff(t *testing.T) {
	tests := []struct {
		name         string
		model        string
		wantEnable   string // enable_thinking 原始 JSON
		wantThinking string // thinking 原始 JSON
	}{
		// 豆包 Seed 文本（模型广场 type=45 火山引擎渠道）
		{name: "doubao-seed-2-1-pro", model: "doubao-seed-2-1-pro", wantThinking: `{"type":"disabled"}`},
		{name: "doubao-seed-2-1-turbo", model: "doubao-seed-2-1-turbo", wantThinking: `{"type":"disabled"}`},
		// 阿里 Qwen（type=1 OpenAI 兼容渠道）
		{name: "qwen3.6-plus", model: "qwen3.6-plus", wantEnable: "false"},
		{name: "qwen3.8-max", model: "qwen3.8-max", wantEnable: "false"},
		{name: "qwen3-coder-plus", model: "qwen3-coder-plus", wantEnable: "false"},
		// 智谱 GLM
		{name: "glm-5", model: "glm-5", wantThinking: `{"type":"disabled"}`},
		{name: "glm-5.3", model: "glm-5.3", wantThinking: `{"type":"disabled"}`},
		// kimi / MiniMax / deepseek 走 OpenAI 兼容中转，关闭参数未确认，必须不注入
		{name: "kimi-k2.5 not injected", model: "kimi-k2.5"},
		{name: "kimi-k3 not injected", model: "kimi-k3"},
		{name: "MiniMax-M2.5 not injected", model: "MiniMax-M2.5"},
		{name: "deepseek-v4-pro not injected", model: "deepseek-v4-pro-0817"},
		{name: "deepseek-v4-flash not injected", model: "deepseek-v4-flash-0817"},
		// seedance（视频）/ seedream（图片）含 doubao 但非 seed- 文本模型，必须不注入
		{name: "doubao-seedance video not matched", model: "doubao-seedance-2-5"},
		{name: "doubao-seedream image not matched", model: "doubao-seedream-5-0-pro"},
		{name: "empty", model: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var req chatRequest
			applyThinkingOff(&req, tt.model)
			assert.Equal(t, tt.wantEnable, string(req.EnableThinking), "enable_thinking")
			assert.Equal(t, tt.wantThinking, string(req.Thinking), "thinking")
		})
	}
}

// TestApplyThinkingOff_EnvKeep 验证环境变量逃生舱：显式保留思考时，即使是已识别的思考模型也不注入。
func TestApplyThinkingOff_EnvKeep(t *testing.T) {
	for _, keep := range []string{"enabled", "keep", "on", "true", "1"} {
		t.Run(keep, func(t *testing.T) {
			t.Setenv(directorThinkingEnv, keep)
			var req chatRequest
			applyThinkingOff(&req, "doubao-seed-2-1-pro")
			require.Empty(t, req.EnableThinking)
			require.Empty(t, req.Thinking)
		})
	}
}
