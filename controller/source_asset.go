package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// 源素材库管理 API（/pg/source-assets/*，UserAuth）。
//
// 源素材是用户上传到自有 TOS 的原件，不绑定渠道；渠道副本由
// service.SyncSourceAssetToChannels 按需同步（见 assets 表的 source_asset_id）。
// 这一层把「一份原件 → N 个渠道副本」的同步关系显式暴露给用户与管理员。

// sourceAssetJSONError 统一的错误响应格式。
func sourceAssetJSONError(c *gin.Context, status int, typ string, msg string) {
	c.JSON(status, gin.H{
		"error": gin.H{
			"message": msg,
			"type":    typ,
		},
	})
}

// UploadSourceAsset 上传源素材：文件落到自有 TOS 后登记 source_assets。
// 不做任何渠道上传，渠道副本由后续同步（自动或手动）创建。
func UploadSourceAsset(c *gin.Context) {
	if _, ok := common.GetTOSUploadConfig(); !ok {
		sourceAssetJSONError(c, http.StatusInternalServerError, "tos_not_configured",
			"TOS 未配置，无法上传素材；请设置 TOS_ACCESS_KEY/TOS_SECRET_KEY/TOS_BUCKET")
		return
	}

	file, fileHeader, err := c.Request.FormFile("file")
	if err != nil {
		sourceAssetJSONError(c, http.StatusBadRequest, "invalid_request", "读取文件失败: "+err.Error())
		return
	}
	defer file.Close()

	assetType := strings.TrimSpace(c.PostForm("asset_type"))
	assetType = normalizeAssetType(assetType, fileHeader.Filename)
	if !model.IsValidAssetType(assetType) {
		sourceAssetJSONError(c, http.StatusBadRequest, "invalid_request", "asset_type 必须为 Image/Video/Audio")
		return
	}

	userId := c.GetInt("id")
	publicURL, objectKey, err := common.UploadReaderToTOS(file, fileHeader.Filename, userId, "source_assets")
	if err != nil {
		common.SysError(fmt.Sprintf("[SourceAsset] TOS upload failed (user=%d, file=%s): %v", userId, fileHeader.Filename, err))
		sourceAssetJSONError(c, http.StatusInternalServerError, "internal_error", "上传到 TOS 失败: "+err.Error())
		return
	}

	name := strings.TrimSpace(c.PostForm("name"))
	if name == "" {
		name = fileHeader.Filename
	}
	asset := &model.SourceAsset{
		UserID:    userId,
		Name:      name,
		AssetType: assetType,
		SourceURL: publicURL,
		FileSize:  fileHeader.Size,
		Status:    model.AssetStatusActive,
	}
	if err := asset.Insert(); err != nil {
		sourceAssetJSONError(c, http.StatusInternalServerError, "insert_error", "登记源素材失败: "+err.Error())
		return
	}
	common.SysLog(fmt.Sprintf("[SourceAsset] user %d uploaded source asset %d (%s)", userId, asset.ID, objectKey))
	c.JSON(http.StatusOK, asset)
}

// normalizeAssetType 未显式指定时按文件扩展名推断素材类型。
func normalizeAssetType(assetType string, filename string) string {
	if assetType != "" {
		return assetType
	}
	lower := strings.ToLower(filename)
	switch {
	case strings.HasSuffix(lower, ".mp4"), strings.HasSuffix(lower, ".mov"), strings.HasSuffix(lower, ".webm"):
		return model.AssetTypeVideo
	case strings.HasSuffix(lower, ".mp3"), strings.HasSuffix(lower, ".wav"), strings.HasSuffix(lower, ".m4a"):
		return model.AssetTypeAudio
	default:
		return model.AssetTypeImage
	}
}

// ListSourceAssets 列出当前用户的源素材，并附带每个素材的渠道同步状态。
// 前端据此展示「哪些渠道已就绪 / 审核中 / 失败」。
func ListSourceAssets(c *gin.Context) {
	userId := c.GetInt("id")
	startIdx, _ := strconv.Atoi(c.Query("start_idx"))
	assets, err := model.GetUserSourceAssets(userId, startIdx, 100)
	if err != nil {
		sourceAssetJSONError(c, http.StatusInternalServerError, "query_data_error", err.Error())
		return
	}

	type sourceAssetWithChannels struct {
		*model.SourceAsset
		Channels []*model.Asset `json:"channels"`
	}
	result := make([]sourceAssetWithChannels, 0, len(assets))
	for _, a := range assets {
		channels, err := model.GetAssetsBySourceAssetId(a.ID)
		if err != nil {
			channels = nil
		}
		result = append(result, sourceAssetWithChannels{SourceAsset: a, Channels: channels})
	}
	c.JSON(http.StatusOK, gin.H{"assets": result})
}

// GetSourceAsset 查询单个源素材及其渠道副本。
func GetSourceAsset(c *gin.Context) {
	userId := c.GetInt("id")
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		sourceAssetJSONError(c, http.StatusBadRequest, "invalid_request", "无效的素材 ID")
		return
	}
	asset, err := model.GetSourceAssetById(id)
	if err != nil || asset.UserID != userId {
		sourceAssetJSONError(c, http.StatusNotFound, "not_found", "素材不存在")
		return
	}
	channels, _ := model.GetAssetsBySourceAssetId(asset.ID)
	c.JSON(http.StatusOK, gin.H{"asset": asset, "channels": channels})
}

// DeleteSourceAsset 删除源素材登记（渠道副本与上游素材保留）。
func DeleteSourceAsset(c *gin.Context) {
	userId := c.GetInt("id")
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		sourceAssetJSONError(c, http.StatusBadRequest, "invalid_request", "无效的素材 ID")
		return
	}
	if err := model.DeleteSourceAssetById(id, userId); err != nil {
		sourceAssetJSONError(c, http.StatusNotFound, "not_found", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

type syncSourceAssetRequest struct {
	SourceAssetId int64 `json:"source_asset_id"`
	ChannelIds    []int `json:"channel_ids"` // 空 = 全部启用素材协议的渠道
}

// SyncSourceAsset 将源素材同步到指定渠道（空数组 = 全部渠道）。
// 用户可同步自己的素材；重复同步已 active 的渠道会被幂等跳过。
func SyncSourceAsset(c *gin.Context) {
	userId := c.GetInt("id")
	var req syncSourceAssetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		sourceAssetJSONError(c, http.StatusBadRequest, "invalid_request", "请求体无效: "+err.Error())
		return
	}
	if req.SourceAssetId <= 0 {
		sourceAssetJSONError(c, http.StatusBadRequest, "invalid_request", "source_asset_id 必填")
		return
	}

	asset, err := model.GetSourceAssetById(req.SourceAssetId)
	if err != nil {
		sourceAssetJSONError(c, http.StatusNotFound, "not_found", "源素材不存在")
		return
	}
	// 所有权校验：非管理员只能同步自己的素材
	if asset.UserID != userId {
		sourceAssetJSONError(c, http.StatusForbidden, "forbidden", "无权操作他人素材")
		return
	}

	results := service.SyncSourceAssetToChannels(req.SourceAssetId, req.ChannelIds)
	c.JSON(http.StatusOK, gin.H{"sync_tasks": results})
}

// AdminSyncSourceAsset 管理员入口：可跨用户同步任意源素材到任意渠道。
func AdminSyncSourceAsset(c *gin.Context) {
	var req syncSourceAssetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		sourceAssetJSONError(c, http.StatusBadRequest, "invalid_request", "请求体无效: "+err.Error())
		return
	}
	if req.SourceAssetId <= 0 {
		sourceAssetJSONError(c, http.StatusBadRequest, "invalid_request", "source_asset_id 必填")
		return
	}
	if _, err := model.GetSourceAssetById(req.SourceAssetId); err != nil {
		sourceAssetJSONError(c, http.StatusNotFound, "not_found", "源素材不存在")
		return
	}
	results := service.SyncSourceAssetToChannels(req.SourceAssetId, req.ChannelIds)
	c.JSON(http.StatusOK, gin.H{"sync_tasks": results})
}

// GetSourceAssetSyncStatus 查询源素材在各渠道的同步状态汇总。
func GetSourceAssetSyncStatus(c *gin.Context) {
	id, err := strconv.ParseInt(c.Query("source_asset_id"), 10, 64)
	if err != nil || id <= 0 {
		sourceAssetJSONError(c, http.StatusBadRequest, "invalid_request", "source_asset_id 必填")
		return
	}
	if _, err := model.GetSourceAssetById(id); err != nil {
		sourceAssetJSONError(c, http.StatusNotFound, "not_found", "源素材不存在")
		return
	}
	channels, err := model.GetAssetsBySourceAssetId(id)
	if err != nil {
		sourceAssetJSONError(c, http.StatusInternalServerError, "query_data_error", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"channels": channels})
}
