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
	ID            int64  `json:"id" gorm:"primaryKey"`
	CreatedAt     int64  `json:"created_at" gorm:"index"`
	UpdatedAt     int64  `json:"updated_at"`
	UserID        int    `json:"user_id" gorm:"index:idx_asset_user_channel,priority:1"`
	ChannelID     int    `json:"channel_id" gorm:"index:idx_asset_user_channel,priority:2;index:idx_asset_channel_asset,priority:1;uniqueIndex:idx_asset_source_channel,priority:2"`
	AssetID       string `json:"asset_id" gorm:"type:varchar(191);index:idx_asset_channel_asset,priority:2"` // 上游素材 ID
	SourceAssetId *int64 `json:"source_asset_id,omitempty" gorm:"index;uniqueIndex:idx_asset_source_channel,priority:1"` // 源素材关联 ID（可为空，兼容旧数据）
	Name          string `json:"name" gorm:"type:varchar(191)"`
	AssetType     string `json:"asset_type" gorm:"type:varchar(20)"`
	Status        string `json:"status" gorm:"type:varchar(20);index"`
	SourceURL     string `json:"source_url" gorm:"type:text"`  // 用户注册时提供的素材 URL
	PreviewURL    string `json:"preview_url" gorm:"type:text"` // 上游返回的可访问 URL（可能带签名时效）
	GroupID       string `json:"group_id" gorm:"type:varchar(191)"`
	ProjectName   string `json:"project_name" gorm:"type:varchar(191)"`
	ErrorMsg      string `json:"error_msg" gorm:"type:text"`
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

// GetAssetsByChannel 跨用户列出某渠道下的素材副本（管理员按渠道同步用）。
func GetAssetsByChannel(channelId int, startIdx int, num int) ([]*Asset, error) {
	if num == 0 {
		num = 50
	}
	var assets []*Asset
	query := DB.Where("channel_id = ?", channelId)
	if startIdx == 0 {
		return assets, query.Order("id desc").Limit(num).Find(&assets).Error
	}
	return assets, query.Order("id desc").Limit(num).Offset(startIdx).Find(&assets).Error
}

// GetAssetByChannelAndSourceURL 按渠道 + 源 URL 定位已存在副本。
// 供 SourceAssetId 为空（直接按 URL 注册）的素材在跨渠道同步时做幂等预检。
func GetAssetByChannelAndSourceURL(channelId int, sourceURL string) (*Asset, error) {
	var asset Asset
	err := DB.Where("channel_id = ? AND source_url = ?", channelId, sourceURL).First(&asset).Error
	return &asset, err
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

// DeleteAssetsByUserAndAssetID 按「用户 + 上游素材 ID」删除渠道素材记录，返回删除行数。
// 供对外删除接口使用：按 user+asset_id 全删，避免遗漏同 ID 的多渠道登记。
func DeleteAssetsByUserAndAssetID(userId int, assetID string) (int64, error) {
	if assetID == "" {
		return 0, errors.New("asset id is required")
	}
	result := DB.Where("user_id = ? AND asset_id = ?", userId, assetID).Delete(&Asset{})
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}

// DeleteAssetsBySourceAssetId 级联删除某源素材在各渠道的副本记录。
// 供删除智能素材时清理 assets 表映射（上游素材保留，仅删本地登记）。
func DeleteAssetsBySourceAssetId(sourceAssetId int64) error {
	return DB.Where("source_asset_id = ?", sourceAssetId).Delete(&Asset{}).Error
}

// AdminDeleteChannelAssetById 按渠道与素材 ID 删除副本（管理员跨用户操作，不限归属）。
// 限定 channel_id 防止误删其他渠道下的同名副本。
func AdminDeleteChannelAssetById(channelId int, id int64) error {
	if id == 0 {
		return errors.New("asset id is required")
	}
	result := DB.Where("id = ? AND channel_id = ?", id, channelId).Delete(&Asset{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("asset not found")
	}
	return nil
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

// UpsertChannelAssetBySourceURL 幂等写入无 SourceAssetId 的渠道副本，键为 (channel_id, source_url)。
// 与 UpsertChannelAsset 行为一致：命中则复用旧行并清空 error_msg，否则新建。
func UpsertChannelAssetBySourceURL(a *Asset) error {
	var existing Asset
	err := DB.Where("channel_id = ? AND source_url = ?", a.ChannelID, a.SourceURL).First(&existing).Error
	if err == nil {
		a.ID = existing.ID
		a.CreatedAt = existing.CreatedAt
		return DB.Model(&Asset{}).Where("id = ?", existing.ID).Updates(map[string]any{
			"asset_id":     a.AssetID,
			"status":       a.Status,
			"group_id":     a.GroupID,
			"project_name": a.ProjectName,
			"error_msg":    "",
			"updated_at":   time.Now().Unix(),
		}).Error
	}
	return a.Insert()
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
