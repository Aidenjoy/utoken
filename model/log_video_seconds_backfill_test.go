package model

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestTaskSnapshotVideoSeconds 锁定上游响应快照的秒数解析口径：volc 顶层 duration
// 优先、resultSummary 兜底，ali wan 取 usage.duration；容忍数字字符串与浮点，
// 缺失/非法记 0，荒谬值钳制到计费同一上限（防上游伪造时长）。
func TestTaskSnapshotVideoSeconds(t *testing.T) {
	tests := []struct {
		name string
		data string
		want float64
	}{
		{"volc顶层数字", `{"duration":4,"status":"succeeded"}`, 4},
		{"volc顶层数字字符串", `{"duration":"5"}`, 5},
		{"中转站resultSummary兜底", `{"resultSummary":{"duration":"6"}}`, 6},
		{"顶层优先于resultSummary", `{"duration":4,"resultSummary":{"duration":"6"}}`, 4},
		{"ali wan usage.duration浮点", `{"output":{"task_status":"SUCCEEDED"},"usage":{"duration":5.5,"SR":1080}}`, 5.5},
		{"ali wan usage.duration字符串", `{"usage":{"duration":"5"}}`, 5},
		{"缺失duration", `{"status":"succeeded"}`, 0},
		{"空串duration", `{"duration":""}`, 0},
		{"负值duration", `{"duration":-3}`, 0},
		{"荒谬值钳制", `{"duration":1e9}`, 3600},
		{"非法JSON", `not-json`, 0},
		{"空快照", ``, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, taskSnapshotVideoSeconds([]byte(tt.data)))
		})
	}
}

// TestBackfillLogVideoSeconds 保护历史秒数回填口径：仅按 tasks.data 上游快照解析出
// 正秒数的任务日志（预扣/结算/退款行）写入 other.video_seconds；快照无时长的任务、
// 已有 video_seconds 的行、无 task_id 的普通行一律不动；并保证幂等。
func TestBackfillLogVideoSeconds(t *testing.T) {
	truncateTables(t)

	// t1: wan 任务，快照 usage.duration=5.5 → 预扣行与结算行都回填。
	require.NoError(t, DB.Create(&Task{TaskID: "t1", Status: TaskStatusSuccess,
		Data: json.RawMessage(`{"usage":{"duration":5.5,"SR":1080}}`)}).Error)
	// t2: seedance 任务，快照顶层 duration=4 → 退款行回填。
	require.NoError(t, DB.Create(&Task{TaskID: "t2", Status: TaskStatusSuccess,
		Data: json.RawMessage(`{"duration":4,"status":"succeeded"}`)}).Error)
	// t3: 快照无时长（其它平台）→ 不动。
	require.NoError(t, DB.Create(&Task{TaskID: "t3", Status: TaskStatusSuccess,
		Data: json.RawMessage(`{"output":{}}`)}).Error)

	require.NoError(t, LOG_DB.Create(&Log{UserId: 1, Type: LogTypeConsume, ModelName: "wan3.0-video",
		Other: `{"task_id":"t1"}`}).Error)
	require.NoError(t, LOG_DB.Create(&Log{UserId: 1, Type: LogTypeConsume, ModelName: "wan3.0-video",
		TaskSettle: true, Other: `{"task_id":"t1","actual_quota":100}`}).Error)
	require.NoError(t, LOG_DB.Create(&Log{UserId: 1, Type: LogTypeRefund, ModelName: "seedance-2-0",
		Other: `{"task_id":"t2"}`}).Error)
	require.NoError(t, LOG_DB.Create(&Log{UserId: 1, Type: LogTypeConsume, ModelName: "kling",
		Other: `{"task_id":"t3"}`}).Error)
	// 已有 video_seconds 的行不覆盖（幂等口径）。
	require.NoError(t, LOG_DB.Create(&Log{UserId: 1, Type: LogTypeConsume, ModelName: "wan3.0-video",
		Other: `{"task_id":"t1","video_seconds":9}`}).Error)
	// 无 task_id 的普通对话行不受影响。
	require.NoError(t, LOG_DB.Create(&Log{UserId: 1, Type: LogTypeConsume, ModelName: "gpt-4o",
		Other: `{"model_ratio":2}`}).Error)

	require.NoError(t, backfillLogVideoSeconds())

	var logs []Log
	require.NoError(t, LOG_DB.Order("id ASC").Find(&logs).Error)
	require.Len(t, logs, 6)

	var other map[string]interface{}
	// t1 预扣行与结算行：5.5 秒，既有键保留。
	require.NoError(t, common.UnmarshalJsonStr(logs[0].Other, &other))
	assert.EqualValues(t, 5.5, other["video_seconds"])
	assert.Equal(t, "t1", other["task_id"])
	require.NoError(t, common.UnmarshalJsonStr(logs[1].Other, &other))
	assert.EqualValues(t, 5.5, other["video_seconds"])
	assert.EqualValues(t, 100, other["actual_quota"])
	// t2 退款行：4 秒。
	require.NoError(t, common.UnmarshalJsonStr(logs[2].Other, &other))
	assert.EqualValues(t, 4, other["video_seconds"])
	// t3 / 已有值 / 普通行：一律未被触碰。
	assert.NotContains(t, logs[3].Other, "video_seconds")
	require.NoError(t, common.UnmarshalJsonStr(logs[4].Other, &other))
	assert.EqualValues(t, 9, other["video_seconds"])
	assert.NotContains(t, logs[5].Other, "video_seconds")

	// 幂等：再次运行不改变已回填的行。
	require.NoError(t, backfillLogVideoSeconds())
	var again []Log
	require.NoError(t, LOG_DB.Order("id ASC").Find(&again).Error)
	for i := range logs {
		assert.Equal(t, logs[i].Other, again[i].Other)
	}
}
