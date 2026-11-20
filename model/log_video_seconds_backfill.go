package model

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

// backfillLogVideoSeconds 为历史任务消耗/退款行回填视频计费秒数（other.video_seconds）。
// 改造后的新任务由 taskBillingOther / UpdateTaskConsumeLogUsage 写入；历史行回查
// tasks.data 上游响应快照，解析上游真实返回的秒数（volc seedance 顶层 duration /
// resultSummary.duration，ali wan usage.duration）。快照无时长的行（其它平台/失败
// 任务）不动。幂等：回填后 other 含 video_seconds，不再命中。
func backfillLogVideoSeconds() error {
	var logs []Log
	if err := LOG_DB.
		Where("type IN ?", []int{LogTypeConsume, LogTypeRefund}).
		Where("other LIKE ?", `%"task_id":%`).
		Where("other NOT LIKE ?", `%"video_seconds":%`).
		Select("id", "other").
		Find(&logs).Error; err != nil {
		return err
	}
	// 同一任务的多条日志（预扣/结算/退款）共享一次快照解析；0 也缓存，避免重复查库。
	secondsCache := map[string]float64{}
	for _, lg := range logs {
		other := map[string]interface{}{}
		if err := common.UnmarshalJsonStr(lg.Other, &other); err != nil {
			continue
		}
		taskID, _ := other["task_id"].(string)
		if taskID == "" {
			continue
		}
		seconds, cached := secondsCache[taskID]
		if !cached {
			var snap struct {
				Data []byte
			}
			if err := DB.Model(&Task{}).Select("data").
				Where("task_id = ?", taskID).Scan(&snap).Error; err != nil {
				return err
			}
			seconds = taskSnapshotVideoSeconds(snap.Data)
			secondsCache[taskID] = seconds
		}
		if seconds <= 0 {
			continue
		}
		if err := LOG_DB.Model(&Log{}).Where("id = ?", lg.Id).
			Update("other", mergeVideoSecondsIntoOther(lg.Other, seconds)).Error; err != nil {
			return err
		}
	}
	return nil
}

// taskSnapshotVideoSeconds 从任务上游响应快照（tasks.data）提取视频计费秒数：
// volc seedance 顶层 duration 优先、中转站 resultSummary.duration 兜底，ali wan 取
// usage.duration。容忍数字字符串（部分中转站把数字字段降级为字符串）；缺失/非法
// 记 0；荒谬值钳制到 MaxTaskDurationSeconds（与计费同一上限，防上游伪造）。
func taskSnapshotVideoSeconds(data []byte) float64 {
	if len(data) == 0 {
		return 0
	}
	var root map[string]json.RawMessage
	if err := common.Unmarshal(data, &root); err != nil {
		return 0
	}
	candidates := []json.RawMessage{root["duration"]}
	for _, key := range []string{"resultSummary", "usage"} {
		var nested map[string]json.RawMessage
		if raw, ok := root[key]; ok && common.Unmarshal(raw, &nested) == nil {
			candidates = append(candidates, nested["duration"])
		}
	}
	for _, raw := range candidates {
		if len(raw) == 0 {
			continue
		}
		var seconds float64
		if err := common.Unmarshal(raw, &seconds); err != nil {
			var s string
			if common.Unmarshal(raw, &s) != nil {
				continue
			}
			seconds, _ = strconv.ParseFloat(strings.TrimSpace(s), 64)
		}
		if seconds > 0 {
			return math.Min(seconds, float64(relaycommon.MaxTaskDurationSeconds))
		}
	}
	return 0
}
