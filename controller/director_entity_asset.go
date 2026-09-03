package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// 云导演：实体图片（角色/道具/场景/镜头）同步到渠道虚拟真人素材库，
// 得到的 asset_id 按「实体 × 视频模型」持久化，供视频生成时以 asset:// 引用。

type directorEntityAssetSyncRequest struct {
	EntityType string `json:"entityType"`
	EntityID   int    `json:"entityId"`
}

type directorEntityAssetVO struct {
	ID         int    `json:"id"`
	EntityType string `json:"entityType"`
	EntityID   int    `json:"entityId"`
	Model      string `json:"model"`
	ChannelID  int    `json:"channelId"`
	AssetID    string `json:"assetId"`
	Status     string `json:"status"` // 渠道素材库中的实时状态 pending/active/failed
}

// directorEntityImageInfo 读取实体图片地址与展示名，并校验归属
func directorEntityImageInfo(userID int, entityType string, entityID int) (imageURL, name string, err error) {
	errNotFound := errors.New("entity not found")
	switch entityType {
	case model.DirectorEntityAssetCharacter:
		var e *model.DirectorCharacter
		e, err = model.GetDirectorCharacterByID(entityID)
		if err == nil {
			if e.UserID != userID {
				return "", "", errNotFound
			}
			return e.ImageURL, e.Name, nil
		}
	case model.DirectorEntityAssetProp:
		var e *model.DirectorProp
		e, err = model.GetDirectorPropByID(entityID)
		if err == nil {
			if e.UserID != userID {
				return "", "", errNotFound
			}
			return e.ImageURL, e.Name, nil
		}
	case model.DirectorEntityAssetScene:
		var e *model.DirectorScene
		e, err = model.GetDirectorSceneByID(entityID)
		if err == nil {
			if e.UserID != userID {
				return "", "", errNotFound
			}
			return e.ImageURL, e.Location, nil
		}
	case model.DirectorEntityAssetStoryboard:
		var e *model.DirectorStoryboard
		e, err = model.GetDirectorStoryboardByID(entityID)
		if err == nil {
			if e.UserID != userID {
				return "", "", errNotFound
			}
			return e.FirstFrameImage, "镜头 " + strconv.Itoa(e.StoryboardNumber), nil
		}
	default:
		return "", "", errNotFound
	}
	return "", "", err
}

// directorVideoModelGroup 解析当前视频模型与回环调用所在分组（令牌分组优先，回退用户分组）
func directorVideoModelGroup(userID int) (videoModel, group string, err error) {
	settings, err := model.GetDirectorModelSettings(userID)
	if err != nil {
		return "", "", err
	}
	videoModel = settings.VideoModel
	if videoModel == "" {
		return "", "", errors.New("video model not configured")
	}
	if token, tErr := model.GetDirectorTokenInfo(userID); tErr == nil && token != nil {
		group = token.Group
	}
	if group == "" {
		group, err = model.GetUserGroup(userID, false)
	}
	return videoModel, group, err
}

// DirectorSyncEntityAsset 把实体图片同步到当前视频模型可用渠道的素材库，并持久化 asset_id 映射
func DirectorSyncEntityAsset(c *gin.Context) {
	userID := c.GetInt("id")
	var req directorEntityAssetSyncRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.EntityID <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	imageURL, name, err := directorEntityImageInfo(userID, req.EntityType, req.EntityID)
	if err != nil {
		common.ApiErrorMsg(c, "实体不存在")
		return
	}
	if imageURL == "" {
		common.ApiErrorMsg(c, "该图片还未生成，请先生成图片")
		return
	}
	videoModel, group, err := directorVideoModelGroup(userID)
	if err != nil || videoModel == "" {
		common.ApiErrorMsg(c, "请先在「模型设定」中配置视频模型")
		return
	}
	channel, err := resolveAssetProtocolChannelForModel(group, videoModel)
	if err != nil {
		common.ApiErrorMsg(c, "当前视频模型没有可用的素材渠道: "+err.Error())
		return
	}
	asset, regErr := registerAssetToChannel(userID, channel, imageURL, model.AssetTypeImage, name)
	if regErr != nil {
		common.ApiErrorMsg(c, "素材同步失败: "+regErr.msg)
		return
	}
	mapping, err := model.UpsertDirectorEntityAsset(userID, req.EntityType, req.EntityID, videoModel, channel.Id, asset.AssetID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, directorEntityAssetVO{
		ID:         mapping.ID,
		EntityType: mapping.EntityType,
		EntityID:   mapping.EntityID,
		Model:      mapping.Model,
		ChannelID:  mapping.ChannelID,
		AssetID:    mapping.AssetID,
		Status:     asset.Status,
	})
}

// DirectorGetEntityAssetList 实体 asset_id 映射列表（仅当前视频模型下的映射；切换视频模型后为空）
func DirectorGetEntityAssetList(c *gin.Context) {
	userID := c.GetInt("id")
	entityType := c.Query("entityType")
	switch entityType {
	case model.DirectorEntityAssetCharacter, model.DirectorEntityAssetProp,
		model.DirectorEntityAssetScene, model.DirectorEntityAssetStoryboard:
	default:
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	settings, err := model.GetDirectorModelSettings(userID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if settings.VideoModel == "" {
		common.ApiSuccess(c, []any{})
		return
	}
	mappings, err := model.ListDirectorEntityAssets(userID, entityType, settings.VideoModel)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 状态以 assets 表为准（映射不冗余状态）；顺带触发 pending 素材的上游状态刷新
	assets := make([]*model.Asset, 0, len(mappings))
	assetByKey := make(map[int]string, len(mappings)) // mapping.ID -> status
	for _, m := range mappings {
		a, aErr := model.GetAssetByChannelAndAssetID(m.ChannelID, m.AssetID)
		if aErr != nil || a == nil || a.ID == 0 {
			assetByKey[m.ID] = model.AssetStatusFailed
			continue
		}
		assets = append(assets, a)
		assetByKey[m.ID] = a.Status
	}
	refreshPendingAssets(assets)
	list := make([]directorEntityAssetVO, 0, len(mappings))
	for _, m := range mappings {
		list = append(list, directorEntityAssetVO{
			ID:         m.ID,
			EntityType: m.EntityType,
			EntityID:   m.EntityID,
			Model:      m.Model,
			ChannelID:  m.ChannelID,
			AssetID:    m.AssetID,
			Status:     assetByKey[m.ID],
		})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": list})
}
