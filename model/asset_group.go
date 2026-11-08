package model

import (
	"encoding/base64"
	"errors"
	"strconv"
	"time"

	"gorm.io/gorm"
)

// 素材组默认值（对齐火山方舟官方 CreateAssetGroup 的缺省语义）。
const (
	AssetGroupTypeDefault      = "AIGC"
	AssetGroupTypeLivenessFace = "LivenessFace"
	AssetProjectNameDefault    = "default"
)

// 游标分页参数（官方兼容 API 的 NextToken / MaxResults）。
const (
	assetCursorDefaultLimit = 10
	assetCursorMaxLimit     = 100
)

// ErrInvalidCursor 对外游标（NextToken）非法，控制器据此返回 400。
var ErrInvalidCursor = errors.New("invalid next token")

// AssetListQuery 是素材与素材组共用的官方列表查询条件。
// PageNumber/PageSize 同时为正表示页码分页，否则使用 NextToken/MaxResults 游标分页。
type AssetListQuery struct {
	GroupIDs    []string
	Statuses    []string
	NameFuzzy   string
	GroupType   string
	ProjectName string
	SortBy      string
	SortOrder   string
	MaxResults  int
	NextToken   string
	PageNumber  int
	PageSize    int
}

// AssetListMeta 携带两种分页各自允许暴露的响应字段。
type AssetListMeta struct {
	NextToken  string
	PageNumber int
	PageSize   int
	TotalCount int64
}

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

// encodeAssetCursor 把下一页偏移编码为不透明的对外游标。
func encodeAssetCursor(offset int64) string {
	return base64.URLEncoding.EncodeToString([]byte(strconv.FormatInt(offset, 10)))
}

func decodeAssetCursor(token string) (int64, error) {
	if token == "" {
		return 0, nil
	}
	raw, err := base64.URLEncoding.DecodeString(token)
	if err != nil {
		return 0, ErrInvalidCursor
	}
	offset, err := strconv.ParseInt(string(raw), 10, 64)
	if err != nil || offset < 0 || offset > int64(^uint(0)>>1) {
		return 0, ErrInvalidCursor
	}
	return offset, nil
}

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

// GetUserAssetGroups 在用户归属范围内执行官方过滤、排序和两种互斥分页。
func GetUserAssetGroups(userId int, list AssetListQuery) ([]*AssetGroup, AssetListMeta, error) {
	query := DB.Model(&AssetGroup{}).Where("user_id = ?", userId)
	if list.GroupType != "" {
		query = query.Where("group_type = ?", list.GroupType)
	}
	if list.ProjectName == AssetProjectNameDefault {
		query = query.Where("(project_name = ? OR project_name = '' OR project_name IS NULL)", AssetProjectNameDefault)
	} else if list.ProjectName != "" {
		query = query.Where("project_name = ?", list.ProjectName)
	}
	if len(list.GroupIDs) > 0 {
		query = query.Where("group_id IN ?", list.GroupIDs)
	}
	if list.NameFuzzy != "" {
		pattern, err := sanitizeLikePattern(list.NameFuzzy)
		if err != nil {
			return nil, AssetListMeta{}, err
		}
		query = query.Where("name LIKE ? ESCAPE '!'", "%"+pattern+"%")
	}
	direction := "desc"
	if list.SortOrder == "Asc" {
		direction = "asc"
	}
	query = query.Order("created_at " + direction + ", id " + direction)
	return findAssetListPage[AssetGroup](query, list)
}

// findAssetListPage 执行官方列表分页；页码模式返回总数，游标模式只返回下一页令牌。
func findAssetListPage[T any](query *gorm.DB, list AssetListQuery) ([]*T, AssetListMeta, error) {
	if list.PageNumber > 0 || list.PageSize > 0 {
		var total int64
		if err := query.Count(&total).Error; err != nil {
			return nil, AssetListMeta{}, err
		}
		var items []*T
		offset := (list.PageNumber - 1) * list.PageSize
		if err := query.Offset(offset).Limit(list.PageSize).Find(&items).Error; err != nil {
			return nil, AssetListMeta{}, err
		}
		return items, AssetListMeta{PageNumber: list.PageNumber, PageSize: list.PageSize, TotalCount: total}, nil
	}

	offset, err := decodeAssetCursor(list.NextToken)
	if err != nil {
		return nil, AssetListMeta{}, err
	}
	limit := normalizeAssetLimit(list.MaxResults)
	var items []*T
	if err := query.Offset(int(offset)).Limit(limit + 1).Find(&items).Error; err != nil {
		return nil, AssetListMeta{}, err
	}
	meta := AssetListMeta{}
	if len(items) > limit {
		items = items[:limit]
		meta.NextToken = encodeAssetCursor(offset + int64(limit))
	}
	return items, meta, nil
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
