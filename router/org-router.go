package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/service/authz"

	"github.com/gin-gonic/gin"
)

// registerOrgRoutes 挂载企业（组织）接口到 /api/org 命名空间。
//
// 三组权限互不重叠，与既有 /api/user 的 selfRoute / adminRoute 分组方式一致
// （父组不挂鉴权，每个子组各自挂一次，避免重复鉴权开销）：
//
//	GET  /api/org/summary          登录即可，无企业返回 org_id=0 供前端渲染空态引导页
//	/api/org/*                     企业管理员，权限严格限定在本企业内
//	/api/org/admin/*               系统管理员，企业 CRUD、充值调额与禁用
//
// 企业管理员不是系统角色：OrgAdminAuth 只认 org_members.org_role，
// 与 RoleAdminUser 无任何交集；系统管理员可越过以便在后台代管企业。
func registerOrgRoutes(apiRouter *gin.RouterGroup) {
	orgRoute := apiRouter.Group("/org")
	{
		orgRoute.GET("/summary", middleware.UserAuth(), controller.GetOrgSummary)

		// 企业管理员：设置、成员、报表与消费明细
		orgAdminRoute := orgRoute.Group("/")
		orgAdminRoute.Use(middleware.UserAuth(), middleware.OrgAdminAuth())
		{
			orgAdminRoute.GET("/", controller.GetOrganization)
			orgAdminRoute.PUT("/", controller.UpdateOrganization)
			orgAdminRoute.GET("/members", middleware.SearchRateLimit(), controller.GetOrgMembers)
			orgAdminRoute.POST("/members/create", middleware.CriticalRateLimit(), controller.CreateOrgMember)
			orgAdminRoute.POST("/members/invite", middleware.CriticalRateLimit(), controller.InviteOrgMember)
			orgAdminRoute.PUT("/members/:id", controller.UpdateOrgMember)
			orgAdminRoute.DELETE("/members/:id", controller.RemoveOrgMember)
			orgAdminRoute.GET("/usage", controller.GetOrgUsage)
			orgAdminRoute.GET("/logs", controller.GetOrgLogs)
			orgAdminRoute.GET("/tokens", middleware.SearchRateLimit(), controller.GetOrgTokens)
			orgAdminRoute.POST("/wallet/transfer", middleware.CriticalRateLimit(), controller.TransferWalletToPool)
		}

		// 企业列表同时供企业管理、费率管理与用户账单的筛选器使用；其余接口归属企业管理菜单。
		sysAdminRoute := orgRoute.Group("/admin")
		sysAdminRoute.Use(middleware.AdminAuth())
		{
			sysAdminRoute.GET("/",
				middleware.RequireAnyPermission(authz.MenuOrganizations, authz.MenuTokenRates, authz.MenuUserBilling),
				controller.AdminGetAllOrganizations,
			)
			sysAdminRoute.PUT("/:id/token_rate",
				middleware.RequireAnyPermission(authz.MenuOrganizations, authz.MenuTokenRates),
				controller.AdminUpdateOrgTokenRate,
			)

			orgAdminRoute := sysAdminRoute.Group("/", middleware.RequirePermission(authz.MenuOrganizations))
			orgAdminRoute.POST("/", middleware.CriticalRateLimit(), controller.AdminCreateOrganization)
			orgAdminRoute.GET("/:id", controller.AdminGetOrganization)
			orgAdminRoute.PUT("/:id", controller.AdminUpdateOrganization)
			orgAdminRoute.DELETE("/:id", controller.AdminDeleteOrganization)
			orgAdminRoute.POST("/:id/quota", controller.AdminAdjustOrgQuota)
			orgAdminRoute.PUT("/:id/model_discounts", controller.AdminUpdateOrgModelDiscounts)
			orgAdminRoute.PATCH("/:id/status", controller.AdminUpdateOrgStatus)
			orgAdminRoute.GET("/:id/members", middleware.SearchRateLimit(), controller.AdminGetOrgMembers)
		}
	}
}
