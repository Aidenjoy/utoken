package model

import (
	"context"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// cacheInvalidateChannel 是多节点之间广播“进程内缓存已变更”的 Redis 频道。
// 写入节点发布消息，其余节点订阅后立即从数据库重建对应缓存，不再等待
// SyncOptions / SyncChannelCache 的周期轮询（默认 60s），从根本上消除负载均衡下
// “写请求落到 A 节点、后续读取/转发落到 B 节点旧缓存”造成的假失败与路由滞后。
const cacheInvalidateChannel = "cluster:cache:invalidate"

// cacheScope 标识需要重建的缓存范围。
type cacheScope string

const (
	cacheScopeOptions  cacheScope = "options"  // 系统选项 / 定价（OptionMap、pricingMap）
	cacheScopeChannels cacheScope = "channels" // 渠道与能力（group2model2channels、channelsIDM 等）
	cacheScopeAuthz    cacheScope = "authz"    // casbin 权限策略（各节点内存 enforcer）
	cacheScopeAll      cacheScope = "all"      // 解析失败等兜底：全部重建
)

// cacheInvalidateMsg 是广播消息载荷。Node 用于让发布节点忽略自己的消息
// （它已在本地完成重建，无需重复重载）。
type cacheInvalidateMsg struct {
	Node  string     `json:"node"`
	Scope cacheScope `json:"scope"`
	Keys  []string   `json:"keys,omitempty"`
}

// publishCacheInvalidation 在缓存对应的数据写库成功后广播失效消息。
// Redis 未启用（单机部署）时静默跳过；发布失败仅记录日志、不影响写入结果，
// 因为各节点仍有周期轮询作为最终一致兜底。
func publishCacheInvalidation(scope cacheScope, keys ...string) {
	if !common.RedisEnabled || common.RDB == nil {
		return
	}
	payload, err := common.Marshal(cacheInvalidateMsg{Node: common.NodeName, Scope: scope, Keys: keys})
	if err != nil {
		common.SysLog("failed to marshal cache invalidate message: " + err.Error())
		return
	}
	if err := common.RDB.Publish(context.Background(), cacheInvalidateChannel, payload).Err(); err != nil {
		common.SysLog("failed to publish cache invalidation: " + err.Error())
	}
}

// publishOptionInvalidation 广播“系统选项/定价已变更”。
func publishOptionInvalidation(keys ...string) {
	publishCacheInvalidation(cacheScopeOptions, keys...)
}

// publishChannelInvalidation 广播“渠道/能力缓存已变更”。
func publishChannelInvalidation() {
	publishCacheInvalidation(cacheScopeChannels)
}

// PublishAuthzInvalidation 广播权限策略失效，供 authz 包在管理员变更用户权限后调用，
// 让其它节点立即重载策略，而不必等待 60s 轮询（关闭权限撤销的跨节点窗口）。
func PublishAuthzInvalidation() {
	publishCacheInvalidation(cacheScopeAuthz)
}

// AuthzReloadFunc 由 main 注入（model 不能 import service/authz，否则循环引用），
// 收到 authz 失效广播时重新加载权限策略。
var AuthzReloadFunc func() error

func reloadAuthz() {
	if AuthzReloadFunc == nil {
		return
	}
	if err := AuthzReloadFunc(); err != nil {
		common.SysError("failed to reload authz policy after broadcast: " + err.Error())
	}
}

// applyCacheScope 在本节点重建指定范围的缓存。只做本地重建、绝不再次广播，
// 因此可被订阅循环安全调用而不产生回环。
func applyCacheScope(scope cacheScope) {
	switch scope {
	case cacheScopeOptions:
		loadOptionsFromDatabase()
		InvalidatePricingCache()
	case cacheScopeChannels:
		reloadChannelCacheFromDB()
	case cacheScopeAuthz:
		reloadAuthz()
	default: // cacheScopeAll 或未知：全部重建，宁可多做不可遗漏
		loadOptionsFromDatabase()
		InvalidatePricingCache()
		reloadChannelCacheFromDB()
		reloadAuthz()
	}
}

// parseExternalScope 解析消息并判断是否来自其它节点。
// 返回 (scope, 是否需要处理)。解析失败时按“外部全量”处理，宁可多重建一次也不漏掉变更。
func parseExternalScope(payload string) (cacheScope, bool) {
	var msg cacheInvalidateMsg
	if err := common.UnmarshalJsonStr(payload, &msg); err != nil {
		return cacheScopeAll, true
	}
	if msg.Node == common.NodeName {
		return "", false // 本节点自己发的，已在本地重建
	}
	return msg.Scope, true
}

// StartCacheSyncSubscriber 订阅失效频道，收到其它节点的变更通知时立即重建本地缓存。
// 应在每个节点启动时以 goroutine 运行；Redis 未启用时直接返回（单机无需跨节点同步）。
// SyncOptions / SyncChannelCache 的周期轮询继续保留，作为消息丢失（如订阅端重连窗口）
// 时的最终一致兜底。
func StartCacheSyncSubscriber() {
	if !common.RedisEnabled || common.RDB == nil {
		return
	}
	pubsub := common.RDB.Subscribe(context.Background(), cacheInvalidateChannel)
	defer pubsub.Close()
	ch := pubsub.Channel()

	// 合并窗口：批量写入（如后台迁移连续多次 UpdateOption、codex 批量刷新）会在短时间
	// 内产生多条失效消息。策略：首条到达即刻重建（把跨节点延迟压到毫秒级，保证前端保存
	// 后的刷新读取尽快拿到新值）；若窗口内还有后续消息（说明是突发批量），窗口结束后对
	// 期间出现过的每个范围再补做一次重建，确保不漏掉晚于首次重建才落库的写入。
	const coalesceWindow = 300 * time.Millisecond
	for {
		msg, ok := <-ch
		if !ok {
			return
		}
		scope, external := parseExternalScope(msg.Payload)
		if !external {
			continue
		}
		applyCacheScope(scope)

		seen := map[cacheScope]bool{scope: true}
		burst := false
		deadline := time.After(coalesceWindow)
	Drain:
		for {
			select {
			case msg2, more := <-ch:
				if !more {
					break Drain
				}
				s2, ext2 := parseExternalScope(msg2.Payload)
				if !ext2 {
					continue
				}
				burst = true
				seen[s2] = true
			case <-deadline:
				break Drain
			}
		}
		if burst {
			for s := range seen {
				applyCacheScope(s)
			}
		}
	}
}
