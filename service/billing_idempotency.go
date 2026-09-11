package service

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// 请求级计费幂等锁。
//
// 客户端重试（网络抖动、超时重发）或网关层重放同一请求时，如果不加区分，
// 会被当成两次独立消费重复扣费。这里以 requestId 为幂等键占位，同一
// (requestId, userId, model) 在 TTL 内只允许一次计费流程通过。
//
// 设计取舍：
//   - requestId 为空时放行（兼容未带幂等键的旧客户端，不能因此拒绝服务）。
//   - Redis 未启用时放行（单机部署无重复风险，且不引入新依赖）。
//   - Redis 异常时保守拒绝，避免故障期间重复扣费。

// billingIdempotencyTTL 幂等键有效期。取 24h 覆盖客户端重试窗口，
// 同时避免键无限堆积。
const billingIdempotencyTTL = 24 * time.Hour

// BillingIdempotencyKey 生成计费幂等键。
func BillingIdempotencyKey(requestId string, userId int, modelName string) string {
	return fmt.Sprintf("billing:idem:%s:%d:%s", requestId, userId, modelName)
}

// TryAcquireBillingIdempotency 尝试占用计费幂等位。
// 返回 true 表示本次请求是首次处理（可以继续计费）；false 表示重复请求。
func TryAcquireBillingIdempotency(requestId string, userId int, modelName string) bool {
	if requestId == "" {
		return true
	}
	if !common.RedisEnabled {
		return true
	}
	key := BillingIdempotencyKey(requestId, userId, modelName)
	return common.RedisSetNX(key, "1", billingIdempotencyTTL)
}

// ReleaseBillingIdempotency 释放计费幂等位。
// 仅在请求确定失败、允许客户端用同一 requestId 重试时调用；
// 计费成功不应释放，否则重试会二次扣费。
func ReleaseBillingIdempotency(requestId string, userId int, modelName string) {
	if requestId == "" || !common.RedisEnabled {
		return
	}
	key := BillingIdempotencyKey(requestId, userId, modelName)
	if err := common.RedisDel(key); err != nil {
		common.SysLog(fmt.Sprintf("failed to release billing idempotency key %s: %v", key, err))
	}
}
