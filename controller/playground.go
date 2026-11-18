package controller

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

func Playground(c *gin.Context) {
	var newAPIError *types.NewAPIError

	defer func() {
		if newAPIError != nil {
			c.JSON(newAPIError.StatusCode, gin.H{
				"error": newAPIError.ToOpenAIError(),
			})
		}
	}()

	useAccessToken := c.GetBool("use_access_token")
	if useAccessToken {
		newAPIError = types.NewError(errors.New("暂不支持使用 access token"), types.ErrorCodeAccessDenied, types.ErrOptionWithSkipRetry())
		return
	}

	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatOpenAI, nil, nil)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
		return
	}

	userId := c.GetInt("id")

	// Write user context to ensure acceptUnsetRatio is available
	userCache, err := model.GetUserCache(userId)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		return
	}
	userCache.WriteContext(c)

	tempToken := &model.Token{
		UserId: userId,
		Name:   fmt.Sprintf("playground-%s", relayInfo.UsingGroup),
		Group:  relayInfo.UsingGroup,
	}
	_ = middleware.SetupContextForToken(c, tempToken)

	Relay(c, types.RelayFormatOpenAI)
}

// PlaygroundImage handles image generation (text-to-image and image-to-image)
// from the playground. It creates a temporary token like Playground does for chat
// and delegates to Relay with the OpenAI image format, so the request follows the
// exact same path as an external /v1/images/generations call.
func PlaygroundImage(c *gin.Context) {
	var newAPIError *types.NewAPIError

	defer func() {
		if newAPIError != nil {
			c.JSON(newAPIError.StatusCode, gin.H{
				"error": newAPIError.ToOpenAIError(),
			})
		}
	}()

	if c.GetBool("use_access_token") {
		newAPIError = types.NewError(errors.New("暂不支持使用 access token"), types.ErrorCodeAccessDenied, types.ErrOptionWithSkipRetry())
		return
	}

	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatOpenAIImage, nil, nil)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
		return
	}

	userId := c.GetInt("id")

	userCache, err := model.GetUserCache(userId)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		return
	}
	userCache.WriteContext(c)

	tempToken := &model.Token{
		UserId: userId,
		Name:   fmt.Sprintf("playground-image-%s", relayInfo.UsingGroup),
		Group:  relayInfo.UsingGroup,
	}
	_ = middleware.SetupContextForToken(c, tempToken)

	Relay(c, types.RelayFormatOpenAIImage)
}

// PlaygroundTask handles video generation task submission from the playground.
// It creates a temporary token (like Playground does for chat) and delegates to RelayTask.
func PlaygroundTask(c *gin.Context) {
	useAccessToken := c.GetBool("use_access_token")
	if useAccessToken {
		c.JSON(http.StatusForbidden, &dto.TaskError{
			Code:       "access_denied",
			Message:    "暂不支持使用 access token",
			StatusCode: http.StatusForbidden,
		})
		return
	}

	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatTask, nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, &dto.TaskError{
			Code:       "gen_relay_info_failed",
			Message:    err.Error(),
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	userId := c.GetInt("id")
	userCache, err := model.GetUserCache(userId)
	if err != nil {
		c.JSON(http.StatusInternalServerError, &dto.TaskError{
			Code:       "query_data_error",
			Message:    err.Error(),
			StatusCode: http.StatusInternalServerError,
		})
		return
	}
	userCache.WriteContext(c)

	// Log batch_id for TOS resource traceability: read body, extract batch_id,
	// then restore the body so the relay flow can process it normally.
	if c.Request.Body != nil {
		bodyBytes, readErr := io.ReadAll(c.Request.Body)
		c.Request.Body.Close()
		if readErr == nil {
			c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
			var body map[string]interface{}
			if unmarshalErr := common.Unmarshal(bodyBytes, &body); unmarshalErr == nil {
				modelName := ""
				if m, ok := body["model"].(string); ok {
					modelName = m
				}
				batchID := ""
				if meta, ok := body["metadata"].(map[string]interface{}); ok {
					if b, ok := meta["batch_id"].(string); ok {
						batchID = b
					}
				}
				if batchID != "" {
					common.SysLog(fmt.Sprintf("[PlaygroundTask] User %d submitted video task (model=%s, batch=%s)", userId, modelName, batchID))
				}
			}
		}
	}

	tempToken := &model.Token{
		UserId: userId,
		Name:   fmt.Sprintf("playground-video-%s", relayInfo.UsingGroup),
		Group:  relayInfo.UsingGroup,
	}
	_ = middleware.SetupContextForToken(c, tempToken)

	RelayTask(c)
}

// PlaygroundTaskFetch handles video generation task status polling from the playground.
func PlaygroundTaskFetch(c *gin.Context) {
	useAccessToken := c.GetBool("use_access_token")
	if useAccessToken {
		c.JSON(http.StatusForbidden, &dto.TaskError{
			Code:       "access_denied",
			Message:    "暂不支持使用 access token",
			StatusCode: http.StatusForbidden,
		})
		return
	}

	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatTask, nil, nil)
	if err != nil {
		c.JSON(http.StatusInternalServerError, &dto.TaskError{
			Code:       "gen_relay_info_failed",
			Message:    err.Error(),
			StatusCode: http.StatusInternalServerError,
		})
		return
	}

	userId := c.GetInt("id")
	userCache, err := model.GetUserCache(userId)
	if err != nil {
		c.JSON(http.StatusInternalServerError, &dto.TaskError{
			Code:       "query_data_error",
			Message:    err.Error(),
			StatusCode: http.StatusInternalServerError,
		})
		return
	}
	userCache.WriteContext(c)

	tempToken := &model.Token{
		UserId: userId,
		Name:   fmt.Sprintf("playground-video-%s", relayInfo.UsingGroup),
		Group:  relayInfo.UsingGroup,
	}
	_ = middleware.SetupContextForToken(c, tempToken)

	RelayTaskFetch(c)
}

// PlaygroundFileUpload handles file uploads from the playground.
// It uploads the file to Volcengine TOS (Object Storage) and returns
// a publicly accessible URL that can be used as a reference URL in
// video generation tasks.
//
// TOS configuration is via environment variables:
//   - TOS_ACCESS_KEY:  TOS access key
//   - TOS_SECRET_KEY:  TOS secret key
//   - TOS_ENDPOINT:    TOS endpoint (e.g., https://tos-cn-beijing.volces.com)
//   - TOS_REGION:      TOS region (e.g., cn-beijing)
//   - TOS_BUCKET:      TOS bucket name
//
// If TOS is not configured, the request fails with an explicit error instead of
// falling back to channel forwarding, keeping all uploads on one auditable path.
func PlaygroundFileUpload(c *gin.Context) {
	useAccessToken := c.GetBool("use_access_token")
	if useAccessToken {
		c.JSON(http.StatusForbidden, gin.H{
			"error": gin.H{
				"message": "暂不支持使用 access token",
				"type":    "access_denied",
			},
		})
		return
	}

	// Uploads always go to the project TOS. If TOS is not fully configured, fail fast
	// with an explicit error instead of silently forwarding to the channel, so all
	// uploads stay on one auditable path.
	if _, ok := common.GetTOSUploadConfig(); !ok {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"message": "TOS not configured, file upload unavailable; set TOS_ACCESS_KEY/TOS_SECRET_KEY/TOS_BUCKET",
				"type":    "tos_not_configured",
			},
		})
		return
	}

	// Get uploaded file from multipart form
	file, fileHeader, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"message": "failed to read file: " + err.Error(),
				"type":    "invalid_request",
			},
		})
		return
	}
	defer file.Close()

	userId := c.GetInt("id")
	model := c.Query("model")
	batchID := c.Query("batch_id")
	publicURL, objectKey, err := common.UploadReaderToTOS(file, fileHeader.Filename, userId, batchID)
	if err != nil {
		common.SysError(fmt.Sprintf("[PlaygroundFileUpload] TOS upload failed (user=%d, model=%s, batch=%s): %v", userId, model, batchID, err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"message": "failed to upload file to TOS: " + err.Error(),
				"type":    "internal_error",
			},
		})
		return
	}
	common.SysLog(fmt.Sprintf("[PlaygroundFileUpload] User %d uploaded file (model=%s, batch=%s): %s -> %s", userId, model, batchID, objectKey, publicURL))
	c.JSON(http.StatusOK, gin.H{
		"id":          objectKey,
		"content_url": publicURL,
	})
}

// PlaygroundTaskCancel 取消体验页在途视频任务：服务端 CAS 迁到 CANCELLED 并退还预扣。
// 响应返回任务最终状态，前端据此展示——取消晚于上游完成时如实返回 SUCCESS/FAILURE，
// 不再出现"界面已取消、账单已扣费"的口径分裂。
func PlaygroundTaskCancel(c *gin.Context) {
	if c.GetBool("use_access_token") {
		c.JSON(http.StatusForbidden, gin.H{
			"error": gin.H{
				"message": "暂不支持使用 access token",
				"type":    "access_denied",
			},
		})
		return
	}
	taskId := c.Param("task_id")
	userId := c.GetInt("id")
	task, exist, err := model.GetByTaskId(userId, taskId)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"message": err.Error(), "type": "query_data_error"},
		})
		return
	}
	if !exist {
		c.JSON(http.StatusNotFound, gin.H{
			"error": gin.H{"message": "task not found", "type": "task_not_exist"},
		})
		return
	}
	status, err := service.CancelVideoTask(c.Request.Context(), task)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"message": err.Error(), "type": "internal_error"},
		})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    gin.H{"status": string(status)},
	})
}

// ListPlaygroundChannels 体验页渠道选择器（仅超级管理员）：返回启用渠道的
// id/name/models（不暴露 key），供先选渠道再选模型。?model= 按模型过滤（保留兼容），
// 空则返回全部启用渠道；?group= 指定分组（须在用户可用分组内），auto 展开自动分组，
// 缺省取可用分组并集。普通用户不展示选择器，走自动选路。
func ListPlaygroundChannels(c *gin.Context) {
	if c.GetInt("role") < common.RoleRootUser {
		c.JSON(http.StatusForbidden, gin.H{
			"error": gin.H{"message": "only super admin can list playground channels", "type": "access_denied"},
		})
		return
	}
	userId := c.GetInt("id")
	modelName := strings.TrimSpace(c.Query("model"))
	group := strings.TrimSpace(c.Query("group"))
	userGroup, _ := model.GetUserGroup(userId, false)
	var groups []string
	switch {
	case group == "auto":
		groups = service.GetUserAutoGroup(userGroup)
	case group != "" && (group == userGroup || service.GroupInUserUsableGroups(userGroup, group)):
		groups = []string{group}
	default:
		for g := range service.GetUserUsableGroups(userGroup) {
			groups = append(groups, g)
		}
	}
	channels, err := model.GetEnabledChannels()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{"message": err.Error(), "type": "query_data_error"},
		})
		return
	}
	list := make([]gin.H, 0)
	for _, ch := range channels {
		if modelName != "" {
			supported := false
			for _, g := range groups {
				if model.IsChannelEnabledForGroupModel(g, modelName, ch.Id) {
					supported = true
					break
				}
			}
			if !supported {
				continue
			}
		}
		models := make([]string, 0)
		for _, name := range strings.Split(ch.Models, ",") {
			if name = strings.TrimSpace(name); name != "" {
				models = append(models, name)
			}
		}
		list = append(list, gin.H{"id": ch.Id, "name": ch.Name, "models": models})
	}
	c.JSON(http.StatusOK, gin.H{"channels": list})
}
