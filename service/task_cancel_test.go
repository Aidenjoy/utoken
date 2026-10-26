package service

import (
	"context"
	"testing"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 取消链路的计费不变量：取消必须全额退还预扣且只退一次；取消是终态，
// 之后的上游成功结果（轮询/实时查询/补录）不得再结算出第二笔扣费。

func seedCancelFixture(t *testing.T, userID, tokenID, channelID, initQuota, preConsumed, tokenRemain int) *model.Task {
	t.Helper()
	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-cancel", tokenRemain)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.TaskID = "task-cancel"
	require.NoError(t, model.DB.Create(task).Error)
	// 模拟提交时的预扣：used_quota 增加
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", userID).Update("used_quota", preConsumed).Error)
	return task
}

func reloadTask(t *testing.T, id int64) *model.Task {
	t.Helper()
	var reloaded model.Task
	require.NoError(t, model.DB.First(&reloaded, id).Error)
	return &reloaded
}

func TestCancelVideoTask_InFlightRefundsPreConsume(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 40, 40, 40
	const initQuota, preConsumed, tokenRemain = 10000, 3000, 5000

	task := seedCancelFixture(t, userID, tokenID, channelID, initQuota, preConsumed, tokenRemain)

	status, err := CancelVideoTask(ctx, task)
	require.NoError(t, err)
	assert.EqualValues(t, model.TaskStatusCancelled, status)

	reloaded := reloadTask(t, task.ID)
	assert.EqualValues(t, model.TaskStatusCancelled, reloaded.Status)
	assert.Equal(t, "100%", reloaded.Progress)
	assert.Equal(t, 0, reloaded.Quota)

	// 预扣全额退回钱包与令牌，used_quota 归零
	assert.Equal(t, initQuota+preConsumed, getUserQuota(t, userID))
	assert.Equal(t, 0, getUserUsedQuota(t, userID))
	assert.Equal(t, tokenRemain+preConsumed, getTokenRemainQuota(t, tokenID))

	log := getLastLog(t)
	require.NotNil(t, log)
	assert.Equal(t, model.LogTypeRefund, log.Type)
	assert.Equal(t, preConsumed, log.Quota)

	// 终态任务不再被后台轮询捞起，否则上游稍后成功会二次计费
	assert.Empty(t, model.GetAllUnFinishSyncTasks(10))
	assert.False(t, model.HasUnfinishedSyncTasks())
}

func TestCancelVideoTask_TwiceRefundsOnce(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 41, 41, 41
	const initQuota, preConsumed, tokenRemain = 10000, 2500, 4000

	task := seedCancelFixture(t, userID, tokenID, channelID, initQuota, preConsumed, tokenRemain)

	_, err := CancelVideoTask(ctx, task)
	require.NoError(t, err)
	quotaAfterFirst := getUserQuota(t, userID)
	logsAfterFirst := countLogs(t)

	// 第二次取消（例如前端重试）拿 DB 现状，不得再次退款
	again, err := CancelVideoTask(ctx, reloadTask(t, task.ID))
	require.NoError(t, err)
	assert.EqualValues(t, model.TaskStatusCancelled, again)

	assert.Equal(t, quotaAfterFirst, getUserQuota(t, userID))
	assert.Equal(t, tokenRemain+preConsumed, getTokenRemainQuota(t, tokenID))
	assert.Equal(t, logsAfterFirst, countLogs(t))
}

func TestCancelVideoTask_AfterSuccessIsNoOp(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 42, 42, 42
	const initQuota, preConsumed, tokenRemain = 10000, 5000, 8000
	const actualQuota = 3000

	task := seedCancelFixture(t, userID, tokenID, channelID, initQuota, preConsumed, tokenRemain)

	// 轮询先把任务结算为 SUCCESS（差额退 2000）
	simulatePollBilling(ctx, task, model.TaskStatusSuccess, actualQuota)
	quotaAfterSettle := getUserQuota(t, userID)
	logsAfterSettle := countLogs(t)

	status, err := CancelVideoTask(ctx, reloadTask(t, task.ID))
	require.NoError(t, err)
	assert.EqualValues(t, model.TaskStatusSuccess, status)

	// 已结算的任务取消是 no-op：不退款、不改状态、不写日志
	reloaded := reloadTask(t, task.ID)
	assert.EqualValues(t, model.TaskStatusSuccess, reloaded.Status)
	assert.Equal(t, quotaAfterSettle, getUserQuota(t, userID))
	assert.Equal(t, logsAfterSettle, countLogs(t))
}

func TestCancelVideoTask_LosesRaceToPoller(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 43, 43, 43
	const initQuota, preConsumed, tokenRemain = 10000, 4000, 6000

	task := seedCancelFixture(t, userID, tokenID, channelID, initQuota, preConsumed, tokenRemain)

	// 轮询在取消的 CAS 之前把任务推进到 SUCCESS 并结算
	simulatePollBilling(ctx, reloadTask(t, task.ID), model.TaskStatusSuccess, preConsumed)
	quotaAfterSettle := getUserQuota(t, userID)
	logsAfterSettle := countLogs(t)

	// 取消方手里还是旧的 IN_PROGRESS 副本：CAS 失败后按 DB 现状返回 SUCCESS
	status, err := CancelVideoTask(ctx, task)
	require.NoError(t, err)
	assert.EqualValues(t, model.TaskStatusSuccess, status)

	assert.Equal(t, quotaAfterSettle, getUserQuota(t, userID))
	assert.Equal(t, tokenRemain, getTokenRemainQuota(t, tokenID))
	assert.Equal(t, logsAfterSettle, countLogs(t))
}

func TestApplyUpstreamTaskResult_IgnoresResultAfterCancel(t *testing.T) {
	truncate(t)
	ctx := context.Background()

	const userID, tokenID, channelID = 44, 44, 44
	const initQuota, preConsumed, tokenRemain = 10000, 3500, 5000

	task := seedCancelFixture(t, userID, tokenID, channelID, initQuota, preConsumed, tokenRemain)

	_, err := CancelVideoTask(ctx, task)
	require.NoError(t, err)
	quotaAfterCancel := getUserQuota(t, userID)
	logsAfterCancel := countLogs(t)

	// 上游稍后报成功：实时透传查询/补录都会走到这里，必须被拦截，
	// 否则同一任务先退款后扣费
	adaptor := &mockAdaptor{adjustReturn: 2000}
	taskResult := &relaycommon.TaskInfo{
		Status:      model.TaskStatusSuccess,
		Url:         "https://example.com/video.mp4",
		TotalTokens: 99999,
	}
	require.NoError(t, ApplyUpstreamTaskResult(ctx, adaptor, reloadTask(t, task.ID), taskResult, []byte(`{}`)))

	reloaded := reloadTask(t, task.ID)
	assert.EqualValues(t, model.TaskStatusCancelled, reloaded.Status)
	assert.Equal(t, 0, reloaded.Quota)
	assert.Equal(t, quotaAfterCancel, getUserQuota(t, userID))
	assert.Equal(t, tokenRemain+preConsumed, getTokenRemainQuota(t, tokenID))
	assert.Equal(t, logsAfterCancel, countLogs(t))
}
