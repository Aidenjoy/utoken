package service

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// 视频模型熔断：以固定窗口统计每个用户的上游错误次数，达到阈值即自动禁用该用户。
// 计数放在 Redis 中，服务器集群各节点共享同一窗口；窗口到期自动清零重新计时。
const (
	videoErrorThreshold = 5           // 窗口内累计上游错误次数阈值
	videoErrorWindow    = time.Minute // 固定窗口长度（到期自动清零）
)

// videoErrorCounterKey 返回某用户视频错误计数器的 Redis key。
func videoErrorCounterKey(userId int) string {
	return fmt.Sprintf("circuit_breaker:video_err:%d", userId)
}

// RecordVideoTaskError 累计一次视频模型上游错误；窗口内达到阈值即自动禁用用户。
// 仅在启用 Redis 时生效（集群共享计数），否则静默跳过。
func RecordVideoTaskError(userId int) {
	if userId <= 0 {
		return
	}
	if !common.RedisEnabled {
		common.SysLog(fmt.Sprintf("circuit breaker skipped (Redis disabled): video error for user %d", userId))
		return
	}

	count, err := common.RedisIncrWithExpire(videoErrorCounterKey(userId), 1, videoErrorWindow)
	if err != nil {
		common.SysError(fmt.Sprintf("circuit breaker incr failed for user %d: %s", userId, err.Error()))
		return
	}
	// 仅在恰好达到阈值时触发一次：>阈值说明本窗口已触发过，直接跳过，避免重复禁用/重复审计。
	// 计数器交由 TTL 自然过期，不主动删除——否则并发下可能误删其他请求刚创建的新窗口计数。
	if count != videoErrorThreshold {
		return
	}
	autoDisableUser(userId, count)
}

// autoDisableUser 将用户置为系统自动禁用（status=3）。跳过 root 用户与已禁用用户，保证幂等。
// count 仅用于日志与审计文案，表示触发禁用时窗口内累计的错误次数。
func autoDisableUser(userId int, count int64) {
	// 条件更新：仅当用户仍为启用且非 root 时置为系统自动禁用，原子避免覆盖管理员的手动禁用；
	// 多节点并发触发时只有一个能实际变更（changed=true），其余幂等返回，不重复失效缓存/写审计。
	changed, err := model.AutoDisableUserIfEnabled(userId)
	if err != nil {
		common.SysError(fmt.Sprintf("circuit breaker disable user %d failed: %s", userId, err.Error()))
		return
	}
	if !changed {
		return
	}

	// 失效用户与其令牌缓存，令下一次鉴权立即识别为已禁用（否则 TTL 过期前仍可发起请求）。
	if err := model.InvalidateUserCache(userId); err != nil {
		common.SysLog(fmt.Sprintf("circuit breaker invalidate user cache %d failed: %s", userId, err.Error()))
	}
	if err := model.InvalidateUserTokensCache(userId); err != nil {
		common.SysLog(fmt.Sprintf("circuit breaker invalidate tokens cache %d failed: %s", userId, err.Error()))
	}

	content := fmt.Sprintf("系统自动禁用：视频模型上游错误 %d 分钟内累计 %d 次，已触发熔断保护", int(videoErrorWindow.Minutes()), count)
	model.RecordLog(userId, model.LogTypeSystem, content)
	common.SysLog(fmt.Sprintf("circuit breaker auto-disabled user %d (video errors=%d in %s)", userId, count, videoErrorWindow))
}
