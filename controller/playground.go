package controller

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/google/uuid"
	tos "github.com/volcengine/ve-tos-golang-sdk/v2/tos"
	"github.com/aliyun/aliyun-oss-go-sdk/oss"

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
// Alibaba Cloud OSS is supported as an alternative object storage:
//   - OSS_ACCESS_KEY_ID:     OSS access key id
//   - OSS_ACCESS_KEY_SECRET: OSS access key secret
//   - OSS_ENDPOINT:          OSS endpoint (e.g., https://oss-cn-beijing.aliyuncs.com)
//   - OSS_BUCKET:            OSS bucket name (must allow public read)
//
// If neither TOS nor OSS is configured, it falls back to the channel Files API.
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

	// Try TOS upload (preferred path for video generation)
	tosAccessKey := common.GetEnvOrDefaultString("TOS_ACCESS_KEY", "")
	tosSecretKey := common.GetEnvOrDefaultString("TOS_SECRET_KEY", "")
	tosEndpoint := common.GetEnvOrDefaultString("TOS_ENDPOINT", "https://tos-cn-beijing.volces.com")
	tosRegion := common.GetEnvOrDefaultString("TOS_REGION", "cn-beijing")
	tosBucket := common.GetEnvOrDefaultString("TOS_BUCKET", "")

	if tosAccessKey != "" && tosSecretKey != "" && tosBucket != "" {
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
		return
	}

	// Try Alibaba Cloud OSS upload (alternative object storage)
	ossAccessKey := common.GetEnvOrDefaultString("OSS_ACCESS_KEY_ID", "")
	ossSecretKey := common.GetEnvOrDefaultString("OSS_ACCESS_KEY_SECRET", "")
	ossEndpoint := common.GetEnvOrDefaultString("OSS_ENDPOINT", "https://oss-cn-beijing.aliyuncs.com")
	ossBucket := common.GetEnvOrDefaultString("OSS_BUCKET", "")

	if ossAccessKey != "" && ossSecretKey != "" && ossBucket != "" {
		userId := c.GetInt("id")
		model := c.Query("model")
		batchID := c.Query("batch_id")
		publicURL, objectKey, err := uploadToOSS(file, fileHeader.Filename, ossEndpoint, ossBucket, ossAccessKey, ossSecretKey, userId, batchID)
		if err != nil {
			common.SysError(fmt.Sprintf("[PlaygroundFileUpload] OSS upload failed (user=%d, model=%s, batch=%s): %v", userId, model, batchID, err))
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": gin.H{
					"message": "failed to upload file to OSS: " + err.Error(),
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
		return
	}

	// Fallback: use Volcengine Files API (requires channel context)
	baseURL := common.GetContextKeyString(c, constant.ContextKeyChannelBaseUrl)
	apiKey := common.GetContextKeyString(c, constant.ContextKeyChannelKey)
	if baseURL == "" || apiKey == "" {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"message": "TOS not configured and channel not selected",
				"type":    "internal_error",
			},
		})
		return
	}

	purpose := c.PostForm("purpose")
	if purpose == "" {
		purpose = "user_data"
	}

	// Build a new multipart request to forward to Volcengine Files API
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	if err := writer.WriteField("purpose", purpose); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"message": "failed to write purpose field: " + err.Error(),
				"type":    "internal_error",
			},
		})
		return
	}
	part, err := writer.CreateFormFile("file", fileHeader.Filename)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"message": "failed to create form file: " + err.Error(),
				"type":    "internal_error",
			},
		})
		return
	}
	if _, err := io.Copy(part, file); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"message": "failed to copy file: " + err.Error(),
				"type":    "internal_error",
			},
		})
		return
	}
	writer.Close()

	// Forward to the channel's files API (path depends on whether baseURL already carries a version suffix)
	uploadURL := filesUploadURL(baseURL)
	req, err := http.NewRequest("POST", uploadURL, &buf)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"message": "failed to create request: " + err.Error(),
				"type":    "internal_error",
			},
		})
		return
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"message": "failed to upload file: " + err.Error(),
				"type":    "internal_error",
			},
		})
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		// 上游非 200 时记录响应，便于定位：404 常见于渠道 baseURL 误带 /api/v3 后缀，
		// 或所选渠道本身不提供 /api/v3/files 文件接口（非火山方舟渠道）。
		bodySnippet := string(body)
		if len(bodySnippet) > 300 {
			bodySnippet = bodySnippet[:300]
		}
		common.SysError(fmt.Sprintf("[PlaygroundFileUpload] upstream upload failed (user=%d, model=%s, url=%s): status=%d body=%s",
			c.GetInt("id"), c.Query("model"), uploadURL, resp.StatusCode, bodySnippet))
	}

	// Add content_url to the response so the frontend can use it directly.
	if resp.StatusCode == http.StatusOK {
		var result map[string]interface{}
		if err := common.Unmarshal(body, &result); err == nil {
			if fileID, ok := result["id"].(string); ok && fileID != "" {
				contentURL := strings.TrimSuffix(baseURL, "/") + "/api/v3/files/" + fileID + "/content"
				result["content_url"] = contentURL
				if updated, err := common.Marshal(result); err == nil {
					body = updated
				}
			}
		}
	}

	if resp.StatusCode == http.StatusNotFound {
		// 上游 404 多为渠道 baseURL 与火山 Files API 路径不匹配（如中转站自带 /api/v2 前缀，
		// 再拼 /api/v3/files 变成双重路径），透传对方默认 404 页对排障无意义，返回明确指引。
		c.JSON(http.StatusNotFound, gin.H{
			"error": gin.H{
				"message": fmt.Sprintf("file upload endpoint not found on channel (%s); configure TOS env (TOS_ACCESS_KEY/TOS_SECRET_KEY/TOS_BUCKET) to enable direct upload", uploadURL),
				"type":    "upstream_not_found",
			},
		})
		return
	}

	// Return the upstream response with the same status code
	c.Data(resp.StatusCode, "application/json", body)
}

// filesUploadURL 按渠道 baseURL 构造文件上传地址。
// baseURL 已带版本路径后缀（如 /v1、/api/v2、/api/v3）时只拼 /files，
// 避免拼出 /api/v2/api/v3/files 这类双重路径；无版本后缀视为火山官方渠道，拼默认 /api/v3/files。
func filesUploadURL(baseURL string) string {
	trimmed := strings.TrimSuffix(baseURL, "/")
	if versionPathSuffixRE.MatchString(trimmed) {
		return trimmed + "/files"
	}
	return trimmed + "/api/v3/files"
}

var versionPathSuffixRE = regexp.MustCompile(`/(?:api/)?v\d+$`)

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
	publicURL = publicObjectURL(endpoint, bucket, objectKey)

	return publicURL, objectKey, nil
}

// uploadToOSS uploads a file to Alibaba Cloud OSS and returns
// the publicly accessible URL and the object key.
// The object key is structured the same as TOS: {date}/{userId}_{batchId}/{filename}.
// The bucket must allow public read so upstream providers can fetch the file directly.
func uploadToOSS(file io.Reader, filename, endpoint, bucket, accessKey, secretKey string, userId int, batchID string) (publicURL, objectKey string, err error) {
	client, err := oss.New(endpoint, accessKey, secretKey)
	if err != nil {
		return "", "", fmt.Errorf("create OSS client: %w", err)
	}
	bkt, err := client.Bucket(bucket)
	if err != nil {
		return "", "", fmt.Errorf("get OSS bucket: %w", err)
	}

	// Object key: {date}/{userId}_{batchId}/{filename}, same layout as TOS.
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

	// Upload to OSS
	if err := bkt.PutObject(objectKey, bytes.NewReader(content)); err != nil {
		return "", "", fmt.Errorf("upload to OSS: %w", err)
	}

	// Construct public URL: https://{bucket}.{endpoint-host}/{object-key}
	publicURL = publicObjectURL(endpoint, bucket, objectKey)

	return publicURL, objectKey, nil
}

// publicObjectURL 构造对象存储的公网直链：https://{bucket}.{endpoint-host}/{key}。
// endpoint 配置为内网地址（如 oss-cn-beijing-internal.aliyuncs.com）时自动去掉 -internal，
// 保证生成的直链公网可达（上游供应商需直接拉取该 URL）。
func publicObjectURL(endpoint, bucket, objectKey string) string {
	endpointHost := strings.TrimPrefix(endpoint, "https://")
	endpointHost = strings.TrimPrefix(endpointHost, "http://")
	endpointHost = strings.ReplaceAll(endpointHost, "-internal", "")
	return fmt.Sprintf("https://%s.%s/%s", bucket, endpointHost, objectKey)
}
