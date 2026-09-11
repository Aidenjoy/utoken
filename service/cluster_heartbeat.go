package service

import (
	"context"
	"fmt"
	"runtime"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"github.com/bytedance/gopkg/util/gopool"
)

// 集群节点心跳（Redis）。
//
// SystemInstance 表已记录节点存活（30s 上报，90s 判定 stale），用于后台
// 「系统信息」页展示。本模块补充一个 Redis 心跳，面向运行时协调：
//
//   - 延迟远低于 DB 轮询，可被请求路径直接查询（例如判断某节点是否在线）；
//   - 携带实时负载（goroutine 数、内存），供后续做任务重新分配的决策依据；
//   - TTL 自动过期，节点崩溃后无需清理逻辑即可被感知为离线。
//
// 与 DB 版本的 SystemInstance 是互补关系，不替代它。

const (
	clusterHeartbeatInterval = 10 * time.Second
	clusterHeartbeatTTL      = 30 * time.Second
	clusterNodeKeyPrefix     = "cluster:node:"
	clusterNodesSetKey       = "cluster:nodes"
)

var clusterHeartbeatOnce sync.Once

// ClusterNodeHeartbeat 节点心跳负载。
type ClusterNodeHeartbeat struct {
	NodeName    string `json:"node_name"`
	IsMaster    bool   `json:"is_master"`
	LastBeat    int64  `json:"last_beat"`
	Goroutines  int    `json:"goroutines"`
	MemoryAlloc uint64 `json:"memory_alloc"`
	StartedAt   int64  `json:"started_at"`
	Version     string `json:"version"`
}

func clusterNodeKey(nodeName string) string {
	return clusterNodeKeyPrefix + nodeName
}

// StartClusterHeartbeat 启动本节点的 Redis 心跳上报。
// Redis 未启用时静默跳过（单机部署无需该能力）。
func StartClusterHeartbeat() {
	if !common.RedisEnabled {
		return
	}
	clusterHeartbeatOnce.Do(func() {
		gopool.Go(func() {
			reportClusterHeartbeat()

			ticker := time.NewTicker(clusterHeartbeatInterval)
			defer ticker.Stop()
			for range ticker.C {
				reportClusterHeartbeat()
			}
		})
	})
}

func reportClusterHeartbeat() {
	nodeName := common.NodeName
	if nodeName == "" {
		return
	}
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)

	beat := ClusterNodeHeartbeat{
		NodeName:    nodeName,
		IsMaster:    common.IsMasterNode,
		LastBeat:    common.GetTimestamp(),
		Goroutines:  runtime.NumGoroutine(),
		MemoryAlloc: memStats.Alloc,
		StartedAt:   common.StartTime,
		Version:     common.Version,
	}
	ctx := context.Background()
	key := clusterNodeKey(nodeName)
	if err := common.RedisHSetObj(key, &beat, clusterHeartbeatTTL); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("cluster heartbeat write failed: %v", err))
		return
	}
	// 节点名单：Redis 不可用或 key 过期时以心跳 key 的存在与否为准
	common.RDB.SAdd(ctx, clusterNodesSetKey, nodeName)
}

// IsClusterNodeAlive 判断指定节点当前是否在线（心跳未过期）。
func IsClusterNodeAlive(nodeName string) bool {
	if !common.RedisEnabled || nodeName == "" {
		return false
	}
	ctx := context.Background()
	exists, err := common.RDB.Exists(ctx, clusterNodeKey(nodeName)).Result()
	return err == nil && exists > 0
}

// ListAliveClusterNodes 返回当前在线的节点名列表。
// 会顺带清理已失效节点在名单集合中的残留成员。
func ListAliveClusterNodes() []string {
	if !common.RedisEnabled {
		return nil
	}
	ctx := context.Background()
	members, err := common.RDB.SMembers(ctx, clusterNodesSetKey).Result()
	if err != nil {
		return nil
	}
	alive := make([]string, 0, len(members))
	for _, name := range members {
		if IsClusterNodeAlive(name) {
			alive = append(alive, name)
			continue
		}
		// 心跳已过期：从名单中移除，避免集合无限增长
		common.RDB.SRem(ctx, clusterNodesSetKey, name)
	}
	return alive
}
