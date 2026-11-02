package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestGetOrgLogsBillingView 守护企业计费详情视图的三个约定：
//  1. 登录/管理等非计费日志不出现；
//  2. 任务差额结算/退款日志不单独成行，折叠进提交预扣行（净额、结算 token、墙钟耗时）；
//  3. 同步消耗日志原样保留。
func TestGetOrgLogsBillingView(t *testing.T) {
	setupOrgFixture(t)
	t.Cleanup(func() {
		DB.Exec("DELETE FROM logs")
	})

	org := seedOrg(t, 1, 1000, OrgStatusEnabled)
	member := seedOrgMember(t, org, 301, OrgRoleMember, 0, OrgMemberStatusEnabled)
	userId := member.UserId

	base := time.Now().Unix()
	seedLogs := []*Log{
		{UserId: userId, CreatedAt: base, Type: LogTypeConsume, ModelName: "sync-model", Quota: 500, PromptTokens: 100, CompletionTokens: 50, UseTime: 2, Other: `{"model_ratio":1}`},
		{UserId: userId, CreatedAt: base + 1, Type: LogTypeLogin, Content: "登录成功", Other: ""},
		{UserId: userId, CreatedAt: base + 5, Type: LogTypeManage, Content: "更新了成员", Other: ""},
		// 任务 1：提交预扣 + 差额退款（结算带真实 token）
		{UserId: userId, CreatedAt: base + 10, Type: LogTypeConsume, ModelName: "task-model", TokenName: "playground-video-default", Quota: 6937500, Other: `{"is_task":true,"task_id":"task_fold_1","model_price":0}`},
		{UserId: userId, CreatedAt: base + 194, Type: LogTypeRefund, ModelName: "task-model", Quota: 5860800, CompletionTokens: 38800, Other: `{"task_id":"task_fold_1","pre_consumed_quota":6937500,"actual_quota":1076700}`},
		// 任务 2：提交预扣 + 补扣差额（结算型消耗日志不得单独成行）
		{UserId: userId, CreatedAt: base + 20, Type: LogTypeConsume, ModelName: "task-model-2", Quota: 1000, Other: `{"is_task":true,"task_id":"task_fold_2"}`},
		{UserId: userId, CreatedAt: base + 80, Type: LogTypeConsume, ModelName: "task-model-2", Quota: 200, Other: `{"task_id":"task_fold_2","pre_consumed_quota":1000,"actual_quota":1200}`},
	}
	for _, log := range seedLogs {
		require.NoError(t, DB.Create(log).Error)
	}

	got, total, err := GetOrgLogs([]int{userId}, 0, 0, "", 0, 0, 20)
	require.NoError(t, err)
	require.Equal(t, int64(3), total, "登录/管理/结算行都不计入总数")
	require.Len(t, got, 3)

	// 按时间倒序：任务 2 提交行、任务 1 提交行、同步行
	task2 := got[0]
	assert.Equal(t, "task-model-2", task2.ModelName)
	assert.Equal(t, 1200, task2.Quota, "补扣差额折叠进提交行")
	assert.Equal(t, 60, task2.UseTime, "耗时取提交到结算的墙钟时间")

	task1 := got[1]
	assert.Equal(t, "task-model", task1.ModelName)
	assert.Equal(t, 6937500-5860800, task1.Quota, "退款折叠后为净额")
	assert.Equal(t, 0, task1.PromptTokens)
	assert.Equal(t, 38800, task1.CompletionTokens, "token 取结算值")
	assert.Equal(t, 184, task1.UseTime)

	sync := got[2]
	assert.Equal(t, "sync-model", sync.ModelName)
	assert.Equal(t, 500, sync.Quota)
	assert.Equal(t, 2, sync.UseTime, "同步行耗时不被改写")
}

// TestGetOrgLogsBillingViewFullRefund 守护任务失败全额退款折叠后净额为 0。
func TestGetOrgLogsBillingViewFullRefund(t *testing.T) {
	setupOrgFixture(t)
	t.Cleanup(func() {
		DB.Exec("DELETE FROM logs")
	})

	org := seedOrg(t, 1, 1000, OrgStatusEnabled)
	member := seedOrgMember(t, org, 302, OrgRoleMember, 0, OrgMemberStatusEnabled)
	userId := member.UserId

	base := time.Now().Unix()
	require.NoError(t, DB.Create(&Log{UserId: userId, CreatedAt: base, Type: LogTypeConsume, ModelName: "fail-model", Quota: 3000, Other: `{"is_task":true,"task_id":"task_fail_1"}`}).Error)
	require.NoError(t, DB.Create(&Log{UserId: userId, CreatedAt: base + 30, Type: LogTypeRefund, ModelName: "fail-model", Quota: 3000, Other: `{"task_id":"task_fail_1","reason":"task failed"}`}).Error)

	got, total, err := GetOrgLogs([]int{userId}, 0, 0, "", 0, 0, 20)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, got, 1)
	assert.Equal(t, 0, got[0].Quota, "全额退款后净额为 0")
	assert.Equal(t, 30, got[0].UseTime)
}

// TestGetOrgLogsStripsChannelAndRates 守护企业日志口径与普通用户 self 视图一致：
// 企业管理员经 /api/org/logs F12 不应看到渠道身份、上游标识或任何内部费率。
func TestGetOrgLogsStripsChannelAndRates(t *testing.T) {
	setupOrgFixture(t)
	t.Cleanup(func() {
		DB.Exec("DELETE FROM logs")
	})

	org := seedOrg(t, 1, 1000, OrgStatusEnabled)
	member := seedOrgMember(t, org, 303, OrgRoleMember, 0, OrgMemberStatusEnabled)
	userId := member.UserId

	base := time.Now().Unix()
	require.NoError(t, DB.Create(&Log{
		UserId: userId, CreatedAt: base, Type: LogTypeConsume, ModelName: "video-model",
		ChannelId: 14, Quota: 1000, PromptTokens: 10, CompletionTokens: 5,
		UpstreamRequestId: "upstream-req-1",
		Other:             `{"is_task":true,"task_id":"org_priv_1","model_ratio":15,"model_price":0.004,"group_ratio":2,"discount":0.8,"original_quota":1250,"channel_id":14,"channel_name":"internal-channel","request_url":"https://internal.example.com","seconds":4}`,
	}).Error)

	got, total, err := GetOrgLogs([]int{userId}, 0, 0, "", 0, 0, 20)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, got, 1)

	row := got[0]
	assert.Zero(t, row.ChannelId, "渠道号必须剥离")
	assert.Empty(t, row.ChannelName, "渠道名必须剥离")
	assert.Empty(t, row.UpstreamRequestId, "上游请求标识必须剥离")

	parsed, err := common.StrToMap(row.Other)
	require.NoError(t, err)
	for _, key := range []string{"model_ratio", "model_price", "group_ratio", "discount", "original_quota", "channel_id", "channel_name", "request_url", "seconds"} {
		assert.NotContains(t, parsed, key, "企业日志不得泄露 %q", key)
	}
	assert.Equal(t, "org_priv_1", parsed["task_id"], "task_id 需保留以支撑折叠")
}
