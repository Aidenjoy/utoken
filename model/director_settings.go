package model

import (
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// ===== 云导演：模型设定与内部令牌 =====

// DirectorModelSettings 用户级模型设定。模型均来自网关自身中转站，
// 只存模型名，不需要任何密钥。
type DirectorModelSettings struct {
	ID         int    `json:"id" gorm:"primaryKey"`
	CreatedAt  int64  `json:"createdAt"`
	UpdatedAt  int64  `json:"updatedAt"`
	UserID     int    `json:"userId" gorm:"uniqueIndex"`
	TextModel  string `json:"textModel" gorm:"size:128"`  // 文本模型（改写/提取/拆镜等）
	ImageModel string `json:"imageModel" gorm:"size:128"` // 图片生成模型
	VideoModel string `json:"videoModel" gorm:"size:128"` // 视频生成模型
}

func (DirectorModelSettings) TableName() string { return "director_model_settings" }

// GetDirectorModelSettings 获取用户模型设定，不存在时返回空设定（不报错）
func GetDirectorModelSettings(userID int) (*DirectorModelSettings, error) {
	var s DirectorModelSettings
	err := DB.Where("user_id = ?", userID).First(&s).Error
	if err == gorm.ErrRecordNotFound {
		return &DirectorModelSettings{UserID: userID}, nil
	}
	return &s, err
}

// UpsertDirectorModelSettings 保存用户模型设定
func UpsertDirectorModelSettings(userID int, textModel, imageModel, videoModel string) error {
	now := time.Now().Unix()
	var s DirectorModelSettings
	err := DB.Where("user_id = ?", userID).First(&s).Error
	if err == gorm.ErrRecordNotFound {
		s = DirectorModelSettings{
			CreatedAt:  now,
			UpdatedAt:  now,
			UserID:     userID,
			TextModel:  textModel,
			ImageModel: imageModel,
			VideoModel: videoModel,
		}
		return DB.Create(&s).Error
	}
	if err != nil {
		return err
	}
	s.UpdatedAt = now
	s.TextModel = textModel
	s.ImageModel = imageModel
	s.VideoModel = videoModel
	return DB.Model(&s).Updates(map[string]any{
		"text_model":  textModel,
		"image_model": imageModel,
		"video_model": videoModel,
		"updated_at":  now,
	}).Error
}

// DirectorUserToken 云导演内部中转令牌。内部调用统一走网关自身的
// /v1/* 端点，令牌与用户绑定，计费与限额与真实请求完全一致。
// 网关按协议隔离语言/图片/视频三类 Key，因此按能力分别绑定；
// TokenID/TokenKey 为旧版统一令牌，未单独绑定的能力回退到它。
type DirectorUserToken struct {
	ID            int    `json:"id" gorm:"primaryKey"`
	CreatedAt     int64  `json:"createdAt"`
	UpdatedAt     int64  `json:"updatedAt"`
	UserID        int    `json:"userId" gorm:"uniqueIndex"`
	TokenID       int    `json:"tokenId"`
	TokenKey      string `json:"-" gorm:"size:128"` // 明文 key，仅服务端回环调用使用
	TextTokenID   int    `json:"textTokenId"`
	TextTokenKey  string `json:"-" gorm:"size:128"`
	ImageTokenID  int    `json:"imageTokenId"`
	ImageTokenKey string `json:"-" gorm:"size:128"`
	VideoTokenID  int    `json:"videoTokenId"`
	VideoTokenKey string `json:"-" gorm:"size:128"`
}

func (DirectorUserToken) TableName() string { return "director_user_tokens" }

// DirectorServiceLabel 云导演能力的展示名（错误引导文案用）
func DirectorServiceLabel(serviceType string) string {
	switch serviceType {
	case "image":
		return "图片模型"
	case "video":
		return "视频模型"
	default:
		return "语言模型"
	}
}

// directorServiceKeyType 云导演能力要求的令牌类型（text 对应 language Key）
func directorServiceKeyType(serviceType string) string {
	switch serviceType {
	case "image":
		return TokenKeyTypeImage
	case "video":
		return TokenKeyTypeVideo
	default:
		return TokenKeyTypeLanguage
	}
}

// getDirectorBoundToken 读取用户在指定能力下绑定的令牌 ID 与 key；
// 未单独绑定时回退旧版统一令牌，完全未绑定时返回 0。
func getDirectorBoundToken(userID int, serviceType string) (int, string, error) {
	var dt DirectorUserToken
	err := DB.Where("user_id = ?", userID).First(&dt).Error
	if err == gorm.ErrRecordNotFound {
		return 0, "", nil
	}
	if err != nil {
		return 0, "", err
	}
	switch serviceType {
	case "image":
		if dt.ImageTokenID > 0 {
			return dt.ImageTokenID, dt.ImageTokenKey, nil
		}
	case "video":
		if dt.VideoTokenID > 0 {
			return dt.VideoTokenID, dt.VideoTokenKey, nil
		}
	default:
		if dt.TextTokenID > 0 {
			return dt.TextTokenID, dt.TextTokenKey, nil
		}
	}
	return dt.TokenID, dt.TokenKey, nil
}

// GetDirectorTokenKey 获取用户指定能力绑定的云导演内部令牌 key。
// 令牌由用户在「模型设定」中自行选择；未绑定或已失效时返回错误。
func GetDirectorTokenKey(userID int, serviceType string) (string, error) {
	tokenID, key, err := getDirectorBoundToken(userID, serviceType)
	if err != nil {
		return "", err
	}
	label := DirectorServiceLabel(serviceType)
	if tokenID <= 0 {
		return "", fmt.Errorf("尚未选择云导演%s Key，请先在「模型设定」中选择", label)
	}
	var token Token
	if err := DB.Where("id = ?", tokenID).First(&token).Error; err != nil ||
		token.Status != common.TokenStatusEnabled {
		return "", fmt.Errorf("云导演%s Key 已失效，请在「模型设定」中重新选择", label)
	}
	return key, nil
}

// GetDirectorTokenInfo 查询用户指定能力绑定的令牌详情（供模型设定页回显），未绑定时返回 nil
func GetDirectorTokenInfo(userID int, serviceType string) (*Token, error) {
	tokenID, _, err := getDirectorBoundToken(userID, serviceType)
	if err != nil || tokenID <= 0 {
		return nil, err
	}
	var token Token
	if err := DB.Where("id = ?", tokenID).First(&token).Error; err != nil {
		return nil, nil
	}
	return &token, nil
}

// BindDirectorToken 绑定用户指定能力的云导演内部令牌。
// 令牌配额由用户在「API 密钥」页面自行管理，绑定时不做额外限额（默认不限额）。
// 已分类的 Key 必须与能力匹配（网关按协议隔离）；存量空类型 Key 保持原有行为，可用于任何能力。
func BindDirectorToken(userID, tokenID int, serviceType string) error {
	var token Token
	if err := DB.Where("id = ? AND user_id = ?", tokenID, userID).First(&token).Error; err != nil {
		return errors.New("令牌不存在")
	}
	if token.Status != common.TokenStatusEnabled {
		return errors.New("令牌已禁用，请先启用后再选择")
	}
	if token.KeyType != "" && token.KeyType != directorServiceKeyType(serviceType) {
		return fmt.Errorf("该令牌类型不匹配，请选择%s Key", DirectorServiceLabel(serviceType))
	}
	now := time.Now().Unix()
	var dt DirectorUserToken
	err := DB.Where("user_id = ?", userID).First(&dt).Error
	if err != nil && err != gorm.ErrRecordNotFound {
		return err
	}
	updates := map[string]any{"updated_at": now}
	switch serviceType {
	case "image":
		dt.ImageTokenID, dt.ImageTokenKey = tokenID, token.Key
		updates["image_token_id"], updates["image_token_key"] = tokenID, token.Key
	case "video":
		dt.VideoTokenID, dt.VideoTokenKey = tokenID, token.Key
		updates["video_token_id"], updates["video_token_key"] = tokenID, token.Key
	default:
		dt.TextTokenID, dt.TextTokenKey = tokenID, token.Key
		updates["text_token_id"], updates["text_token_key"] = tokenID, token.Key
	}
	if err == gorm.ErrRecordNotFound {
		dt.CreatedAt, dt.UpdatedAt, dt.UserID = now, now, userID
		return DB.Create(&dt).Error
	}
	return DB.Model(&dt).Updates(updates).Error
}
