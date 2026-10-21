package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/samber/lo"
)

// TaskPollingAdaptor 定义轮询所需的最小适配器接口，避免 service -> relay 的循环依赖
type TaskPollingAdaptor interface {
	Init(info *relaycommon.RelayInfo)
	FetchTask(baseURL string, key string, body map[string]any, proxy string) (*http.Response, error)
	ParseTaskResult(body []byte) (*relaycommon.TaskInfo, error)
	// AdjustBillingOnComplete 在任务到达终态（成功/失败）时由轮询循环调用。
	// 返回正数触发差额结算（补扣/退还），返回 0 保持预扣费金额不变。
	AdjustBillingOnComplete(task *model.Task, taskResult *relaycommon.TaskInfo) int
}

// GetTaskAdaptorFunc 由 main 包注入，用于获取指定平台的任务适配器。
// 打破 service -> relay -> relay/channel -> service 的循环依赖。
var GetTaskAdaptorFunc func(platform constant.TaskPlatform) TaskPollingAdaptor

// sweepTimedOutTasks 在主轮询之前独立处理超时任务。
// 每次最多处理 100 条，剩余的下个周期继续处理。
//
// 超时不再"盲判失败+退款"，而是三段式：
//  1. 先回源（复用补录链路 RefetchAndSettleTask）：上游给出终态就正常结算/退款
//     （计费恰好一次由 ApplyUpstreamTaskResult 的 CAS 保证）；
//  2. 解析不了（上游不可达/404过期/仍在途/空状态）→ 不退款、不标失败，按退避间隔重试；
//  3. 账龄超硬上限（或渠道被删除/旧系统遗留任务）→ CAS 迁到 TIMEOUT_UNRESOLVED 挂起标记：
//     保留预扣估值、不退款、停止自动轮询，等人工用"重新查询"按钮处理。
//
// 使用 per-task CAS (UpdateWithStatus) 防止覆盖被正常轮询/其他节点已推进的任务。
func sweepTimedOutTasks(ctx context.Context) {
	if constant.TaskTimeoutMinutes <= 0 {
		return
	}
	now := time.Now().Unix()
	cutoff := now - int64(constant.TaskTimeoutMinutes)*60
	tasks := model.GetTimedOutUnfinishedTasks(cutoff, 100)
	if len(tasks) == 0 {
		return
	}

	const legacyTaskCutoff int64 = 1740182400 // 2026-02-22 00:00:00 UTC
	resolveIntervalSec := int64(constant.TaskTimeoutResolveIntervalMinutes) * 60
	if resolveIntervalSec <= 0 {
		resolveIntervalSec = 30 * 60
	}
	capSec := int64(constant.TaskTimeoutUnresolvedAfterHours) * 3600

	resolvedCount, flaggedCount, deferredCount := 0, 0, 0
	for _, task := range tasks {
		if ctx.Err() != nil {
			return
		}
		// 退避：未到下次可解析时刻则跳过，约束上游调用频率
		if task.NextResolveAt > now {
			deferredCount++
			continue
		}

		isLegacy := task.SubmitTime > 0 && task.SubmitTime < legacyTaskCutoff
		// 渠道被删除 → 物理上无法回源（丢失 key/base_url），直接挂起标记（保留预扣、不退款）
		_, chErr := model.GetChannelById(task.ChannelId, true)

		if isLegacy {
			// 旧系统遗留任务：不回源，直接挂起标记（沿用"不退款、联系管理员"原意）
			if flagTaskTimeoutUnresolved(ctx, task, "任务超时（旧系统遗留任务，未退款，请联系管理员核对）") {
				flaggedCount++
			}
			continue
		}
		if chErr != nil {
			if flagTaskTimeoutUnresolved(ctx, task, fmt.Sprintf("渠道 #%d 已删除，无法回源，待人工核对（未退款）", task.ChannelId)) {
				flaggedCount++
			}
			continue
		}

		// 阶段1：先回源解析（复用补录链路，CAS 保证计费恰好一次）
		_, err := RefetchAndSettleTask(ctx, task)
		// 回源后按 DB 实际状态分类（多节点安全）：已终态则结算/退款已由 ApplyUpstreamTaskResult 完成
		var reloaded model.Task
		reloadErr := model.DB.First(&reloaded, task.ID).Error
		if reloadErr == nil && (reloaded.Status == model.TaskStatusSuccess || reloaded.Status == model.TaskStatusFailure) {
			resolvedCount++
			continue
		}

		// 阶段2：未解析（上游不可达/404过期/仍在途/空状态/回源出错）→ 不退款、不标失败
		attempts := task.ResolveAttempts + 1
		lastErr := "上游未返回终态"
		if err != nil {
			lastErr = err.Error()
		} else if reloadErr != nil {
			lastErr = reloadErr.Error()
		}
		if len(lastErr) > 255 {
			lastErr = lastErr[:255]
		}

		// 阶段3：账龄超硬上限 → 挂起标记（保留预扣、不退款），停止自动轮询
		if capSec > 0 && task.SubmitTime > 0 && now-task.SubmitTime > capSec {
			task.ResolveAttempts = attempts
			task.LastResolveError = lastErr
			if flagTaskTimeoutUnresolved(ctx, task, fmt.Sprintf("超时回源 %d 次仍未解析，待人工核对（未退款）：%s", attempts, lastErr)) {
				flaggedCount++
			}
			continue
		}

		// 退避重试：仅更新元数据列（非计费、无需 CAS），下次到点再试
		if uerr := model.DB.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{
			"resolve_attempts":   attempts,
			"next_resolve_at":    now + resolveIntervalSec,
			"last_resolve_error": lastErr,
		}).Error; uerr != nil {
			logger.LogError(ctx, fmt.Sprintf("sweepTimedOutTasks: 更新回源退避元数据失败 task %s: %v", task.TaskID, uerr))
		} else {
			deferredCount++
		}
	}

	if resolvedCount+flaggedCount+deferredCount > 0 {
		logger.LogInfo(ctx, fmt.Sprintf("sweepTimedOutTasks: resolved=%d flagged=%d deferred=%d (of %d timed-out)",
			resolvedCount, flaggedCount, deferredCount, len(tasks)))
	}
}

// flagTaskTimeoutUnresolved 把超时且无法解析的任务 CAS 迁移到 TIMEOUT_UNRESOLVED 挂起态：
// 不退款、保留预扣估值、停止自动轮询，等待人工用"重新查询"按钮处理。
// 返回是否由本次调用完成迁移（CAS 失败说明已被其他进程推进，跳过）。
func flagTaskTimeoutUnresolved(ctx context.Context, task *model.Task, reason string) bool {
	oldStatus := task.Status
	task.Status = model.TaskStatusTimeoutUnresolved
	task.FailReason = reason
	won, err := task.UpdateWithStatus(oldStatus)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("sweepTimedOutTasks: 挂起标记 CAS 失败 task %s: %v", task.TaskID, err))
		return false
	}
	if !won {
		logger.LogInfo(ctx, fmt.Sprintf("sweepTimedOutTasks: task %s 已被其他进程推进，跳过挂起标记", task.TaskID))
		return false
	}
	logger.LogWarn(ctx, fmt.Sprintf("sweepTimedOutTasks: task %s 超时未解析，挂起待人工核对（未退款）：%s", task.TaskID, reason))
	return true
}

// TaskPollSummary is the result recorded on an async_task_poll system task row,
// summarizing one polling pass.
type TaskPollSummary struct {
	UnfinishedTasks  int `json:"unfinished_tasks"`
	PlatformsScanned int `json:"platforms_scanned"`
	NullTasksFailed  int `json:"null_tasks_failed"`
}

// RunTaskPollingOnce performs one async-task (Suno/video) polling pass
// synchronously. It honors ctx cancellation (the system-task runner cancels it
// when the lease is lost) and, when report is non-nil, reports progress as
// (processedPlatforms, totalPlatforms). It returns immediately if the task
// adaptor factory has not been wired yet, to avoid a nil call during startup.
func RunTaskPollingOnce(ctx context.Context, report func(processed, total int)) TaskPollSummary {
	summary := TaskPollSummary{}
	if GetTaskAdaptorFunc == nil {
		return summary
	}
	if ctx == nil {
		ctx = context.Background()
	}

	common.SysLog("任务进度轮询开始")
	sweepTimedOutTasks(ctx)
	allTasks := model.GetAllUnFinishSyncTasks(constant.TaskQueryLimit)
	summary.UnfinishedTasks = len(allTasks)
	platformTask := make(map[constant.TaskPlatform][]*model.Task)
	for _, t := range allTasks {
		platformTask[t.Platform] = append(platformTask[t.Platform], t)
	}

	totalPlatforms := len(platformTask)
	processedPlatforms := 0
	for platform, tasks := range platformTask {
		if ctx.Err() != nil {
			break
		}
		if report != nil {
			report(processedPlatforms, totalPlatforms)
		}
		processedPlatforms++
		if len(tasks) == 0 {
			continue
		}
		summary.PlatformsScanned++
		taskChannelM := make(map[int][]string)
		taskM := make(map[string]*model.Task)
		nullTaskIds := make([]int64, 0)
		for _, task := range tasks {
			upstreamID := task.GetUpstreamTaskID()
			if upstreamID == "" {
				// 统计失败的未完成任务
				nullTaskIds = append(nullTaskIds, task.ID)
				continue
			}
			taskM[upstreamID] = task
			taskChannelM[task.ChannelId] = append(taskChannelM[task.ChannelId], upstreamID)
		}
		if len(nullTaskIds) > 0 {
			summary.NullTasksFailed += len(nullTaskIds)
			err := model.TaskBulkUpdateByID(nullTaskIds, map[string]any{
				"status":   "FAILURE",
				"progress": "100%",
			})
			if err != nil {
				logger.LogError(ctx, fmt.Sprintf("Fix null task_id task error: %v", err))
			} else {
				logger.LogInfo(ctx, fmt.Sprintf("Fix null task_id task success: %v", nullTaskIds))
			}
		}
		if len(taskChannelM) == 0 {
			continue
		}

		DispatchPlatformUpdate(ctx, platform, taskChannelM, taskM)
	}
	if report != nil && ctx.Err() == nil {
		report(totalPlatforms, totalPlatforms)
	}
	common.SysLog("任务进度轮询完成")
	return summary
}

// DispatchPlatformUpdate 按平台分发轮询更新
func DispatchPlatformUpdate(ctx context.Context, platform constant.TaskPlatform, taskChannelM map[int][]string, taskM map[string]*model.Task) {
	if ctx == nil {
		ctx = context.Background()
	}
	switch platform {
	case constant.TaskPlatformMidjourney:
		// MJ 轮询由其自身处理，这里预留入口
	case constant.TaskPlatformSuno:
		_ = UpdateSunoTasks(ctx, taskChannelM, taskM)
	default:
		if err := UpdateVideoTasks(ctx, platform, taskChannelM, taskM); err != nil {
			common.SysLog(fmt.Sprintf("UpdateVideoTasks fail: %s", err))
		}
	}
}

// UpdateSunoTasks 按渠道更新所有 Suno 任务
func UpdateSunoTasks(ctx context.Context, taskChannelM map[int][]string, taskM map[string]*model.Task) error {
	for channelId, taskIds := range taskChannelM {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		err := updateSunoTasks(ctx, channelId, taskIds, taskM)
		if err != nil {
			logger.LogError(ctx, fmt.Sprintf("渠道 #%d 更新异步任务失败: %s", channelId, err.Error()))
		}
	}
	return nil
}

func updateSunoTasks(ctx context.Context, channelId int, taskIds []string, taskM map[string]*model.Task) error {
	logger.LogInfo(ctx, fmt.Sprintf("渠道 #%d 未完成的任务有: %d", channelId, len(taskIds)))
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if len(taskIds) == 0 {
		return nil
	}
	ch, err := model.CacheGetChannel(channelId)
	if err != nil {
		// D1 回退：缓存未命中时按主键直读，禁用渠道也能取到凭证继续回源
		ch, err = model.GetChannelById(channelId, true)
	}
	if err != nil {
		// D2：渠道确已删除，无法回源。挂起标记 TIMEOUT_UNRESOLVED（保留预扣、不退款），
		// 不再"标 FAILURE 且不退款"。
		common.SysLog(fmt.Sprintf("channel %d not found (deleted): %v", channelId, err))
		var flagIDs []int64
		for _, upstreamID := range taskIds {
			if t, ok := taskM[upstreamID]; ok {
				flagIDs = append(flagIDs, t.ID)
			}
		}
		if errUpdate := model.TaskBulkUpdateByID(flagIDs, map[string]any{
			"status":      model.TaskStatusTimeoutUnresolved,
			"fail_reason": fmt.Sprintf("渠道 #%d 已删除，无法回源，待人工核对（未退款）", channelId),
		}); errUpdate != nil {
			common.SysLog(fmt.Sprintf("UpdateSunoTask flag unresolved error: %v", errUpdate))
		}
		return err
	}
	adaptor := GetTaskAdaptorFunc(constant.TaskPlatformSuno)
	if adaptor == nil {
		return errors.New("adaptor not found")
	}
	proxy := ch.GetSetting().Proxy
	resp, err := adaptor.FetchTask(*ch.BaseURL, ch.Key, map[string]any{
		"ids": taskIds,
	}, proxy)
	if err != nil {
		common.SysLog(fmt.Sprintf("Get Task Do req error: %v", err))
		return err
	}
	if resp.StatusCode != http.StatusOK {
		logger.LogError(ctx, fmt.Sprintf("Get Task status code: %d", resp.StatusCode))
		return fmt.Errorf("Get Task status code: %d", resp.StatusCode)
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		common.SysLog(fmt.Sprintf("Get Suno Task parse body error: %v", err))
		return err
	}
	var responseItems dto.TaskResponse[[]dto.SunoDataResponse]
	err = common.Unmarshal(responseBody, &responseItems)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("Get Suno Task parse body error2: %v, body: %s", err, string(responseBody)))
		return err
	}
	if !responseItems.IsSuccess() {
		common.SysLog(fmt.Sprintf("渠道 #%d 未完成的任务有: %d, 成功获取到任务数: %s", channelId, len(taskIds), string(responseBody)))
		return err
	}

	for _, responseItem := range responseItems.Data {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		task := taskM[responseItem.TaskID]
		if task == nil {
			logger.LogWarn(ctx, fmt.Sprintf("Suno task response ignored: unknown task_id=%s", responseItem.TaskID))
			continue
		}
		if !taskNeedsUpdate(task, responseItem) {
			continue
		}

		task.Status = lo.If(model.TaskStatus(responseItem.Status) != "", model.TaskStatus(responseItem.Status)).Else(task.Status)
		task.FailReason = lo.If(responseItem.FailReason != "", responseItem.FailReason).Else(task.FailReason)
		task.SubmitTime = lo.If(responseItem.SubmitTime != 0, responseItem.SubmitTime).Else(task.SubmitTime)
		task.StartTime = lo.If(responseItem.StartTime != 0, responseItem.StartTime).Else(task.StartTime)
		task.FinishTime = lo.If(responseItem.FinishTime != 0, responseItem.FinishTime).Else(task.FinishTime)
		if responseItem.FailReason != "" || task.Status == model.TaskStatusFailure {
			logger.LogInfo(ctx, task.TaskID+" 构建失败，"+task.FailReason)
			task.Progress = "100%"
			RefundTaskQuota(ctx, task, task.FailReason)
		}
		if responseItem.Status == model.TaskStatusSuccess {
			task.Progress = "100%"
		}
		task.Data = responseItem.Data

		err = task.Update()
		if err != nil {
			common.SysLog("UpdateSunoTask task error: " + err.Error())
		}
	}
	return nil
}

// taskNeedsUpdate 检查 Suno 任务是否需要更新
func taskNeedsUpdate(oldTask *model.Task, newTask dto.SunoDataResponse) bool {
	if oldTask.SubmitTime != newTask.SubmitTime {
		return true
	}
	if oldTask.StartTime != newTask.StartTime {
		return true
	}
	if oldTask.FinishTime != newTask.FinishTime {
		return true
	}
	if string(oldTask.Status) != newTask.Status {
		return true
	}
	if oldTask.FailReason != newTask.FailReason {
		return true
	}

	if (oldTask.Status == model.TaskStatusFailure || oldTask.Status == model.TaskStatusSuccess) && oldTask.Progress != "100%" {
		return true
	}

	oldData, _ := common.Marshal(oldTask.Data)
	newData, _ := common.Marshal(newTask.Data)

	sort.Slice(oldData, func(i, j int) bool {
		return oldData[i] < oldData[j]
	})
	sort.Slice(newData, func(i, j int) bool {
		return newData[i] < newData[j]
	})

	if string(oldData) != string(newData) {
		return true
	}
	return false
}

// UpdateVideoTasks 按渠道更新所有视频任务
func UpdateVideoTasks(ctx context.Context, platform constant.TaskPlatform, taskChannelM map[int][]string, taskM map[string]*model.Task) error {
	channelIDs := make([]int, 0, len(taskChannelM))
	for channelID := range taskChannelM {
		channelIDs = append(channelIDs, channelID)
	}
	sort.Ints(channelIDs)

	var wg sync.WaitGroup
	for _, channelId := range channelIDs {
		taskIds := taskChannelM[channelId]
		if len(taskIds) == 0 {
			continue
		}
		taskIds = append([]string(nil), taskIds...)

		wg.Add(1)
		gopool.Go(func() {
			defer wg.Done()
			if err := updateVideoTasks(ctx, platform, channelId, taskIds, taskM); err != nil {
				logger.LogError(ctx, fmt.Sprintf("Channel #%d failed to update video async tasks: %s", channelId, err.Error()))
			}
		})
	}
	wg.Wait()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return nil
}

func updateVideoTasks(ctx context.Context, platform constant.TaskPlatform, channelId int, taskIds []string, taskM map[string]*model.Task) error {
	logger.LogInfo(ctx, fmt.Sprintf("Channel #%d pending video tasks: %d", channelId, len(taskIds)))
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if len(taskIds) == 0 {
		return nil
	}
	cacheGetChannel, err := model.CacheGetChannel(channelId)
	if err != nil {
		// D1 回退：缓存未命中（如缓存尚未同步）时按主键直读，禁用渠道也能取到凭证继续回源
		cacheGetChannel, err = model.GetChannelById(channelId, true)
	}
	if err != nil {
		// D2：渠道确已删除，物理上无法回源。不再"标 FAILURE 且不退款"（最糟组合：用户被扣、
		// 任务显示失败、又没查过上游），改为挂起标记 TIMEOUT_UNRESOLVED：保留预扣、不退款、
		// 停止自动轮询，待人工核对。
		var flagIDs []int64
		for _, upstreamID := range taskIds {
			if t, ok := taskM[upstreamID]; ok {
				flagIDs = append(flagIDs, t.ID)
			}
		}
		if errUpdate := model.TaskBulkUpdateByID(flagIDs, map[string]any{
			"status":      model.TaskStatusTimeoutUnresolved,
			"fail_reason": fmt.Sprintf("渠道 #%d 已删除，无法回源，待人工核对（未退款）", channelId),
		}); errUpdate != nil {
			common.SysLog(fmt.Sprintf("UpdateVideoTask flag unresolved error: %v", errUpdate))
		}
		return fmt.Errorf("channel %d not found (deleted): %w", channelId, err)
	}
	adaptor := GetTaskAdaptorFunc(platform)
	if adaptor == nil {
		return fmt.Errorf("video adaptor not found")
	}
	info := &relaycommon.RelayInfo{}
	info.ChannelMeta = &relaycommon.ChannelMeta{
		ChannelBaseUrl: cacheGetChannel.GetBaseURL(),
	}
	info.ApiKey = cacheGetChannel.Key
	adaptor.Init(info)
	disablePollingSleep := cacheGetChannel.GetOtherSettings().DisableTaskPollingSleep
	for i, taskId := range taskIds {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := updateVideoSingleTask(ctx, adaptor, cacheGetChannel, taskId, taskM); err != nil {
			logger.LogError(ctx, fmt.Sprintf("Failed to update video task %s: %s", taskId, err.Error()))
		}
		if disablePollingSleep || i == len(taskIds)-1 {
			continue
		}

		// sleep 1 second between tasks for this channel only.
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(1 * time.Second):
		}
	}
	return nil
}

// RefetchAndSettleTask 供管理员手动补录：对单个任务重新回源上游并结算。
// 组装与后台轮询相同的 adaptor/渠道上下文后复用 updateVideoSingleTask，
// 计费恰好一次由 ApplyUpstreamTaskResult 的 CAS 保证；对已终态任务同样适用
// （用于找回被超时清扫丢弃的上游成功结果）。
func RefetchAndSettleTask(ctx context.Context, task *model.Task) (string, error) {
	if task == nil {
		return "", errors.New("task is nil")
	}
	if GetTaskAdaptorFunc == nil {
		return "", errors.New("task adaptor not initialized")
	}
	adaptor := GetTaskAdaptorFunc(task.Platform)
	if adaptor == nil {
		return "", fmt.Errorf("no adaptor for platform %s", task.Platform)
	}
	ch, err := model.GetChannelById(task.ChannelId, true)
	if err != nil {
		return "", fmt.Errorf("load channel %d: %w", task.ChannelId, err)
	}
	upstreamID := task.GetUpstreamTaskID()
	if upstreamID == "" {
		return "", errors.New("task has no upstream id")
	}
	beforeStatus := task.Status
	beforeQuota := task.Quota
	if err := updateVideoSingleTask(ctx, adaptor, ch, upstreamID, map[string]*model.Task{upstreamID: task}); err != nil {
		return "", err
	}
	latest, exist, err := model.GetByOnlyTaskId(task.TaskID)
	if err != nil || !exist || latest == nil {
		latest = task
	}
	switch {
	case latest.Status == model.TaskStatusFailure && beforeStatus != model.TaskStatusFailure:
		return "refunded", nil
	case beforeStatus == model.TaskStatusSuccess && latest.Status == model.TaskStatusSuccess:
		return "already_settled", nil
	case latest.Status == model.TaskStatusSuccess && latest.Quota != beforeQuota:
		return "settled_adjusted", nil
	case latest.Status == model.TaskStatusSuccess:
		return "settled_exact", nil
	case latest.Status == beforeStatus:
		return "no_terminal", nil
	default:
		return "status_changed", nil
	}
}

func updateVideoSingleTask(ctx context.Context, adaptor TaskPollingAdaptor, ch *model.Channel, taskId string, taskM map[string]*model.Task) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	baseURL := constant.ChannelBaseURLs[ch.Type]
	if ch.GetBaseURL() != "" {
		baseURL = ch.GetBaseURL()
	}
	proxy := ch.GetSetting().Proxy

	task := taskM[taskId]
	if task == nil {
		logger.LogError(ctx, fmt.Sprintf("Task %s not found in taskM", taskId))
		return fmt.Errorf("task %s not found", taskId)
	}
	key := ch.Key

	privateData := task.PrivateData
	if privateData.Key != "" {
		key = privateData.Key
	}
	resp, err := adaptor.FetchTask(baseURL, key, map[string]any{
		"task_id": task.GetUpstreamTaskID(),
		"action":  task.Action,
	}, proxy)
	if err != nil {
		return fmt.Errorf("fetchTask failed for task %s: %w", taskId, err)
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("readAll failed for task %s: %w", taskId, err)
	}

	// 上游明确返回 404/410（记录不存在/已过期）：无法判定任务真实成败，按"未解析"处理——
	// 不进入 ApplyUpstreamTaskResult（避免空状态被误判为 FAILURE 并退款），交由超时回源
	// 退避重试，最终挂起标记待人工核对。
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone {
		return fmt.Errorf("upstream task record not found (HTTP %d) for task %s", resp.StatusCode, taskId)
	}

	logger.LogDebugJSON(ctx, "updateVideoSingleTask response: %s", responseBody)

	// 按用户 token 费率缩放上游响应中的 usage token 数（仅「按 seedance 计费」的
	// 任务会被改写，其余原样返回）；必须在 ParseTaskResult / ApplyUpstreamTaskResult
	// 之前执行，使计费结算、task.Data 快照与客户端可见 JSON 自动跟随缩放后的值。
	responseBody = ScaleSeedanceTaskUsageByUserRate(responseBody, task, "[TaskPolling]")

	taskResult := &relaycommon.TaskInfo{}
	// try parse as New API response format
	var responseItems dto.TaskResponse[model.Task]
	if err = common.Unmarshal(responseBody, &responseItems); err == nil && responseItems.IsSuccess() {
		logger.LogDebug(ctx, "updateVideoSingleTask parsed as new api response format: %+v", responseItems)
		t := responseItems.Data
		taskResult.TaskID = t.TaskID
		taskResult.Status = string(t.Status)
		taskResult.Url = t.GetResultURL()
		taskResult.Progress = t.Progress
		taskResult.Reason = t.FailReason
		taskResult.FinishTime = t.FinishTime
	} else if taskResult, err = adaptor.ParseTaskResult(responseBody); err != nil {
		return fmt.Errorf("parseTaskResult failed for task %s: %w", taskId, err)
	}

	logger.LogDebug(ctx, "updateVideoSingleTask taskResult: %+v", taskResult)

	return ApplyUpstreamTaskResult(ctx, adaptor, task, taskResult, responseBody)
}

// ApplyUpstreamTaskResult 把上游查询结果 taskResult 写回本地任务并做 CAS 状态迁移，
// 进入终态时执行计费处理（成功 → 差额结算，失败 → 全额退款）。
// 后台轮询与客户端实时查询旁路（relay 的 arkNativePassthroughFetch / tryRealtimeFetch）
// 共用本函数：任务一旦进入终态就不再被 GetAllUnFinishSyncTasks 捞起，谁先把任务
// 推进到终态谁负责结算，另一方 CAS 失败即跳过，保证计费恰好执行一次。
// responseBody 为上游原始查询响应，用于 task.Data 快照与空状态错误探测。
func ApplyUpstreamTaskResult(ctx context.Context, adaptor TaskPollingAdaptor, task *model.Task, taskResult *relaycommon.TaskInfo, responseBody []byte) error {
	snap := task.Snapshot()
	task.Data = redactVideoResponseBody(responseBody)

	now := time.Now().Unix()
	// 完成时间优先采用上游报告的终态时刻（漏结算任务被很久后的查询补结算时，
	// 本地检测时刻会严重偏离真实完成时间）；拒绝异常时钟（未来时间/早于提交
	// 时间）并回退到本地检测时刻。
	finishAt := now
	if ts := taskResult.FinishTime; ts > 0 && ts <= now && ts >= task.SubmitTime {
		finishAt = ts
	}
	if taskResult.Status == "" {
		//taskResult = relaycommon.FailTaskInfo("upstream returned empty status")
		errorResult := &dto.GeneralErrorResponse{}
		if err := common.Unmarshal(responseBody, &errorResult); err == nil {
			openaiError := errorResult.TryToOpenAIError()
			if openaiError != nil {
				// 返回规范的 OpenAI 错误格式，提取错误信息，判断错误是否为任务失败
				if openaiError.Code == "429" {
					// 429 错误通常表示请求过多或速率限制，暂时不认为是任务失败，保持原状态等待下一轮轮询
					return nil
				}

				// 其他错误认为是任务失败，记录错误信息并更新任务状态
				taskResult = relaycommon.FailTaskInfo("upstream returned error")
			} else {
				// unknown error format, log original response
				logger.LogError(ctx, fmt.Sprintf("Task %s returned empty status with unrecognized error format, response: %s", task.TaskID, string(responseBody)))
				taskResult = relaycommon.FailTaskInfo("upstream returned unrecognized message")
			}
		}
	}

	shouldRefund := false
	shouldSettle := false
	quota := task.Quota

	task.Status = model.TaskStatus(taskResult.Status)
	switch taskResult.Status {
	case model.TaskStatusSubmitted:
		task.Progress = taskcommon.ProgressSubmitted
	case model.TaskStatusQueued:
		task.Progress = taskcommon.ProgressQueued
	case model.TaskStatusInProgress:
		task.Progress = taskcommon.ProgressInProgress
		if task.StartTime == 0 {
			task.StartTime = now
		}
	case model.TaskStatusSuccess:
		task.Progress = taskcommon.ProgressComplete
		if task.FinishTime == 0 {
			task.FinishTime = finishAt
		}
		if strings.HasPrefix(taskResult.Url, "data:") {
			// data: URI (e.g. Vertex base64 encoded video) — keep in Data, not in ResultURL
			task.PrivateData.ResultURL = taskcommon.BuildProxyURL(task.TaskID)
		} else if taskResult.Url != "" {
			// Direct upstream URL (e.g. Kling, Ali, Doubao, etc.)
			task.PrivateData.ResultURL = taskResult.Url
		} else {
			// No URL from adaptor — construct proxy URL using public task ID
			task.PrivateData.ResultURL = taskcommon.BuildProxyURL(task.TaskID)
		}
		shouldSettle = true
	case model.TaskStatusFailure:
		logger.LogJson(ctx, fmt.Sprintf("Task %s failed", task.TaskID), task)
		task.Status = model.TaskStatusFailure
		task.Progress = taskcommon.ProgressComplete
		if task.FinishTime == 0 {
			task.FinishTime = finishAt
		}
		task.FailReason = taskResult.Reason
		logger.LogInfo(ctx, fmt.Sprintf("Task %s failed: %s", task.TaskID, task.FailReason))
		taskResult.Progress = taskcommon.ProgressComplete
		if quota != 0 {
			shouldRefund = true
		}
	default:
		return fmt.Errorf("unknown task status %s for task %s", taskResult.Status, task.TaskID)
	}
	if taskResult.Progress != "" {
		task.Progress = taskResult.Progress
	}

	// 幂等防回退：已成功结算（SUCCESS）的任务是计费终态。后续重放（重复补录、实时
	// 旁路、上游记录过期/查询报错被解析为 FAILURE）不得把它改判 FAILURE 触发全额
	// 退款，否则会产生错误退款数据。SUCCESS→SUCCESS 的漏结算补偿不受影响，仍走
	// RecalculateTaskQuota 的 delta=0 幂等路径（重复应用不产生第二笔日志/资金变动）。
	if snap.Status == model.TaskStatusSuccess && task.Status == model.TaskStatusFailure {
		logger.LogWarn(ctx, fmt.Sprintf("Task %s already settled as SUCCESS, ignore regression to FAILURE", task.TaskID))
		return nil
	}

	isDone := task.Status == model.TaskStatusSuccess || task.Status == model.TaskStatusFailure
	if isDone && snap.Status != task.Status {
		won, err := task.UpdateWithStatus(snap.Status)
		if err != nil {
			logger.LogError(ctx, fmt.Sprintf("UpdateWithStatus failed for task %s: %s", task.TaskID, err.Error()))
			shouldRefund = false
			shouldSettle = false
		} else if !won {
			logger.LogWarn(ctx, fmt.Sprintf("Task %s already transitioned by another process, skip billing", task.TaskID))
			shouldRefund = false
			shouldSettle = false
		}
	} else if !snap.Equal(task.Snapshot()) {
		if _, err := task.UpdateWithStatus(snap.Status); err != nil {
			logger.LogError(ctx, fmt.Sprintf("Failed to update task %s: %s", task.TaskID, err.Error()))
		}
	} else {
		// No changes, skip update
		logger.LogDebug(ctx, "No update needed for task %s", task.TaskID)
	}

	if shouldSettle {
		settleTaskBillingOnComplete(ctx, adaptor, task, taskResult)
	}
	if shouldRefund {
		RefundTaskQuota(ctx, task, task.FailReason)
	}

	return nil
}

func redactVideoResponseBody(body []byte) []byte {
	var m map[string]any
	if err := common.Unmarshal(body, &m); err != nil {
		return body
	}
	resp, _ := m["response"].(map[string]any)
	if resp != nil {
		delete(resp, "bytesBase64Encoded")
		if v, ok := resp["video"].(string); ok {
			resp["video"] = truncateBase64(v)
		}
		if vs, ok := resp["videos"].([]any); ok {
			for i := range vs {
				if vm, ok := vs[i].(map[string]any); ok {
					delete(vm, "bytesBase64Encoded")
				}
			}
		}
	}
	b, err := common.Marshal(m)
	if err != nil {
		return body
	}
	return b
}

func truncateBase64(s string) string {
	const maxKeep = 256
	if len(s) <= maxKeep {
		return s
	}
	return s[:maxKeep] + "..."
}

// splitTaskUsageTokens 把上游任务用量拆成 prompt/completion 用于日志展示：
// 上游只给 total（如方舟视频 completion=total）时全部按 completion 记录；
// 给了 completion 时 prompt = total - completion（负值兜底为 0）。
func splitTaskUsageTokens(taskResult *relaycommon.TaskInfo) (promptTokens, completionTokens int) {
	if taskResult == nil || taskResult.TotalTokens <= 0 {
		return 0, 0
	}
	completionTokens = taskResult.CompletionTokens
	if completionTokens <= 0 || completionTokens > taskResult.TotalTokens {
		return 0, taskResult.TotalTokens
	}
	return taskResult.TotalTokens - completionTokens, completionTokens
}

// settleTaskBillingOnComplete 任务完成时的统一计费调整。
// 优先级：1. adaptor.AdjustBillingOnComplete 返回正数 → 使用 adaptor 计算的额度
//
//  2. taskResult.TotalTokens > 0 → 按 token 重算
//  3. 都不满足 → 保持预扣额度不变
func settleTaskBillingOnComplete(ctx context.Context, adaptor TaskPollingAdaptor, task *model.Task, taskResult *relaycommon.TaskInfo) {
	// 0. 按次计费的任务不做差额结算
	if bc := task.PrivateData.BillingContext; bc != nil && bc.PerCallBilling {
		logger.LogInfo(ctx, fmt.Sprintf("任务 %s 按次计费，跳过差额结算", task.TaskID))
		return
	}
	// 0.5 回填预扣消费日志的真实 tokens/耗时：差额为 0（预扣准确）时
	// RecalculateTaskQuota 不写差额行，tokens 会完全丢失；差额非 0 时原预扣行
	// 也仍是 0。统一在此补展示字段（不改资金），使日志页原行反映真实消耗。
	backfillPreConsumeLogUsage(ctx, task, taskResult)
	// 1. 优先让 adaptor 决定最终额度
	if actualQuota := adaptor.AdjustBillingOnComplete(task, taskResult); actualQuota > 0 {
		promptTokens, completionTokens := splitTaskUsageTokens(taskResult)
		RecalculateTaskQuota(ctx, task, actualQuota, "adaptor计费调整", promptTokens, completionTokens)
		return
	}
	// 2. 回退到 token 重算
	if taskResult.TotalTokens > 0 {
		RecalculateTaskQuotaByTokens(ctx, task, taskResult.TotalTokens)
		return
	}
	// 3. 无调整，保持预扣额度
}

// backfillPreConsumeLogUsage 把上游终态的真实 tokens 与耗时回填到提交时的预扣
// 消费日志行，仅补展示字段。耗时优先采用上游终态时刻与提交时刻之差。
func backfillPreConsumeLogUsage(ctx context.Context, task *model.Task, taskResult *relaycommon.TaskInfo) {
	promptTokens, completionTokens := splitTaskUsageTokens(taskResult)
	now := time.Now().Unix()
	finishAt := now
	if ts := taskResult.FinishTime; ts > 0 && ts <= now && ts >= task.SubmitTime {
		finishAt = ts
	}
	useTime := int(finishAt - task.SubmitTime)
	if useTime < 0 {
		useTime = 0
	}
	if promptTokens+completionTokens <= 0 && useTime <= 0 {
		return
	}
	n, err := model.UpdateTaskConsumeLogUsage(task.TaskID, promptTokens, completionTokens, useTime)
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("回填预扣消费日志失败 task %s: %s", task.TaskID, err.Error()))
		return
	}
	if n > 0 {
		logger.LogInfo(ctx, fmt.Sprintf("任务 %s 回填预扣消费日志 tokens=%d+%d 耗时=%ds", task.TaskID, promptTokens, completionTokens, useTime))
	}
}
