package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"

	"github.com/gin-gonic/gin"
)

// registerPromptRoutes 挂载 Prompt 模板库到 /api/prompt 命名空间。
//
// 全部端点只要求登录：可见范围与可管理范围由 controller 按模板实体上的
// visibility / user_id / org_id 判定，而不是靠路由分组区分角色。
// 这样企业管理员与 root 无需各自的端点，普通成员也不会因为路由放行而越权。
//
//	GET    /api/prompt/          列表（keyword / tag / visibility / scope / 分页）
//	GET    /api/prompt/tags      可见模板的标签集合
//	GET    /api/prompt/:id       详情
//	POST   /api/prompt/          新建
//	PUT    /api/prompt/:id       更新
//	DELETE /api/prompt/:id       删除
//	POST   /api/prompt/:id/copy  复制为自己的副本
//	POST   /api/prompt/:id/use   记录一次"在 Playground 中使用"
func registerPromptRoutes(apiRouter *gin.RouterGroup) {
	promptRoute := apiRouter.Group("/prompt")
	promptRoute.Use(middleware.UserAuth())
	{
		promptRoute.GET("/", middleware.SearchRateLimit(), controller.GetPromptTemplates)
		promptRoute.GET("/tags", controller.GetPromptTemplateTags)
		promptRoute.GET("/:id", controller.GetPromptTemplate)
		promptRoute.POST("/", middleware.CriticalRateLimit(), controller.CreatePromptTemplate)
		promptRoute.PUT("/:id", middleware.CriticalRateLimit(), controller.UpdatePromptTemplate)
		promptRoute.DELETE("/:id", middleware.CriticalRateLimit(), controller.DeletePromptTemplate)
		promptRoute.POST("/:id/copy", middleware.CriticalRateLimit(), controller.CopyPromptTemplate)
		promptRoute.POST("/:id/use", controller.UsePromptTemplate)
	}
}
