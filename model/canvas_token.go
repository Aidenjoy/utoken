package model

import (
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// CanvasImageTokenName 智能画布内部图片 Key 的名称。画布经网关门回环调用
// /v1/images/generations，需要一把归属于用户本人的图片类 Key：鉴权、限额、
// 计费与日志因此与真实调用完全一致，费用计到调用者账户，画布层不再二次扣费。
const CanvasImageTokenName = "智能画布图片 Key（自动创建）"

// EnsureCanvasImageToken 取得（必要时创建）用户用于画布回环调用的图片 Key。
// 已存在同名 Key 时直接复用；被禁用的同名 Key 重新启用，避免用户手动禁用后画布永久不可用。
func EnsureCanvasImageToken(userID int) (*Token, error) {
	var existing Token
	err := DB.Where("user_id = ? AND name = ?", userID, CanvasImageTokenName).First(&existing).Error
	if err == nil {
		if existing.Status != common.TokenStatusEnabled {
			if updateErr := DB.Model(&existing).
				Update("status", common.TokenStatusEnabled).Error; updateErr != nil {
				return nil, updateErr
			}
			existing.Status = common.TokenStatusEnabled
		}
		return &existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	now := time.Now().Unix()
	token := &Token{
		UserId:         userID,
		Key:            common.GetUUID(),
		Status:         common.TokenStatusEnabled,
		Name:           CanvasImageTokenName,
		CreatedTime:    now,
		AccessedTime:   now,
		ExpiredTime:    -1,
		UnlimitedQuota: true,
		KeyType:        TokenKeyTypeImage,
	}
	// Key 为唯一索引：极端并发下同名创建会一方失败，此处按「已存在」处理并回读。
	if createErr := DB.Create(token).Error; createErr != nil {
		var fallback Token
		if readErr := DB.Where("user_id = ? AND name = ?", userID, CanvasImageTokenName).
			First(&fallback).Error; readErr == nil {
			return &fallback, nil
		}
		return nil, createErr
	}
	return token, nil
}
