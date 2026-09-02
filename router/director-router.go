package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"

	"github.com/gin-gonic/gin"
)

// registerDirectorRoutes 云导演（Cloud Director）业务路由，所有登录用户可用。
// 内部 AI 调用经用户专属令牌回环网关 /v1/* 端点，计费计到调用者本人账户。
func registerDirectorRoutes(apiRouter *gin.RouterGroup) {
	directorRoute := apiRouter.Group("/director")
	directorRoute.Use(middleware.UserAuth())

	// 模型设定与内部令牌
	{
		directorRoute.GET("/settings", controller.DirectorGetSettings)
		directorRoute.PUT("/settings", controller.DirectorUpdateSettings)
	}

	// 项目（短剧/电商/广告/日常由 category 区分）
	{
		directorRoute.POST("/project", controller.DirectorCreateProject)
		directorRoute.PUT("/project", controller.DirectorUpdateProject)
		directorRoute.DELETE("/project", controller.DirectorDeleteProject)
		directorRoute.GET("/project", controller.DirectorGetProject)
		directorRoute.GET("/project/list", controller.DirectorGetProjectList)
	}

	// 分集与 AI 编排
	{
		directorRoute.POST("/episode", controller.DirectorCreateEpisode)
		directorRoute.PUT("/episode", controller.DirectorUpdateEpisode)
		directorRoute.DELETE("/episode", controller.DirectorDeleteEpisode)
		directorRoute.GET("/episode", controller.DirectorGetEpisode)
		directorRoute.GET("/episode/list", controller.DirectorGetEpisodeList)
		directorRoute.GET("/episode/pipeline", controller.DirectorGetEpisodePipeline)
		directorRoute.POST("/episode/rewrite", controller.DirectorRewriteEpisodeScript)
		directorRoute.POST("/episode/extract", controller.DirectorExtractEpisodeRolesScenes)
		directorRoute.POST("/episode/prompts", controller.DirectorGenerateEpisodePrompts)
		directorRoute.POST("/episode/splitStoryboards", controller.DirectorSplitEpisodeStoryboards)
		directorRoute.POST("/episode/character", controller.DirectorAddEpisodeCharacter)
		directorRoute.POST("/episode/scene", controller.DirectorAddEpisodeScene)
	}

	// 角色
	{
		directorRoute.POST("/character", controller.DirectorCreateCharacter)
		directorRoute.PUT("/character", controller.DirectorUpdateCharacter)
		directorRoute.DELETE("/character", controller.DirectorDeleteCharacter)
		directorRoute.GET("/character", controller.DirectorGetCharacter)
		directorRoute.GET("/character/list", controller.DirectorGetCharacterList)
		directorRoute.POST("/character/image", controller.DirectorGenerateCharacterImage)
		directorRoute.POST("/character/prompt", controller.DirectorGenerateCharacterPrompt)
	}

	// 场景
	{
		directorRoute.POST("/scene", controller.DirectorCreateScene)
		directorRoute.PUT("/scene", controller.DirectorUpdateScene)
		directorRoute.DELETE("/scene", controller.DirectorDeleteScene)
		directorRoute.GET("/scene", controller.DirectorGetScene)
		directorRoute.GET("/scene/list", controller.DirectorGetSceneList)
		directorRoute.POST("/scene/image", controller.DirectorGenerateSceneImage)
		directorRoute.POST("/scene/prompt", controller.DirectorGenerateScenePrompt)
	}

	// 道具
	{
		directorRoute.POST("/prop", controller.DirectorCreateProp)
		directorRoute.PUT("/prop", controller.DirectorUpdateProp)
		directorRoute.DELETE("/prop", controller.DirectorDeleteProp)
		directorRoute.GET("/prop", controller.DirectorGetProp)
		directorRoute.GET("/prop/list", controller.DirectorGetPropList)
		directorRoute.POST("/prop/image", controller.DirectorGeneratePropImage)
		directorRoute.POST("/prop/prompt", controller.DirectorGeneratePropPrompt)
	}

	// 分镜
	{
		directorRoute.POST("/storyboard", controller.DirectorCreateStoryboard)
		directorRoute.PUT("/storyboard", controller.DirectorUpdateStoryboard)
		directorRoute.DELETE("/storyboard", controller.DirectorDeleteStoryboard)
		directorRoute.GET("/storyboard", controller.DirectorGetStoryboard)
		directorRoute.GET("/storyboard/list", controller.DirectorGetStoryboardList)
		directorRoute.POST("/storyboard/image", controller.DirectorGenerateStoryboardImage)
		directorRoute.POST("/storyboard/prompt", controller.DirectorGenerateStoryboardPrompt)
		directorRoute.POST("/storyboard/video", controller.DirectorGenerateStoryboardVideo)
		directorRoute.POST("/storyboard/videoPrompt", controller.DirectorGenerateStoryboardVideoPrompt)
	}

	// 生成任务查询（前端轮询）
	{
		directorRoute.GET("/imageGeneration", controller.DirectorGetImageGeneration)
		directorRoute.GET("/imageGeneration/list", controller.DirectorGetImageGenerationList)
		directorRoute.GET("/videoGeneration", controller.DirectorGetVideoGeneration)
		directorRoute.GET("/videoGeneration/list", controller.DirectorGetVideoGenerationList)
	}

	// 在线剪辑
	{
		directorRoute.GET("/edit/project", controller.DirectorGetEditProject)
		directorRoute.PUT("/edit/project", controller.DirectorSaveEditProject)
		directorRoute.POST("/edit/render", controller.DirectorSubmitEditRender)
		directorRoute.GET("/edit/renderProgress", controller.DirectorGetEditRenderProgress)
		directorRoute.POST("/edit/subtitleCorrect", controller.DirectorCorrectSubtitles)
	}

	// 素材库
	{
		directorRoute.POST("/asset", controller.DirectorCreateAsset)
		directorRoute.PUT("/asset", controller.DirectorUpdateAsset)
		directorRoute.DELETE("/asset", controller.DirectorDeleteAsset)
		directorRoute.GET("/asset/list", controller.DirectorGetAssetList)
		directorRoute.POST("/asset/upload", controller.DirectorUploadAsset)
		directorRoute.GET("/asset/category/list", controller.DirectorGetAssetCategoryList)
		directorRoute.POST("/asset/category", controller.DirectorCreateAssetCategory)
		directorRoute.PUT("/asset/category", controller.DirectorUpdateAssetCategory)
		directorRoute.DELETE("/asset/category", controller.DirectorDeleteAssetCategory)
	}
}
