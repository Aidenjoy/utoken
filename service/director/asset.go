package director

import (
	"errors"
	"mime/multipart"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/model"

	"gorm.io/gorm"
)

// AssetService 素材库服务（上传登记、自定义分类管理）
type AssetService struct{}

// AssetWithUsername 素材及归属用户名（仅管理员视图填充）
type AssetWithUsername struct {
	model.DirectorAsset
	Username string `json:"username,omitempty"`
}

// ListAssets 分页查询素材；withUsername 时填充归属用户名（管理员视图）
func (s *AssetService) ListAssets(f model.DirectorAssetFilter, withUsername bool) ([]AssetWithUsername, int64, error) {
	assets, total, err := model.ListDirectorAssets(f)
	if err != nil {
		return nil, 0, err
	}
	list := make([]AssetWithUsername, 0, len(assets))
	for _, a := range assets {
		list = append(list, AssetWithUsername{DirectorAsset: *a})
	}
	if withUsername && len(assets) > 0 {
		userIDs := make([]int, 0, len(assets))
		for _, a := range assets {
			userIDs = append(userIDs, a.UserID)
		}
		usernames, err := fetchUsernames(userIDs)
		if err != nil {
			return nil, 0, err
		}
		for i := range list {
			list[i].Username = usernames[list[i].UserID]
		}
	}
	return list, total, nil
}

// builtinAssetCategories 内置分类键（生成环节自动登记，自定义分类不可重名）
var builtinAssetCategories = []string{"character", "scene", "prop", "storyboard", "composed", "merged", "edited", "upload"}

// UploadAsset 上传文件到 TOS 并登记为素材（分类默认 upload，可指定内置/自定义分类）
// 文件按项目归档到 TOS 批次 director{projectID}
func (s *AssetService) UploadAsset(header *multipart.FileHeader, userID, projectID, episodeID int, name, category string) (model.DirectorAsset, error) {
	url, err := storeHeaderToTOS(header, userID, projectID)
	if err != nil {
		return model.DirectorAsset{}, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = strings.TrimSuffix(header.Filename, filepath.Ext(header.Filename))
	}
	asset := model.DirectorAsset{
		UserID:   userID,
		Name:     name,
		Type:     detectUploadType(header),
		Category: normalizeAssetCategory(userID, category),
		URL:      url,
		FileSize: header.Size,
	}
	if projectID > 0 {
		asset.ProjectID = &projectID
	}
	if episodeID > 0 {
		asset.EpisodeID = &episodeID
	}
	return asset, asset.Insert()
}

// UploadFile 仅上传文件到 TOS 并返回 URL，不登记素材库（项目封面等纯引用场景）
func (s *AssetService) UploadFile(header *multipart.FileHeader, userID, projectID int) (string, error) {
	return storeHeaderToTOS(header, userID, projectID)
}

// detectUploadType 按 Content-Type / 扩展名推断素材类型（image/video/audio/file）
func detectUploadType(header *multipart.FileHeader) string {
	ct := header.Header.Get("Content-Type")
	switch {
	case strings.HasPrefix(ct, "image/"):
		return "image"
	case strings.HasPrefix(ct, "video/"):
		return "video"
	case strings.HasPrefix(ct, "audio/"):
		return "audio"
	}
	switch strings.ToLower(filepath.Ext(header.Filename)) {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp":
		return "image"
	case ".mp4", ".mov", ".webm", ".mkv", ".avi":
		return "video"
	case ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac":
		return "audio"
	}
	return "file"
}

// normalizeAssetCategory 校验分类值：内置键或当前用户已存在的自定义分类，否则回退 upload
func normalizeAssetCategory(userID int, category string) string {
	category = strings.TrimSpace(category)
	if category == "" {
		return "upload"
	}
	for _, b := range builtinAssetCategories {
		if b == category {
			return category
		}
	}
	var cnt int64
	model.DB.Model(&model.DirectorAssetCategory{}).Where("user_id = ? AND name = ?", userID, category).Count(&cnt)
	if cnt > 0 {
		return category
	}
	return "upload"
}

// validateCategoryName 自定义分类名校验（非空/长度/内置键/重名）
func validateCategoryName(userID int, name string, excludeID int) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", errors.New("分类名不能为空")
	}
	if utf8.RuneCountInString(name) > 20 {
		return "", errors.New("分类名最多 20 个字符")
	}
	for _, b := range builtinAssetCategories {
		if b == name {
			return "", errors.New("不能使用内置分类名：" + name)
		}
	}
	var cnt int64
	model.DB.Model(&model.DirectorAssetCategory{}).Where("user_id = ? AND name = ? AND id <> ?", userID, name, excludeID).Count(&cnt)
	if cnt > 0 {
		return "", errors.New("分类已存在：" + name)
	}
	return name, nil
}

// CreateAssetCategory 创建自定义分类
func (s *AssetService) CreateAssetCategory(userID int, name string) (model.DirectorAssetCategory, error) {
	var cat model.DirectorAssetCategory
	name, err := validateCategoryName(userID, name, 0)
	if err != nil {
		return cat, err
	}
	cat = model.DirectorAssetCategory{UserID: userID, Name: name}
	return cat, cat.Insert()
}

// UpdateAssetCategory 重命名自定义分类，并同步该分类下素材的 category 值
func (s *AssetService) UpdateAssetCategory(userID, id int, name string) error {
	name, err := validateCategoryName(userID, name, id)
	if err != nil {
		return err
	}
	var cat model.DirectorAssetCategory
	if err = model.DB.Where("id = ? AND user_id = ?", id, userID).First(&cat).Error; err != nil {
		return errors.New("分类不存在")
	}
	old := cat.Name
	return model.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&cat).Update("name", name).Error; err != nil {
			return err
		}
		return tx.Model(&model.DirectorAsset{}).Where("user_id = ? AND category = ?", userID, old).Update("category", name).Error
	})
}

// DeleteAssetCategory 删除自定义分类，其下素材回到未分类
func (s *AssetService) DeleteAssetCategory(userID, id int) error {
	var cat model.DirectorAssetCategory
	if err := model.DB.Where("id = ? AND user_id = ?", id, userID).First(&cat).Error; err != nil {
		return errors.New("分类不存在")
	}
	return model.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&cat).Error; err != nil {
			return err
		}
		return tx.Model(&model.DirectorAsset{}).Where("user_id = ? AND category = ?", userID, cat.Name).Update("category", "").Error
	})
}
