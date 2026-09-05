package director

import (
	"errors"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestRetryStructuredDecode 保护“结构化输出解析失败即重新采样重试”的契约。
// 线上故障：豆包 Seed 关闭思考后一次性生成长嵌套 JSON 时偶发括号错乱——第一个场景后就提前
// 闭合 scenes 数组与顶层对象，把后续场景游离成顶层多余内容，Go 解析完首个完整对象再遇到 ','
// 即报 "invalid character ',' after top-level value"。单次失败但温度 0.7 下重采样通常可恢复。
func TestRetryStructuredDecode(t *testing.T) {
	type payload struct {
		Scenes []struct {
			Location string `json:"location"`
		} `json:"scenes"`
	}
	// 精确复现线上畸形输出：scenes 提前闭合、顶层对象提前结束，其后是游离的 ',' 与多余片段
	const malformed = `{"scenes":[{"location":"国金中心地下车库"}],"location":"58楼会议室"},{"location":"北外滩工地"}`
	const valid = `{"scenes":[{"location":"国金中心地下车库"},{"location":"58楼会议室"},{"location":"北外滩工地"}]}`

	decodeInto := func(got *payload) func(string) error {
		return func(jsonText string) error {
			return common.Unmarshal([]byte(jsonText), got)
		}
	}

	t.Run("首次畸形、重采样后合法则恢复", func(t *testing.T) {
		calls := 0
		var got payload
		err := retryStructuredDecode("doubao-seed-2-1-pro", func() (string, error) {
			calls++
			if calls == 1 {
				return malformed, nil
			}
			return valid, nil
		}, decodeInto(&got))
		require.NoError(t, err)
		assert.Equal(t, 2, calls, "应在第 2 次采样成功")
		require.Len(t, got.Scenes, 3)
		assert.Equal(t, "国金中心地下车库", got.Scenes[0].Location)
	})

	t.Run("持续畸形则重试至上限并返回解析错误", func(t *testing.T) {
		calls := 0
		var got payload
		err := retryStructuredDecode("doubao-seed-2-1-pro", func() (string, error) {
			calls++
			return malformed, nil
		}, decodeInto(&got))
		require.Error(t, err)
		assert.Equal(t, jsonParseMaxAttempts, calls, "解析失败应重试到上限次数")
		assert.Empty(t, got.Scenes)
	})

	t.Run("调用本身报错则立即返回且不再解析", func(t *testing.T) {
		calls := 0
		decoded := 0
		sentinel := errors.New("AI 服务限流（429），已自动重试 3 次仍失败")
		err := retryStructuredDecode("doubao-seed-2-1-pro", func() (string, error) {
			calls++
			return "", sentinel
		}, func(string) error {
			decoded++
			return nil
		})
		require.ErrorIs(t, err, sentinel)
		assert.Equal(t, 1, calls, "瞬时故障已由 Chat 内部重试，这里不应再重复调用")
		assert.Equal(t, 0, decoded, "调用失败时不应触发解析")
	})
}
