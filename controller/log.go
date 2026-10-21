package controller

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

func GetAllLogs(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	logType, _ := strconv.Atoi(c.Query("type"))
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	username := c.Query("username")
	tokenName := c.Query("token_name")
	modelName := c.Query("model_name")
	channel, _ := strconv.Atoi(c.Query("channel"))
	group := c.Query("group")
	requestId := c.Query("request_id")
	upstreamRequestId := c.Query("upstream_request_id")
	taskID := c.Query("task_id")
	logs, total, err := model.GetAllLogs(logType, startTimestamp, endTimestamp, modelName, username, tokenName, pageInfo.GetStartIdx(), pageInfo.GetPageSize(), channel, group, requestId, upstreamRequestId, taskID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(logs)
	common.ApiSuccess(c, pageInfo)
	return
}

func GetUserLogs(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	userId := c.GetInt("id")
	logType, _ := strconv.Atoi(c.Query("type"))
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	tokenName := c.Query("token_name")
	modelName := c.Query("model_name")
	group := c.Query("group")
	requestId := c.Query("request_id")
	upstreamRequestId := c.Query("upstream_request_id")
	taskID := c.Query("task_id")
	logs, total, err := model.GetUserLogs(userId, logType, startTimestamp, endTimestamp, modelName, tokenName, pageInfo.GetStartIdx(), pageInfo.GetPageSize(), group, requestId, upstreamRequestId, taskID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(logs)
	common.ApiSuccess(c, pageInfo)
	return
}

// Deprecated: SearchAllLogs 已废弃，前端未使用该接口。
func SearchAllLogs(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": false,
		"message": "该接口已废弃",
	})
}

// Deprecated: SearchUserLogs 已废弃，前端未使用该接口。
func SearchUserLogs(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": false,
		"message": "该接口已废弃",
	})
}

func GetLogByKey(c *gin.Context) {
	tokenId := c.GetInt("token_id")
	if tokenId == 0 {
		c.JSON(200, gin.H{
			"success": false,
			"message": "无效的令牌",
		})
		return
	}
	logs, err := model.GetLogByTokenId(tokenId)
	if err != nil {
		c.JSON(200, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	c.JSON(200, gin.H{
		"success": true,
		"message": "",
		"data":    logs,
	})
}

func GetLogsStat(c *gin.Context) {
	logType, _ := strconv.Atoi(c.Query("type"))
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	tokenName := c.Query("token_name")
	username := c.Query("username")
	modelName := c.Query("model_name")
	channel, _ := strconv.Atoi(c.Query("channel"))
	group := c.Query("group")
	stat, err := model.SumUsedQuota(logType, startTimestamp, endTimestamp, modelName, username, tokenName, channel, group)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	//tokenNum := model.SumUsedToken(logType, startTimestamp, endTimestamp, modelName, username, "")
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"quota": stat.Quota,
			"rpm":   stat.Rpm,
			"tpm":   stat.Tpm,
		},
	})
	return
}

func GetLogsSelfStat(c *gin.Context) {
	username := c.GetString("username")
	logType, _ := strconv.Atoi(c.Query("type"))
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	tokenName := c.Query("token_name")
	modelName := c.Query("model_name")
	channel, _ := strconv.Atoi(c.Query("channel"))
	group := c.Query("group")
	quotaNum, err := model.SumUsedQuota(logType, startTimestamp, endTimestamp, modelName, username, tokenName, channel, group)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	//tokenNum := model.SumUsedToken(logType, startTimestamp, endTimestamp, modelName, username, tokenName)
	c.JSON(200, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"quota": quotaNum.Quota,
			"rpm":   quotaNum.Rpm,
			"tpm":   quotaNum.Tpm,
			//"token": tokenNum,
		},
	})
	return
}

// DeleteHistoryLogs is the legacy synchronous log cleanup endpoint (DELETE /api/log/).
// It deletes directly instead of going through the async system task. It is kept only
// for the classic frontend; the default frontend uses POST /api/system-task/log-cleanup.
// TODO: remove this handler (and its route) once the classic frontend is removed.
func DeleteHistoryLogs(c *gin.Context) {
	targetTimestamp, _ := strconv.ParseInt(c.Query("target_timestamp"), 10, 64)
	if targetTimestamp == 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "target timestamp is required",
		})
		return
	}
	count, err := model.DeleteOldLog(c.Request.Context(), targetTimestamp, 100)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    count,
	})
	return
}

// GetLogBodies 使用日志详情的「传入/传出参数」快照查询：GET /api/log/bodies?request_id=...
// 挂在日志 UserAuth 路由组，可见范围与日志列表一致（管理员任意 / 本人自己的 /
// 代理商名下成员范围内的）。先按 request_id（已有索引 idx_logs_request_id）定位日志行归属
// 用户；查不到日志行返回 404，越权返回空数据（不泄露该 request_id 是否有快照）。
func GetLogBodies(c *gin.Context) {
	requestId := c.Query("request_id")
	if requestId == "" {
		common.ApiErrorMsg(c, "request_id is required")
		return
	}

	ownerId, found, err := model.GetLogUserIdByRequestId(requestId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !found {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "log not found",
		})
		return
	}

	if !canViewLogBodies(c, ownerId) {
		// 越权：返回空数据而非 403，不泄露该 request_id 是否存在快照。
		common.ApiSuccess(c, gin.H{"request_data": "", "response_data": ""})
		return
	}

	body, ok, err := model.GetLogBodyByRequestId(requestId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !ok {
		// 历史日志或未开启快照：无 bodies 行，返回空（前端 JsonBlock 显示「None」）。
		common.ApiSuccess(c, gin.H{"request_data": "", "response_data": ""})
		return
	}
	common.ApiSuccess(c, gin.H{
		"request_data":  body.RequestData,
		"response_data": body.ResponseData,
	})
}

// canViewLogBodies 判定当前登录用户是否可查看 ownerId 的日志快照：管理员放行、本人放行、
// 代理商放行其名下成员，其余一律拒绝。agent_id 不在 UserAuth 上下文，故按当前用户查
// agents 表判定身份（与 middleware.AgentAuth 同源）。
func canViewLogBodies(c *gin.Context, ownerId int) bool {
	if c.GetInt("role") >= common.RoleAdminUser {
		return true
	}
	selfId := c.GetInt("id")
	if selfId > 0 && selfId == ownerId {
		return true
	}
	agent, err := model.GetAgentByUserId(selfId)
	if err != nil || agent.Status != model.AgentStatusEnabled {
		return false
	}
	memberIds, err := model.ListAgentMemberIds(agent.Id)
	if err != nil {
		return false
	}
	for _, id := range memberIds {
		if id == ownerId {
			return true
		}
	}
	return false
}
