package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// ---------- 素材库 ----------

// DirectorCreateAsset 登记素材（不含文件上传，URL 需已存在）
func DirectorCreateAsset(c *gin.Context) {
	userId := c.GetInt("id")
	var a model.DirectorAsset
	if err := c.ShouldBindJSON(&a); err != nil {
		common.ApiError(c, err)
		return
	}
	if a.URL == "" {
		common.ApiErrorMsg(c, "素材地址不能为空")
		return
	}
	if a.ProjectID != nil && *a.ProjectID > 0 && !directorOwnedProjectID(c, *a.ProjectID) {
		return
	}
	a.ID = 0
	a.UserID = userId
	if err := a.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, a)
}

// DirectorUpdateAsset 更新素材字段
func DirectorUpdateAsset(c *gin.Context) {
	var req struct {
		ID         int    `json:"id"`
		Name       string `json:"name"`
		Type       string `json:"type"`
		Category   string `json:"category"`
		URL        string `json:"url"`
		IsFavorite bool   `json:"isFavorite"`
		ProjectID  *int   `json:"projectId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	if req.ID <= 0 {
		common.ApiErrorMsg(c, "素材ID不能为空")
		return
	}
	a, err := model.GetDirectorAssetByID(req.ID)
	if err != nil || !directorOwned(c, a.UserID) {
		common.ApiErrorMsg(c, "素材不存在")
		return
	}
	fields := map[string]any{
		"name":        req.Name,
		"type":        req.Type,
		"category":    req.Category,
		"url":         req.URL,
		"is_favorite": req.IsFavorite,
	}
	// 调整项目归属：projectId > 0 归属项目，否则转为全局素材；
	// 同时清空分集/分镜引用，避免跨项目脏关联
	if req.ProjectID != nil {
		if *req.ProjectID > 0 {
			if !directorOwnedProjectID(c, *req.ProjectID) {
				return
			}
			fields["project_id"] = *req.ProjectID
		} else {
			fields["project_id"] = nil
		}
		fields["episode_id"] = nil
		fields["storyboard_id"] = nil
	}
	if err := a.Update(fields); err != nil {
		common.ApiError(c, err)
		return
	}
	if updated, err := model.GetDirectorAssetByID(req.ID); err == nil {
		common.ApiSuccess(c, updated)
		return
	}
	common.ApiSuccess(c, nil)
}

// DirectorDeleteAsset 删除素材
func DirectorDeleteAsset(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	a, err := model.GetDirectorAssetByID(id)
	if err != nil || !directorOwned(c, a.UserID) {
		common.ApiErrorMsg(c, "素材不存在")
		return
	}
	if err := model.DeleteDirectorAsset(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// DirectorGetAssetList 素材列表（管理员可按归属用户过滤并返回用户名）
func DirectorGetAssetList(c *gin.Context) {
	page, pageSize := directorPage(c)
	ownerID, isAdmin := directorOwnerFilter(c)
	f := model.DirectorAssetFilter{
		UserID:       ownerID,
		ProjectID:    directorQueryIntPtr(c, "projectId"),
		EpisodeID:    directorQueryIntPtr(c, "episodeId"),
		StoryboardID: directorQueryIntPtr(c, "storyboardId"),
		Type:         c.Query("type"),
		Category:     c.Query("category"),
		IsFavorite:   directorQueryBoolPtr(c, "isFavorite"),
		Page:         page,
		PageSize:     pageSize,
	}
	list, total, err := directorAssetSvc.ListAssets(f, isAdmin)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, directorPageResult(list, total, page, pageSize))
}

// DirectorUploadAsset 上传素材文件（multipart，存 TOS 并登记素材库）
func DirectorUploadAsset(c *gin.Context) {
	userId := c.GetInt("id")
	header, err := c.FormFile("file")
	if err != nil {
		common.ApiErrorMsg(c, "请选择要上传的文件")
		return
	}
	projectID, _ := strconv.Atoi(c.PostForm("projectId"))
	episodeID, _ := strconv.Atoi(c.PostForm("episodeId"))
	if projectID > 0 && !directorOwnedProjectID(c, projectID) {
		return
	}
	asset, err := directorAssetSvc.UploadAsset(header, userId, projectID, episodeID, c.PostForm("name"), c.PostForm("category"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"url": asset.URL, "asset": asset})
}

// DirectorUploadFile 仅上传文件到 TOS 并返回 URL，不登记素材库（项目封面等纯引用场景）
func DirectorUploadFile(c *gin.Context) {
	userId := c.GetInt("id")
	header, err := c.FormFile("file")
	if err != nil {
		common.ApiErrorMsg(c, "请选择要上传的文件")
		return
	}
	projectID, _ := strconv.Atoi(c.PostForm("projectId"))
	if projectID > 0 && !directorOwnedProjectID(c, projectID) {
		return
	}
	url, err := directorAssetSvc.UploadFile(header, userId, projectID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"url": url})
}

// ---------- 素材自定义分类 ----------

// DirectorGetAssetCategoryList 素材自定义分类列表
func DirectorGetAssetCategoryList(c *gin.Context) {
	userId := c.GetInt("id")
	list, err := model.ListDirectorAssetCategories(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, list)
}

// DirectorCreateAssetCategory 创建素材自定义分类
func DirectorCreateAssetCategory(c *gin.Context) {
	userId := c.GetInt("id")
	var body struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		common.ApiError(c, err)
		return
	}
	cat, err := directorAssetSvc.CreateAssetCategory(userId, body.Name)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, cat)
}

// DirectorUpdateAssetCategory 重命名素材自定义分类
func DirectorUpdateAssetCategory(c *gin.Context) {
	userId := c.GetInt("id")
	var body struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		common.ApiError(c, err)
		return
	}
	if body.ID <= 0 {
		common.ApiErrorMsg(c, "分类ID不能为空")
		return
	}
	if err := directorAssetSvc.UpdateAssetCategory(userId, body.ID, body.Name); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// DirectorDeleteAssetCategory 删除素材自定义分类（其下素材回到未分类）
func DirectorDeleteAssetCategory(c *gin.Context) {
	userId := c.GetInt("id")
	var body struct {
		ID int `json:"id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		common.ApiError(c, err)
		return
	}
	if body.ID <= 0 {
		common.ApiErrorMsg(c, "分类ID不能为空")
		return
	}
	if err := directorAssetSvc.DeleteAssetCategory(userId, body.ID); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
