package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"

	"github.com/gin-gonic/gin"
)

// registerCanvasRoutes 智能画布（Smart Canvas）业务路由，所有登录用户可用。
// 生成复用云导演模型设定，内部 AI 调用经用户专属令牌回环网关 /v1/* 端点，
// 计费计到调用者本人账户。
func registerCanvasRoutes(apiRouter *gin.RouterGroup) {
	canvasRoute := apiRouter.Group("/canvas")
	canvasRoute.Use(middleware.UserAuth())

	// 画布项目（列表不含文档大字段，进入编辑器才拉取完整文档）
	{
		canvasRoute.POST("/project", controller.CanvasCreateProject)
		canvasRoute.GET("/project", controller.CanvasGetProject)
		canvasRoute.GET("/project/list", controller.CanvasGetProjectList)
		canvasRoute.PUT("/project", controller.CanvasUpdateProject)
		canvasRoute.DELETE("/project", controller.CanvasDeleteProject)
		canvasRoute.POST("/project/duplicate", controller.CanvasDuplicateProject)
		canvasRoute.GET("/project/recycle", controller.CanvasRecycleBinList)
		canvasRoute.POST("/project/restore", controller.CanvasRestoreProject)
		canvasRoute.DELETE("/project/permanent", controller.CanvasPermanentDeleteProject)
	}

	// 节点生成与任务轮询
	{
		canvasRoute.POST("/generate", controller.CanvasGenerate)
		canvasRoute.GET("/generation", controller.CanvasGetGeneration)
		canvasRoute.POST("/generation/cancel", controller.CanvasCancelGeneration)
		canvasRoute.GET("/generation/list", controller.CanvasGetGenerationList)
	}

	// Agent 草案（文本模型产出节点画布草案）
	canvasRoute.POST("/agent/draft", controller.CanvasAgentDraft)
	canvasRoute.POST("/prompt/optimize", controller.CanvasOptimizePrompt)
	canvasRoute.POST("/script/split", controller.CanvasScriptSplit)

	// 参考图/素材上传
	canvasRoute.POST("/upload", controller.CanvasUpload)

	// 本地回退上传文件访问：<img> 请求无法携带 New-Api-User 头，
	// 用会话鉴权（TryUserAuth），handler 内校验文件归属
	apiRouter.GET("/local-file/:name", middleware.TryUserAuth(), controller.LocalUploadFile)
}
