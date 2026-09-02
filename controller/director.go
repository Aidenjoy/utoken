package controller

import (
	"errors"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	directorService "github.com/QuantumNous/new-api/service/director"

	"github.com/gin-gonic/gin"
)

// ===== 云导演（Cloud Director）API =====
// 项目/分集/角色/场景/道具/分镜/生成任务/剪辑/素材/模型设定。
// 全部挂载在已认证的 /api/director 分组下，userId 取自会话。

var (
	directorProjectSvc = &directorService.ProjectService{}
	directorLLMSvc     = &directorService.LLMService{}
	directorImageSvc   = &directorService.ImageGenerationService{}
	directorVideoSvc   = &directorService.VideoGenerationService{}
	directorEditSvc    = &directorService.EditService{}
	directorAssetSvc   = &directorService.AssetService{}
)

// ---------- 通用参数解析 ----------

// directorIDParam 从请求中解析实体 ID（query 与 body 均可），缺失或非法时返回错误
func directorIDParam(c *gin.Context) (int, error) {
	var req struct {
		ID int `form:"id" json:"id"`
	}
	if err := c.ShouldBind(&req); err != nil {
		return 0, errors.New("invalid parameters")
	}
	if req.ID <= 0 {
		return 0, errors.New("id is required")
	}
	return req.ID, nil
}

func directorQueryInt(c *gin.Context, key string) int {
	v, _ := strconv.Atoi(c.Query(key))
	return v
}

func directorQueryIntPtr(c *gin.Context, key string) *int {
	if c.Query(key) == "" {
		return nil
	}
	v, err := strconv.Atoi(c.Query(key))
	if err != nil {
		return nil
	}
	return &v
}

func directorQueryBoolPtr(c *gin.Context, key string) *bool {
	if c.Query(key) == "" {
		return nil
	}
	v, err := strconv.ParseBool(c.Query(key))
	if err != nil {
		return nil
	}
	return &v
}

func directorPage(c *gin.Context) (int, int) {
	return directorQueryInt(c, "p"), directorQueryInt(c, "page_size")
}

// directorPageResult 统一分页返回结构
func directorPageResult(list any, total int64, page, pageSize int) gin.H {
	return gin.H{"list": list, "total": total, "page": page, "pageSize": pageSize}
}

// ---------- 项目 ----------

// DirectorCreateProject 创建项目
func DirectorCreateProject(c *gin.Context) {
	userId := c.GetInt("id")
	var p model.DirectorProject
	if err := c.ShouldBindJSON(&p); err != nil {
		common.ApiError(c, err)
		return
	}
	if p.Title == "" {
		common.ApiErrorMsg(c, "项目名称不能为空")
		return
	}
	if p.Category != "" && !model.IsValidDirectorCategory(p.Category) {
		common.ApiErrorMsg(c, "无效的项目类型")
		return
	}
	p.ID = 0
	p.UserID = userId
	if err := p.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, p)
}

// DirectorUpdateProject 更新项目字段
func DirectorUpdateProject(c *gin.Context) {
	var req struct {
		ID            int    `json:"id"`
		Title         string `json:"title"`
		Category      string `json:"category"`
		Description   string `json:"description"`
		Genre         string `json:"genre"`
		Style         string `json:"style"`
		TotalEpisodes int    `json:"totalEpisodes"`
		TotalDuration int    `json:"totalDuration"`
		Status        string `json:"status"`
		Thumbnail     string `json:"thumbnail"`
		Tags          string `json:"tags"`
		Metadata      string `json:"metadata"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.ID <= 0 {
		common.ApiErrorMsg(c, "项目ID不能为空")
		return
	}
	if req.Category != "" && !model.IsValidDirectorCategory(req.Category) {
		common.ApiErrorMsg(c, "无效的项目类型")
		return
	}
	p, err := model.GetDirectorProjectByID(req.ID)
	if err != nil {
		common.ApiErrorMsg(c, "项目不存在")
		return
	}
	fields := map[string]any{
		"title":          req.Title,
		"category":       req.Category,
		"description":    req.Description,
		"genre":          req.Genre,
		"style":          req.Style,
		"total_episodes": req.TotalEpisodes,
		"total_duration": req.TotalDuration,
		"status":         req.Status,
		"thumbnail":      req.Thumbnail,
		"tags":           req.Tags,
		"metadata":       req.Metadata,
	}
	if err := p.Update(fields); err != nil {
		common.ApiError(c, err)
		return
	}
	if updated, err := model.GetDirectorProjectByID(req.ID); err == nil {
		common.ApiSuccess(c, updated)
		return
	}
	common.ApiSuccess(c, nil)
}

// DirectorDeleteProject 删除项目（级联删除全部从属数据）
func DirectorDeleteProject(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := directorProjectSvc.DeleteProjectCascade(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// DirectorGetProject 项目详情
func DirectorGetProject(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	p, err := model.GetDirectorProjectByID(id)
	if err != nil {
		common.ApiErrorMsg(c, "项目不存在")
		return
	}
	common.ApiSuccess(c, p)
}

// DirectorGetProjectList 项目列表（附带统计）
func DirectorGetProjectList(c *gin.Context) {
	page, pageSize := directorPage(c)
	f := model.DirectorProjectListFilter{
		Category: c.Query("category"),
		Status:   c.Query("status"),
		Keyword:  c.Query("keyword"),
		Page:     page,
		PageSize: pageSize,
	}
	list, total, err := directorProjectSvc.ListProjectsWithStats(f)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, directorPageResult(list, total, page, pageSize))
}

// ---------- 分集 ----------

// DirectorCreateEpisode 创建分集
func DirectorCreateEpisode(c *gin.Context) {
	userId := c.GetInt("id")
	var e model.DirectorEpisode
	if err := c.ShouldBindJSON(&e); err != nil {
		common.ApiError(c, err)
		return
	}
	if e.ProjectID <= 0 {
		common.ApiErrorMsg(c, "所属项目ID不能为空")
		return
	}
	if _, err := model.GetDirectorProjectByID(e.ProjectID); err != nil {
		common.ApiErrorMsg(c, "所属项目不存在")
		return
	}
	if e.EpisodeNumber <= 0 {
		// 缺省集号 = 当前项目最大集号 + 1
		var maxNum int
		model.DB.Model(&model.DirectorEpisode{}).Where("project_id = ?", e.ProjectID).
			Select("COALESCE(MAX(episode_number), 0)").Scan(&maxNum)
		e.EpisodeNumber = maxNum + 1
	}
	if e.Title == "" {
		e.Title = "第 " + strconv.Itoa(e.EpisodeNumber) + " 集"
	}
	e.ID = 0
	e.UserID = userId
	if err := e.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, e)
}

// DirectorUpdateEpisode 更新分集字段（角色/场景关联由专用接口维护）
func DirectorUpdateEpisode(c *gin.Context) {
	var req struct {
		ID             int    `json:"id"`
		Title          string `json:"title"`
		Content        string `json:"content"`
		ScriptContent  string `json:"scriptContent"`
		Description    string `json:"description"`
		Duration       int    `json:"duration"`
		TargetDuration int    `json:"targetDuration"`
		AspectRatio    string `json:"aspectRatio"`
		Resolution     string `json:"resolution"`
		Metadata       string `json:"metadata"`
		Status         string `json:"status"`
		VideoURL       string `json:"videoUrl"`
		Thumbnail      string `json:"thumbnail"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.ID <= 0 {
		common.ApiErrorMsg(c, "分集ID不能为空")
		return
	}
	e, err := model.GetDirectorEpisodeByID(req.ID)
	if err != nil {
		common.ApiErrorMsg(c, "分集不存在")
		return
	}
	fields := map[string]any{
		"title":           req.Title,
		"content":         req.Content,
		"script_content":  req.ScriptContent,
		"description":     req.Description,
		"duration":        req.Duration,
		"target_duration": req.TargetDuration,
		"aspect_ratio":    req.AspectRatio,
		"resolution":      req.Resolution,
		"metadata":        req.Metadata,
		"status":          req.Status,
		"video_url":       req.VideoURL,
		"thumbnail":       req.Thumbnail,
	}
	if err := e.Update(fields); err != nil {
		common.ApiError(c, err)
		return
	}
	if updated, err := model.GetDirectorEpisodeByID(req.ID); err == nil {
		common.ApiSuccess(c, updated)
		return
	}
	common.ApiSuccess(c, nil)
}

// DirectorDeleteEpisode 删除分集（级联删除分镜与剪辑工程）
func DirectorDeleteEpisode(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := directorProjectSvc.DeleteEpisodeCascade(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// DirectorGetEpisode 分集详情（预载角色与场景）
func DirectorGetEpisode(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	e, err := model.GetDirectorEpisodeDetail(id)
	if err != nil {
		common.ApiErrorMsg(c, "分集不存在")
		return
	}
	common.ApiSuccess(c, e)
}

// DirectorGetEpisodeList 分集列表
func DirectorGetEpisodeList(c *gin.Context) {
	projectID := directorQueryInt(c, "projectId")
	if projectID <= 0 {
		common.ApiErrorMsg(c, "缺少项目ID")
		return
	}
	page, pageSize := directorPage(c)
	list, total, err := model.ListDirectorEpisodes(projectID, page, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, directorPageResult(list, total, page, pageSize))
}

// DirectorGetEpisodePipeline 分集流水线进度聚合
func DirectorGetEpisodePipeline(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	episode, steps, err := directorProjectSvc.GetEpisodePipeline(id)
	if err != nil {
		common.ApiErrorMsg(c, "分集不存在")
		return
	}
	common.ApiSuccess(c, gin.H{"episode": episode, "steps": steps})
}

// ---------- 分集 AI 编排 ----------

// directorEpisodeAIRequest 分集 AI 编排请求（改写/提取/拆镜/批量提示词）
type directorEpisodeAIRequest struct {
	ID int `json:"id"`
}

// DirectorRewriteEpisodeScript AI 改写剧本
func DirectorRewriteEpisodeScript(c *gin.Context) {
	userId := c.GetInt("id")
	var req directorEpisodeAIRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.ID <= 0 {
		common.ApiErrorMsg(c, "分集ID不能为空")
		return
	}
	if err := directorLLMSvc.RewriteScript(userId, req.ID); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// DirectorExtractEpisodeRolesScenes AI 提取角色/场景/道具
func DirectorExtractEpisodeRolesScenes(c *gin.Context) {
	userId := c.GetInt("id")
	var req directorEpisodeAIRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.ID <= 0 {
		common.ApiErrorMsg(c, "分集ID不能为空")
		return
	}
	result, err := directorLLMSvc.ExtractRolesScenes(userId, req.ID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

// DirectorGenerateEpisodePrompts AI 批量生成本集角色/场景绘图提示词
func DirectorGenerateEpisodePrompts(c *gin.Context) {
	userId := c.GetInt("id")
	var req directorEpisodeAIRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.ID <= 0 {
		common.ApiErrorMsg(c, "分集ID不能为空")
		return
	}
	if err := directorLLMSvc.GenerateEpisodePrompts(userId, req.ID); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// DirectorSplitEpisodeStoryboards AI 拆解分镜
func DirectorSplitEpisodeStoryboards(c *gin.Context) {
	userId := c.GetInt("id")
	var req directorEpisodeAIRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.ID <= 0 {
		common.ApiErrorMsg(c, "分集ID不能为空")
		return
	}
	count, err := directorLLMSvc.SplitStoryboards(userId, req.ID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"count": count})
}

// DirectorAddEpisodeCharacter 人工为本集添加角色
func DirectorAddEpisodeCharacter(c *gin.Context) {
	userId := c.GetInt("id")
	var req struct {
		EpisodeID int                     `json:"episodeId"`
		Character model.DirectorCharacter `json:"character"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.EpisodeID <= 0 || req.Character.Name == "" {
		common.ApiErrorMsg(c, "分集ID与角色名称不能为空")
		return
	}
	req.Character.ID = 0
	if err := directorProjectSvc.AddEpisodeCharacter(userId, req.EpisodeID, &req.Character); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, req.Character)
}

// DirectorAddEpisodeScene 人工为本集添加场景
func DirectorAddEpisodeScene(c *gin.Context) {
	userId := c.GetInt("id")
	var req struct {
		EpisodeID int                 `json:"episodeId"`
		Scene     model.DirectorScene `json:"scene"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.EpisodeID <= 0 || req.Scene.Location == "" {
		common.ApiErrorMsg(c, "分集ID与场景地点不能为空")
		return
	}
	req.Scene.ID = 0
	if err := directorProjectSvc.AddEpisodeScene(userId, req.EpisodeID, &req.Scene); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, req.Scene)
}
