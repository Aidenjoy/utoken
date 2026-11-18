package controller

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	canvasService "github.com/QuantumNous/new-api/service/canvas"

	"github.com/gin-gonic/gin"
)

// ===== 智能画布（Smart Canvas）API =====
// 全部挂在已认证的 /api/canvas 分组下，userId 取自会话，项目/任务/素材均做归属校验。

// canvasError 统一错误响应：success=false + 稳定 code + 可读 message。
// 冲突类（revision / 幂等键）用 409，额度不足用 403，便于前端区分处理。
func canvasError(c *gin.Context, status int, code string, message string) {
	c.JSON(status, gin.H{"success": false, "code": code, "message": message})
}

// canvasIdParam 解析路径中的数字 ID
func canvasIdParam(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		canvasError(c, http.StatusBadRequest, "invalid_request", "无效的 ID")
		return 0, false
	}
	return id, true
}

// canvasQueryInt 读取 query 整数（缺失或非法时为 0）
func canvasQueryInt(c *gin.Context, key string) int {
	v, _ := strconv.Atoi(c.Query(key))
	return v
}

// CanvasCapabilities 工具能力查询：模型、参数、限制、不可用原因
func CanvasCapabilities(c *gin.Context) {
	common.ApiSuccess(c, gin.H{
		"tools":    canvasService.ToolList(),
		"maxSide":  canvasService.MaxCanvasSide(),
		"maxDocMB": canvasService.MaxCanvasDocumentMB(),
	})
}

// CanvasListProjects 画布项目列表
func CanvasListProjects(c *gin.Context) {
	userID := c.GetInt("id")
	page, pageSize := canvasQueryInt(c, "p"), canvasQueryInt(c, "page_size")
	list, total, err := canvasService.ListProjects(userID, c.Query("keyword"), page, pageSize)
	if err != nil {
		canvasError(c, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	items := make([]model.CanvasProjectPublic, 0, len(list))
	for _, p := range list {
		items = append(items, p.ToPublic())
	}
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	common.ApiSuccess(c, gin.H{"items": items, "total": total, "page": page, "pageSize": pageSize})
}

// CanvasCreateProject 新建画布项目
func CanvasCreateProject(c *gin.Context) {
	userID := c.GetInt("id")
	var req canvasService.CreateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		canvasError(c, http.StatusBadRequest, "invalid_request", "请求参数不合法")
		return
	}
	project, err := canvasService.CreateProject(userID, req)
	if err != nil {
		canvasError(c, http.StatusBadRequest, "create_failed", err.Error())
		return
	}
	common.ApiSuccess(c, project)
}

// CanvasGetProject 项目详情（含图层文档）
func CanvasGetProject(c *gin.Context) {
	userID := c.GetInt("id")
	id, ok := canvasIdParam(c)
	if !ok {
		return
	}
	project, err := canvasService.GetProject(userID, id)
	if err != nil {
		canvasError(c, http.StatusNotFound, "not_found", err.Error())
		return
	}
	common.ApiSuccess(c, project)
}

// CanvasRenameProject 重命名项目
func CanvasRenameProject(c *gin.Context) {
	userID := c.GetInt("id")
	id, ok := canvasIdParam(c)
	if !ok {
		return
	}
	var req struct {
		Title string `json:"title"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		canvasError(c, http.StatusBadRequest, "invalid_request", "请求参数不合法")
		return
	}
	if err := canvasService.RenameProject(userID, id, req.Title); err != nil {
		canvasError(c, http.StatusBadRequest, "rename_failed", err.Error())
		return
	}
	project, err := canvasService.GetProject(userID, id)
	if err != nil {
		canvasError(c, http.StatusNotFound, "not_found", err.Error())
		return
	}
	common.ApiSuccess(c, project)
}

// CanvasDeleteProject 删除项目及其任务
func CanvasDeleteProject(c *gin.Context) {
	userID := c.GetInt("id")
	id, ok := canvasIdParam(c)
	if !ok {
		return
	}
	if err := canvasService.DeleteProject(userID, id); err != nil {
		canvasError(c, http.StatusBadRequest, "delete_failed", err.Error())
		return
	}
	common.ApiSuccess(c, nil)
}

// CanvasSaveDocument 保存画布（带 revision 乐观锁，旧版本写入返回 409）
func CanvasSaveDocument(c *gin.Context) {
	userID := c.GetInt("id")
	id, ok := canvasIdParam(c)
	if !ok {
		return
	}
	var req canvasService.SaveDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		canvasError(c, http.StatusBadRequest, "invalid_request", "画布文档格式不合法")
		return
	}
	req.ProjectID = id
	project, err := canvasService.SaveDocument(userID, req)
	if err != nil {
		if errors.Is(err, model.ErrCanvasRevisionConflict) {
			canvasError(c, http.StatusConflict, "revision_conflict", "画布已被其他窗口更新，请刷新后重试")
			return
		}
		canvasError(c, http.StatusBadRequest, "save_failed", err.Error())
		return
	}
	common.ApiSuccess(c, gin.H{
		"id": project.ID, "revision": project.Revision, "updatedAt": project.UpdatedAt,
		"layerCount": project.LayerCount, "thumbnail": project.Thumbnail,
	})
}

// CanvasListAssets 可导入的素材（现有共享素材库中的图片）
func CanvasListAssets(c *gin.Context) {
	userID := c.GetInt("id")
	startIdx := canvasQueryInt(c, "start_idx")
	assets, err := model.GetUserSourceAssets(userID, startIdx, 100)
	if err != nil {
		canvasError(c, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	type assetItem struct {
		RefID     string `json:"refId"`
		Name      string `json:"name"`
		URL       string `json:"url"`
		AssetType string `json:"assetType"`
		CreatedAt int64  `json:"createdAt"`
	}
	items := make([]assetItem, 0, len(assets))
	for _, a := range assets {
		if a.AssetType != "" && a.AssetType != model.AssetTypeImage {
			continue
		}
		items = append(items, assetItem{
			RefID: a.RefID, Name: a.Name, URL: a.SourceURL,
			AssetType: a.AssetType, CreatedAt: a.CreatedAt,
		})
	}
	common.ApiSuccess(c, gin.H{"items": items})
}

// CanvasUploadImage 上传本地图片（multipart：file + projectId）。
// 只落对象存储并返回像素信息，不登记素材库；结果转存素材库走 save-asset。
func CanvasUploadImage(c *gin.Context) {
	userID := c.GetInt("id")
	header, err := c.FormFile("file")
	if err != nil {
		canvasError(c, http.StatusBadRequest, "missing_file", "请选择要上传的图片")
		return
	}
	projectID, _ := strconv.Atoi(c.PostForm("projectId"))
	if projectID > 0 {
		if _, err := canvasService.GetProject(userID, projectID); err != nil {
			canvasError(c, http.StatusNotFound, "project_not_found", "画布不存在")
			return
		}
	}
	limit := int64(canvasService.MaxCanvasUploadMB()) << 20
	if header.Size > limit {
		canvasError(c, http.StatusBadRequest, "file_too_large",
			fmt.Sprintf("图片超过体积上限 %dMB", canvasService.MaxCanvasUploadMB()))
		return
	}
	file, err := header.Open()
	if err != nil {
		canvasError(c, http.StatusBadRequest, "invalid_file", "读取上传文件失败")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		canvasError(c, http.StatusBadRequest, "invalid_file", "读取上传文件失败")
		return
	}
	if int64(len(data)) > limit {
		canvasError(c, http.StatusBadRequest, "file_too_large",
			fmt.Sprintf("图片超过体积上限 %dMB", canvasService.MaxCanvasUploadMB()))
		return
	}
	upload, err := canvasService.UploadImage(userID, projectID, header.Filename, data)
	if err != nil {
		if errors.Is(err, canvasService.ErrUnsupportedImage) {
			canvasError(c, http.StatusBadRequest, "unsupported_image", "仅支持 PNG/JPEG/GIF/BMP/WebP 图片")
			return
		}
		canvasError(c, http.StatusBadRequest, "upload_failed", err.Error())
		return
	}
	common.ApiSuccess(c, upload)
}

// CanvasCreateTask 提交生成/编辑任务
func CanvasCreateTask(c *gin.Context) {
	userID := c.GetInt("id")
	var req canvasService.SubmitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		canvasError(c, http.StatusBadRequest, "invalid_request", "请求参数不合法")
		return
	}
	task, reused, err := canvasService.Submit(userID, req)
	if err != nil {
		switch {
		case errors.Is(err, model.ErrCanvasIdempotencyConflict):
			canvasError(c, http.StatusConflict, "idempotency_conflict", "同一幂等键已提交过不同参数的任务")
		case errors.Is(err, canvasService.ErrToolUnavailable):
			canvasError(c, http.StatusServiceUnavailable, "tool_unavailable", strings.TrimPrefix(err.Error(), canvasService.ErrToolUnavailable.Error()+": "))
		case errors.Is(err, canvasService.ErrMaskSizeMismatch):
			canvasError(c, http.StatusBadRequest, "mask_size_mismatch", err.Error())
		case errors.Is(err, model.ErrInsufficientUserQuota):
			canvasError(c, http.StatusForbidden, "insufficient_quota", "额度不足，无法提交该任务")
		default:
			canvasError(c, http.StatusBadRequest, "submit_failed", err.Error())
		}
		return
	}
	common.ApiSuccess(c, gin.H{"task": task, "reused": reused})
}

// CanvasListTasks 任务历史
func CanvasListTasks(c *gin.Context) {
	userID := c.GetInt("id")
	page, pageSize := canvasQueryInt(c, "p"), canvasQueryInt(c, "page_size")
	list, total, err := canvasService.ListTasks(userID, canvasQueryInt(c, "projectId"),
		c.Query("tool"), c.Query("status"), page, pageSize)
	if err != nil {
		canvasError(c, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	common.ApiSuccess(c, gin.H{"items": list, "total": total, "page": page, "pageSize": pageSize})
}

// CanvasGetTask 任务详情（前端轮询）
func CanvasGetTask(c *gin.Context) {
	userID := c.GetInt("id")
	id, ok := canvasIdParam(c)
	if !ok {
		return
	}
	view, err := canvasService.GetTask(userID, id)
	if err != nil {
		canvasError(c, http.StatusNotFound, "not_found", err.Error())
		return
	}
	common.ApiSuccess(c, view)
}

// CanvasCancelTask 取消任务（仅未派发阶段可取消）
func CanvasCancelTask(c *gin.Context) {
	userID := c.GetInt("id")
	id, ok := canvasIdParam(c)
	if !ok {
		return
	}
	view, err := canvasService.Cancel(userID, id)
	if err != nil {
		switch {
		case errors.Is(err, canvasService.ErrTaskNotFound):
			canvasError(c, http.StatusNotFound, "not_found", err.Error())
		case errors.Is(err, canvasService.ErrCancelNotSupported):
			canvasError(c, http.StatusConflict, "cancel_not_supported", err.Error())
		default:
			canvasError(c, http.StatusBadRequest, "cancel_failed", err.Error())
		}
		return
	}
	common.ApiSuccess(c, view)
}

// CanvasRepersistTask 从已知上游结果补存到自有存储（不重跑模型）
func CanvasRepersistTask(c *gin.Context) {
	userID := c.GetInt("id")
	id, ok := canvasIdParam(c)
	if !ok {
		return
	}
	view, err := canvasService.RepersistTask(userID, id)
	if err != nil {
		canvasError(c, http.StatusBadRequest, "repersist_failed", err.Error())
		return
	}
	common.ApiSuccess(c, view)
}

// CanvasSaveResultToAsset 把任务结果转存进现有共享素材库（源素材库）
func CanvasSaveResultToAsset(c *gin.Context) {
	userID := c.GetInt("id")
	id, ok := canvasIdParam(c)
	if !ok {
		return
	}
	var req struct {
		Index int    `json:"index"`
		Name  string `json:"name"`
	}
	_ = c.ShouldBindJSON(&req)
	asset, err := canvasService.SaveResultToLibrary(userID, id, req.Index, req.Name)
	if err != nil {
		canvasError(c, http.StatusBadRequest, "save_asset_failed", err.Error())
		return
	}
	// 与 /assets 保持同一套字段名，前端不需要在两种命名之间来回转换
	common.ApiSuccess(c, gin.H{
		"refId": asset.RefID, "name": asset.Name, "url": asset.SourceURL,
		"assetType": asset.AssetType, "createdAt": asset.CreatedAt,
	})
}

// CanvasProxyImage 同源图片代理：只放行自有存储域名，供画布导出与蒙版底图使用
// （跨域图片会污染 canvas，导致 toBlob 失败）。
func CanvasProxyImage(c *gin.Context) {
	result, err := canvasService.FetchCanvasImage(c.Query("url"))
	if err != nil {
		canvasError(c, http.StatusBadRequest, "proxy_rejected", err.Error())
		return
	}
	c.Header("Cache-Control", "private, max-age=3600")
	c.Data(http.StatusOK, result.ContentType, result.Data)
}

// CanvasDownloadResult 下载任务结果（跳转到自有存储的直链）
func CanvasDownloadResult(c *gin.Context) {
	userID := c.GetInt("id")
	id, ok := canvasIdParam(c)
	if !ok {
		return
	}
	url, err := canvasService.ResultDownloadURL(userID, id, canvasQueryInt(c, "index"))
	if err != nil {
		canvasError(c, http.StatusBadRequest, "download_failed", err.Error())
		return
	}
	c.Redirect(http.StatusFound, url)
}

// CanvasLocalAsset 本地存储替身读取（仅当 CANVAS_LOCAL_STORAGE_DIR 开启时可用）
func CanvasLocalAsset(c *gin.Context) {
	contentType, data, err := canvasService.FetchLocalAsset(c.Param("name"))
	if err != nil {
		canvasError(c, http.StatusNotFound, "asset_not_found", "本地素材不存在")
		return
	}
	c.Header("Cache-Control", "private, max-age=60")
	c.Data(http.StatusOK, contentType, data)
}
