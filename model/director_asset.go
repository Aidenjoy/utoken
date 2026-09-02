package model

import (
	"time"
)

// ===== 云导演：项目素材库 =====

// DirectorAsset 云导演素材（区别于渠道虚拟人像素材库 model.Asset）
type DirectorAsset struct {
	ID           int    `json:"id" gorm:"primaryKey"`
	CreatedAt    int64  `json:"createdAt" gorm:"index"`
	UpdatedAt    int64  `json:"updatedAt"`
	UserID       int    `json:"userId" gorm:"index"`
	ProjectID    *int   `json:"projectId" gorm:"index"`
	EpisodeID    *int   `json:"episodeId" gorm:"index"`
	StoryboardID *int   `json:"storyboardId" gorm:"index"`
	Name         string `json:"name" gorm:"size:128"`           // 素材名称
	Type         string `json:"type" gorm:"size:32;index"`      // image/video/subtitle
	Category     string `json:"category" gorm:"size:64"`        // 分类
	URL          string `json:"url" gorm:"size:512"`            // 访问地址
	FileSize     int64  `json:"fileSize"`                       // 文件大小(字节)
	Width        int    `json:"width"`                          // 宽度
	Height       int    `json:"height"`                         // 高度
	Duration     int    `json:"duration"`                       // 时长(秒)
	IsFavorite   bool   `json:"isFavorite"`                     // 是否收藏
}

func (DirectorAsset) TableName() string { return "director_assets" }

func (a *DirectorAsset) Insert() error {
	now := time.Now().Unix()
	a.CreatedAt = now
	a.UpdatedAt = now
	return DB.Create(a).Error
}

func (a *DirectorAsset) Update(fields map[string]any) error {
	a.UpdatedAt = time.Now().Unix()
	return DB.Model(a).Updates(fields).Error
}

func DeleteDirectorAsset(id int) error {
	return DB.Delete(&DirectorAsset{}, id).Error
}

func GetDirectorAssetByID(id int) (*DirectorAsset, error) {
	var a DirectorAsset
	err := DB.First(&a, id).Error
	return &a, err
}

// DirectorAssetFilter 素材列表过滤
type DirectorAssetFilter struct {
	UserID       int
	ProjectID    *int
	EpisodeID    *int
	StoryboardID *int
	Type         string
	Category     string
	IsFavorite   *bool
	Keyword      string
	Page         int
	PageSize     int
}

func ListDirectorAssets(f DirectorAssetFilter) ([]*DirectorAsset, int64, error) {
	query := DB.Model(&DirectorAsset{})
	if f.UserID > 0 {
		query = query.Where("user_id = ?", f.UserID)
	}
	if f.ProjectID != nil {
		query = query.Where("project_id = ?", *f.ProjectID)
	}
	if f.EpisodeID != nil {
		query = query.Where("episode_id = ?", *f.EpisodeID)
	}
	if f.StoryboardID != nil {
		query = query.Where("storyboard_id = ?", *f.StoryboardID)
	}
	if f.Type != "" {
		query = query.Where("type = ?", f.Type)
	}
	if f.Category != "" {
		query = query.Where("category = ?", f.Category)
	}
	if f.IsFavorite != nil {
		query = query.Where("is_favorite = ?", *f.IsFavorite)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	page, pageSize := normalizePage(f.Page, f.PageSize)
	var list []*DirectorAsset
	err := query.Order("id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&list).Error
	return list, total, err
}

// DirectorAssetCategory 素材库自定义分类
type DirectorAssetCategory struct {
	ID        int    `json:"id" gorm:"primaryKey"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
	UserID    int    `json:"userId" gorm:"index"`
	Name      string `json:"name" gorm:"size:64;index"` // 分类名
}

func (DirectorAssetCategory) TableName() string { return "director_asset_categories" }

func (c *DirectorAssetCategory) Insert() error {
	now := time.Now().Unix()
	c.CreatedAt = now
	c.UpdatedAt = now
	return DB.Create(c).Error
}

func (c *DirectorAssetCategory) Update(fields map[string]any) error {
	c.UpdatedAt = time.Now().Unix()
	return DB.Model(c).Updates(fields).Error
}

func DeleteDirectorAssetCategory(id int) error {
	return DB.Delete(&DirectorAssetCategory{}, id).Error
}

func ListDirectorAssetCategories(userID int) ([]*DirectorAssetCategory, error) {
	var list []*DirectorAssetCategory
	err := DB.Where("user_id = ?", userID).Order("id ASC").Find(&list).Error
	return list, err
}
