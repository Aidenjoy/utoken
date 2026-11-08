package model

import (
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// SourceAsset 用户上传到自有 TOS 的源素材记录。
// 源素材不绑定渠道，由用户上传后按需同步到各渠道（见 assets 表的 SourceAssetId）。
type SourceAsset struct {
	ID        int64  `json:"id" gorm:"primaryKey"`
	RefID     string `json:"ref_id" gorm:"type:varchar(64);uniqueIndex"` // 对外稳定引用 asset-<年月日时分秒>-sm<三位数字>，与官方渠道素材同构、以 sm+纯数字后缀区分
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
	if s.RefID == "" {
		s.RefID = generateUniqueSourceAssetRefID()
	}
	return DB.Create(s).Error
}

// formatSourceAssetRef 生成智能素材对外引用：asset-<年月日时分秒>-sm<三位数字>。
// 与官方渠道素材 asset-<时间戳>-<随机串> 同构，仅以 sm+纯数字后缀区分，便于客户系统识别。
func formatSourceAssetRef(t time.Time) string {
	return fmt.Sprintf("asset-%s-sm%03d", t.Format("20060102150405"), common.GetRandomInt(1000))
}

// generateUniqueSourceAssetRefID 生成一个当前库中尚未占用的引用。时间戳精确到秒、
// 后缀仅三位数字，批量上传同秒可能撞号，故循环查库去重；唯一索引是最终防线，
// 极端并发下撞索引由调用方重试上传即可。
func generateUniqueSourceAssetRefID() string {
	for i := 0; i < 16; i++ {
		candidate := formatSourceAssetRef(time.Now())
		if _, err := GetSourceAssetByRefId(candidate); errors.Is(err, gorm.ErrRecordNotFound) {
			return candidate
		}
	}
	return formatSourceAssetRef(time.Now())
}

// GetSourceAssetByRefId 按对外引用（ref_id）查询源素材；未命中返回 gorm.ErrRecordNotFound。
func GetSourceAssetByRefId(refId string) (*SourceAsset, error) {
	var asset SourceAsset
	err := DB.Where("ref_id = ?", refId).First(&asset).Error
	return &asset, err
}

// backfillSourceAssetRefIDs 为历史源素材补发 ref_id（迁移用，幂等）。时间戳取各行
// CreatedAt，内存 used 集合保证同秒多行不撞号；只回填仍为空的行，多节点共享库并发
// 启动时由唯一索引兜底，撞号则跳过、待下次启动自愈。
func backfillSourceAssetRefIDs() error {
	var assets []*SourceAsset
	if err := DB.Where("ref_id IS NULL OR ref_id = ''").Find(&assets).Error; err != nil {
		return err
	}
	if len(assets) == 0 {
		return nil
	}
	used := make(map[string]bool)
	var existing []string
	if err := DB.Model(&SourceAsset{}).
		Where("ref_id IS NOT NULL AND ref_id <> ''").
		Pluck("ref_id", &existing).Error; err == nil {
		for _, r := range existing {
			used[r] = true
		}
	}
	for _, a := range assets {
		ts := time.Unix(a.CreatedAt, 0)
		ref := ""
		for attempt := 0; attempt < 64; attempt++ {
			candidate := formatSourceAssetRef(ts)
			if used[candidate] {
				continue
			}
			used[candidate] = true
			ref = candidate
			break
		}
		if ref == "" {
			continue
		}
		if err := DB.Model(&SourceAsset{}).
			Where("id = ? AND (ref_id IS NULL OR ref_id = '')", a.ID).
			Update("ref_id", ref).Error; err != nil {
			common.SysError(fmt.Sprintf("[SourceAsset] backfill ref_id failed (id=%d): %v", a.ID, err))
		}
	}
	return nil
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

// GetSourceAssetByUserAndURL 按「用户 + 源地址」查找已登记的源素材。
// 供以 URL 注册智能素材时做幂等去重，避免同一地址重复登记产生多份智能素材。
// 未命中时返回 record-not-found 错误，调用方须按 error 判定。
func GetSourceAssetByUserAndURL(userId int, sourceURL string) (*SourceAsset, error) {
	var asset SourceAsset
	err := DB.Where("user_id = ? AND source_url = ?", userId, sourceURL).First(&asset).Error
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
			"asset_id":     a.AssetID,
			"status":       a.Status,
			"source_url":   a.SourceURL,
			"group_id":     a.GroupID,
			"project_name": a.ProjectName,
			"error_code":   "",
			"error_msg":    "",
			"updated_at":   time.Now().Unix(),
		}).Error
	}
	return a.Insert()
}
