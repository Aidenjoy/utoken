package model

import (
	"encoding/base64"
	"errors"
	"strconv"
	"time"
)

// 素材组默认值（对齐火山方舟官方 CreateAssetGroup 的缺省语义）。
const (
	AssetGroupTypeDefault   = "AIGC"
	AssetProjectNameDefault = "default"
)

// 游标分页参数（官方兼容 API 的 NextToken / MaxResults）。
const (
	assetCursorDefaultLimit = 20
	assetCursorMaxLimit     = 100
)

// ErrInvalidCursor 对外游标（NextToken）非法，控制器据此返回 400。
var ErrInvalidCursor = errors.New("invalid next token")

// AssetGroup 本地素材组登记。组与「用户 × 上游渠道」绑定：
// CreateAsset 必须落到建组时的同一 ChannelID，保证与上游同一账号。
// 官方兼容 API 的 List/Get 一律读本地并按 UserID 归属过滤，杜绝跨租户。
type AssetGroup struct {
	ID          int64  `json:"id" gorm:"primaryKey"`
	CreatedAt   int64  `json:"created_at" gorm:"index"`
	UpdatedAt   int64  `json:"updated_at"`
	UserID      int    `json:"user_id" gorm:"index:idx_ag_user_group,priority:1"`
	ChannelID   int    `json:"channel_id"`                                                           // 组所在上游渠道
	GroupID     string `json:"group_id" gorm:"type:varchar(191);index:idx_ag_user_group,priority:2"` // 上游组 ID
	Name        string `json:"name" gorm:"type:varchar(191)"`
	Description string `json:"description" gorm:"type:text"`
	GroupType   string `json:"group_type" gorm:"type:varchar(32)"`    // 默认 AIGC
	ProjectName string `json:"project_name" gorm:"type:varchar(191)"` // 默认 default
}

func (AssetGroup) TableName() string {
	return "asset_groups"
}

// encodeAssetCursor 把自增 ID 编码为对外游标（base64），供官方兼容 API 的 NextToken 使用。
func encodeAssetCursor(id int64) string {
	return base64.URLEncoding.EncodeToString([]byte(strconv.FormatInt(id, 10)))
}

// decodeAssetCursor 解析游标为「id < cursor」的上界；空游标返回 0（表示从头开始）。
func decodeAssetCursor(token string) (int64, error) {
	if token == "" {
		return 0, nil
	}
	raw, err := base64.URLEncoding.DecodeString(token)
	if err != nil {
		return 0, ErrInvalidCursor
	}
	id, err := strconv.ParseInt(string(raw), 10, 64)
	if err != nil || id < 0 {
		return 0, ErrInvalidCursor
	}
	return id, nil
}

// normalizeAssetLimit 归一化分页大小：默认 20，上限 100。
func normalizeAssetLimit(maxResults int) int {
	if maxResults <= 0 {
		return assetCursorDefaultLimit
	}
	if maxResults > assetCursorMaxLimit {
		return assetCursorMaxLimit
	}
	return maxResults
}

func (g *AssetGroup) Insert() error {
	now := time.Now().Unix()
	g.CreatedAt = now
	g.UpdatedAt = now
	if g.GroupType == "" {
		g.GroupType = AssetGroupTypeDefault
	}
	if g.ProjectName == "" {
		g.ProjectName = AssetProjectNameDefault
	}
	return DB.Create(g).Error
}

// GetUserAssetGroups 按归属列出用户的素材组：user_id 过滤 + 可选 group_id IN +
// 可选 name 模糊 + id desc 游标分页。返回结果与下一页游标（无更多则空串）。
func GetUserAssetGroups(userId int, groupIDs []string, nameFuzzy string, maxResults int, nextToken string) ([]*AssetGroup, string, error) {
	limit := normalizeAssetLimit(maxResults)
	cursor, err := decodeAssetCursor(nextToken)
	if err != nil {
		return nil, "", err
	}
	query := DB.Where("user_id = ?", userId)
	if len(groupIDs) > 0 {
		query = query.Where("group_id IN ?", groupIDs)
	}
	if nameFuzzy != "" {
		pattern, err := sanitizeLikePattern(nameFuzzy)
		if err != nil {
			return nil, "", err
		}
		query = query.Where("name LIKE ? ESCAPE '!'", "%"+pattern+"%")
	}
	if cursor > 0 {
		query = query.Where("id < ?", cursor)
	}
	var groups []*AssetGroup
	if err := query.Order("id desc").Limit(limit + 1).Find(&groups).Error; err != nil {
		return nil, "", err
	}
	next := ""
	if len(groups) > limit {
		groups = groups[:limit]
		next = encodeAssetCursor(groups[len(groups)-1].ID)
	}
	return groups, next, nil
}

// GetAssetGroupByUserAndGroupID 按「用户 + 上游组 ID」精确查询；未命中返回 gorm.ErrRecordNotFound。
func GetAssetGroupByUserAndGroupID(userId int, groupID string) (*AssetGroup, error) {
	var group AssetGroup
	err := DB.Where("user_id = ? AND group_id = ?", userId, groupID).First(&group).Error
	return &group, err
}

// GetAssetGroupsByUserAndGroupIDs 批量按「用户 + 组 ID 列表」查询，供 DeleteAssetGroup 级联用。
func GetAssetGroupsByUserAndGroupIDs(userId int, groupIDs []string) ([]*AssetGroup, error) {
	if len(groupIDs) == 0 {
		return nil, nil
	}
	var groups []*AssetGroup
	err := DB.Where("user_id = ? AND group_id IN ?", userId, groupIDs).Find(&groups).Error
	return groups, err
}

// UpdateAssetGroupFields 更新组的名称与描述（始终带 user_id 过滤，防跨租户写入）。
// 归属与存在性由调用方先行读取校验；此处不以 RowsAffected==0 报错，
// 因为提交未变更值时 MySQL 亦返回 0 影响行，属幂等成功。
func UpdateAssetGroupFields(userId int, groupID string, name, description string) error {
	return DB.Model(&AssetGroup{}).Where("user_id = ? AND group_id = ?", userId, groupID).
		Updates(map[string]any{
			"name":        name,
			"description": description,
			"updated_at":  time.Now().Unix(),
		}).Error
}

// DeleteAssetGroupByUserAndGroupID 删除组本地登记，返回删除行数（0 表示不存在或非本人）。
func DeleteAssetGroupByUserAndGroupID(userId int, groupID string) (int64, error) {
	result := DB.Where("user_id = ? AND group_id = ?", userId, groupID).Delete(&AssetGroup{})
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}
