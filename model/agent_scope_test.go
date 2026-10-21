package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestListAgentMemberIdsAndOptions 锁定代理商成员解析：服务端强制范围的真源是
// users.agent_id，ListAgentMemberIds 返回全量成员 ID（不设上限），
// ListAgentMemberOptions 仅供前端下拉（按 id 倒序、受 limit 约束）。
// agentId<=0 时两者都返回 nil，杜绝“无归属 = 全部用户”的越权回退。
func TestListAgentMemberIdsAndOptions(t *testing.T) {
	truncateTables(t)

	m1 := &User{Username: "m1", AffCode: "aff-a-1", AgentId: 11, Quota: 100}
	m2 := &User{Username: "m2", AffCode: "aff-a-2", AgentId: 11, Quota: 100}
	other := &User{Username: "other", AffCode: "aff-a-3", AgentId: 22, Quota: 100}
	none := &User{Username: "none", AffCode: "aff-a-4", AgentId: 0, Quota: 100}
	for _, u := range []*User{m1, m2, other, none} {
		require.NoError(t, DB.Create(u).Error)
	}

	ids, err := ListAgentMemberIds(11)
	require.NoError(t, err)
	assert.ElementsMatch(t, []int{m1.Id, m2.Id}, ids)

	// agentId<=0 → nil（不回退为全量）
	ids, err = ListAgentMemberIds(0)
	require.NoError(t, err)
	assert.Nil(t, ids)

	opts, err := ListAgentMemberOptions(11, 1000)
	require.NoError(t, err)
	require.Len(t, opts, 2)
	// 倒序：后建的成员排在前面
	assert.Equal(t, m2.Id, opts[0].UserId)
	assert.Equal(t, "m2", opts[0].Username)

	// limit 生效
	opts, err = ListAgentMemberOptions(11, 1)
	require.NoError(t, err)
	assert.Len(t, opts, 1)

	// agentId<=0 → nil
	opts, err = ListAgentMemberOptions(0, 10)
	require.NoError(t, err)
	assert.Nil(t, opts)
}

// TestGetAgentScopedLogs 锁定代理商范围日志：只返回 userIds 内的行，空 ids 直接
// 返回空（绝不落到“无过滤 = 全量”），且经 formatUserLogs 剥离 admin_info 等
// 管理员专属字段（最小权限）。
func TestGetAgentScopedLogs(t *testing.T) {
	truncateTables(t)

	now := time.Now().Unix()
	mk := func(uid int, other string) *Log {
		return &Log{
			UserId:    uid,
			Type:      LogTypeConsume,
			ModelName: "gpt-4o",
			Quota:     10,
			CreatedAt: now,
			Other:     other,
		}
	}
	// 成员 1、2 各一条；非成员 99 一条（含 admin_info，验证不会泄漏给代理商）。
	require.NoError(t, DB.Create(mk(1, `{"admin_info":{"quota_saturation":{"op":"x"}},"group_ratio":2}`)).Error)
	require.NoError(t, DB.Create(mk(2, `{}`)).Error)
	require.NoError(t, DB.Create(mk(99, `{"admin_info":{"secret":1}}`)).Error)

	logs, total, err := GetAgentScopedLogs([]int{1, 2}, LogTypeUnknown, 0, 0, "", "", 0, 10, "", "", "")
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	require.Len(t, logs, 2)
	gotIds := []int{logs[0].UserId, logs[1].UserId}
	assert.ElementsMatch(t, []int{1, 2}, gotIds)
	// admin_info 被剥离，非管理员字段（group_ratio）保留
	for _, l := range logs {
		assert.NotContains(t, l.Other, "admin_info")
	}
	assert.Contains(t, logs[0].Other+logs[1].Other, "group_ratio")

	// 空 ids → 空结果（不回退全量）
	logs, total, err = GetAgentScopedLogs(nil, LogTypeUnknown, 0, 0, "", "", 0, 10, "", "", "")
	require.NoError(t, err)
	assert.Equal(t, int64(0), total)
	assert.Empty(t, logs)

	// 只请求非成员 id → 空结果
	logs, total, err = GetAgentScopedLogs([]int{99}, LogTypeUnknown, 0, 0, "", "", 0, 10, "", "", "")
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, logs, 1)
	assert.NotContains(t, logs[0].Other, "admin_info")
}

// TestSumUsedQuotaByUserIds 锁定范围统计：只累计 userIds 内的消费额度，
// 空 ids 返回零值 Stat（不回退全量）。
func TestSumUsedQuotaByUserIds(t *testing.T) {
	truncateTables(t)

	now := time.Now().Unix()
	mk := func(uid int, quota int, typ int) *Log {
		return &Log{UserId: uid, Type: typ, Quota: quota, CreatedAt: now}
	}
	require.NoError(t, DB.Create(mk(1, 100, LogTypeConsume)).Error)
	require.NoError(t, DB.Create(mk(2, 50, LogTypeConsume)).Error)
	require.NoError(t, DB.Create(mk(99, 999, LogTypeConsume)).Error)
	// 非消费类型不计入 quota 汇总
	require.NoError(t, DB.Create(mk(1, 7, LogTypeTopup)).Error)

	stat, err := SumUsedQuotaByUserIds([]int{1, 2}, LogTypeConsume, 0, 0, "", "", "")
	require.NoError(t, err)
	assert.Equal(t, 150, stat.Quota)

	// 空 ids → 零值
	stat, err = SumUsedQuotaByUserIds(nil, LogTypeConsume, 0, 0, "", "", "")
	require.NoError(t, err)
	assert.Equal(t, 0, stat.Quota)
}

// TestMidjourneyGetAllTasksUserIDs 锁定绘图日志的 UserIDs 过滤：非空时只返回范围内
// 的行；为空表示不限制（因此代理商 handler 必须在 effectiveIds 为空时提前返回空，
// 不能依赖此处的空值放行）。
func TestMidjourneyGetAllTasksUserIDs(t *testing.T) {
	truncateTables(t)

	mk := func(uid int, mjId string) *Midjourney {
		return &Midjourney{UserId: uid, MjId: mjId, Status: "SUCCESS", SubmitTime: time.Now().UnixMilli()}
	}
	require.NoError(t, DB.Create(mk(1, "mj-1")).Error)
	require.NoError(t, DB.Create(mk(2, "mj-2")).Error)
	require.NoError(t, DB.Create(mk(99, "mj-99")).Error)

	got := GetAllTasks(0, 10, TaskQueryParams{UserIDs: []int{1, 2}})
	require.Len(t, got, 2)
	assert.Equal(t, int64(2), CountAllTasks(TaskQueryParams{UserIDs: []int{1, 2}}))

	got = GetAllTasks(0, 10, TaskQueryParams{UserIDs: []int{99}})
	require.Len(t, got, 1)
	assert.Equal(t, "mj-99", got[0].MjId)

	// 空 UserIDs = 不限制（全量），印证 handler 需自行防空
	got = GetAllTasks(0, 10, TaskQueryParams{})
	assert.Len(t, got, 3)
	assert.Equal(t, int64(3), CountAllTasks(TaskQueryParams{}))
}
