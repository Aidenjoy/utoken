package controller

import (
	"encoding/json"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// ---------- 在线剪辑 ----------

// DirectorGetEditProject 查询分集剪辑工程（不存在时返回空草稿，前端轮询渲染状态也走这里）
func DirectorGetEditProject(c *gin.Context) {
	episodeID := directorQueryInt(c, "episodeId")
	if episodeID <= 0 {
		common.ApiErrorMsg(c, "缺少分集ID")
		return
	}
	if !directorOwnedEpisodeID(c, episodeID) {
		return
	}
	project, _, err := directorEditSvc.GetEditProject(episodeID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, project)
}

// DirectorSaveEditProject 保存剪辑草稿（upsert，时间轴变化使旧渲染结果失效）
func DirectorSaveEditProject(c *gin.Context) {
	userId := c.GetInt("id")
	// Timeline 接收前端 JSON.stringify 后的字符串，原样存储
	var req struct {
		EpisodeID int    `json:"episodeId"`
		Name      string `json:"name"`
		Timeline  string `json:"timeline"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.EpisodeID <= 0 {
		common.ApiErrorMsg(c, "缺少分集ID")
		return
	}
	if !directorOwnedEpisodeID(c, req.EpisodeID) {
		return
	}
	timeline := strings.TrimSpace(req.Timeline)
	if timeline == "" || timeline == "null" {
		common.ApiErrorMsg(c, "剪辑时间轴不能为空")
		return
	}
	project, err := directorEditSvc.SaveEditProject(userId, req.EpisodeID, req.Name, timeline)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, project)
}

// DirectorSubmitEditRender 提交剪辑云端渲染（异步 ffmpeg，轮询 editProject 获取状态）
func DirectorSubmitEditRender(c *gin.Context) {
	userId := c.GetInt("id")
	var req struct {
		EpisodeID int `json:"episodeId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.EpisodeID <= 0 {
		common.ApiErrorMsg(c, "缺少分集ID")
		return
	}
	if !directorOwnedEpisodeID(c, req.EpisodeID) {
		return
	}
	projectID, err := directorEditSvc.SubmitEditRender(userId, req.EpisodeID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"projectId": projectID})
}

// DirectorGetEditRenderProgress 查询剪辑渲染实时进度（内存态，前端轮询）
func DirectorGetEditRenderProgress(c *gin.Context) {
	projectID := directorQueryInt(c, "projectId")
	if projectID <= 0 {
		common.ApiErrorMsg(c, "缺少剪辑工程ID")
		return
	}
	ep, err := model.GetDirectorEditProjectByID(projectID)
	if err != nil || !directorOwned(c, ep.UserID) {
		common.ApiErrorMsg(c, "剪辑工程不存在")
		return
	}
	common.ApiSuccess(c, directorEditSvc.GetEditRenderProgress(projectID))
}

// DirectorCorrectSubtitles AI 字幕纠错（结合剧本上下文纠正错别字/同音字）
func DirectorCorrectSubtitles(c *gin.Context) {
	userId := c.GetInt("id")
	var req struct {
		EpisodeID int             `json:"episodeId"`
		Subtitles json.RawMessage `json:"subtitles"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.EpisodeID <= 0 || len(req.Subtitles) == 0 {
		common.ApiErrorMsg(c, "缺少分集ID或字幕数据")
		return
	}
	if !directorOwnedEpisodeID(c, req.EpisodeID) {
		return
	}
	// 字幕结构由 service 层定义与校验，这里透传原始 JSON
	subtitles, err := directorEditSvc.CorrectSubtitlesRaw(userId, req.EpisodeID, req.Subtitles)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"subtitles": subtitles})
}
