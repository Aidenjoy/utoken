package controller

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/google/uuid"
	tos "github.com/volcengine/ve-tos-golang-sdk/v2/tos"

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
	tosAccessKey := common.GetEnvOrDefaultString("TOS_ACCESS_KEY", "")
	tosSecretKey := common.GetEnvOrDefaultString("TOS_SECRET_KEY", "")
	tosEndpoint := common.GetEnvOrDefaultString("TOS_ENDPOINT", "https://tos-cn-beijing.volces.com")
	tosRegion := common.GetEnvOrDefaultString("TOS_REGION", "cn-beijing")
	tosBucket := common.GetEnvOrDefaultString("TOS_BUCKET", "")
	if tosAccessKey == "" || tosSecretKey == "" || tosBucket == "" {
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
	publicURL, objectKey, err := uploadToTOS(file, fileHeader.Filename, tosEndpoint, tosRegion, tosBucket, tosAccessKey, tosSecretKey, userId, batchID)
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

// uploadToTOS uploads a file to Volcengine TOS (Object Storage) and returns
// the publicly accessible URL and the object key.
// The object key is structured as {date}/{userId}_{batchId}/{filename} so that
// all resources for the same video task are grouped in one folder.
// If batchId is empty, a new UUID is generated (backwards compat).
func uploadToTOS(file io.Reader, filename, endpoint, region, bucket, accessKey, secretKey string, userId int, batchID string) (publicURL, objectKey string, err error) {
	client, err := tos.NewClientV2(endpoint, tos.WithRegion(region), tos.WithCredentials(tos.NewStaticCredentials(accessKey, secretKey)))
	if err != nil {
		return "", "", fmt.Errorf("create TOS client: %w", err)
	}

	// Object key: {date}/{userId}_{batchId}/{filename}
	// All files for the same video task share the same batchId folder.
	if batchID == "" {
		batchID = uuid.New().String()
	}
	date := time.Now().Format("2006-01-02")
	objectKey = fmt.Sprintf("%s/%d_%s/%s", date, userId, batchID, filename)

	// Read file content
	content, err := io.ReadAll(file)
	if err != nil {
		return "", "", fmt.Errorf("read file: %w", err)
	}

	// Upload to TOS
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	output, err := client.PutObjectV2(ctx, &tos.PutObjectV2Input{
		PutObjectBasicInput: tos.PutObjectBasicInput{
			Bucket: bucket,
			Key:    objectKey,
		},
		Content: bytes.NewReader(content),
	})
	if err != nil {
		return "", "", fmt.Errorf("upload to TOS: %w", err)
	}
	_ = output

	// Construct public URL: https://{bucket}.{endpoint-host}/{object-key}
	endpointHost := strings.TrimPrefix(endpoint, "https://")
	endpointHost = strings.TrimPrefix(endpointHost, "http://")
	publicURL = fmt.Sprintf("https://%s.%s/%s", bucket, endpointHost, objectKey)

	return publicURL, objectKey, nil
}
