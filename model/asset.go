package model

import (
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// 素材类型（上游仅接受 Image/Video/Audio）
const (
	AssetTypeImage = "Image"
	AssetTypeVideo = "Video"
	AssetTypeAudio = "Audio"
)

// 素材状态（本地归一化，上游状态映射到这三态）
const (
	AssetStatusPending = "pending"
	AssetStatusActive  = "active"
	AssetStatusFailed  = "failed"
)

// Asset 虚拟人像素材库记录。素材 ID 只在上传它的渠道上游有效，
// 因此素材与「用户 × 渠道」绑定；视频任务引用 asset://<AssetID> 时
// 由 Distribute 中间件强制锁定到 ChannelID 对应渠道转发。
type Asset struct {
	ID          int64  `json:"id" gorm:"primaryKey"`
	CreatedAt   int64  `json:"created_at" gorm:"index"`
	UpdatedAt   int64  `json:"updated_at"`
	UserID      int    `json:"user_id" gorm:"index:idx_asset_user_channel,priority:1"`
	ChannelID   int    `json:"channel_id" gorm:"index:idx_asset_user_channel,priority:2;index:idx_asset_channel_asset,priority:1"`
	AssetID     string `json:"asset_id" gorm:"type:varchar(191);index:idx_asset_channel_asset,priority:2"` // 上游素材 ID
	Name        string `json:"name" gorm:"type:varchar(191)"`
	AssetType   string `json:"asset_type" gorm:"type:varchar(20)"`
	Status      string `json:"status" gorm:"type:varchar(20);index"`
	SourceURL   string `json:"source_url" gorm:"type:text"`   // 用户注册时提供的素材 URL
	PreviewURL  string `json:"preview_url" gorm:"type:text"`  // 上游返回的可访问 URL（可能带签名时效）
	GroupID     string `json:"group_id" gorm:"type:varchar(191)"`
	ProjectName string `json:"project_name" gorm:"type:varchar(191)"`
	ErrorMsg    string `json:"error_msg" gorm:"type:text"`
}

func (Asset) TableName() string {
	return "assets"
}

func IsValidAssetType(t string) bool {
	switch t {
	case AssetTypeImage, AssetTypeVideo, AssetTypeAudio:
		return true
	}
	return false
}

func (a *Asset) Insert() error {
	now := time.Now().Unix()
	a.CreatedAt = now
	a.UpdatedAt = now
	return DB.Create(a).Error
}

func GetAssetById(id int64) (*Asset, error) {
	var asset Asset
	err := DB.Where("id = ?", id).First(&asset).Error
	return &asset, err
}

// GetAssetByChannelAndAssetID 用于 asset:// 引用解析：上游 ID + 渠道唯一定位素材。
func GetAssetByChannelAndAssetID(channelId int, assetID string) (*Asset, error) {
	var asset Asset
	err := DB.Where("channel_id = ? AND asset_id = ?", channelId, assetID).First(&asset).Error
	return &asset, err
}

// GetUserAssetsByAssetIDs 校验 asset:// 引用的素材归属当前用户，按上游 ID 批量查询。
func GetUserAssetsByAssetIDs(userId int, assetIDs []string) ([]*Asset, error) {
	if len(assetIDs) == 0 {
		return nil, nil
	}
	var assets []*Asset
	err := DB.Where("user_id = ? AND asset_id IN ?", userId, assetIDs).Find(&assets).Error
	return assets, err
}

func GetUserAssets(userId int, channelId int, startIdx int, num int) ([]*Asset, error) {
	var assets []*Asset
	var err error
	if num == 0 {
		num = 50
	}
	query := DB.Where("user_id = ?", userId)
	if channelId > 0 {
		query = query.Where("channel_id = ?", channelId)
	}
	if startIdx == 0 {
		err = query.Order("id desc").Limit(num).Find(&assets).Error
	} else {
		err = query.Order("id desc").Limit(num).Offset(startIdx).Find(&assets).Error
	}
	return assets, err
}

func DeleteAssetById(id int64, userId int) (string, error) {
	if id == 0 {
		return "", errors.New("asset id is required")
	}
	result := DB.Where("id = ? AND user_id = ?", id, userId).Delete(&Asset{})
	if result.Error != nil {
		return "", result.Error
	}
	if result.RowsAffected == 0 {
		return "", errors.New("asset not found or not owned by user")
	}
	return "", nil
}

// UpdateAssetStatus 刷新素材状态与预览地址（上游查询成功时调用）。
func UpdateAssetStatus(id int64, status string, previewURL string, errMsg string) error {
	updates := map[string]any{
		"status":     status,
		"error_msg":  errMsg,
		"updated_at": time.Now().Unix(),
	}
	if previewURL != "" {
		updates["preview_url"] = previewURL
	}
	return DB.Model(&Asset{}).Where("id = ?", id).Updates(updates).Error
}

// AssetURIScheme 素材引用前缀，视频任务 content 中以 asset://<上游素材ID> 引用素材。
const AssetURIScheme = "asset://"

// RefURI 生成 content 中使用的引用串。
func (a *Asset) RefURI() string {
	return fmt.Sprintf("%s%s", AssetURIScheme, a.AssetID)
}

// GetEnabledChannels 获取全部启用渠道（含 key，仅供服务端内部逻辑使用，禁止直接透出）。
func GetEnabledChannels() ([]*Channel, error) {
	var channels []*Channel
	err := DB.Where("status = ?", common.ChannelStatusEnabled).Find(&channels).Error
	return channels, err
}
