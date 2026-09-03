package model

import (
	"time"

	"gorm.io/gorm"
)

// ===== 云导演：实体图片与渠道虚拟真人素材（asset_id）的映射 =====

// 实体类型取值（与前端 entityType 一致）
const (
	DirectorEntityAssetCharacter  = "character"
	DirectorEntityAssetProp       = "prop"
	DirectorEntityAssetScene      = "scene"
	DirectorEntityAssetStoryboard = "storyboard"
)

// DirectorEntityAsset 记录角色/道具/场景/镜头图片同步到渠道素材库后得到的 asset_id。
// asset_id 只在上游渠道与注册时的视频模型语境下有效，因此映射按「实体 × 视频模型」保存：
// 模型设置切换视频模型后查不到映射（前端显示为空），切回旧模型时映射重新命中。
type DirectorEntityAsset struct {
	ID         int    `json:"id" gorm:"primaryKey"`
	CreatedAt  int64  `json:"createdAt"`
	UpdatedAt  int64  `json:"updatedAt"`
	UserID     int    `json:"userId" gorm:"index"`
	EntityType string `json:"entityType" gorm:"size:32;uniqueIndex:idx_director_entity_asset,priority:1"` // character/prop/scene/storyboard
	EntityID   int    `json:"entityId" gorm:"uniqueIndex:idx_director_entity_asset,priority:2"`
	Model      string `json:"model" gorm:"size:128;uniqueIndex:idx_director_entity_asset,priority:3"` // 同步时的视频模型名
	ChannelID  int    `json:"channelId"`
	AssetID    string `json:"assetId" gorm:"size:191"` // 渠道上游素材 ID
}

func (DirectorEntityAsset) TableName() string { return "director_entity_assets" }

// UpsertDirectorEntityAsset 按（实体类型, 实体, 模型）唯一键写入或更新映射
func UpsertDirectorEntityAsset(userID int, entityType string, entityID int, videoModel string, channelID int, assetID string) (*DirectorEntityAsset, error) {
	now := time.Now().Unix()
	var m DirectorEntityAsset
	err := DB.Where("entity_type = ? AND entity_id = ? AND model = ?", entityType, entityID, videoModel).
		First(&m).Error
	if err == gorm.ErrRecordNotFound {
		m = DirectorEntityAsset{
			CreatedAt:  now,
			UpdatedAt:  now,
			UserID:     userID,
			EntityType: entityType,
			EntityID:   entityID,
			Model:      videoModel,
			ChannelID:  channelID,
			AssetID:    assetID,
		}
		return &m, DB.Create(&m).Error
	}
	if err != nil {
		return nil, err
	}
	m.UpdatedAt = now
	m.UserID = userID
	m.ChannelID = channelID
	m.AssetID = assetID
	return &m, DB.Save(&m).Error
}

// GetDirectorEntityAsset 查询单个实体在指定视频模型下的映射
func GetDirectorEntityAsset(entityType string, entityID int, videoModel string) (*DirectorEntityAsset, error) {
	var m DirectorEntityAsset
	err := DB.Where("entity_type = ? AND entity_id = ? AND model = ?", entityType, entityID, videoModel).
		First(&m).Error
	return &m, err
}

// ListDirectorEntityAssets 列出用户在指定实体类型 + 视频模型下的全部映射
func ListDirectorEntityAssets(userID int, entityType, videoModel string) ([]*DirectorEntityAsset, error) {
	var list []*DirectorEntityAsset
	err := DB.Where("user_id = ? AND entity_type = ? AND model = ?", userID, entityType, videoModel).
		Find(&list).Error
	return list, err
}
