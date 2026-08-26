package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"

	"github.com/gin-gonic/gin"
)

func SetVideoRouter(router *gin.Engine) {
	// Video proxy: accepts either session auth (dashboard) or token auth (API clients)
	videoProxyRouter := router.Group("/v1")
	videoProxyRouter.Use(middleware.RouteTag("relay"))
	videoProxyRouter.Use(middleware.TokenOrUserAuth())
	{
		videoProxyRouter.GET("/videos/:task_id/content", controller.VideoProxy)
	}

	videoV1Router := router.Group("/v1")
	videoV1Router.Use(middleware.RouteTag("relay"))
	videoV1Router.Use(middleware.TokenAuth(), middleware.Distribute())
	{
		videoV1Router.POST("/video/generations", controller.RelayTask)
		videoV1Router.GET("/video/generations/:task_id", controller.RelayTaskFetch)
		videoV1Router.POST("/videos/:video_id/remix", controller.RelayTask)
	}
	// openai compatible API video routes
	// docs: https://platform.openai.com/docs/api-reference/videos/create
	{
		videoV1Router.POST("/videos", controller.RelayTask)
		videoV1Router.GET("/videos/:task_id", controller.RelayTaskFetch)
	}

	klingV1Router := router.Group("/kling/v1")
	klingV1Router.Use(middleware.RouteTag("relay"))
	klingV1Router.Use(middleware.KlingRequestConvert(), middleware.TokenAuth(), middleware.Distribute())
	{
		klingV1Router.POST("/videos/text2video", controller.RelayTask)
		klingV1Router.POST("/videos/image2video", controller.RelayTask)
		klingV1Router.GET("/videos/text2video/:task_id", controller.RelayTaskFetch)
		klingV1Router.GET("/videos/image2video/:task_id", controller.RelayTaskFetch)
	}

	// Jimeng official API routes - direct mapping to official API format
	jimengOfficialGroup := router.Group("jimeng")
	jimengOfficialGroup.Use(middleware.RouteTag("relay"))
	jimengOfficialGroup.Use(middleware.JimengRequestConvert(), middleware.TokenAuth(), middleware.Distribute())
	{
		// Maps to: /?Action=CVSync2AsyncSubmitTask&Version=2022-08-31 and /?Action=CVSync2AsyncGetResult&Version=2022-08-31
		jimengOfficialGroup.POST("/", controller.RelayTask)
	}

	// Volcengine Ark official-protocol routes — clients of the official Ark API
	// can point their base_url at this server and keep the exact same paths.
	arkNativeRouter := router.Group("/api/v3")
	arkNativeRouter.Use(middleware.RouteTag("relay"))
	arkNativeRouter.Use(middleware.TokenAuth(), middleware.Distribute())
	{
		arkNativeRouter.POST("/contents/generations/tasks", controller.RelayTask)
		arkNativeRouter.GET("/contents/generations/tasks/:task_id", controller.RelayTaskFetch)
	}

	// 中转站风格素材库对外 API（兼容 ctaigw 契约）：下游客户端/下级网关
	// 用 Bearer token 注册与查询素材，本站可作为其素材协议的中转上游。
	relayAssetRouter := router.Group("/v1/api/assets")
	relayAssetRouter.Use(middleware.RouteTag("relay"))
	relayAssetRouter.Use(middleware.TokenAuth())
	{
		relayAssetRouter.POST("/upload", controller.RelayUploadAsset)
		relayAssetRouter.GET("/:id", controller.RelayGetAsset)
	}
}
