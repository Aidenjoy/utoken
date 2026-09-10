package middleware

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setupOrgAuthFixture 迁移企业鉴权所需的表并注册清理。
// middleware 包的 TestMain 只迁移 Asset，这里按需补齐。
func setupOrgAuthFixture(t *testing.T) {
	t.Helper()
	require.NoError(t, model.DB.AutoMigrate(&model.Organization{}, &model.OrgMember{}, &model.User{}))
	cleanup := func() {
		model.DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&model.OrgMember{})
		model.DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&model.Organization{})
		model.DB.Exec("DELETE FROM users")
	}
	cleanup()
	t.Cleanup(cleanup)
}

// seedOrgAuthUser 写入企业、成员与用户，返回 userId。成员/企业状态与角色由参数决定。
func seedOrgAuthUser(t *testing.T, orgId int, userId int, orgRole string, orgStatus int, memberStatus int) int {
	t.Helper()
	org := &model.Organization{
		Id: orgId, Name: fmt.Sprintf("auth-org-%d", orgId), DisplayName: fmt.Sprintf("Auth %d", orgId),
		Group: "default", Status: orgStatus, Quota: 1000,
	}
	require.NoError(t, model.DB.Create(org).Error)
	user := &model.User{
		Id: userId, Username: fmt.Sprintf("auth-user-%d", userId), AffCode: fmt.Sprintf("auth-aff-%d", userId),
		Status: common.UserStatusEnabled, Group: "default", OrgId: orgId,
	}
	require.NoError(t, model.DB.Create(user).Error)
	member := &model.OrgMember{OrgId: orgId, UserId: userId, OrgRole: orgRole, Status: memberStatus}
	require.NoError(t, model.DB.Create(member).Error)
	return userId
}

// newOrgAuthContext 构造带鉴权上下文的 gin.Context。
func newOrgAuthContext(role int, userId int, orgId int) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/org/members", nil)
	c.Set("role", role)
	c.Set("id", userId)
	common.SetContextKey(c, constant.ContextKeyUserOrgId, orgId)
	return c, w
}

// TestOrgMemberAuthGuards 校验企业成员鉴权：
// 非成员 403、启用成员放行、系统管理员越过（便于后台代管）。
func TestOrgMemberAuthGuards(t *testing.T) {
	setupOrgAuthFixture(t)
	userId := seedOrgAuthUser(t, 1, 101, model.OrgRoleMember, model.OrgStatusEnabled, model.OrgMemberStatusEnabled)

	t.Run("non member is forbidden", func(t *testing.T) {
		c, w := newOrgAuthContext(common.RoleCommonUser, 999, 0)
		OrgMemberAuth()(c)
		assert.True(t, c.IsAborted())
		assert.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("active member passes", func(t *testing.T) {
		c, _ := newOrgAuthContext(common.RoleCommonUser, userId, 1)
		OrgMemberAuth()(c)
		assert.False(t, c.IsAborted())
	})

	t.Run("disabled member is forbidden", func(t *testing.T) {
		// 上下文声明属于企业 1，但成员在库中已停用 -> GetActiveOrganizationForUser 返回 nil
		disabledUserId := seedOrgAuthUser(t, 2, 102, model.OrgRoleMember, model.OrgStatusEnabled, model.OrgMemberStatusDisabled)
		c, w := newOrgAuthContext(common.RoleCommonUser, disabledUserId, 2)
		OrgMemberAuth()(c)
		assert.True(t, c.IsAborted())
		assert.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("system admin bypasses without membership", func(t *testing.T) {
		c, _ := newOrgAuthContext(common.RoleAdminUser, 500, 0)
		OrgMemberAuth()(c)
		assert.False(t, c.IsAborted(), "system admin may manage orgs on behalf of others")
	})
}

// TestOrgAdminAuthGuards 校验企业管理员鉴权：
// 普通成员 403、企业管理员放行、系统管理员越过。企业管理员身份只在本企业内生效。
func TestOrgAdminAuthGuards(t *testing.T) {
	setupOrgAuthFixture(t)
	memberId := seedOrgAuthUser(t, 1, 201, model.OrgRoleMember, model.OrgStatusEnabled, model.OrgMemberStatusEnabled)
	adminId := seedOrgAuthUser(t, 2, 202, model.OrgRoleAdmin, model.OrgStatusEnabled, model.OrgMemberStatusEnabled)

	t.Run("plain member is forbidden", func(t *testing.T) {
		c, w := newOrgAuthContext(common.RoleCommonUser, memberId, 1)
		OrgAdminAuth()(c)
		assert.True(t, c.IsAborted())
		assert.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("org admin passes", func(t *testing.T) {
		c, _ := newOrgAuthContext(common.RoleCommonUser, adminId, 2)
		OrgAdminAuth()(c)
		assert.False(t, c.IsAborted())
	})

	t.Run("system admin bypasses", func(t *testing.T) {
		c, _ := newOrgAuthContext(common.RoleAdminUser, 500, 0)
		OrgAdminAuth()(c)
		assert.False(t, c.IsAborted())
	})
}
