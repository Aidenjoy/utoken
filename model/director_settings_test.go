package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// insertDirectorBindTestToken 创建绑定测试用令牌，测试结束后清理令牌与绑定记录
func insertDirectorBindTestToken(t *testing.T, userID int, key, keyType string, status int) *Token {
	t.Helper()
	token := &Token{
		UserId:      userID,
		Key:         key,
		Name:        key,
		Status:      status,
		KeyType:     keyType,
		ExpiredTime: -1,
	}
	require.NoError(t, DB.Create(token).Error)
	t.Cleanup(func() {
		DB.Unscoped().Delete(token)
		DB.Where("user_id = ?", userID).Delete(&DirectorUserToken{})
	})
	return token
}

// 网关按协议隔离语言/图片/视频 Key：云导演三项能力必须各自使用对应类型的令牌，
// 互不串用，否则回环调用会被网关 403 拒绝。
func TestDirectorTokenPerServiceBinding(t *testing.T) {
	const userID = 9101
	textToken := insertDirectorBindTestToken(t, userID, "director-bind-text", TokenKeyTypeLanguage, common.TokenStatusEnabled)
	imageToken := insertDirectorBindTestToken(t, userID, "director-bind-image", TokenKeyTypeImage, common.TokenStatusEnabled)
	videoToken := insertDirectorBindTestToken(t, userID, "director-bind-video", TokenKeyTypeVideo, common.TokenStatusEnabled)

	require.NoError(t, BindDirectorToken(userID, textToken.Id, "text"))
	require.NoError(t, BindDirectorToken(userID, imageToken.Id, "image"))
	require.NoError(t, BindDirectorToken(userID, videoToken.Id, "video"))

	for _, tc := range []struct {
		serviceType string
		wantKey     string
	}{
		{"text", textToken.Key},
		{"image", imageToken.Key},
		{"video", videoToken.Key},
	} {
		key, err := GetDirectorTokenKey(userID, tc.serviceType)
		require.NoError(t, err, tc.serviceType)
		assert.Equal(t, tc.wantKey, key, tc.serviceType)

		info, err := GetDirectorTokenInfo(userID, tc.serviceType)
		require.NoError(t, err, tc.serviceType)
		require.NotNil(t, info, tc.serviceType)
		assert.Equal(t, tc.wantKey, info.Key, tc.serviceType)
	}

	// 重新绑定同一能力只覆盖该能力，不影响其他能力
	anotherText := insertDirectorBindTestToken(t, userID, "director-bind-text-2", TokenKeyTypeLanguage, common.TokenStatusEnabled)
	require.NoError(t, BindDirectorToken(userID, anotherText.Id, "text"))
	key, err := GetDirectorTokenKey(userID, "text")
	require.NoError(t, err)
	assert.Equal(t, anotherText.Key, key)
	key, err = GetDirectorTokenKey(userID, "video")
	require.NoError(t, err)
	assert.Equal(t, videoToken.Key, key)
}

// 旧版统一令牌（TokenID/TokenKey）对未单独绑定的能力继续生效；
// 单独绑定后优先于旧版令牌，保证存量用户升级后流水线不中断。
func TestDirectorTokenLegacyFallback(t *testing.T) {
	const userID = 9102
	legacyToken := insertDirectorBindTestToken(t, userID, "director-bind-legacy", "", common.TokenStatusEnabled)
	require.NoError(t, DB.Create(&DirectorUserToken{
		UserID:   userID,
		TokenID:  legacyToken.Id,
		TokenKey: legacyToken.Key,
	}).Error)

	for _, serviceType := range []string{"text", "image", "video"} {
		key, err := GetDirectorTokenKey(userID, serviceType)
		require.NoError(t, err, serviceType)
		assert.Equal(t, legacyToken.Key, key, serviceType)
	}

	videoToken := insertDirectorBindTestToken(t, userID, "director-bind-legacy-video", TokenKeyTypeVideo, common.TokenStatusEnabled)
	require.NoError(t, BindDirectorToken(userID, videoToken.Id, "video"))

	key, err := GetDirectorTokenKey(userID, "video")
	require.NoError(t, err)
	assert.Equal(t, videoToken.Key, key)
	key, err = GetDirectorTokenKey(userID, "text")
	require.NoError(t, err)
	assert.Equal(t, legacyToken.Key, key)
}

// 已分类 Key 与能力不匹配时拒绝绑定；存量空类型 Key 保持原有行为可用于任何能力；
// 已禁用令牌不可绑定；绑定后令牌被禁用时取 Key 报错引导重新选择。
func TestBindDirectorTokenValidation(t *testing.T) {
	const userID = 9103
	imageToken := insertDirectorBindTestToken(t, userID, "director-validate-image", TokenKeyTypeImage, common.TokenStatusEnabled)
	legacyToken := insertDirectorBindTestToken(t, userID, "director-validate-legacy", "", common.TokenStatusEnabled)
	disabledToken := insertDirectorBindTestToken(t, userID, "director-validate-disabled", TokenKeyTypeLanguage, common.TokenStatusDisabled)

	err := BindDirectorToken(userID, imageToken.Id, "text")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "语言模型 Key")

	require.NoError(t, BindDirectorToken(userID, legacyToken.Id, "text"))
	err = BindDirectorToken(userID, disabledToken.Id, "text")
	require.Error(t, err)

	// 绑定后令牌被禁用：取 Key 必须报错而不是继续用失效令牌计费
	require.NoError(t, DB.Model(&Token{}).Where("id = ?", legacyToken.Id).
		Update("status", common.TokenStatusDisabled).Error)
	_, err = GetDirectorTokenKey(userID, "text")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "已失效")

	// 完全未绑定的能力报错引导到模型设定
	_, err = GetDirectorTokenKey(userID, "video")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "模型设定")
}
