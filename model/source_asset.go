package model

import "time"

// SourceAsset 用户上传到自有 TOS 的源素材记录。
// 源素材不绑定渠道，由用户上传后按需同步到各渠道（见 assets 表的 SourceAssetId）。
type SourceAsset struct {
	ID        int64  `json:"id" gorm:"primaryKey"`
	UserID    int    `json:"user_id" gorm:"index"`
	Name      string `json:"name" gorm:"type:varchar(191)"`
	AssetType string `json:"asset_type" gorm:"type:varchar(20)"` // Image/Video/Audio
	SourceURL string `json:"source_url" gorm:"type:text"`        // 自有 TOS 的永久 URL
	FileSize  int64  `json:"file_size"`
	Status    string `json:"status" gorm:"type:varchar(20);index"` // pending/active/failed
	CreatedAt int64  `json:"created_at" gorm:"index"`
	UpdatedAt int64  `json:"updated_at"`
}

func (SourceAsset) TableName() string {
	return "source_assets"
}

func (s *SourceAsset) Insert() error {
	now := time.Now().Unix()
	s.CreatedAt = now
	s.UpdatedAt = now
	return DB.Create(s).Error
}

func GetSourceAssetById(id int64) (*SourceAsset, error) {
	var asset SourceAsset
	err := DB.Where("id = ?", id).First(&asset).Error
	return &asset, err
}

func GetUserSourceAssets(userId int, startIdx int, num int) ([]*SourceAsset, error) {
	if num == 0 {
		num = 50
	}
	var assets []*SourceAsset
	query := DB.Where("user_id = ?", userId)
	if startIdx == 0 {
		err := query.Order("id desc").Limit(num).Find(&assets).Error
		return assets, err
	}
	err := query.Order("id desc").Limit(num).Offset(startIdx).Find(&assets).Error
	return assets, err
}

func DeleteSourceAssetById(id int64, userId int) error {
	result := DB.Where("id = ? AND user_id = ?", id, userId).Delete(&SourceAsset{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

func UpdateSourceAssetStatus(id int64, status string) error {
	return DB.Model(&SourceAsset{}).Where("id = ?", id).Updates(map[string]any{
		"status":     status,
		"updated_at": time.Now().Unix(),
	}).Error
}

// GetSourceAssetByAssetId 通过渠道素材的 asset_id 反查源素材。
// 用于视频任务提交时检查素材是否已同步到目标渠道。
func GetSourceAssetByAssetId(assetId int64) (*SourceAsset, error) {
	var asset SourceAsset
	err := DB.Where("id = ?", assetId).First(&asset).Error
	return &asset, err
}

// GetAssetsBySourceAssetId 查询指定源素材在所有渠道的副本。
func GetAssetsBySourceAssetId(sourceAssetId int64) ([]*Asset, error) {
	var assets []*Asset
	err := DB.Where("source_asset_id = ?", sourceAssetId).Find(&assets).Error
	return assets, err
}

// GetAssetBySourceAndChannel 查询指定源素材在指定渠道的副本。
func GetAssetBySourceAndChannel(sourceAssetId int64, channelId int) (*Asset, error) {
	var asset Asset
	err := DB.Where("source_asset_id = ? AND channel_id = ?", sourceAssetId, channelId).First(&asset).Error
	return &asset, err
}

// GetAssetsByStatus 查询指定状态的素材。
func GetAssetsByStatus(status string, limit int) ([]*Asset, error) {
	var assets []*Asset
	err := DB.Where("status = ?", status).Limit(limit).Find(&assets).Error
	return assets, err
}

// HasPendingAssets 判断是否存在待审核的渠道素材。
// 供调度器决定是否需要创建 asset_status_poll 任务行（空闲时不建行）。
func HasPendingAssets() bool {
	var id int64
	err := DB.Model(&Asset{}).
		Where("status = ?", AssetStatusPending).
		Limit(1).
		Pluck("id", &id).Error
	return err == nil && id != 0
}

// UpsertChannelAsset 幂等地写入「源素材 × 渠道」副本记录。
// 依赖 (source_asset_id, channel_id) 唯一索引：并发下由数据库保证唯一，
// 冲突时复用已存在的行，避免多节点同时同步产生重复副本。
func UpsertChannelAsset(a *Asset) error {
	var existing Asset
	err := DB.Where("source_asset_id = ? AND channel_id = ?", *a.SourceAssetId, a.ChannelID).First(&existing).Error
	if err == nil {
		a.ID = existing.ID
		a.CreatedAt = existing.CreatedAt
		return DB.Model(&Asset{}).Where("id = ?", existing.ID).Updates(map[string]any{
			"asset_id":    a.AssetID,
			"status":      a.Status,
			"source_url":  a.SourceURL,
			"group_id":    a.GroupID,
			"project_name": a.ProjectName,
			"error_msg":   "",
			"updated_at":  time.Now().Unix(),
		}).Error
	}
	return a.Insert()
}
