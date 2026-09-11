package model

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/go-redis/redis/v8"
	"gorm.io/gorm"
)

const (
	BatchUpdateTypeUserQuota = iota
	BatchUpdateTypeTokenQuota
	BatchUpdateTypeUsedQuota
	BatchUpdateTypeChannelUsedQuota
	BatchUpdateTypeRequestCount
	BatchUpdateTypeCount // if you add a new type, you need to add a new map and a new lock
)

var batchUpdateStores []map[int]int
var batchUpdateLocks []sync.Mutex

func init() {
	for i := 0; i < BatchUpdateTypeCount; i++ {
		batchUpdateStores = append(batchUpdateStores, make(map[int]int))
		batchUpdateLocks = append(batchUpdateLocks, sync.Mutex{})
	}
}

func InitBatchUpdater() {
	gopool.Go(func() {
		for {
			time.Sleep(time.Duration(common.BatchUpdateInterval) * time.Second)
			batchUpdate()
		}
	})
}

func addNewRecord(type_ int, id int, value int) {
	// Redis 可用时增量只写入 Redis 累加器：跨节点可见、进程崩溃不丢失，
	// 且同一笔增量只存在于一个累加器，刷写合并本地与远端时不会重复计费。
	if enqueueBatchDeltaToRedis(type_, id, value) {
		return
	}
	addLocalBatchDelta(type_, id, value)
}

// tryQueueUserQuotaDecrease 批量模式下原子地检查余额并排队扣减。
//
// 余额判定为「DB 余额 + 已排队未刷写的 delta」，因此连续两次扣减不会
// 因为刷写尚未发生而被重复放行（DB 余额在刷写前不会变化）。
// DB 读放在锁外执行，避免 I/O 阻塞同类型的其他扣减。
func tryQueueUserQuotaDecrease(userId int, quota int) bool {
	remain := 0
	readFailed := false
	if err := DB.Model(&User{}).Where("id = ?", userId).Select("quota").Find(&remain).Error; err != nil {
		// 查询失败：放行排队，由刷写阶段的带保护扣减兜底
		readFailed = true
	}
	return tryQueueBatchDecrease(BatchUpdateTypeUserQuota, userId, remain, quota, readFailed)
}

// tryQueueTokenQuotaDecrease 批量模式下原子地检查令牌余额并排队扣减。
// 余额判定与 tryQueueUserQuotaDecrease 同理，计入已排队的 delta。
func tryQueueTokenQuotaDecrease(tokenId int, quota int) bool {
	remain := 0
	readFailed := false
	if err := DB.Model(&Token{}).Where("id = ?", tokenId).Select("remain_quota").Find(&remain).Error; err != nil {
		readFailed = true
	}
	return tryQueueBatchDecrease(BatchUpdateTypeTokenQuota, tokenId, remain, quota, readFailed)
}

// tryQueueBatchDecrease 预检查并入队一笔扣减。
//
// Redis 可用时判定与入队由 Lua 脚本原子完成，Redis 累加器汇聚所有节点的
// 在途 delta，跨节点预检查互相可见；Redis 故障时降级为进程内累加器判定。
func tryQueueBatchDecrease(type_ int, id int, remain int, quota int, readFailed bool) bool {
	if readFailed {
		// 无法预检查余额：直接排队，由刷写阶段的带保护扣减兜底
		if !enqueueBatchDeltaToRedis(type_, id, -quota) {
			addLocalBatchDelta(type_, id, -quota)
		}
		return true
	}

	if common.RedisEnabled {
		// 本地累加器中可能残留 Redis 故障期间降级的 delta，一并计入判定基数
		batchUpdateLocks[type_].Lock()
		localQueued := batchUpdateStores[type_][id]
		batchUpdateLocks[type_].Unlock()

		queued, err := tryQueueBatchDecreaseRedis(type_, id, remain+localQueued, quota)
		if err == nil {
			return queued
		}
		// Redis 故障降级为进程内路径；若脚本超时但实际已执行，本笔会被
		// 双重排队，属极端网络故障取舍，刷写阶段的余额保护保证不产生负数
		common.SysLog(fmt.Sprintf("redis batch decrease failed, fallback to local (type=%d, id=%d): %v", type_, id, err))
	}

	batchUpdateLocks[type_].Lock()
	defer batchUpdateLocks[type_].Unlock()

	store := batchUpdateStores[type_]
	if remain+store[id] < quota {
		return false
	}
	store[id] -= quota
	return true
}

func batchUpdate() {
	// check if there's any data to update
	hasData := false
	for i := 0; i < BatchUpdateTypeCount; i++ {
		batchUpdateLocks[i].Lock()
		if len(batchUpdateStores[i]) > 0 {
			hasData = true
			batchUpdateLocks[i].Unlock()
			break
		}
		batchUpdateLocks[i].Unlock()
	}

	if !hasData {
		// 进程内累加器为空不代表 Redis 累加器为空：Redis 可用时 delta 直接
		// 写入 Redis，其他节点（或本节点）排队的增量可能尚未刷写，
		// 仍需执行一次冲刷。
		if !hasRedisPendingDeltas() {
			return
		}
	}

	common.SysLog("batch update started")

	// 先从 Redis 累加器原子取出待刷写的 delta，再与本地累加器合并。
	// 本地累加器仅含 Redis 故障期间降级的残留 delta，同一笔增量只存在
	// 于一处，合并不会重复计费。Redis 是跨节点共享的，任一节点都可以
	// 安全地取走并刷写（取值即清零，其他节点不会再取到同一批 delta）。
	localStores := make([]map[int]int, BatchUpdateTypeCount)
	for i := 0; i < BatchUpdateTypeCount; i++ {
		batchUpdateLocks[i].Lock()
		localStores[i] = batchUpdateStores[i]
		batchUpdateStores[i] = make(map[int]int)
		batchUpdateLocks[i].Unlock()
	}

	stores := make([]map[int]int, BatchUpdateTypeCount)
	for i := 0; i < BatchUpdateTypeCount; i++ {
		stores[i] = mergeBatchDeltas(localStores[i], drainRedisPendingDeltas(i))
	}

	for i, store := range stores {
		if i == BatchUpdateTypeUserQuota || i == BatchUpdateTypeUsedQuota || i == BatchUpdateTypeRequestCount {
			continue
		}
		for key, value := range store {
			switch i {
			case BatchUpdateTypeTokenQuota:
				if value >= 0 {
					// 增加操作：无余额保护需求
					if err := increaseTokenQuota(key, value); err != nil {
						common.SysLog("failed to batch update token quota (increase): " + err.Error())
					}
				} else {
					// 扣减操作：使用带余额保护的 decreaseTokenQuota，防止刷写导致负数
					// 如果余额不足，跳过本次扣减并记录日志（预扣费时预检查已通过，但存在时间窗口）
					if err := decreaseTokenQuota(key, -value); err != nil {
						if errors.Is(err, ErrInsufficientTokenQuota) {
							common.SysLog(fmt.Sprintf("batch flush token quota overdraft skipped (tokenId=%d, delta=%d)", key, value))
						} else {
							common.SysLog("failed to batch update token quota (decrease): " + err.Error())
						}
					}
				}
			case BatchUpdateTypeChannelUsedQuota:
				updateChannelUsedQuota(key, value)
			}
		}
	}

	userQuotaStore := stores[BatchUpdateTypeUserQuota]
	usedQuotaStore := stores[BatchUpdateTypeUsedQuota]
	requestCountStore := stores[BatchUpdateTypeRequestCount]

	userIDs := make(map[int]struct{}, len(userQuotaStore)+len(usedQuotaStore)+len(requestCountStore))
	for key := range userQuotaStore {
		userIDs[key] = struct{}{}
	}
	for key := range usedQuotaStore {
		userIDs[key] = struct{}{}
	}
	for key := range requestCountStore {
		userIDs[key] = struct{}{}
	}
	for key := range userIDs {
		batchFlushUserUpdates(key, userQuotaStore[key], usedQuotaStore[key], requestCountStore[key])
	}
	common.SysLog("batch update finished")
}

// batchFlushUserUpdates 安全地刷写用户额度/已用/请求数批量更新。
// 当 userQuotaDelta 为负数（扣费）时，使用 WHERE quota >= ? 保护，防止并发超扣。
func batchFlushUserUpdates(userId int, userQuotaDelta int, usedQuotaDelta int, requestCountDelta int) {
	if userQuotaDelta == 0 && usedQuotaDelta == 0 && requestCountDelta == 0 {
		return
	}
	if userQuotaDelta < 0 {
		// 扣减操作：先执行带保护的扣减，再处理其他字段
		deductAmount := -userQuotaDelta
		result := DB.Model(&User{}).
			Where("id = ? AND quota >= ?", userId, deductAmount).
			Updates(map[string]interface{}{
				"quota":         gorm.Expr("quota - ?", deductAmount),
				"used_quota":    gorm.Expr("used_quota + ?", usedQuotaDelta),
				"request_count": gorm.Expr("request_count + ?", requestCountDelta),
			})
		if result.Error != nil {
			common.SysLog("failed to batch flush user quota (decrease): " + result.Error.Error())
			return
		}
		if result.RowsAffected == 0 {
			// 余额不足：仍然更新 used_quota 和 request_count，仅跳过额度扣减
			common.SysLog(fmt.Sprintf("batch flush user quota overdraft skipped (userId=%d, deduct=%d)", userId, deductAmount))
			if usedQuotaDelta != 0 || requestCountDelta != 0 {
				if err := DB.Model(&User{}).Where("id = ?", userId).Updates(map[string]interface{}{
					"used_quota":    gorm.Expr("used_quota + ?", usedQuotaDelta),
					"request_count": gorm.Expr("request_count + ?", requestCountDelta),
				}).Error; err != nil {
					common.SysLog("failed to batch flush user non-quota fields: " + err.Error())
				}
			}
			return
		}
	} else {
		// 增加操作或零：无余额保护需求
		updateUserQuotaUsedQuotaAndRequestCount(userId, userQuotaDelta, usedQuotaDelta, requestCountDelta)
	}
}

// ---------------------------------------------------------------------------
// Redis 批量增量累加器
//
// 进程内累加器（batchUpdateStores）在集群下有两点不足：
//  1. 节点重启会丢弃已排队但未刷写的 delta，造成账目少扣；
//  2. 余额预检查无法看到其他节点排队的扣减，可能重复放行导致透支。
//
// 因此 Redis 可用时增量直接写入 Redis Hash（同一笔增量只存在于一个累加器，
// 刷写合并的本地数据仅为 Redis 故障期间的降级残留，不会重复计费），
// 余额预检查与入队由 Lua 脚本原子完成，判定基数包含所有节点的在途 delta；
// 刷写时 Lua 原子「取值即删除」，保证同一批 delta 只被一个节点处理一次。
// Redis 不可用时静默降级为纯进程内累加，不影响原有功能。
// ---------------------------------------------------------------------------

const batchDeltaRedisPrefix = "batch:delta:"

func batchDeltaRedisKey(type_ int) string {
	return fmt.Sprintf("%s%d", batchDeltaRedisPrefix, type_)
}

// enqueueBatchDeltaToRedis 把一笔增量写入 Redis 累加器，返回是否成功
// （失败不阻断，由调用方降级到进程内累加器）。
//
// 直接用 RDB.HIncrBy 而非 common.RedisHIncrBy：后者只在 key 已存在 TTL 时
// 才真正写入，而累加器 key 是无 TTL 的常驻键，用它会静默不写入。
func enqueueBatchDeltaToRedis(type_ int, id int, value int) bool {
	if !common.RedisEnabled {
		return false
	}
	ctx := context.Background()
	if err := common.RDB.HIncrBy(ctx, batchDeltaRedisKey(type_), strconv.Itoa(id), int64(value)).Err(); err != nil {
		common.SysLog(fmt.Sprintf("failed to enqueue batch delta to redis (type=%d, id=%d): %v", type_, id, err))
		return false
	}
	return true
}

// addLocalBatchDelta 把一笔增量写入进程内累加器（Redis 不可用时的降级路径）。
func addLocalBatchDelta(type_ int, id int, value int) {
	batchUpdateLocks[type_].Lock()
	batchUpdateStores[type_][id] += value
	batchUpdateLocks[type_].Unlock()
}

// tryQueueBatchDecreaseScript 原子完成「余额预检查 + 排队扣减」：
// KEYS[1]=累加器 hash，ARGV[1]=实体 ID，ARGV[2]=DB 余额（含本节点降级残留的
// 本地 delta），ARGV[3]=扣减额。Redis 汇聚所有节点的在途 delta，余额足够则
// 原子入队并返回 1，否则返回 0，消除并发预检查「先读后写」的重复放行竞态。
var tryQueueBatchDecreaseScript = redis.NewScript(`
local queued = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0')
if tonumber(ARGV[2]) + queued < tonumber(ARGV[3]) then
	return 0
end
redis.call('HINCRBY', KEYS[1], ARGV[1], -tonumber(ARGV[3]))
return 1
`)

func tryQueueBatchDecreaseRedis(type_ int, id int, balance int, quota int) (bool, error) {
	ctx := context.Background()
	queued, err := tryQueueBatchDecreaseScript.
		Run(ctx, common.RDB, []string{batchDeltaRedisKey(type_)}, id, balance, quota).
		Int64()
	if err != nil {
		return false, err
	}
	return queued == 1, nil
}

// drainBatchDeltaScript 原子取出并清空累加器。旧的 HGETALL + DEL 两步实现
// 存在窗口：并发节点可能取到同一批 delta 各自刷写（重复计费），或窗口内
// 新写入的 delta 被 DEL 误删（账目丢失）。Lua 脚本在 Redis 单线程内执行，杜绝两者。
var drainBatchDeltaScript = redis.NewScript(`
local fields = redis.call('HGETALL', KEYS[1])
if #fields > 0 then
	redis.call('DEL', KEYS[1])
end
return fields
`)

// drainRedisPendingDeltas 原子取出并清空某类型的全部待刷写增量。
// 执行失败时返回空：delta 仍留在 Redis 中，下一轮刷写重试；若脚本实际
// 已执行但响应丢失，该批 delta 会丢失，属极端网络故障取舍。
func drainRedisPendingDeltas(type_ int) map[int]int {
	result := map[int]int{}
	if !common.RedisEnabled {
		return result
	}
	ctx := context.Background()
	key := batchDeltaRedisKey(type_)

	values, err := drainBatchDeltaScript.Run(ctx, common.RDB, []string{key}).Slice()
	if err != nil {
		common.SysLog(fmt.Sprintf("failed to drain batch delta key %s: %v", key, err))
		return result
	}
	// HGETALL 返回 [field, value, ...] 平铺数组，成对解析
	for i := 0; i+1 < len(values); i += 2 {
		field, _ := values[i].(string)
		raw, _ := values[i+1].(string)
		id, idErr := strconv.Atoi(field)
		value, valueErr := strconv.Atoi(raw)
		if idErr != nil || valueErr != nil {
			common.SysLog(fmt.Sprintf("skipped malformed batch delta (key=%s, field=%s, value=%s)", key, field, raw))
			continue
		}
		result[id] = value
	}
	return result
}

// hasRedisPendingDeltas 判断 Redis 中是否还有待刷写增量。
func hasRedisPendingDeltas() bool {
	if !common.RedisEnabled {
		return false
	}
	ctx := context.Background()
	for i := 0; i < BatchUpdateTypeCount; i++ {
		if n, err := common.RDB.HLen(ctx, batchDeltaRedisKey(i)).Result(); err == nil && n > 0 {
			return true
		}
	}
	return false
}

// mergeBatchDeltas 合并本地与 Redis 两路增量（同 ID 相加）。
func mergeBatchDeltas(local map[int]int, remote map[int]int) map[int]int {
	if len(remote) == 0 {
		return local
	}
	if local == nil {
		local = make(map[int]int, len(remote))
	}
	for id, value := range remote {
		local[id] += value
	}
	return local
}

func RecordExist(err error) (bool, error) {
	if err == nil {
		return true, nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	return false, err
}

func shouldUpdateRedis(fromDB bool, err error) bool {
	return common.RedisEnabled && fromDB && err == nil
}
