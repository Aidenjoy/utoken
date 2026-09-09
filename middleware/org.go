package middleware

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// setOrgContext 把用户的企业（组织）上下文写入 gin.Context。
// 数据优先取用户缓存（Redis 命中时零 DB 开销），miss 时由 GetUserCache 回源查库并异步回填；
// 取不到时按"无企业"处理（org_id=0），不阻断请求。
func setOrgContext(c *gin.Context, userId int) {
	orgId := 0
	orgRole := ""
	if userId > 0 {
		if userCache, err := model.GetUserCache(userId); err == nil && userCache != nil {
			orgId = userCache.OrgId
			orgRole = userCache.OrgRole
		}
	}
	common.SetContextKey(c, constant.ContextKeyUserOrgId, orgId)
	common.SetContextKey(c, constant.ContextKeyUserOrgRole, orgRole)
}

// OrgIdFromContext 返回鉴权上下文里的企业 ID，0 表示用户不属于任何企业
func OrgIdFromContext(c *gin.Context) int {
	return c.GetInt(string(constant.ContextKeyUserOrgId))
}

// OrgRoleFromContext 返回鉴权上下文里的企业成员角色（model.OrgRoleAdmin / model.OrgRoleMember）
func OrgRoleFromContext(c *gin.Context) string {
	return c.GetString(string(constant.ContextKeyUserOrgRole))
}

// IsOrgAdmin 当前请求是否以企业管理员身份发起（仅企业内语义，与系统角色无关）
func IsOrgAdmin(c *gin.Context) bool {
	return OrgRoleFromContext(c) == model.OrgRoleAdmin
}

// IsSystemAdmin 当前请求是否来自系统管理员（role >= RoleAdminUser）
func IsSystemAdmin(c *gin.Context) bool {
	return c.GetInt("role") >= common.RoleAdminUser
}

// OrgScopeId 解析本次请求要操作的企业 ID。
// 成员与企业管理员固定取自己所属企业；系统管理员代管时可通过 org_id 查询参数显式指定。
// 返回 0 表示无法确定企业，调用方应按"企业不存在"响应，避免泄露他人企业的存在性。
func OrgScopeId(c *gin.Context) int {
	if orgId := OrgIdFromContext(c); orgId > 0 {
		return orgId
	}
	if IsSystemAdmin(c) {
		if orgId, err := strconv.Atoi(c.Query("org_id")); err == nil && orgId > 0 {
			return orgId
		}
	}
	return 0
}

func abortWithOrgForbidden(c *gin.Context, key string) {
	c.JSON(http.StatusForbidden, gin.H{
		"success": false,
		"message": common.TranslateMessage(c, key),
	})
	c.Abort()
}

// OrgMemberAuth 企业成员鉴权：要求调用者属于启用状态的企业且成员本身启用。
// 系统管理员（role >= RoleAdminUser）可越过，以便在后台代管企业。
func OrgMemberAuth() func(c *gin.Context) {
	return func(c *gin.Context) {
		if IsSystemAdmin(c) {
			c.Next()
			return
		}
		orgId := OrgIdFromContext(c)
		if orgId <= 0 {
			abortWithOrgForbidden(c, i18n.MsgOrgMemberOnly)
			return
		}
		org, member, err := model.GetActiveOrganizationForUser(c.GetInt("id"))
		if err != nil {
			common.ApiErrorI18n(c, i18n.MsgDatabaseError)
			c.Abort()
			return
		}
		if org == nil || member == nil {
			abortWithOrgForbidden(c, i18n.MsgOrgMemberOnly)
			return
		}
		c.Next()
	}
}

// OrgAdminAuth 企业管理员鉴权：在成员鉴权基础上要求 org_role == admin。
// 系统管理员同样可越过以便后台代管。
func OrgAdminAuth() func(c *gin.Context) {
	return func(c *gin.Context) {
		if IsSystemAdmin(c) {
			c.Next()
			return
		}
		orgId := OrgIdFromContext(c)
		if orgId <= 0 {
			abortWithOrgForbidden(c, i18n.MsgOrgMemberOnly)
			return
		}
		org, member, err := model.GetActiveOrganizationForUser(c.GetInt("id"))
		if err != nil {
			common.ApiErrorI18n(c, i18n.MsgDatabaseError)
			c.Abort()
			return
		}
		if org == nil || member == nil {
			abortWithOrgForbidden(c, i18n.MsgOrgMemberOnly)
			return
		}
		if !member.IsAdmin() {
			abortWithOrgForbidden(c, i18n.MsgOrgAdminOnly)
			return
		}
		c.Next()
	}
}
