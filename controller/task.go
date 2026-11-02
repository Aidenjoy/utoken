package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

func GetAllTask(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)

	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	// 解析其他查询参数
	queryParams := model.SyncTaskQueryParams{
		Platform:       constant.TaskPlatform(c.Query("platform")),
		TaskID:         c.Query("task_id"),
		Status:         c.Query("status"),
		Action:         c.Query("action"),
		StartTimestamp: startTimestamp,
		EndTimestamp:   endTimestamp,
		ChannelID:      c.Query("channel_id"),
		Username:       c.Query("username"),
	}

	items := model.TaskGetAllTasks(pageInfo.GetStartIdx(), pageInfo.GetPageSize(), queryParams)
	total := model.TaskCountAllTasks(queryParams)
	pageInfo.SetTotal(int(total))
	taskDtos := tasksToDto(items, true)
	if c.GetInt("role") != common.RoleRootUser {
		stripTaskProtocolDetails(taskDtos)
	}
	pageInfo.SetItems(taskDtos)
	common.ApiSuccess(c, pageInfo)
}

func GetUserTask(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)

	userId := c.GetInt("id")

	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)

	queryParams := model.SyncTaskQueryParams{
		Platform:       constant.TaskPlatform(c.Query("platform")),
		TaskID:         c.Query("task_id"),
		Status:         c.Query("status"),
		Action:         c.Query("action"),
		StartTimestamp: startTimestamp,
		EndTimestamp:   endTimestamp,
	}

	items := model.TaskGetAllUserTask(userId, pageInfo.GetStartIdx(), pageInfo.GetPageSize(), queryParams)
	total := model.TaskCountAllUserTask(userId, queryParams)
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(tasksToPublicDto(items, false))
	common.ApiSuccess(c, pageInfo)
}

// AdminRefetchTask 管理员对单个任务手动「重新查询上游并结算」（补录）。
// 复用后台轮询同一条链路 service.RefetchAndSettleTask：拉取上游最新状态 ->
// CAS 推进到终态 -> 结算/退款。计费恰好一次由 ApplyUpstreamTaskResult 的 CAS
// 保证，因此重复点击不会重复结算；对已终态任务同样适用（用于找回被超时清扫
// 丢弃的上游成功结果）。
func AdminRefetchTask(c *gin.Context) {
	taskId := c.Param("task_id")
	if taskId == "" {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	task, exist, err := model.GetByOnlyTaskId(taskId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !exist || task == nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	summary, err := service.RefetchAndSettleTask(c.Request.Context(), task)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	latest, _, _ := model.GetByOnlyTaskId(taskId)
	if latest == nil {
		latest = task
	}
	taskDto := relay.TaskModel2Dto(latest)
	if c.GetInt("role") != common.RoleRootUser {
		stripTaskProtocolDetails([]*dto.TaskDto{taskDto})
	}
	common.ApiSuccess(c, gin.H{"task": taskDto, "result": summary})
}

// stripTaskProtocolDetails 允许管理员查看任务列表的运营字段，但协议快照仅超级管理员可见。
func stripTaskProtocolDetails(tasks []*dto.TaskDto) {
	for _, task := range tasks {
		task.Data = nil
		task.RequestData = nil
		if properties, ok := task.Properties.(model.Properties); ok {
			task.Properties = dto.PublicTaskProperties{
				OriginModelName: properties.OriginModelName,
			}
		} else {
			task.Properties = nil
		}
	}
}

// tasksToPublicDto 构造普通用户或代理商任务日志。网页列表不返回上游协议快照；
// 仅代理商视图保留成员身份，用于区分其名下的不同用户。
func tasksToPublicDto(tasks []*model.Task, includeUser bool) []*dto.PublicTaskDto {
	if includeUser {
		fillTaskUsernames(tasks)
	}
	result := make([]*dto.PublicTaskDto, len(tasks))
	for i, task := range tasks {
		result[i] = relay.TaskModel2PublicDto(task)
		result[i].Data = nil
		if includeUser {
			result[i].UserId = task.UserId
			result[i].Username = task.Username
		}
	}
	return result
}

func fillTaskUsernames(tasks []*model.Task) {
	userIdMap := make(map[int]*model.UserBase)
	userIds := types.NewSet[int]()
	for _, task := range tasks {
		userIds.Add(task.UserId)
	}
	for _, userId := range userIds.Items() {
		cacheUser, err := model.GetUserCache(userId)
		if err == nil {
			userIdMap[userId] = cacheUser
		}
	}
	for _, task := range tasks {
		if user, ok := userIdMap[task.UserId]; ok {
			task.Username = user.Username
		}
	}
}

func tasksToDto(tasks []*model.Task, fillUser bool) []*dto.TaskDto {
	if fillUser {
		fillTaskUsernames(tasks)
	}
	result := make([]*dto.TaskDto, len(tasks))
	for i, task := range tasks {
		result[i] = relay.TaskModel2Dto(task)
	}
	return result
}
