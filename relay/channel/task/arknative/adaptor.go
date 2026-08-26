package arknative

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/task/doubao"
	"github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
	"github.com/tidwall/sjson"
)

// TaskAdaptor 火山方舟官方协议透传适配器。
// 对外暴露与官方 Ark API 完全一致的路径与请求/响应格式
// （POST/GET {base}/contents/generations/tasks[/:id]），
// 客户端只需替换 base_url 与 key 即可接入：
// 请求体除 model 字段按渠道模型映射替换外原样透传上游，
// 上游提交/查询响应也原样返回客户端。
// 渠道 base_url 必须包含版本路径（官方填 /api/v3，中转站按各自协议填
// /v1、/api/v2 等），程序不做任何自动补全，所见即所发。
type TaskAdaptor struct {
	taskcommon.BaseBilling
	ChannelType int
	apiKey      string
	baseURL     string

	// Validate 阶段从原始请求体提取的计费相关字段
	rawBody    []byte
	resolution string
	hasVideo   bool
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.ChannelType = info.ChannelType
	a.baseURL = info.ChannelBaseUrl
	a.apiKey = info.ApiKey
}

// ValidateRequestAndSetAction 对官方协议原始请求体做最小校验：
// model 必填；duration 是用户可控的计费乘数，必须强制上下界（计费安全不变量）。
// 不做通用格式解析，其余字段全部透传。
func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) *dto.TaskError {
	info.Action = constant.TaskActionGenerate

	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	raw, err := io.ReadAll(storage)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	a.rawBody = raw

	var req struct {
		Model      string        `json:"model"`
		Resolution string        `json:"resolution"`
		Duration   *dto.IntValue `json:"duration"`
		Content    []struct {
			Type string `json:"type"`
		} `json:"content"`
	}
	if err := common.Unmarshal(raw, &req); err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	if strings.TrimSpace(req.Model) == "" {
		return service.TaskErrorWrapperLocal(errors.New("model is required"), "invalid_request", http.StatusBadRequest)
	}
	if req.Duration != nil {
		duration := int(*req.Duration)
		if duration < 0 || duration > relaycommon.MaxTaskDurationSeconds {
			return service.TaskErrorWrapperLocal(
				fmt.Errorf("duration must be between 0 and %d, got %d", relaycommon.MaxTaskDurationSeconds, duration),
				"invalid_request", http.StatusBadRequest)
		}
	}

	a.resolution = req.Resolution
	for _, item := range req.Content {
		if item.Type == "video_url" {
			a.hasVideo = true
			break
		}
	}
	return nil
}

// BuildRequestURL constructs the upstream URL.
// base_url 按渠道配置原样使用（含版本路径），不自动补全 /api/v3。
func (a *TaskAdaptor) BuildRequestURL(_ *relaycommon.RelayInfo) (string, error) {
	return strings.TrimSuffix(a.baseURL, "/") + "/contents/generations/tasks", nil
}

// BuildRequestHeader sets required headers.
func (a *TaskAdaptor) BuildRequestHeader(_ *gin.Context, req *http.Request, _ *relaycommon.RelayInfo) error {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
	return nil
}

// EstimateBilling 与豆包视频渠道一致：按输出分辨率档/是否含视频输入相对基准价计费。
func (a *TaskAdaptor) EstimateBilling(c *gin.Context, info *relaycommon.RelayInfo) map[string]float64 {
	ratio, ok := doubao.GetVideoInputRatio(info.OriginModelName, a.resolution, a.hasVideo)
	if !ok || ratio == 1.0 {
		return nil
	}
	return map[string]float64{"video_input": ratio}
}

// BuildRequestBody 原样透传客户端请求体，仅按模型映射替换 model 字段。
func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	body := a.rawBody
	if len(body) == 0 {
		storage, err := common.GetBodyStorage(c)
		if err != nil {
			return nil, err
		}
		body, err = io.ReadAll(storage)
		if err != nil {
			return nil, err
		}
	}

	if info.UpstreamModelName != "" {
		mapped, err := sjson.SetBytes(body, "model", info.UpstreamModelName)
		if err != nil {
			return nil, errors.Wrap(err, "replace model field failed")
		}
		body = mapped
	}

	logBody := string(body)
	if len(logBody) > 2000 {
		logBody = logBody[:2000] + "...(truncated)"
	}
	common.SysLog(fmt.Sprintf("[ArkNative] Submit request body: %s", logBody))

	return bytes.NewReader(body), nil
}

// DoRequest delegates to common helper.
func (a *TaskAdaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoTaskApiRequest(a, c, info, requestBody)
}

// DoResponse 原样透传上游提交响应，并以上游任务 ID 作为公开任务 ID
// （官方提交响应里的 id 即上游 ID，客户端用它查询，tasks 表 TaskID 必须一致）。
func (a *TaskAdaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (taskID string, taskData []byte, taskErr *dto.TaskError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		taskErr = service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
		return
	}
	_ = resp.Body.Close()

	logBody := string(responseBody)
	if len(logBody) > 2000 {
		logBody = logBody[:2000] + "...(truncated)"
	}
	common.SysLog(fmt.Sprintf("[ArkNative] Submit response status=%d body=%s", resp.StatusCode, logBody))

	if resp.StatusCode != http.StatusOK {
		var errResp struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		if unmarshalErr := common.Unmarshal(responseBody, &errResp); unmarshalErr == nil && errResp.Error.Message != "" {
			taskErr = service.TaskErrorWrapper(fmt.Errorf("upstream error: %s - %s", errResp.Error.Code, errResp.Error.Message), "upstream_error", resp.StatusCode)
		} else {
			taskErr = service.TaskErrorWrapper(fmt.Errorf("upstream returned status %d: %s", resp.StatusCode, responseBody), "upstream_error", resp.StatusCode)
		}
		return
	}

	var submitResp struct {
		ID string `json:"id"`
	}
	if err := common.Unmarshal(responseBody, &submitResp); err != nil {
		taskErr = service.TaskErrorWrapper(errors.Wrapf(err, "body: %s", responseBody), "unmarshal_response_body_failed", http.StatusInternalServerError)
		return
	}
	if submitResp.ID == "" {
		common.SysError(fmt.Sprintf("[ArkNative] task_id is empty in response: %s", string(responseBody)))
		taskErr = service.TaskErrorWrapper(fmt.Errorf("task_id is empty"), "invalid_response", http.StatusInternalServerError)
		return
	}

	info.PublicTaskID = submitResp.ID

	c.Status(http.StatusOK)
	c.Header("Content-Type", "application/json")
	if _, err := c.Writer.Write(responseBody); err != nil {
		taskErr = service.TaskErrorWrapper(err, "write_response_failed", http.StatusInternalServerError)
		return
	}
	return submitResp.ID, responseBody, nil
}

// FetchTask fetch task status.
func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok {
		return nil, fmt.Errorf("invalid task_id")
	}

	uri := strings.TrimSuffix(baseUrl, "/") + fmt.Sprintf("/contents/generations/tasks/%s", taskID)

	req, err := http.NewRequest(http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)

	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	return client.Do(req)
}

func (a *TaskAdaptor) GetModelList() []string {
	return ModelList
}

func (a *TaskAdaptor) GetChannelName() string {
	return ChannelName
}

// ParseTaskResult 解析官方格式查询响应（兼容中转站 resultSummary 包装），驱动轮询与计费。
// 注意：本适配器不实现 OpenAIVideoConverter，对外查询走官方格式透传分支。
func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	return taskcommon.ParseVolcTaskResult(respBody, "[ArkNative]")
}
