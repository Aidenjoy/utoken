package service

import (
	"context"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/types"
)

const (
	circuitBreakerFailPrefix    = "cb:fail:"
	circuitBreakerOpenPrefix    = "cb:open:"
	circuitBreakerDefaultWindow = 60 * time.Second
	circuitBreakerDefaultThresh = 3
	circuitBreakerDefaultCool   = 5 * time.Minute
)

// ChannelCircuitBreaker 基于 Redis 的分布式渠道熔断器。
type ChannelCircuitBreaker struct {
	windowDuration time.Duration
	threshold      int
	cooldown       time.Duration
}

func NewChannelCircuitBreaker() *ChannelCircuitBreaker {
	return &ChannelCircuitBreaker{
		windowDuration: circuitBreakerDefaultWindow,
		threshold:      circuitBreakerDefaultThresh,
		cooldown:       circuitBreakerDefaultCool,
	}
}

// RecordFailure 记录渠道失败。达到阈值时触发熔断。
func (cb *ChannelCircuitBreaker) RecordFailure(channelId int) {
	if !common.RedisEnabled {
		return
	}
	ctx := context.Background()
	key := fmt.Sprintf("%s%d", circuitBreakerFailPrefix, channelId)
	val, _ := common.RDB.IncrBy(ctx, key, 1).Result()
	if val == 1 {
		common.RDB.Expire(ctx, key, cb.windowDuration)
	}
	if int(val) >= cb.threshold {
		openKey := fmt.Sprintf("%s%d", circuitBreakerOpenPrefix, channelId)
		common.RDB.Set(ctx, openKey, "1", cb.cooldown)
	}
}

// IsOpen 判断渠道是否处于熔断状态。
func (cb *ChannelCircuitBreaker) IsOpen(channelId int) bool {
	if !common.RedisEnabled {
		return false
	}
	_, err := common.RedisGet(fmt.Sprintf("%s%d", circuitBreakerOpenPrefix, channelId))
	return err == nil
}

// RecordSuccess 成功时清除熔断标记和失败计数。
func (cb *ChannelCircuitBreaker) RecordSuccess(channelId int) {
	if !common.RedisEnabled {
		return
	}
	_ = common.RedisDel(fmt.Sprintf("%s%d", circuitBreakerOpenPrefix, channelId))
	_ = common.RedisDel(fmt.Sprintf("%s%d", circuitBreakerFailPrefix, channelId))
}

var globalCircuitBreaker *ChannelCircuitBreaker

func GetChannelCircuitBreaker() *ChannelCircuitBreaker {
	if globalCircuitBreaker == nil {
		globalCircuitBreaker = NewChannelCircuitBreaker()
	}
	return globalCircuitBreaker
}

func IsChannelCircuitOpen(channelId int) bool {
	return GetChannelCircuitBreaker().IsOpen(channelId)
}

func RecordChannelFailure(channelId int) {
	GetChannelCircuitBreaker().RecordFailure(channelId)
}

func RecordChannelSuccess(channelId int) {
	GetChannelCircuitBreaker().RecordSuccess(channelId)
}

// ShouldCountTowardCircuitBreaker 判断一个错误是否应计入渠道熔断失败数。
//
// 熔断针对的是「渠道不可用」，因此只有渠道侧故障才计数：
//   - 网络/上游 5xx/超时 → 计入
//   - 用户侧错误（额度不足、参数非法、无权限）→ 不计入，
//     否则用户发错请求会把健康渠道熔断。
//
// 判定复用 NewAPIError 的错误码：跳过重试的错误通常是终态业务错误
// （额度不足、请求非法），不应归因于渠道。
func ShouldCountTowardCircuitBreaker(err *types.NewAPIError) bool {
	if err == nil {
		return false
	}
	if types.IsSkipRetryError(err) {
		return false
	}
	switch err.GetErrorCode() {
	case types.ErrorCodeInsufficientUserQuota,
		types.ErrorCodeInvalidRequest,
		types.ErrorCodePreConsumeTokenQuotaFailed:
		return false
	}
	return true
}
