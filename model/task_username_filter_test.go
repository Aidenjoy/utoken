package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestTaskGetAllTasksByUsername 锁定任务按用户名筛选：tasks 表只存 user_id，
// 经 users 表子查询映射；匹配语义与通用日志一致——默认精确，含 % 时 LIKE 模糊。
// 该子查询须在三库（SQLite/MySQL/PostgreSQL）下行为一致。
func TestTaskGetAllTasksByUsername(t *testing.T) {
	truncateTables(t)

	alice := &User{Username: "alice", AffCode: "aff-u-1", Quota: 100}
	bob := &User{Username: "bob_team", AffCode: "aff-u-2", Quota: 100}
	carol := &User{Username: "carol", AffCode: "aff-u-3", Quota: 100}
	require.NoError(t, DB.Create(alice).Error)
	require.NoError(t, DB.Create(bob).Error)
	require.NoError(t, DB.Create(carol).Error)

	mk := func(uid int, taskID string) *Task {
		return &Task{TaskID: taskID, UserId: uid, Status: TaskStatusSuccess, Progress: "100%"}
	}
	require.NoError(t, DB.Create(mk(alice.Id, "t-alice")).Error)
	require.NoError(t, DB.Create(mk(bob.Id, "t-bob")).Error)
	require.NoError(t, DB.Create(mk(carol.Id, "t-carol")).Error)

	// 精确匹配：只返回该用户的任务，计数一致
	got := TaskGetAllTasks(0, 10, SyncTaskQueryParams{Username: "bob_team"})
	require.Len(t, got, 1)
	assert.Equal(t, "t-bob", got[0].TaskID)
	assert.Equal(t, int64(1), TaskCountAllTasks(SyncTaskQueryParams{Username: "bob_team"}))

	// 模糊匹配（含 %）：前缀命中
	got = TaskGetAllTasks(0, 10, SyncTaskQueryParams{Username: "bo%"})
	require.Len(t, got, 1)
	assert.Equal(t, "t-bob", got[0].TaskID)

	// 用户名不存在：空结果而非全量
	got = TaskGetAllTasks(0, 10, SyncTaskQueryParams{Username: "nobody"})
	assert.Empty(t, got)
	assert.Equal(t, int64(0), TaskCountAllTasks(SyncTaskQueryParams{Username: "nobody"}))

	// 空 username 不过滤
	got = TaskGetAllTasks(0, 10, SyncTaskQueryParams{})
	assert.Len(t, got, 3)
}
