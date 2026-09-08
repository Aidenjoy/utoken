package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// 管理员“全部用户”视角必须排除归属用户已注销（软删或硬删）的令牌：
// 用户删除后 relay 鉴权取不到用户缓存会直接拒绝，这些密钥已不可用，
// 不应出现在列表与总数中；而按用户 ID 限定的视角不受该过滤影响。
func TestTokenScopeExcludesTokensOfDeletedUsers(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&User{}, &Token{}))
	cleanup := func() {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Token{}).Error)
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&User{}).Error)
	}
	cleanup()
	t.Cleanup(cleanup)

	require.NoError(t, DB.Create(&User{Id: 9001, Username: "scope-alive", AffCode: "scope-aff-9001"}).Error)
	require.NoError(t, DB.Create(&User{Id: 9002, Username: "scope-soft-deleted", AffCode: "scope-aff-9002"}).Error)
	require.NoError(t, DB.Delete(&User{}, 9002).Error) // 软删：行仍在，deleted_at 置位
	// 9003 不建用户行，模拟硬删后残留的孤儿令牌

	tokens := []*Token{
		{Id: 9101, UserId: 9001, Key: "scope-test-key-9101", Name: "alive", Status: 1},
		{Id: 9102, UserId: 9002, Key: "scope-test-key-9102", Name: "soft-deleted", Status: 1},
		{Id: 9103, UserId: 9003, Key: "scope-test-key-9103", Name: "hard-deleted", Status: 1},
	}
	require.NoError(t, DB.Create(&tokens).Error)

	all, err := GetAllUserTokens(0, 0, 10)
	require.NoError(t, err)
	require.Len(t, all, 1)
	assert.Equal(t, 9101, all[0].Id)

	total, err := CountUserTokens(0)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)

	softDeletedOwner, err := GetAllUserTokens(9002, 0, 10)
	require.NoError(t, err)
	require.Len(t, softDeletedOwner, 1)
	assert.Equal(t, 9102, softDeletedOwner[0].Id)

	orphanOwner, err := GetAllUserTokens(9003, 0, 10)
	require.NoError(t, err)
	require.Len(t, orphanOwner, 1)
	assert.Equal(t, 9103, orphanOwner[0].Id)
}
