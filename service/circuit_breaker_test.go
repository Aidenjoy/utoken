package service

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAutoDisableUserGuards 锁定熔断自动禁用的三条真实契约：
// 普通启用用户被置为 status=3；root 用户永不被自动禁用；已手动禁用(status=2)的用户
// 保持原状态不被覆盖，保证幂等且不丢失“手动禁用”这一标识。
// 该逻辑不依赖 Redis（TestMain 已设 RedisEnabled=false，缓存失效函数直接返回 nil）。
func TestAutoDisableUserGuards(t *testing.T) {
	require.NoError(t, model.DB.AutoMigrate(&model.User{}, &model.Log{}))
	cleanup := func() {
		model.DB.Exec("DELETE FROM users")
		model.DB.Exec("DELETE FROM logs")
	}
	cleanup()
	t.Cleanup(cleanup)

	tests := []struct {
		name         string
		userId       int
		role         int
		status       int
		expectStatus int
	}{
		{
			name:         "common enabled user is auto-disabled",
			userId:       9101,
			role:         common.RoleCommonUser,
			status:       common.UserStatusEnabled,
			expectStatus: common.UserStatusAutoDisabled,
		},
		{
			name:         "root user is never auto-disabled",
			userId:       9102,
			role:         common.RoleRootUser,
			status:       common.UserStatusEnabled,
			expectStatus: common.UserStatusEnabled,
		},
		{
			name:         "already manually disabled user stays disabled",
			userId:       9103,
			role:         common.RoleCommonUser,
			status:       common.UserStatusDisabled,
			expectStatus: common.UserStatusDisabled,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			user := &model.User{
				Id:       tt.userId,
				Username: fmt.Sprintf("cb-user-%d", tt.userId),
				AffCode:  fmt.Sprintf("cb-aff-%d", tt.userId),
				Role:     tt.role,
				Status:   tt.status,
				Group:    "default",
			}
			require.NoError(t, model.DB.Create(user).Error)

			autoDisableUser(tt.userId, int64(videoErrorThreshold))

			var reloaded model.User
			require.NoError(t, model.DB.First(&reloaded, "id = ?", tt.userId).Error)
			assert.Equal(t, tt.expectStatus, reloaded.Status)
		})
	}
}
