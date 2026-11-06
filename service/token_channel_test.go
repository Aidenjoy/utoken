package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestResolveTokenBoundChannel 锁定 B 端密钥绑定渠道的核心判定契约：
// 未绑定统一返回 ErrTokenChannelBindingRequired；绑定但渠道不存在/禁用/未开启素材协议
// 分别报错（且不等于未绑定错误，便于定位）；正常绑定返回渠道。解绑校验恒合法。
func TestResolveTokenBoundChannel(t *testing.T) {
	model.InitCol()
	require.NoError(t, model.DB.AutoMigrate(&model.Channel{}))
	model.DB.Exec("DELETE FROM channels")
	t.Cleanup(func() { model.DB.Exec("DELETE FROM channels") })

	seedAssetChannel(t, 1, common.ChannelStatusEnabled, "ark_official")          // 正常可用
	seedAssetChannel(t, 2, common.ChannelStatusManuallyDisabled, "ark_official") // 已禁用
	seedAssetChannel(t, 3, common.ChannelStatusEnabled, "")                      // 未开启素材协议

	t.Run("unbound returns unified binding-required error", func(t *testing.T) {
		_, err := ResolveTokenBoundChannel(0)
		assert.ErrorIs(t, err, ErrTokenChannelBindingRequired)
	})

	t.Run("missing channel is not the binding-required error", func(t *testing.T) {
		_, err := ResolveTokenBoundChannel(999)
		require.Error(t, err)
		assert.NotErrorIs(t, err, ErrTokenChannelBindingRequired)
	})

	t.Run("disabled channel rejected", func(t *testing.T) {
		_, err := ResolveTokenBoundChannel(2)
		require.Error(t, err)
		assert.NotErrorIs(t, err, ErrTokenChannelBindingRequired)
	})

	t.Run("channel without asset protocol rejected", func(t *testing.T) {
		_, err := ResolveTokenBoundChannel(3)
		require.Error(t, err)
		assert.NotErrorIs(t, err, ErrTokenChannelBindingRequired)
	})

	t.Run("valid bound channel returned", func(t *testing.T) {
		ch, err := ResolveTokenBoundChannel(1)
		require.NoError(t, err)
		assert.Equal(t, 1, ch.Id)
	})

	t.Run("validate unbind always ok", func(t *testing.T) {
		assert.NoError(t, ValidateTokenBindChannel(0))
	})

	t.Run("validate bound channel mirrors resolve", func(t *testing.T) {
		assert.NoError(t, ValidateTokenBindChannel(1))
		assert.Error(t, ValidateTokenBindChannel(2))
		assert.Error(t, ValidateTokenBindChannel(3))
		assert.Error(t, ValidateTokenBindChannel(999))
	})
}
