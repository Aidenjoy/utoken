package service

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/bytedance/gopkg/util/gopool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type taskPollingFetchAdaptor struct {
	mu           sync.Mutex
	taskIDs      []string
	fetched      chan string
	blockTaskID  string
	blockStarted chan struct{}
	releaseBlock chan struct{}
	blockOnce    sync.Once
}

func (a *taskPollingFetchAdaptor) Init(_ *relaycommon.RelayInfo) {}

func (a *taskPollingFetchAdaptor) FetchTask(_ string, _ string, body map[string]any, _ string) (*http.Response, error) {
	taskID, _ := body["task_id"].(string)
	if taskID == a.blockTaskID && a.releaseBlock != nil {
		a.blockOnce.Do(func() {
			if a.blockStarted != nil {
				close(a.blockStarted)
			}
		})
		<-a.releaseBlock
	}

	a.mu.Lock()
	a.taskIDs = append(a.taskIDs, taskID)
	a.mu.Unlock()
	if a.fetched != nil {
		select {
		case a.fetched <- taskID:
		default:
		}
	}

	response := dto.TaskResponse[model.Task]{
		Code: dto.TaskSuccessCode,
		Data: model.Task{
			TaskID:   taskID,
			Status:   model.TaskStatusInProgress,
			Progress: "30%",
		},
	}
	responseBody, err := common.Marshal(response)
	if err != nil {
		return nil, err
	}
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewReader(responseBody)),
	}, nil
}

func (a *taskPollingFetchAdaptor) ParseTaskResult([]byte) (*relaycommon.TaskInfo, error) {
	return &relaycommon.TaskInfo{Status: model.TaskStatusInProgress}, nil
}

func (a *taskPollingFetchAdaptor) AdjustBillingOnComplete(_ *model.Task, _ *relaycommon.TaskInfo) int {
	return 0
}

func (a *taskPollingFetchAdaptor) fetchCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.taskIDs)
}

func (a *taskPollingFetchAdaptor) fetchedTaskIDs() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]string(nil), a.taskIDs...)
}

func seedTaskPollingChannel(t *testing.T, id int, disableSleep bool) {
	t.Helper()
	ch := &model.Channel{
		Id:     id,
		Type:   constant.ChannelTypeKling,
		Name:   "polling_channel",
		Key:    "sk-test",
		Status: common.ChannelStatusEnabled,
	}
	if disableSleep {
		ch.SetOtherSettings(dto.ChannelOtherSettings{DisableTaskPollingSleep: true})
	}
	require.NoError(t, model.DB.Create(ch).Error)
}

func seedPollingTask(t *testing.T, channelID int, publicID string, upstreamID string) *model.Task {
	t.Helper()
	task := &model.Task{
		TaskID:    publicID,
		Platform:  constant.TaskPlatform("kling"),
		UserId:    1,
		ChannelId: channelID,
		Action:    constant.TaskActionGenerate,
		Status:    model.TaskStatusInProgress,
		Progress:  "30%",
		CreatedAt: time.Now().Unix(),
		UpdatedAt: time.Now().Unix(),
		PrivateData: model.TaskPrivateData{
			UpstreamTaskID: upstreamID,
		},
	}
	require.NoError(t, model.DB.Create(task).Error)
	return task
}

func TestUpdateVideoTasksDefaultSleepWaitsBetweenTasks(t *testing.T) {
	truncate(t)

	const channelID = 101
	seedTaskPollingChannel(t, channelID, false)
	first := seedPollingTask(t, channelID, "task_public_1", "upstream_1")
	second := seedPollingTask(t, channelID, "task_public_2", "upstream_2")

	adaptor := &taskPollingFetchAdaptor{}
	previousFactory := GetTaskAdaptorFunc
	GetTaskAdaptorFunc = func(constant.TaskPlatform) TaskPollingAdaptor { return adaptor }
	t.Cleanup(func() { GetTaskAdaptorFunc = previousFactory })

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	err := UpdateVideoTasks(ctx, constant.TaskPlatform("kling"), map[int][]string{
		channelID: {
			first.GetUpstreamTaskID(),
			second.GetUpstreamTaskID(),
		},
	}, map[string]*model.Task{
		first.GetUpstreamTaskID():  first,
		second.GetUpstreamTaskID(): second,
	})

	require.ErrorIs(t, err, context.DeadlineExceeded)
	assert.Equal(t, 1, adaptor.fetchCount())
}

func TestUpdateVideoTasksCanSkipPollingSleepPerChannel(t *testing.T) {
	truncate(t)

	const channelID = 102
	seedTaskPollingChannel(t, channelID, true)
	first := seedPollingTask(t, channelID, "task_public_3", "upstream_3")
	second := seedPollingTask(t, channelID, "task_public_4", "upstream_4")

	adaptor := &taskPollingFetchAdaptor{}
	previousFactory := GetTaskAdaptorFunc
	GetTaskAdaptorFunc = func(constant.TaskPlatform) TaskPollingAdaptor { return adaptor }
	t.Cleanup(func() { GetTaskAdaptorFunc = previousFactory })

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	err := UpdateVideoTasks(ctx, constant.TaskPlatform("kling"), map[int][]string{
		channelID: {
			first.GetUpstreamTaskID(),
			second.GetUpstreamTaskID(),
		},
	}, map[string]*model.Task{
		first.GetUpstreamTaskID():  first,
		second.GetUpstreamTaskID(): second,
	})

	require.NoError(t, err)
	assert.Equal(t, 2, adaptor.fetchCount())
}

func TestUpdateVideoTasksDefaultSleepDoesNotBlockOtherChannels(t *testing.T) {
	truncate(t)

	const firstChannelID = 201
	const secondChannelID = 202
	seedTaskPollingChannel(t, firstChannelID, false)
	seedTaskPollingChannel(t, secondChannelID, false)
	firstChannelFirst := seedPollingTask(t, firstChannelID, "task_public_5", "upstream_a_1")
	firstChannelSecond := seedPollingTask(t, firstChannelID, "task_public_6", "upstream_a_2")
	secondChannelFirst := seedPollingTask(t, secondChannelID, "task_public_7", "upstream_b_1")
	secondChannelSecond := seedPollingTask(t, secondChannelID, "task_public_8", "upstream_b_2")

	adaptor := &taskPollingFetchAdaptor{}
	previousFactory := GetTaskAdaptorFunc
	GetTaskAdaptorFunc = func(constant.TaskPlatform) TaskPollingAdaptor { return adaptor }
	t.Cleanup(func() { GetTaskAdaptorFunc = previousFactory })

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	err := UpdateVideoTasks(ctx, constant.TaskPlatform("kling"), map[int][]string{
		firstChannelID: {
			firstChannelFirst.GetUpstreamTaskID(),
			firstChannelSecond.GetUpstreamTaskID(),
		},
		secondChannelID: {
			secondChannelFirst.GetUpstreamTaskID(),
			secondChannelSecond.GetUpstreamTaskID(),
		},
	}, map[string]*model.Task{
		firstChannelFirst.GetUpstreamTaskID():   firstChannelFirst,
		firstChannelSecond.GetUpstreamTaskID():  firstChannelSecond,
		secondChannelFirst.GetUpstreamTaskID():  secondChannelFirst,
		secondChannelSecond.GetUpstreamTaskID(): secondChannelSecond,
	})

	require.ErrorIs(t, err, context.DeadlineExceeded)
	assert.ElementsMatch(t, []string{"upstream_a_1", "upstream_b_1"}, adaptor.fetchedTaskIDs())
}

func TestUpdateVideoTasksSlowChannelDoesNotBlockOtherChannels(t *testing.T) {
	truncate(t)

	const slowChannelID = 251
	const fastChannelID = 252
	seedTaskPollingChannel(t, slowChannelID, false)
	seedTaskPollingChannel(t, fastChannelID, true)
	slowTask := seedPollingTask(t, slowChannelID, "task_public_slow", "upstream_slow_1")
	fastFirst := seedPollingTask(t, fastChannelID, "task_public_fast_1", "upstream_fast_parallel_1")
	fastSecond := seedPollingTask(t, fastChannelID, "task_public_fast_2", "upstream_fast_parallel_2")

	adaptor := &taskPollingFetchAdaptor{
		fetched:      make(chan string, 4),
		blockTaskID:  slowTask.GetUpstreamTaskID(),
		blockStarted: make(chan struct{}),
		releaseBlock: make(chan struct{}),
	}
	var releaseOnce sync.Once
	releaseBlockedTask := func() {
		releaseOnce.Do(func() {
			close(adaptor.releaseBlock)
		})
	}
	t.Cleanup(releaseBlockedTask)
	previousFactory := GetTaskAdaptorFunc
	GetTaskAdaptorFunc = func(constant.TaskPlatform) TaskPollingAdaptor { return adaptor }
	t.Cleanup(func() { GetTaskAdaptorFunc = previousFactory })

	errCh := make(chan error, 1)
	gopool.Go(func() {
		errCh <- UpdateVideoTasks(context.Background(), constant.TaskPlatform("kling"), map[int][]string{
			slowChannelID: {
				slowTask.GetUpstreamTaskID(),
			},
			fastChannelID: {
				fastFirst.GetUpstreamTaskID(),
				fastSecond.GetUpstreamTaskID(),
			},
		}, map[string]*model.Task{
			slowTask.GetUpstreamTaskID():   slowTask,
			fastFirst.GetUpstreamTaskID():  fastFirst,
			fastSecond.GetUpstreamTaskID(): fastSecond,
		})
	})

	select {
	case <-adaptor.blockStarted:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("slow channel did not start blocking")
	}

	require.Eventually(t, func() bool {
		fetchedTaskIDs := adaptor.fetchedTaskIDs()
		return len(fetchedTaskIDs) == 2 &&
			fetchedTaskIDs[0] == fastFirst.GetUpstreamTaskID() &&
			fetchedTaskIDs[1] == fastSecond.GetUpstreamTaskID()
	}, 500*time.Millisecond, 10*time.Millisecond)

	releaseBlockedTask()
	require.NoError(t, <-errCh)
	assert.ElementsMatch(t, []string{
		slowTask.GetUpstreamTaskID(),
		fastFirst.GetUpstreamTaskID(),
		fastSecond.GetUpstreamTaskID(),
	}, adaptor.fetchedTaskIDs())
}

func TestUpdateVideoTasksMixedChannelSleepSettings(t *testing.T) {
	truncate(t)

	const sleepyChannelID = 301
	const fastChannelID = 302
	seedTaskPollingChannel(t, sleepyChannelID, false)
	seedTaskPollingChannel(t, fastChannelID, true)
	sleepyFirst := seedPollingTask(t, sleepyChannelID, "task_public_9", "upstream_sleepy_1")
	sleepySecond := seedPollingTask(t, sleepyChannelID, "task_public_10", "upstream_sleepy_2")
	fastFirst := seedPollingTask(t, fastChannelID, "task_public_11", "upstream_fast_1")
	fastSecond := seedPollingTask(t, fastChannelID, "task_public_12", "upstream_fast_2")

	adaptor := &taskPollingFetchAdaptor{}
	previousFactory := GetTaskAdaptorFunc
	GetTaskAdaptorFunc = func(constant.TaskPlatform) TaskPollingAdaptor { return adaptor }
	t.Cleanup(func() { GetTaskAdaptorFunc = previousFactory })

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	err := UpdateVideoTasks(ctx, constant.TaskPlatform("kling"), map[int][]string{
		sleepyChannelID: {
			sleepyFirst.GetUpstreamTaskID(),
			sleepySecond.GetUpstreamTaskID(),
		},
		fastChannelID: {
			fastFirst.GetUpstreamTaskID(),
			fastSecond.GetUpstreamTaskID(),
		},
	}, map[string]*model.Task{
		sleepyFirst.GetUpstreamTaskID():  sleepyFirst,
		sleepySecond.GetUpstreamTaskID(): sleepySecond,
		fastFirst.GetUpstreamTaskID():    fastFirst,
		fastSecond.GetUpstreamTaskID():   fastSecond,
	})

	require.ErrorIs(t, err, context.DeadlineExceeded)
	assert.ElementsMatch(t, []string{"upstream_sleepy_1", "upstream_fast_1", "upstream_fast_2"}, adaptor.fetchedTaskIDs())
}

// fixedSettleAdaptor 只用于验证 ApplyUpstreamTaskResult 的结算行为：
// AdjustBillingOnComplete 返回预设实际额度；Apply 不应触发任何上游请求，
// FetchTask/ParseTaskResult 被调用即 panic 暴露误用。
type fixedSettleAdaptor struct{ quota int }

func (a *fixedSettleAdaptor) Init(_ *relaycommon.RelayInfo) {}

func (a *fixedSettleAdaptor) FetchTask(string, string, map[string]any, string) (*http.Response, error) {
	panic("ApplyUpstreamTaskResult must not call FetchTask")
}

func (a *fixedSettleAdaptor) ParseTaskResult([]byte) (*relaycommon.TaskInfo, error) {
	panic("ApplyUpstreamTaskResult must not call ParseTaskResult")
}

func (a *fixedSettleAdaptor) AdjustBillingOnComplete(*model.Task, *relaycommon.TaskInfo) int {
	return a.quota
}

// TestApplyUpstreamTaskResultSettlesMissedTerminalTask 锁定漏结算补偿路径：
// 历史版本中实时查询把任务标成 Success 但不结算，后台轮询又不再捕获终态任务，
// 导致结算永不执行。修复后对已终态任务再次应用上游终态结果时，必须补执行
// 差额结算（带 token 的退费日志）并补 FinishTime；重复应用不得二次扣费。
func TestApplyUpstreamTaskResultSettlesMissedTerminalTask(t *testing.T) {
	truncate(t)

	const (
		userID      = 9101
		tokenID     = 9102
		channelID   = 9103
		initQuota   = 10000
		preConsumed = 3000
		actualQuota = 1000
		totalTokens = 40594
	)
	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-ark-settle", initQuota)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	// 场景：任务已被旧版实时查询标成终态，但结算缺失（FinishTime 未落）
	task.Status = model.TaskStatusSuccess
	task.Progress = "100%"
	require.NoError(t, model.DB.Create(task).Error)

	adaptor := &fixedSettleAdaptor{quota: actualQuota}
	// 上游报告的真实终态时刻（补结算场景下与本地检测时刻差异巨大），应被采用
	upstreamFinish := time.Now().Add(-2 * time.Minute).Unix()
	taskResult := &relaycommon.TaskInfo{
		Status:           model.TaskStatusSuccess,
		Progress:         "100%",
		TotalTokens:      totalTokens,
		CompletionTokens: totalTokens,
		Url:              "https://upstream/video.mp4",
		FinishTime:       upstreamFinish,
	}
	body := []byte(`{"id":"upstream_1","status":"succeeded"}`)

	require.NoError(t, ApplyUpstreamTaskResult(context.Background(), adaptor, task, taskResult, body))

	// 差额退费：退款额 = 预扣 - 实际，且退费日志带真实 token 用量
	assert.Equal(t, initQuota+(preConsumed-actualQuota), getUserQuota(t, userID))
	var refund model.Log
	require.NoError(t, model.DB.Where("type = ?", model.LogTypeRefund).First(&refund).Error)
	assert.Equal(t, preConsumed-actualQuota, refund.Quota)
	assert.Equal(t, totalTokens, refund.CompletionTokens)

	// 任务落库：quota 更新为实际额度，FinishTime 采用上游真实终态时刻（任务日志耗时准确）
	var reloaded model.Task
	require.NoError(t, model.DB.First(&reloaded, task.ID).Error)
	assert.Equal(t, actualQuota, reloaded.Quota)
	assert.Equal(t, upstreamFinish, reloaded.FinishTime)

	// 重复应用同一终态结果（客户端再次查询）：delta=0，不得产生第二笔日志或资金变动
	logsBefore := countLogs(t)
	require.NoError(t, ApplyUpstreamTaskResult(context.Background(), adaptor, task, taskResult, body))
	assert.Equal(t, logsBefore, countLogs(t))
	assert.Equal(t, initQuota+(preConsumed-actualQuota), getUserQuota(t, userID))
}

// TestApplyUpstreamTaskResultRefundsFailedTaskOnce 锁定失败退款"恰好一次"：
// 客户端每次查询任务详情都会实时拉取上游并重新应用结果，而失败任务已不再被后台
// 轮询捞起。历史版本对已终态任务每次查询都全额退一遍预扣额度（企业池/钱包余额
// 越退越多），修复后退款额度先被原子认领（quota 置零），重复查询不得再次退款。
func TestApplyUpstreamTaskResultRefundsFailedTaskOnce(t *testing.T) {
	truncate(t)

	const (
		userID      = 9201
		tokenID     = 9202
		channelID   = 9203
		initQuota   = 20000
		preConsumed = 8750
		tokenRemain = 9000
	)
	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-ark-refund", tokenRemain)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	require.NoError(t, model.DB.Create(task).Error)
	// 预扣费已扣走钱包与令牌额度
	require.NoError(t, model.DecreaseUserQuota(userID, preConsumed, false))
	require.NoError(t, model.DecreaseTokenQuota(tokenID, "sk-ark-refund", preConsumed))

	adaptor := &fixedSettleAdaptor{quota: 0}
	failedResult := &relaycommon.TaskInfo{Status: model.TaskStatusFailure, Reason: "upstream rejected"}
	body := []byte(`{"id":"upstream_1","status":"failed"}`)

	// 客户端连续查询 3 次，每次都像实时查询路径一样从库里重新加载任务
	for i := 0; i < 3; i++ {
		var fresh model.Task
		require.NoError(t, model.DB.First(&fresh, task.ID).Error)
		require.NoError(t, ApplyUpstreamTaskResult(context.Background(), adaptor, &fresh, failedResult, body))
	}

	assert.Equal(t, initQuota, getUserQuota(t, userID), "只退一次款")
	assert.Equal(t, tokenRemain, getTokenRemainQuota(t, tokenID), "令牌额度只退一次")
	var refundLogs int64
	require.NoError(t, model.DB.Model(&model.Log{}).Where("type = ?", model.LogTypeRefund).Count(&refundLogs).Error)
	assert.Equal(t, int64(1), refundLogs)

	var reloaded model.Task
	require.NoError(t, model.DB.First(&reloaded, task.ID).Error)
	assert.EqualValues(t, model.TaskStatusFailure, reloaded.Status)
	assert.Equal(t, "upstream rejected", reloaded.FailReason)
	assert.Equal(t, 0, reloaded.Quota, "预扣额度已被退款认领置零")
}

// TestApplyUpstreamTaskResultIgnoresFailureAfterSettledSuccess 锁定补录幂等：
// 已成功结算的任务再次补录时，若上游记录已过期/查询报错被解析为 FAILURE，
// 不得改判状态或全额退款（错误退款数据）；状态、额度与日志均保持结算后不变。
func TestApplyUpstreamTaskResultIgnoresFailureAfterSettledSuccess(t *testing.T) {
	truncate(t)

	const (
		userID    = 9301
		tokenID   = 9302
		channelID = 9303
		initQuota = 20000
		quota     = 5000 // 预扣==实际，结算 delta=0，不产生结算日志
	)
	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-ark-idem", initQuota)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, quota, tokenID, BillingSourceWallet, 0)
	task.Status = model.TaskStatusSuccess
	task.Progress = "100%"
	require.NoError(t, model.DB.Create(task).Error)

	adaptor := &fixedSettleAdaptor{quota: quota}
	successResult := &relaycommon.TaskInfo{
		Status:           model.TaskStatusSuccess,
		Progress:         "100%",
		TotalTokens:      100,
		CompletionTokens: 100,
		Url:              "https://upstream/video.mp4",
	}
	body := []byte(`{"id":"upstream_1","status":"succeeded"}`)
	require.NoError(t, ApplyUpstreamTaskResult(context.Background(), adaptor, task, successResult, body))
	quotaAfterSettle := getUserQuota(t, userID)

	// 再次补录：上游记录过期，查询报错被解析为 FAILURE
	var fresh model.Task
	require.NoError(t, model.DB.First(&fresh, task.ID).Error)
	failedResult := &relaycommon.TaskInfo{Status: model.TaskStatusFailure, Reason: "task not found"}
	require.NoError(t, ApplyUpstreamTaskResult(context.Background(), adaptor, &fresh, failedResult, []byte(`{"error":"not found"}`)))

	var reloaded model.Task
	require.NoError(t, model.DB.First(&reloaded, task.ID).Error)
	assert.EqualValues(t, model.TaskStatusSuccess, reloaded.Status, "已结算成功不得被改判失败")
	assert.Equal(t, quota, reloaded.Quota, "额度保持结算后不变")
	assert.Equal(t, quotaAfterSettle, getUserQuota(t, userID), "不得错误退款")
	var refundLogs int64
	require.NoError(t, model.DB.Model(&model.Log{}).Where("type = ?", model.LogTypeRefund).Count(&refundLogs).Error)
	assert.Equal(t, int64(0), refundLogs, "不得产生退款日志")
}

// TestSplitTaskUsageTokens 锁定结算日志 token 拆分语义：方舟视频 completion=total
// 全记 completion；有独立 completion 时 prompt=total-completion；异常输入归零。
func TestSplitTaskUsageTokens(t *testing.T) {
	cases := []struct {
		name           string
		result         *relaycommon.TaskInfo
		wantPrompt     int
		wantCompletion int
	}{
		{name: "nil", result: nil, wantPrompt: 0, wantCompletion: 0},
		{name: "零用量", result: &relaycommon.TaskInfo{}, wantPrompt: 0, wantCompletion: 0},
		{
			name:           "方舟视频 completion 等于 total",
			result:         &relaycommon.TaskInfo{TotalTokens: 196425, CompletionTokens: 196425},
			wantPrompt:     0,
			wantCompletion: 196425,
		},
		{
			name:           "仅 total 时全部记 completion",
			result:         &relaycommon.TaskInfo{TotalTokens: 1000},
			wantPrompt:     0,
			wantCompletion: 1000,
		},
		{
			name:           "prompt 与 completion 拆分",
			result:         &relaycommon.TaskInfo{TotalTokens: 1000, CompletionTokens: 400},
			wantPrompt:     600,
			wantCompletion: 400,
		},
		{
			name:           "completion 超过 total 按仅 total 处理",
			result:         &relaycommon.TaskInfo{TotalTokens: 100, CompletionTokens: 200},
			wantPrompt:     0,
			wantCompletion: 100,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			prompt, completion := splitTaskUsageTokens(tc.result)
			assert.Equal(t, tc.wantPrompt, prompt)
			assert.Equal(t, tc.wantCompletion, completion)
		})
	}
}

// scriptedResolveAdaptor 为超时回源测试提供可编排的上游响应：
// FetchTask 返回指定 HTTP 状态码与 New API 格式的任务状态；AdjustBillingOnComplete 返回预设实际额度。
type scriptedResolveAdaptor struct {
	status   model.TaskStatus
	quota    int
	httpCode int
}

func (a *scriptedResolveAdaptor) Init(_ *relaycommon.RelayInfo) {}

func (a *scriptedResolveAdaptor) FetchTask(string, string, map[string]any, string) (*http.Response, error) {
	code := a.httpCode
	if code == 0 {
		code = http.StatusOK
	}
	resp := dto.TaskResponse[model.Task]{
		Code: dto.TaskSuccessCode,
		Data: model.Task{TaskID: "up", Status: a.status},
	}
	body, _ := common.Marshal(resp)
	return &http.Response{StatusCode: code, Body: io.NopCloser(bytes.NewReader(body))}, nil
}

func (a *scriptedResolveAdaptor) ParseTaskResult([]byte) (*relaycommon.TaskInfo, error) {
	return &relaycommon.TaskInfo{Status: string(a.status)}, nil
}

func (a *scriptedResolveAdaptor) AdjustBillingOnComplete(*model.Task, *relaycommon.TaskInfo) int {
	return a.quota
}

func setSweepTestConfig(t *testing.T, timeoutMin, intervalMin, capHours int) {
	t.Helper()
	oldT, oldI, oldC := constant.TaskTimeoutMinutes, constant.TaskTimeoutResolveIntervalMinutes, constant.TaskTimeoutUnresolvedAfterHours
	constant.TaskTimeoutMinutes = timeoutMin
	constant.TaskTimeoutResolveIntervalMinutes = intervalMin
	constant.TaskTimeoutUnresolvedAfterHours = capHours
	t.Cleanup(func() {
		constant.TaskTimeoutMinutes, constant.TaskTimeoutResolveIntervalMinutes, constant.TaskTimeoutUnresolvedAfterHours = oldT, oldI, oldC
	})
}

func injectResolveAdaptor(t *testing.T, a TaskPollingAdaptor) {
	t.Helper()
	prev := GetTaskAdaptorFunc
	GetTaskAdaptorFunc = func(constant.TaskPlatform) TaskPollingAdaptor { return a }
	t.Cleanup(func() { GetTaskAdaptorFunc = prev })
}

func countRefundLogs(t *testing.T) int64 {
	t.Helper()
	var n int64
	require.NoError(t, model.DB.Model(&model.Log{}).Where("type = ?", model.LogTypeRefund).Count(&n).Error)
	return n
}

// TestSweepTimedOutTasksResolvesUpstreamSuccessInsteadOfRefund 锁定超时"先回源"：
// 上游实际已成功时，超时清扫必须结算为 SUCCESS（按实际额度差额结算），
// 而不是旧逻辑那样盲判 FAILURE+全额退款（少收费）。
func TestSweepTimedOutTasksResolvesUpstreamSuccessInsteadOfRefund(t *testing.T) {
	truncate(t)
	setSweepTestConfig(t, 1, 30, 168)

	const (
		userID      = 9401
		tokenID     = 9402
		channelID   = 9403
		initQuota   = 20000
		preConsumed = 3000
		actualQuota = 1000
	)
	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-sweep-ok", initQuota)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.Status = model.TaskStatusInProgress
	task.Progress = "30%"
	task.SubmitTime = time.Now().Unix() - 120
	require.NoError(t, model.DB.Create(task).Error)
	require.NoError(t, model.DecreaseUserQuota(userID, preConsumed, false))

	injectResolveAdaptor(t, &scriptedResolveAdaptor{status: model.TaskStatusSuccess, quota: actualQuota})

	sweepTimedOutTasks(context.Background())

	var reloaded model.Task
	require.NoError(t, model.DB.First(&reloaded, task.ID).Error)
	assert.EqualValues(t, model.TaskStatusSuccess, reloaded.Status, "上游成功应结算为 SUCCESS而非超时失败")
	assert.Equal(t, actualQuota, reloaded.Quota)
	// 差额退款=preConsumed-actual，用户净扣 actual（而非旧逻辑的全退）
	assert.Equal(t, initQuota-actualQuota, getUserQuota(t, userID))
}

// TestSweepTimedOutTasks404KeepsUnresolvedNoRefund 锁定决策 B：上游 404/过期
// 无法判定成败时，不得误判 FAILURE+退款，而是保持未完成并退避重试。
func TestSweepTimedOutTasks404KeepsUnresolvedNoRefund(t *testing.T) {
	truncate(t)
	setSweepTestConfig(t, 1, 30, 168)

	const (userID = 9411; tokenID = 9412; channelID = 9413; initQuota = 20000; preConsumed = 3000)
	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-sweep-404", initQuota)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.Status = model.TaskStatusInProgress
	task.Progress = "30%"
	task.SubmitTime = time.Now().Unix() - 120
	require.NoError(t, model.DB.Create(task).Error)
	require.NoError(t, model.DecreaseUserQuota(userID, preConsumed, false))

	injectResolveAdaptor(t, &scriptedResolveAdaptor{status: model.TaskStatusInProgress, httpCode: http.StatusNotFound})

	sweepTimedOutTasks(context.Background())

	var reloaded model.Task
	require.NoError(t, model.DB.First(&reloaded, task.ID).Error)
	assert.EqualValues(t, model.TaskStatusInProgress, reloaded.Status, "404 不得误判失败")
	assert.NotEqualValues(t, model.TaskStatusTimeoutUnresolved, reloaded.Status, "未超硬上限不应挂起")
	assert.Equal(t, 1, reloaded.ResolveAttempts)
	assert.Greater(t, reloaded.NextResolveAt, time.Now().Unix())
	assert.Equal(t, initQuota-preConsumed, getUserQuota(t, userID), "不得退款")
	assert.Equal(t, int64(0), countRefundLogs(t))
}

// TestSweepTimedOutTasksCapsToUnresolvedNoRefund 锁定阶段3：账龄超硬上限且始终
// 解析不了→挂起标记 TIMEOUT_UNRESOLVED（保留预扣、不退款、停止自动轮询）。
func TestSweepTimedOutTasksCapsToUnresolvedNoRefund(t *testing.T) {
	truncate(t)
	setSweepTestConfig(t, 1, 30, 1) // 硬上限 1 小时

	const (userID = 9421; tokenID = 9422; channelID = 9423; initQuota = 20000; preConsumed = 3000)
	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-sweep-cap", initQuota)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.Status = model.TaskStatusInProgress
	task.Progress = "30%"
	task.SubmitTime = time.Now().Unix() - 7200 // 2h > 1h 上限
	require.NoError(t, model.DB.Create(task).Error)
	require.NoError(t, model.DecreaseUserQuota(userID, preConsumed, false))

	injectResolveAdaptor(t, &scriptedResolveAdaptor{status: model.TaskStatusInProgress})

	sweepTimedOutTasks(context.Background())

	var reloaded model.Task
	require.NoError(t, model.DB.First(&reloaded, task.ID).Error)
	assert.EqualValues(t, model.TaskStatusTimeoutUnresolved, reloaded.Status)
	assert.Equal(t, preConsumed, reloaded.Quota, "保留预扣估值")
	assert.Contains(t, reloaded.FailReason, "未解析")
	assert.Equal(t, initQuota-preConsumed, getUserQuota(t, userID), "不得退款")
	assert.Equal(t, int64(0), countRefundLogs(t))
	// 挂起后不再被自动轮询捞起
	assert.False(t, model.HasUnfinishedSyncTasks())
	assert.Empty(t, model.GetAllUnFinishSyncTasks(10))
}

// TestSweepTimedOutTasksFlagsWhenChannelDeleted 锁定 D2：渠道被删除时无法回源，
// 直接挂起标记（保留预扣、不退款），而不是旧逻辑的"标 FAILURE 且不退款"。
func TestSweepTimedOutTasksFlagsWhenChannelDeleted(t *testing.T) {
	truncate(t)
	setSweepTestConfig(t, 1, 30, 168)

	const (userID = 9431; tokenID = 9432; channelID = 9433; initQuota = 20000; preConsumed = 3000)
	seedUser(t, userID, initQuota)
	seedToken(t, tokenID, userID, "sk-sweep-nochannel", initQuota)
	// 故意不 seedChannel：模拟渠道已被删除

	task := makeTask(userID, channelID, preConsumed, tokenID, BillingSourceWallet, 0)
	task.Status = model.TaskStatusInProgress
	task.Progress = "30%"
	task.SubmitTime = time.Now().Unix() - 120
	require.NoError(t, model.DB.Create(task).Error)
	require.NoError(t, model.DecreaseUserQuota(userID, preConsumed, false))

	injectResolveAdaptor(t, &scriptedResolveAdaptor{status: model.TaskStatusSuccess, quota: preConsumed})

	sweepTimedOutTasks(context.Background())

	var reloaded model.Task
	require.NoError(t, model.DB.First(&reloaded, task.ID).Error)
	assert.EqualValues(t, model.TaskStatusTimeoutUnresolved, reloaded.Status)
	assert.Contains(t, reloaded.FailReason, "渠道")
	assert.Equal(t, preConsumed, reloaded.Quota)
	assert.Equal(t, initQuota-preConsumed, getUserQuota(t, userID), "不得退款")
}

// TestDeleteChannelBlockedWhileTaskInFlight 锁定 D3 护栏：渠道仍有在途任务时
// 拒绝硬删除（删除会丢失回源凭证）；任务进入终态后允许删除。
func TestDeleteChannelBlockedWhileTaskInFlight(t *testing.T) {
	truncate(t)

	const channelID = 9501
	seedChannel(t, channelID)
	task := makeTask(1, channelID, 100, 0, BillingSourceWallet, 0)
	task.Status = model.TaskStatusInProgress
	task.Progress = "30%"
	require.NoError(t, model.DB.Create(task).Error)

	ch := model.Channel{Id: channelID}
	err := ch.Delete()
	require.Error(t, err, "有在途任务时禁止删除渠道")
	assert.Contains(t, err.Error(), "在途")

	// 任务进入终态后，护栏不再拦截（在途计数归零）
	require.NoError(t, model.DB.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{
		"status": model.TaskStatusSuccess, "progress": "100%",
	}).Error)
	cnt, cerr := model.CountInFlightTasksByChannelIDs([]int{channelID})
	require.NoError(t, cerr)
	assert.Equal(t, int64(0), cnt, "任务终态后应允许删除")
}
