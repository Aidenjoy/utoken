package model

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// 查询类 API 调用审计日志（type=LogTypeApiQuery）采用「先入队、后批量落库」：
// 请求时仅 RPUSH 到 Redis 列表（Redis 未启用或异常时降级为内存队列），
// 后台任务每 2 秒批量 INSERT 一次。轮询接口请求量极大，逐条同步 INSERT 会
// 给 logs 表带来持续写压力（尤其 SQLite），缓冲后写压力被摊平为周期批量写。
const (
	apiCallBufferRedisKey = "api_call_log_buffer"
	apiCallFlushInterval  = 2 * time.Second
	apiCallFlushBatchSize = 500
	// apiCallPendingMax 内存队列上限（Redis 不可用与落库失败重试共用）：
	// 溢出丢弃最旧条目——审计行可丢，内存不可无限增长拖垮主链路。
	apiCallPendingMax = 10000
)

var (
	apiCallPendingMu   sync.Mutex
	apiCallPending     []Log
	apiCallFlusherOnce sync.Once
	apiCallDropped     int64
	apiCallDropLogAt   time.Time
)

// enqueueApiCallLog 查询类审计日志入队：优先 Redis 列表（多节点共享、
// 进程重启不丢），Redis 未启用或推送失败时降级内存队列，由同一冲刷任务落库。
func enqueueApiCallLog(log *Log) {
	if common.RedisEnabled && common.RDB != nil {
		data, err := common.Marshal(log)
		if err == nil {
			if err := common.RDB.RPush(context.Background(), apiCallBufferRedisKey, data).Err(); err == nil {
				return
			}
		}
	}
	appendApiCallPending(*log)
}

func appendApiCallPending(logs ...Log) {
	apiCallPendingMu.Lock()
	defer apiCallPendingMu.Unlock()
	apiCallPending = append(apiCallPending, logs...)
	overflow := len(apiCallPending) - apiCallPendingMax
	if overflow <= 0 {
		return
	}
	apiCallPending = append(apiCallPending[:0], apiCallPending[overflow:]...)
	apiCallDropped += int64(overflow)
	// 持续溢出时丢弃日志限流到每分钟一条，避免日志洪水。
	if time.Since(apiCallDropLogAt) > time.Minute {
		apiCallDropLogAt = time.Now()
		common.SysError(fmt.Sprintf("api call log buffer overflow, dropped %d entries (total dropped: %d)", overflow, apiCallDropped))
	}
}

// drainRedisApiCallLogs 从 Redis 列表批量弹出待落库日志，直到取空或达到单轮上限。
func drainRedisApiCallLogs() []Log {
	var out []Log
	ctx := context.Background()
	for len(out) < apiCallFlushBatchSize*4 {
		items, err := common.RDB.LPopCount(ctx, apiCallBufferRedisKey, apiCallFlushBatchSize).Result()
		if err != nil || len(items) == 0 {
			break
		}
		for _, item := range items {
			var log Log
			if common.UnmarshalJsonStr(item, &log) == nil {
				out = append(out, log)
			}
		}
		if len(items) < apiCallFlushBatchSize {
			break
		}
	}
	return out
}

// FlushApiCallLogBuffer 将缓冲中的查询类审计日志批量落库：周期任务与进程
// 关闭时调用。落库失败时整批退回内存队列下一轮重试（溢出按上限丢弃）。
func FlushApiCallLogBuffer() {
	var batch []Log
	if common.RedisEnabled && common.RDB != nil {
		batch = drainRedisApiCallLogs()
	}
	apiCallPendingMu.Lock()
	batch = append(batch, apiCallPending...)
	apiCallPending = nil
	apiCallPendingMu.Unlock()
	if len(batch) == 0 {
		return
	}
	if err := LOG_DB.CreateInBatches(batch, apiCallFlushBatchSize).Error; err != nil {
		common.SysError("failed to flush api call log buffer: " + err.Error())
		appendApiCallPending(batch...)
	}
}

// StartApiCallLogFlusher 启动后台冲刷任务（幂等，全进程单实例）。
func StartApiCallLogFlusher() {
	apiCallFlusherOnce.Do(func() {
		go func() {
			ticker := time.NewTicker(apiCallFlushInterval)
			defer ticker.Stop()
			for range ticker.C {
				FlushApiCallLogBuffer()
			}
		}()
	})
}
