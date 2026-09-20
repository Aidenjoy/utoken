package model

import (
	"errors"
	"sync"

	"gorm.io/gorm"
)

// 用户 token 消耗费率的进程内缓存（userId -> token_rate）。
// 写穿缓存：UpdateUserTokenRate 成功后同步更新；读路径 miss 时查库回填。
// 注意：多节点部署时其他节点的缓存不会自动失效（本期不做 Redis pub/sub 同步），
// 修改费率后其他节点最迟在重启后生效。
var (
	tokenRateCache     = make(map[int]float64)
	tokenRateCacheLock sync.RWMutex
)

// GetUserTokenRate 返回用户设置的 token 费率；0 表示未设置（调用方视为不缩放）。
// 查询失败时 fail-open 返回 0，绝不因费率查询错误阻断任务结算链路。
func GetUserTokenRate(id int) float64 {
	if id <= 0 {
		return 0
	}
	tokenRateCacheLock.RLock()
	rate, ok := tokenRateCache[id]
	tokenRateCacheLock.RUnlock()
	if ok {
		return rate
	}

	var user User
	err := DB.Select("id", "token_rate").Where("id = ?", id).First(&user).Error
	if err != nil {
		// 用户不存在（如已删除）时缓存 0，避免任务轮询反复打库；
		// 其他错误不缓存，下次调用重试。
		if errors.Is(err, gorm.ErrRecordNotFound) {
			updateUserTokenRateCache(id, 0)
		}
		return 0
	}
	updateUserTokenRateCache(id, user.TokenRate)
	return user.TokenRate
}

// UpdateUserTokenRate 更新用户 token 费率（0 表示清除，恢复默认 1.0 倍）。
func UpdateUserTokenRate(id int, rate float64) error {
	if id <= 0 {
		return errors.New("invalid user id")
	}
	result := DB.Model(&User{}).Where("id = ?", id).Update("token_rate", rate)
	if result.Error != nil {
		return result.Error
	}
	updateUserTokenRateCache(id, rate)
	return nil
}

func updateUserTokenRateCache(id int, rate float64) {
	tokenRateCacheLock.Lock()
	tokenRateCache[id] = rate
	tokenRateCacheLock.Unlock()
}
