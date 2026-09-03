package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// ---------- 角色 ----------

// DirectorCreateCharacter 创建角色（需指定所属项目）
func DirectorCreateCharacter(c *gin.Context) {
	userId := c.GetInt("id")
	var ch model.DirectorCharacter
	if err := c.ShouldBindJSON(&ch); err != nil {
		common.ApiError(c, err)
		return
	}
	if ch.ProjectID <= 0 || ch.Name == "" {
		common.ApiErrorMsg(c, "所属项目ID与角色名称不能为空")
		return
	}
	ch.ID = 0
	ch.UserID = userId
	if err := ch.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, ch)
}

// DirectorUpdateCharacter 更新角色字段
func DirectorUpdateCharacter(c *gin.Context) {
	var req struct {
		ID       int    `json:"id"`
		Name     string `json:"name"`
		Role     string `json:"role"`
		Prompt   string `json:"prompt"`
		ImageURL string `json:"imageUrl"`
		Source   string `json:"source"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.ID <= 0 {
		common.ApiErrorMsg(c, "角色ID不能为空")
		return
	}
	ch, err := model.GetDirectorCharacterByID(req.ID)
	if err != nil {
		common.ApiErrorMsg(c, "角色不存在")
		return
	}
	fields := map[string]any{
		"name":      req.Name,
		"role":      req.Role,
		"prompt":    req.Prompt,
		"image_url": req.ImageURL,
		"source":    req.Source,
	}
	if err := ch.Update(fields); err != nil {
		common.ApiError(c, err)
		return
	}
	if updated, err := model.GetDirectorCharacterByID(req.ID); err == nil {
		common.ApiSuccess(c, updated)
		return
	}
	common.ApiSuccess(c, nil)
}

// DirectorDeleteCharacter 删除角色
func DirectorDeleteCharacter(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.DeleteDirectorCharacter(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// DirectorGetCharacter 角色详情
func DirectorGetCharacter(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	ch, err := model.GetDirectorCharacterByID(id)
	if err != nil {
		common.ApiErrorMsg(c, "角色不存在")
		return
	}
	common.ApiSuccess(c, ch)
}

// DirectorGetCharacterList 角色列表
func DirectorGetCharacterList(c *gin.Context) {
	projectID := directorQueryInt(c, "projectId")
	if projectID <= 0 {
		common.ApiErrorMsg(c, "缺少项目ID")
		return
	}
	page, pageSize := directorPage(c)
	list, total, err := model.ListDirectorCharacters(projectID, page, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, directorPageResult(list, total, page, pageSize))
}

// DirectorGenerateCharacterImage 生成角色形象图（异步任务）
func DirectorGenerateCharacterImage(c *gin.Context) {
	userId := c.GetInt("id")
	var req directorGenSubmitRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.ID <= 0 {
		common.ApiErrorMsg(c, "角色ID不能为空")
		return
	}
	genID, err := directorImageSvc.SubmitCharacterImage(userId, req.ID, req.Prompt, req.Size)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"generationId": genID})
}

// DirectorGenerateCharacterPrompt AI 生成角色外貌提示词
func DirectorGenerateCharacterPrompt(c *gin.Context) {
	userId := c.GetInt("id")
	var req directorGenSubmitRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.ID <= 0 {
		common.ApiErrorMsg(c, "角色ID不能为空")
		return
	}
	prompt, err := directorLLMSvc.GenerateCharacterPrompt(userId, req.ID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"prompt": prompt})
}

// ---------- 场景 ----------

// DirectorCreateScene 创建场景
func DirectorCreateScene(c *gin.Context) {
	userId := c.GetInt("id")
	var sc model.DirectorScene
	if err := c.ShouldBindJSON(&sc); err != nil {
		common.ApiError(c, err)
		return
	}
	if sc.ProjectID <= 0 || sc.Location == "" {
		common.ApiErrorMsg(c, "所属项目ID与场景地点不能为空")
		return
	}
	sc.ID = 0
	sc.UserID = userId
	if err := sc.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, sc)
}

// DirectorUpdateScene 更新场景字段
func DirectorUpdateScene(c *gin.Context) {
	var req struct {
		ID       int    `json:"id"`
		Location string `json:"location"`
		Time     string `json:"time"`
		Prompt   string `json:"prompt"`
		ImageURL string `json:"imageUrl"`
		Source   string `json:"source"`
		Status   string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.ID <= 0 {
		common.ApiErrorMsg(c, "场景ID不能为空")
		return
	}
	sc, err := model.GetDirectorSceneByID(req.ID)
	if err != nil {
		common.ApiErrorMsg(c, "场景不存在")
		return
	}
	fields := map[string]any{
		"location":  req.Location,
		"time":      req.Time,
		"prompt":    req.Prompt,
		"image_url": req.ImageURL,
		"source":    req.Source,
		"status":    req.Status,
	}
	if err := sc.Update(fields); err != nil {
		common.ApiError(c, err)
		return
	}
	if updated, err := model.GetDirectorSceneByID(req.ID); err == nil {
		common.ApiSuccess(c, updated)
		return
	}
	common.ApiSuccess(c, nil)
}

// DirectorDeleteScene 删除场景
func DirectorDeleteScene(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.DeleteDirectorScene(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// DirectorGetScene 场景详情
func DirectorGetScene(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	sc, err := model.GetDirectorSceneByID(id)
	if err != nil {
		common.ApiErrorMsg(c, "场景不存在")
		return
	}
	common.ApiSuccess(c, sc)
}

// DirectorGetSceneList 场景列表（可按分集过滤）
func DirectorGetSceneList(c *gin.Context) {
	projectID := directorQueryInt(c, "projectId")
	if projectID <= 0 {
		common.ApiErrorMsg(c, "缺少项目ID")
		return
	}
	page, pageSize := directorPage(c)
	list, total, err := model.ListDirectorScenes(projectID, directorQueryIntPtr(c, "episodeId"), page, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, directorPageResult(list, total, page, pageSize))
}

// DirectorGenerateSceneImage 生成场景图（异步任务）
func DirectorGenerateSceneImage(c *gin.Context) {
	userId := c.GetInt("id")
	var req directorGenSubmitRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.ID <= 0 {
		common.ApiErrorMsg(c, "场景ID不能为空")
		return
	}
	genID, err := directorImageSvc.SubmitSceneImage(userId, req.ID, req.Prompt, req.Size)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"generationId": genID})
}

// DirectorGenerateScenePrompt AI 生成场景图提示词
func DirectorGenerateScenePrompt(c *gin.Context) {
	userId := c.GetInt("id")
	var req directorGenSubmitRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.ID <= 0 {
		common.ApiErrorMsg(c, "场景ID不能为空")
		return
	}
	prompt, err := directorLLMSvc.GenerateScenePrompt(userId, req.ID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"prompt": prompt})
}

// ---------- 道具 ----------

// DirectorCreateProp 创建道具
func DirectorCreateProp(c *gin.Context) {
	userId := c.GetInt("id")
	var p model.DirectorProp
	if err := c.ShouldBindJSON(&p); err != nil {
		common.ApiError(c, err)
		return
	}
	if p.ProjectID <= 0 || p.Name == "" {
		common.ApiErrorMsg(c, "所属项目ID与道具名称不能为空")
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

// DirectorUpdateProp 更新道具字段
func DirectorUpdateProp(c *gin.Context) {
	var req struct {
		ID       int    `json:"id"`
		Name     string `json:"name"`
		Type     string `json:"type"`
		Prompt   string `json:"prompt"`
		ImageURL string `json:"imageUrl"`
		Source   string `json:"source"`
		Status   string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.ID <= 0 {
		common.ApiErrorMsg(c, "道具ID不能为空")
		return
	}
	p, err := model.GetDirectorPropByID(req.ID)
	if err != nil {
		common.ApiErrorMsg(c, "道具不存在")
		return
	}
	fields := map[string]any{
		"name":      req.Name,
		"type":      req.Type,
		"prompt":    req.Prompt,
		"image_url": req.ImageURL,
		"source":    req.Source,
		"status":    req.Status,
	}
	if err := p.Update(fields); err != nil {
		common.ApiError(c, err)
		return
	}
	if updated, err := model.GetDirectorPropByID(req.ID); err == nil {
		common.ApiSuccess(c, updated)
		return
	}
	common.ApiSuccess(c, nil)
}

// DirectorDeleteProp 删除道具
func DirectorDeleteProp(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.DeleteDirectorProp(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// DirectorGetProp 道具详情
func DirectorGetProp(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	p, err := model.GetDirectorPropByID(id)
	if err != nil {
		common.ApiErrorMsg(c, "道具不存在")
		return
	}
	common.ApiSuccess(c, p)
}

// DirectorGetPropList 道具列表
func DirectorGetPropList(c *gin.Context) {
	projectID := directorQueryInt(c, "projectId")
	if projectID <= 0 {
		common.ApiErrorMsg(c, "缺少项目ID")
		return
	}
	page, pageSize := directorPage(c)
	list, total, err := model.ListDirectorProps(projectID, page, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, directorPageResult(list, total, page, pageSize))
}

// DirectorGeneratePropImage 生成道具图（异步任务）
func DirectorGeneratePropImage(c *gin.Context) {
	userId := c.GetInt("id")
	var req directorGenSubmitRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.ID <= 0 {
		common.ApiErrorMsg(c, "道具ID不能为空")
		return
	}
	genID, err := directorImageSvc.SubmitPropImage(userId, req.ID, req.Prompt, req.Size)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"generationId": genID})
}

// DirectorGeneratePropPrompt AI 生成道具图提示词
func DirectorGeneratePropPrompt(c *gin.Context) {
	userId := c.GetInt("id")
	var req directorGenSubmitRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.ID <= 0 {
		common.ApiErrorMsg(c, "道具ID不能为空")
		return
	}
	prompt, err := directorLLMSvc.GeneratePropPrompt(userId, req.ID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"prompt": prompt})
}

// ---------- 分镜 ----------

// DirectorCreateStoryboard 创建分镜（需指定所属分集）
func DirectorCreateStoryboard(c *gin.Context) {
	userId := c.GetInt("id")
	var sb model.DirectorStoryboard
	if err := c.ShouldBindJSON(&sb); err != nil {
		common.ApiError(c, err)
		return
	}
	if sb.EpisodeID <= 0 {
		common.ApiErrorMsg(c, "所属分集ID不能为空")
		return
	}
	if sb.StoryboardNumber <= 0 {
		// 缺省镜号 = 本集最大镜号 + 1
		var maxNum int
		model.DB.Model(&model.DirectorStoryboard{}).Where("episode_id = ?", sb.EpisodeID).
			Select("COALESCE(MAX(storyboard_number), 0)").Scan(&maxNum)
		sb.StoryboardNumber = maxNum + 1
	}
	sb.ID = 0
	sb.UserID = userId
	if err := sb.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, sb)
}

// DirectorUpdateStoryboard 更新分镜字段（出镜角色关联由前端随完整对象提交）
func DirectorUpdateStoryboard(c *gin.Context) {
	var req struct {
		ID              int                        `json:"id"`
		Title           string                     `json:"title"`
		Location        string                     `json:"location"`
		Time            string                     `json:"time"`
		ShotType        string                     `json:"shotType"`
		Angle           string                     `json:"angle"`
		Movement        string                     `json:"movement"`
		Result          string                     `json:"result"`
		ImagePrompt     string                     `json:"imagePrompt"`
		VideoPrompt     string                     `json:"videoPrompt"`
		BgmPrompt       string                     `json:"bgmPrompt"`
		Duration        int                        `json:"duration"`
		FirstFrameImage string                     `json:"firstFrameImage"`
		VideoURL        string                     `json:"videoUrl"`
		Status          string                     `json:"status"`
		Characters      []*model.DirectorCharacter `json:"characters"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.ID <= 0 {
		common.ApiErrorMsg(c, "分镜ID不能为空")
		return
	}
	sb, err := model.GetDirectorStoryboardByID(req.ID)
	if err != nil {
		common.ApiErrorMsg(c, "分镜不存在")
		return
	}
	fields := map[string]any{
		"title":             req.Title,
		"location":          req.Location,
		"time":              req.Time,
		"shot_type":         req.ShotType,
		"angle":             req.Angle,
		"movement":          req.Movement,
		"result":            req.Result,
		"image_prompt":      req.ImagePrompt,
		"video_prompt":      req.VideoPrompt,
		"bgm_prompt":        req.BgmPrompt,
		"duration":          req.Duration,
		"first_frame_image": req.FirstFrameImage,
		"video_url":         req.VideoURL,
		"status":            req.Status,
	}
	if err := sb.Update(fields); err != nil {
		common.ApiError(c, err)
		return
	}
	// 出镜角色关联：请求带 characters 字段时整体替换
	if req.Characters != nil {
		if err := model.DB.Model(sb).Association("Characters").Replace(req.Characters); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if updated, err := model.GetDirectorStoryboardDetail(req.ID); err == nil {
		common.ApiSuccess(c, updated)
		return
	}
	common.ApiSuccess(c, nil)
}

// DirectorDeleteStoryboard 删除分镜
func DirectorDeleteStoryboard(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.DeleteDirectorStoryboard(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// DirectorGetStoryboard 分镜详情（预载出镜角色）
func DirectorGetStoryboard(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	sb, err := model.GetDirectorStoryboardDetail(id)
	if err != nil {
		common.ApiErrorMsg(c, "分镜不存在")
		return
	}
	common.ApiSuccess(c, sb)
}

// DirectorGetStoryboardList 分镜列表
func DirectorGetStoryboardList(c *gin.Context) {
	episodeID := directorQueryInt(c, "episodeId")
	if episodeID <= 0 {
		common.ApiErrorMsg(c, "缺少分集ID")
		return
	}
	page, pageSize := directorPage(c)
	list, total, err := model.ListDirectorStoryboards(episodeID, c.Query("status"), page, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, directorPageResult(list, total, page, pageSize))
}

// directorGenSubmitRequest 图片/视频生成提交请求（提示词与参数可选覆盖）
type directorGenSubmitRequest struct {
	ID          int    `json:"id"`
	Prompt      string `json:"prompt"`
	Size        string `json:"size"`        // 图片尺寸（如 2560x1440）
	AspectRatio string `json:"aspectRatio"` // 视频画幅（如 9:16/16:9/1:1）
	Resolution  string `json:"resolution"`  // 视频分辨率（如 720p/1080p）
	Duration    int    `json:"duration"`    // 视频时长（秒）
	Count       int    `json:"count"`       // 视频生成数量
	FrameMode   string `json:"frameMode"`   // first_last_frame/first_frame/reference
}

// DirectorGenerateStoryboardImage 生成分镜首帧图（异步任务）
func DirectorGenerateStoryboardImage(c *gin.Context) {
	userId := c.GetInt("id")
	var req directorGenSubmitRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.ID <= 0 {
		common.ApiErrorMsg(c, "分镜ID不能为空")
		return
	}
	genID, err := directorImageSvc.SubmitStoryboardImage(userId, req.ID, req.Prompt, req.Size)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"generationId": genID})
}

// DirectorGenerateStoryboardPrompt AI 重新生成分镜首帧图提示词
func DirectorGenerateStoryboardPrompt(c *gin.Context) {
	userId := c.GetInt("id")
	var req directorGenSubmitRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.ID <= 0 {
		common.ApiErrorMsg(c, "分镜ID不能为空")
		return
	}
	prompt, err := directorLLMSvc.GenerateStoryboardPrompt(userId, req.ID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"prompt": prompt})
}

// DirectorGenerateStoryboardVideo 生成分镜视频（异步任务）
func DirectorGenerateStoryboardVideo(c *gin.Context) {
	userId := c.GetInt("id")
	var req directorGenSubmitRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.ID <= 0 {
		common.ApiErrorMsg(c, "分镜ID不能为空")
		return
	}
	genID, err := directorVideoSvc.SubmitStoryboardVideo(userId, req.ID, req.Prompt, req.AspectRatio, req.Resolution, req.Duration, req.Count, req.FrameMode)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"generationId": genID})
}

// DirectorGenerateStoryboardVideoPrompt AI 重新生成分镜视频运动提示词
func DirectorGenerateStoryboardVideoPrompt(c *gin.Context) {
	userId := c.GetInt("id")
	var req directorGenSubmitRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.ID <= 0 {
		common.ApiErrorMsg(c, "分镜ID不能为空")
		return
	}
	prompt, err := directorLLMSvc.GenerateStoryboardVideoPrompt(userId, req.ID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"prompt": prompt})
}

// ---------- 生成任务查询（前端轮询） ----------

// DirectorGetImageGeneration 图片生成任务详情
func DirectorGetImageGeneration(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	g, err := model.GetDirectorImageGenerationByID(id)
	if err != nil {
		common.ApiErrorMsg(c, "任务不存在")
		return
	}
	common.ApiSuccess(c, g)
}

// DirectorGetImageGenerationList 图片生成任务列表
func DirectorGetImageGenerationList(c *gin.Context) {
	page, pageSize := directorPage(c)
	f := model.DirectorImageGenerationFilter{
		StoryboardID: directorQueryIntPtr(c, "storyboardId"),
		CharacterID:  directorQueryIntPtr(c, "characterId"),
		SceneID:      directorQueryIntPtr(c, "sceneId"),
		PropID:       directorQueryIntPtr(c, "propId"),
		ProjectID:    directorQueryIntPtr(c, "projectId"),
		Status:       c.Query("status"),
		Page:         page,
		PageSize:     pageSize,
	}
	list, total, err := model.ListDirectorImageGenerations(f)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, directorPageResult(list, total, page, pageSize))
}

// DirectorGetVideoGeneration 视频生成任务详情
func DirectorGetVideoGeneration(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	g, err := model.GetDirectorVideoGenerationByID(id)
	if err != nil {
		common.ApiErrorMsg(c, "任务不存在")
		return
	}
	common.ApiSuccess(c, g)
}

// DirectorGetVideoGenerationList 视频生成任务列表
func DirectorGetVideoGenerationList(c *gin.Context) {
	page, pageSize := directorPage(c)
	f := model.DirectorVideoGenerationFilter{
		StoryboardID: directorQueryIntPtr(c, "storyboardId"),
		ProjectID:    directorQueryIntPtr(c, "projectId"),
		Status:       c.Query("status"),
		Page:         page,
		PageSize:     pageSize,
	}
	list, total, err := model.ListDirectorVideoGenerations(f)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, directorPageResult(list, total, page, pageSize))
}
