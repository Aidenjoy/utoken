package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"

	"github.com/gin-gonic/gin"
)

// registerCanvasRoutes 智能画布业务路由，所有登录用户可用。
// 生成/编辑统一经网关自身的 /v1/images/generations 回环转发（Ark 工具）或直连
// AI MediaKit 同步工具（无 Relay 适配器的工具），计费口径见 service/canvas。
func registerCanvasRoutes(apiRouter *gin.RouterGroup) {
	canvasRoute := apiRouter.Group("/canvas")
	canvasRoute.Use(middleware.UserAuth())

	// 能力与项目
	{
		canvasRoute.GET("/capabilities", controller.CanvasCapabilities)
		canvasRoute.GET("/assets", controller.CanvasListAssets)
		canvasRoute.POST("/upload", controller.CanvasUploadImage)
		canvasRoute.GET("/image", controller.CanvasProxyImage)
		canvasRoute.GET("/local-asset/*name", controller.CanvasLocalAsset)
		canvasRoute.GET("/projects", controller.CanvasListProjects)
		canvasRoute.POST("/projects", controller.CanvasCreateProject)
		canvasRoute.GET("/projects/:id", controller.CanvasGetProject)
		canvasRoute.PUT("/projects/:id", controller.CanvasRenameProject)
		canvasRoute.DELETE("/projects/:id", controller.CanvasDeleteProject)
		canvasRoute.PUT("/projects/:id/document", controller.CanvasSaveDocument)
	}

	// 任务
	{
		canvasRoute.POST("/tasks", controller.CanvasCreateTask)
		canvasRoute.GET("/tasks", controller.CanvasListTasks)
		canvasRoute.GET("/tasks/:id", controller.CanvasGetTask)
		canvasRoute.POST("/tasks/:id/cancel", controller.CanvasCancelTask)
		canvasRoute.POST("/tasks/:id/repersist", controller.CanvasRepersistTask)
		canvasRoute.POST("/tasks/:id/save-asset", controller.CanvasSaveResultToAsset)
		canvasRoute.GET("/tasks/:id/download", controller.CanvasDownloadResult)
	}
}
