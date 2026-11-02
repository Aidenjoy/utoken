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

	all, err := GetAllUserTokens(0, 0, 10, false)
	require.NoError(t, err)
	require.Len(t, all, 1)
	assert.Equal(t, 9101, all[0].Id)

	total, err := CountUserTokens(0, false)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)

	softDeletedOwner, err := GetAllUserTokens(9002, 0, 10, false)
	require.NoError(t, err)
	require.Len(t, softDeletedOwner, 1)
	assert.Equal(t, 9102, softDeletedOwner[0].Id)

	orphanOwner, err := GetAllUserTokens(9003, 0, 10, false)
	require.NoError(t, err)
	require.Len(t, orphanOwner, 1)
	assert.Equal(t, 9103, orphanOwner[0].Id)
}

// 管理员排查视角：客户删掉密钥后，运营仍需在页面上看到这条令牌并取回明文，
// 而不是去查数据库。includeDeleted 打开时列表与总数必须同口径包含软删行，
// 且 DeletedAt 有值可供前端标注删除时间；默认口径不受影响。
func TestTokenScopeIncludeDeleted(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&User{}, &Token{}))
	cleanup := func() {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Token{}).Error)
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&User{}).Error)
	}
	cleanup()
	t.Cleanup(cleanup)

	require.NoError(t, DB.Create(&User{Id: 9011, Username: "deleted-scope", AffCode: "deleted-aff-9011"}).Error)
	tokens := []*Token{
		{Id: 9111, UserId: 9011, Key: "deleted-scope-key-live", Name: "live", Status: 1},
		{Id: 9112, UserId: 9011, Key: "deleted-scope-key-gone", Name: "gone", Status: 2},
	}
	require.NoError(t, DB.Create(&tokens).Error)
	require.NoError(t, DB.Delete(&Token{}, 9112).Error)

	live, err := GetAllUserTokens(9011, 0, 10, false)
	require.NoError(t, err)
	require.Len(t, live, 1)
	assert.Equal(t, 9111, live[0].Id)

	liveTotal, err := CountUserTokens(9011, false)
	require.NoError(t, err)
	assert.Equal(t, int64(1), liveTotal)

	withDeleted, err := GetAllUserTokens(9011, 0, 10, true)
	require.NoError(t, err)
	require.Len(t, withDeleted, 2)
	assert.Equal(t, 9112, withDeleted[0].Id, "id desc：软删行应出现在列表中")
	assert.True(t, withDeleted[0].DeletedAt.Valid)
	assert.False(t, withDeleted[1].DeletedAt.Valid)

	withDeletedTotal, err := CountUserTokens(9011, true)
	require.NoError(t, err)
	assert.Equal(t, int64(2), withDeletedTotal)

	// 取回明文：默认读取查不到软删行，管理员路径必须查得到且不写缓存
	_, err = GetTokenById(9112)
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
	recovered, err := GetTokenByIdIncludeDeleted(9112)
	require.NoError(t, err)
	assert.Equal(t, "deleted-scope-key-gone", recovered.Key)
	assert.True(t, recovered.DeletedAt.Valid)

	_, err = GetTokenByIdIncludeDeleted(0)
	assert.Error(t, err)
}
