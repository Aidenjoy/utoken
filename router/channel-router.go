package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/gin-gonic/gin"
)

// 渠道菜单页面级权限：拥有 menu/channels 的管理员可使用该页全部增删改查接口；
// 渠道账单仅能共用列表与搜索接口，其它接口由 RequirePermission 在服务端强制拦截。
func registerChannelRoutes(apiRouter *gin.RouterGroup) {
	channelRoute := apiRouter.Group("/channel")
	channelRoute.Use(middleware.AdminAuth())
	{
		// 渠道账单需要渠道筛选器，但不能因此获得渠道菜单的其它管理能力。
		channelReadPermission := middleware.RequireAnyPermission(authz.MenuChannels, authz.MenuChannelBilling)
		channelRoute.GET("/", channelReadPermission, controller.GetAllChannels)
		channelRoute.GET("/search", channelReadPermission, controller.SearchChannels)

		channelManageRoute := channelRoute.Group("/", middleware.RequirePermission(authz.MenuChannels))
		// 渠道菜单授权覆盖整页能力；查看完整密钥仍须通过安全验证并保留审计。
		channelManageRoute.POST("/:id/key",
			middleware.CriticalRateLimit(),
			middleware.DisableCache(),
			middleware.SecureVerificationRequired(),
			controller.GetChannelKey,
		)

		channelManageRoute.GET("/models", controller.ChannelListModels)
		channelManageRoute.GET("/models_enabled", controller.EnabledListModels)
		channelManageRoute.GET("/ops", controller.GetChannelOps)
		channelManageRoute.GET("/:id", controller.GetChannel)
		channelManageRoute.GET("/test", controller.TestAllChannels)
		channelManageRoute.GET("/test/:id", controller.TestChannel)
		channelManageRoute.GET("/update_balance", controller.UpdateAllChannelsBalance)
		channelManageRoute.GET("/update_balance/:id", controller.UpdateChannelBalance)
		channelManageRoute.POST("/", controller.AddChannel)
		channelManageRoute.PUT("/", controller.UpdateChannel)
		channelManageRoute.POST("/status/batch", controller.BatchUpdateChannelStatus)
		channelManageRoute.POST("/:id/status", controller.UpdateChannelStatus)
		channelManageRoute.DELETE("/disabled", controller.DeleteDisabledChannel)
		channelManageRoute.POST("/tag/disabled", controller.DisableTagChannels)
		channelManageRoute.POST("/tag/enabled", controller.EnableTagChannels)
		channelManageRoute.PUT("/tag", controller.EditTagChannels)
		channelManageRoute.DELETE("/:id", controller.DeleteChannel)
		channelManageRoute.POST("/batch", controller.DeleteChannelBatch)
		channelManageRoute.POST("/fix", controller.FixChannelsAbilities)
		channelManageRoute.GET("/fetch_models/:id", controller.FetchUpstreamModels)
		channelManageRoute.POST("/fetch_models", controller.FetchModels)
		channelManageRoute.POST("/:id/codex/refresh", controller.RefreshCodexChannelCredential)
		channelManageRoute.GET("/:id/codex/usage", controller.GetCodexChannelUsage)
		channelManageRoute.GET("/:id/codex/usage/reset-credits", controller.GetCodexChannelRateLimitResetCredits)
		channelManageRoute.POST("/:id/codex/usage/reset", controller.ResetCodexChannelUsage)
		channelManageRoute.POST("/ollama/pull", controller.OllamaPullModel)
		channelManageRoute.POST("/ollama/pull/stream", controller.OllamaPullModelStream)
		channelManageRoute.DELETE("/ollama/delete", controller.OllamaDeleteModel)
		channelManageRoute.GET("/ollama/version/:id", controller.OllamaVersion)
		channelManageRoute.POST("/batch/tag", controller.BatchSetChannelTag)
		channelManageRoute.GET("/tag/models", controller.GetTagModels)
		channelManageRoute.POST("/copy/:id", controller.CopyChannel)
		channelManageRoute.POST("/multi_key/manage", controller.ManageMultiKeys)
		channelManageRoute.POST("/upstream_updates/apply", controller.ApplyChannelUpstreamModelUpdates)
		channelManageRoute.POST("/upstream_updates/apply_all", controller.ApplyAllChannelUpstreamModelUpdates)
		channelManageRoute.POST("/upstream_updates/detect", controller.DetectChannelUpstreamModelUpdates)
		channelManageRoute.POST("/upstream_updates/detect_all", controller.DetectAllChannelUpstreamModelUpdates)
	}
}
