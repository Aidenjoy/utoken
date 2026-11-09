package controller

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

var arkTaskStatusFilters = map[string][]model.TaskStatus{
	"queued":    {model.TaskStatusNotStart, model.TaskStatusSubmitted, model.TaskStatusQueued},
	"running":   {model.TaskStatusInProgress, model.TaskStatusUnknown},
	"cancelled": {model.TaskStatusCancelled},
	"succeeded": {model.TaskStatusSuccess},
	"failed":    {model.TaskStatusFailure},
	"expired":   {model.TaskStatusTimeoutUnresolved},
}

// ArkVideoTaskList 从本站任务记录构造官方列表，不能透传共享上游账号的全量任务，
// 否则会跨用户泄露任务与结果地址。过滤和 Key 权限全部完成后再计算 total 与分页。
func ArkVideoTaskList(c *gin.Context) {
	startTime := time.Now()
	// 协议快照：本入口不经 Relay()，需单独旁路捕获请求/响应，与审计行同 request_id 关联。
	requestId := c.GetString(common.RequestIdKey)
	bw := newRelayBodyWriter(c)
	defer func() { saveApiCallBodySnapshot(c, requestId, true, bw) }()
	// 查询类接口（客户端高频轮询）：审计日志受 LogQueryApiCallEnabled 开关门控。
	defer func() {
		model.RecordApiCallLog(c, c.GetInt("id"), model.RecordApiCallLogParams{
			ModelName:      "ListVideoTasks",
			Content:        fmt.Sprintf("查询视频任务列表，状态码 %d", c.Writer.Status()),
			TokenName:      c.GetString("token_name"),
			TokenId:        c.GetInt("token_id"),
			UseTimeSeconds: int(time.Since(startTime).Seconds()),
			IsQuery:        true,
			Other: map[string]interface{}{
				"api":         "video_task",
				"action":      "ListVideoTasks",
				"http_status": c.Writer.Status(),
			},
		})
	}()
	pageNum, err := arkTaskPageParam(c, "page_num", 1)
	if err != nil {
		respondTaskError(c, service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest))
		return
	}
	pageSize, err := arkTaskPageParam(c, "page_size", 20)
	if err != nil {
		respondTaskError(c, service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest))
		return
	}

	statusFilter := strings.TrimSpace(c.Query("filter.status"))
	statuses, ok := arkTaskStatusFilters[statusFilter]
	if statusFilter != "" && !ok {
		respondTaskError(c, service.TaskErrorWrapperLocal(fmt.Errorf("unsupported filter.status: %s", statusFilter), "invalid_request", http.StatusBadRequest))
		return
	}
	serviceTier := strings.TrimSpace(c.Query("filter.service_tier"))
	if serviceTier == "" {
		serviceTier = "default"
	}
	if serviceTier != "default" && serviceTier != "flex" {
		respondTaskError(c, service.TaskErrorWrapperLocal(fmt.Errorf("unsupported filter.service_tier: %s", serviceTier), "invalid_request", http.StatusBadRequest))
		return
	}
	modelFilter := strings.TrimSpace(c.Query("filter.model"))
	if modelFilter != "" && !arkTaskModelAllowed(c, modelFilter) {
		respondTaskError(c, service.TaskErrorWrapperLocal(errors.New("no access to model: "+modelFilter), "model_forbidden", http.StatusForbidden))
		return
	}

	taskIDs := c.QueryArray("filter.task_ids")
	for i := range taskIDs {
		taskIDs[i] = strings.TrimSpace(taskIDs[i])
	}
	tasks, err := model.ListArkTasks(c.GetInt("id"), taskIDs, statuses)
	if err != nil {
		respondTaskError(c, service.TaskErrorWrapper(err, "get_tasks_failed", http.StatusInternalServerError))
		return
	}

	filtered := make([]map[string]any, 0, len(tasks))
	for _, task := range tasks {
		if task.IsDeleted() {
			continue
		}
		item := task.ToArkTask()
		itemModel, _ := item["model"].(string)
		if modelFilter != "" && itemModel != modelFilter {
			continue
		}
		if !arkTaskModelAllowed(c, itemModel) {
			continue
		}
		itemTier, _ := item["service_tier"].(string)
		if itemTier == "" {
			itemTier = "default"
		}
		if itemTier != serviceTier {
			continue
		}
		filtered = append(filtered, item)
	}

	start := (pageNum - 1) * pageSize
	end := start + pageSize
	if start > len(filtered) {
		start = len(filtered)
	}
	if end > len(filtered) {
		end = len(filtered)
	}
	items := filtered[start:end]
	if items == nil {
		items = make([]map[string]any, 0)
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": len(filtered)})
}

func arkTaskPageParam(c *gin.Context, name string, defaultValue int) (int, error) {
	raw := strings.TrimSpace(c.Query(name))
	if raw == "" {
		return defaultValue, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 || value > 500 {
		return 0, fmt.Errorf("%s must be an integer between 1 and 500", name)
	}
	return value, nil
}

// arkTaskModelAllowed 同时应用代理商白名单与当前 Key 的模型限制。绑定渠道的
// 视频 Key 会跳过自动选路，因此列表和删除必须在公开 API 层再次执行这一判定。
func arkTaskModelAllowed(c *gin.Context, modelName string) bool {
	agentID := common.GetContextKeyInt(c, constant.ContextKeyUserAgentId)
	if agentID > 0 {
		allowed := model.ResolveAllowedModels(agentID, common.GetContextKeyString(c, constant.ContextKeyUserAllowedModels))
		if len(allowed) > 0 && !allowed.Allows(modelName) {
			return false
		}
	}
	if !common.GetContextKeyBool(c, constant.ContextKeyTokenModelLimitEnabled) {
		return true
	}
	if modelName == "" {
		return false
	}
	value, ok := common.GetContextKey(c, constant.ContextKeyTokenModelLimit)
	if !ok {
		return false
	}
	limits, ok := value.(map[string]bool)
	if !ok {
		return false
	}
	if _, ok = limits[modelName]; ok {
		return true
	}
	_, ok = limits[ratio_setting.FormatMatchingModelName(modelName)]
	return ok
}

// ArkVideoTaskDelete 对齐官方语义：排队任务取消，终态任务删除记录，运行中拒绝。
// 上游成功后才改变本地状态，避免上游失败却提前退款或隐藏任务。
func ArkVideoTaskDelete(c *gin.Context) {
	taskID := strings.TrimSpace(c.Param("task_id"))
	startTime := time.Now()
	// 协议快照：本入口不经 Relay()，需单独旁路捕获请求/响应，与审计行同 request_id 关联。
	requestId := c.GetString(common.RequestIdKey)
	bw := newRelayBodyWriter(c)
	defer func() { saveApiCallBodySnapshot(c, requestId, false, bw) }()
	// 写类接口：取消/删除始终记录审计日志，不受查询开关影响。
	defer func() {
		model.RecordApiCallLog(c, c.GetInt("id"), model.RecordApiCallLogParams{
			ModelName:      "DeleteVideoTask",
			Content:        fmt.Sprintf("取消/删除视频任务 %s，状态码 %d", taskID, c.Writer.Status()),
			TokenName:      c.GetString("token_name"),
			TokenId:        c.GetInt("token_id"),
			UseTimeSeconds: int(time.Since(startTime).Seconds()),
			Other: map[string]interface{}{
				"api":         "video_task",
				"action":      "DeleteVideoTask",
				"task_id":     taskID,
				"http_status": c.Writer.Status(),
			},
		})
	}()
	if taskID == "" {
		respondTaskError(c, service.TaskErrorWrapperLocal(errors.New("task_id is required"), "invalid_request", http.StatusBadRequest))
		return
	}
	task, exist, err := model.GetByTaskId(c.GetInt("id"), taskID)
	if err != nil {
		respondTaskError(c, service.TaskErrorWrapper(err, "get_task_failed", http.StatusInternalServerError))
		return
	}
	if !exist || task.IsDeleted() {
		message := fmt.Sprintf("The specified resource `%s` is not found.", taskID)
		respondTaskError(c, service.TaskErrorWrapperLocal(errors.New(message), "ResourceNotFound", http.StatusNotFound))
		return
	}
	if !arkTaskModelAllowed(c, task.Properties.OriginModelName) {
		respondTaskError(c, service.TaskErrorWrapperLocal(errors.New("no access to model: "+task.Properties.OriginModelName), "model_forbidden", http.StatusForbidden))
		return
	}

	cancelQueued := false
	switch task.Status {
	case model.TaskStatusNotStart, model.TaskStatusSubmitted, model.TaskStatusQueued:
		cancelQueued = true
	case model.TaskStatusSuccess, model.TaskStatusFailure, model.TaskStatusCancelled, model.TaskStatusTimeoutUnresolved:
	default:
		message := fmt.Sprintf("Cannot delete task `%s` because it is currently running.", taskID)
		respondTaskError(c, service.TaskErrorWrapperLocal(errors.New(message), "InvalidAction.RunningTaskDeletion", http.StatusConflict))
		return
	}

	channelModel, err := model.GetChannelById(task.ChannelId, true)
	if err != nil {
		respondTaskError(c, service.TaskErrorWrapper(err, "channel_not_found", http.StatusBadGateway))
		return
	}
	adaptor := relay.GetTaskAdaptor(task.Platform)
	if adaptor == nil {
		respondTaskError(c, service.TaskErrorWrapperLocal(errors.New("task platform is not supported"), "invalid_api_platform", http.StatusBadRequest))
		return
	}
	deleter, ok := adaptor.(channel.TaskDeleteAdaptor)
	if !ok {
		respondTaskError(c, service.TaskErrorWrapperLocal(errors.New("task platform does not support delete"), "not_implemented", http.StatusNotImplemented))
		return
	}
	baseURL := channelModel.GetBaseURL()
	if baseURL == "" {
		baseURL = constant.ChannelBaseURLs[channelModel.Type]
	}
	resp, err := deleter.DeleteTask(baseURL, channelModel.Key, task.GetUpstreamTaskID(), channelModel.GetSetting().Proxy)
	if err != nil {
		respondTaskError(c, service.TaskErrorWrapper(err, "delete_upstream_task_failed", http.StatusBadGateway))
		return
	}
	if resp == nil {
		respondTaskError(c, service.TaskErrorWrapperLocal(errors.New("upstream returned empty response"), "delete_upstream_task_failed", http.StatusBadGateway))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		body, readErr := io.ReadAll(resp.Body)
		if readErr == nil && len(body) > 0 {
			c.Data(resp.StatusCode, "application/json", body)
			return
		}
		respondTaskError(c, service.TaskErrorWrapperLocal(fmt.Errorf("upstream returned status %d", resp.StatusCode), "upstream_error", resp.StatusCode))
		return
	}

	if cancelQueued {
		status, cancelErr := service.CancelVideoTask(c.Request.Context(), task)
		if cancelErr != nil {
			respondTaskError(c, service.TaskErrorWrapper(cancelErr, "cancel_task_failed", http.StatusInternalServerError))
			return
		}
		if status != model.TaskStatusCancelled {
			respondTaskError(c, service.TaskErrorWrapperLocal(fmt.Errorf("task status changed to %s before local cancellation", status), "task_status_changed", http.StatusConflict))
			return
		}
	} else if err := task.MarkDeleted(); err != nil {
		respondTaskError(c, service.TaskErrorWrapper(err, "delete_task_failed", http.StatusInternalServerError))
		return
	}
	c.JSON(http.StatusOK, gin.H{})
}
