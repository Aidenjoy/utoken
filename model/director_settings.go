package model

import (
	"errors"
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
type DirectorUserToken struct {
	ID        int    `json:"id" gorm:"primaryKey"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
	UserID    int    `json:"userId" gorm:"uniqueIndex"`
	TokenID   int    `json:"tokenId"`
	TokenKey  string `json:"-" gorm:"size:128"` // 明文 key，仅服务端回环调用使用
}

func (DirectorUserToken) TableName() string { return "director_user_tokens" }

// GetDirectorTokenKey 获取用户绑定的云导演内部令牌 key。
// 令牌由用户在「模型设定」中自行选择，不再自动创建；未绑定或已失效时返回错误。
func GetDirectorTokenKey(userID int) (string, error) {
	var dt DirectorUserToken
	err := DB.Where("user_id = ?", userID).First(&dt).Error
	if err == gorm.ErrRecordNotFound {
		return "", errors.New("尚未选择云导演内部令牌，请先在「模型设定」中选择令牌")
	}
	if err != nil {
		return "", err
	}
	var token Token
	if err := DB.Where("id = ?", dt.TokenID).First(&token).Error; err != nil ||
		token.Status != common.TokenStatusEnabled {
		return "", errors.New("云导演内部令牌已失效，请在「模型设定」中重新选择")
	}
	return dt.TokenKey, nil
}

// GetDirectorTokenInfo 查询用户绑定的令牌详情（供模型设定页回显），未绑定时返回 nil
func GetDirectorTokenInfo(userID int) (*Token, error) {
	var dt DirectorUserToken
	err := DB.Where("user_id = ?", userID).First(&dt).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var token Token
	if err := DB.Where("id = ?", dt.TokenID).First(&token).Error; err != nil {
		return nil, nil
	}
	return &token, nil
}

// BindDirectorToken 绑定用户的云导演内部令牌。
// 令牌配额由用户在「API 密钥」页面自行管理，绑定时不做额外限额（默认不限额）。
func BindDirectorToken(userID, tokenID int) error {
	var token Token
	if err := DB.Where("id = ? AND user_id = ?", tokenID, userID).First(&token).Error; err != nil {
		return errors.New("令牌不存在")
	}
	if token.Status != common.TokenStatusEnabled {
		return errors.New("令牌已禁用，请先启用后再选择")
	}
	now := time.Now().Unix()
	var dt DirectorUserToken
	err := DB.Where("user_id = ?", userID).First(&dt).Error
	if err == gorm.ErrRecordNotFound {
		dt = DirectorUserToken{
			CreatedAt: now,
			UpdatedAt: now,
			UserID:    userID,
			TokenID:   tokenID,
			TokenKey:  token.Key,
		}
		return DB.Create(&dt).Error
	}
	if err != nil {
		return err
	}
	return DB.Model(&dt).Updates(map[string]any{
		"token_id":   tokenID,
		"token_key":  token.Key,
		"updated_at": now,
	}).Error
}
