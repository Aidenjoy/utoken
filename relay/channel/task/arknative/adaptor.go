package arknative

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
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
// 渠道 base_url 原样使用（所见即所发），仅火山官方域名例外：
// 官方任务 API 固定挂在 /api/v3，而用户常把 base_url 配成 OpenAI 兼容
// 聊天路径 /v1（或裸域名），直接拼任务路径会 404，因此官方域名统一归一到 /api/v3。
type TaskAdaptor struct {
	taskcommon.BaseBilling
	ChannelType int
	apiKey      string
	baseURL     string

	// Validate 阶段从原始请求体提取的计费相关字段
	rawBody    []byte
	resolution string
	hasVideo   bool
	// hasWatermark 记录客户端是否显式传了 watermark：未传时 BuildRequestBody
	// 注入 false 去水印（方舟默认盖水印），显式传值则原样透传。
	hasWatermark bool
	// unified 标记请求体为统一视频协议（无 content 数组）：BuildRequestBody
	// 按 doubao 规则转换为官方格式而非透传。
	unified bool
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.ChannelType = info.ChannelType
	a.baseURL = info.ChannelBaseUrl
	a.apiKey = info.ApiKey
}

var (
	// arkOfficialHostRE 匹配火山方舟官方 API 域名（国内 volces.com / 国际 bytepluses.com）。
	arkOfficialHostRE = regexp.MustCompile(`^ark\.[a-z0-9-]+\.(?:volces\.com|bytepluses\.com)(:\d+)?$`)
	// arkVersionPathRE 匹配尾部版本路径（/v1、/api/v3 等）。
	arkVersionPathRE = regexp.MustCompile(`/(?:api/)?v\d+$`)
)

// arkTaskBaseURL 归一化火山官方域名的 base_url 到任务 API 版本路径 /api/v3：
// .../v1（OpenAI 兼容聊天路径）或裸域名都会 404，必须换成 /api/v3；
// 非官方域名（中转站）保持所见即所发，原样返回。
func arkTaskBaseURL(baseURL string) string {
	trimmed := strings.TrimSuffix(baseURL, "/")
	if u, err := url.Parse(trimmed); err == nil && arkOfficialHostRE.MatchString(u.Host) {
		return arkVersionPathRE.ReplaceAllString(trimmed, "") + "/api/v3"
	}
	return trimmed
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

	var req submitProbe
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
	// 统一视频协议兼容：云导演/Playground 同源客户端向 /v1/video/generations 发送
	// {prompt, images, metadata}，而官方协议要求 content 数组；缺 content 时按
	// doubao 规则转换（见 buildUnifiedRequestBody）
	if len(req.Content) == 0 && (strings.TrimSpace(req.Prompt) != "" || len(req.Images) > 0 || strings.TrimSpace(req.Image) != "") {
		return a.validateUnifiedSubmit(&req)
	}
	a.resolution = req.Resolution
	a.hasWatermark = req.Watermark != nil
	for _, item := range req.Content {
		if item.Type == "video_url" {
			a.hasVideo = true
			break
		}
	}
	return nil
}

// submitProbe 提交请求体的最小解析结构：同时覆盖官方协议与统一视频协议字段，
// 用于区分两种格式并提取计费相关字段
type submitProbe struct {
	Model      string         `json:"model"`
	Resolution string         `json:"resolution"`
	Duration   *dto.IntValue  `json:"duration"`
	Watermark  *dto.BoolValue `json:"watermark"`
	Content    []struct {
		Type string `json:"type"`
	} `json:"content"`
	// 统一视频协议字段（云导演/Playground 同源客户端）
	Prompt   string         `json:"prompt"`
	Image    string         `json:"image"`
	Images   []string       `json:"images"`
	Metadata map[string]any `json:"metadata"`
}

// validateUnifiedSubmit 校验统一视频协议体：prompt 必填；metadata 内的 duration 是
// 用户可控计费乘数且绕过顶层校验，必须同标强制上下界（计费安全不变量）；
// 并提取计费字段（resolution / 是否含视频输入）。
func (a *TaskAdaptor) validateUnifiedSubmit(req *submitProbe) *dto.TaskError {
	if strings.TrimSpace(req.Prompt) == "" {
		return service.TaskErrorWrapperLocal(errors.New("prompt is required"), "invalid_request", http.StatusBadRequest)
	}
	if raw, ok := req.Metadata["duration"]; ok {
		if b, err := common.Marshal(raw); err == nil {
			var dv dto.IntValue
			if common.Unmarshal(b, &dv) == nil {
				duration := int(dv)
				if duration < 0 || duration > relaycommon.MaxTaskDurationSeconds {
					return service.TaskErrorWrapperLocal(
						fmt.Errorf("duration must be between 0 and %d, got %d", relaycommon.MaxTaskDurationSeconds, duration),
						"invalid_request", http.StatusBadRequest)
				}
			}
		}
	}
	a.unified = true
	if res, ok := req.Metadata["resolution"].(string); ok {
		a.resolution = res
	}
	if videoURLs, ok := req.Metadata["video_urls"].([]interface{}); ok && len(videoURLs) > 0 {
		a.hasVideo = true
	}
	if _, ok := req.Metadata["watermark"]; ok {
		a.hasWatermark = true
	}
	return nil
}

// BuildRequestURL constructs the upstream URL.
// base_url 按渠道配置原样使用；火山官方域名归一到 /api/v3（见 arkTaskBaseURL）。
func (a *TaskAdaptor) BuildRequestURL(_ *relaycommon.RelayInfo) (string, error) {
	return arkTaskBaseURL(a.baseURL) + "/contents/generations/tasks", nil
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

	// 统一视频协议：按 doubao 规则转换为官方格式（content 数组 + 顶层参数），
	// 去水印默认值等官方语义已由转换逻辑补齐，不再走透传与水印注入
	if a.unified {
		return a.buildUnifiedRequestBody(body, info)
	}

	if info.UpstreamModelName != "" {
		mapped, err := sjson.SetBytes(body, "model", info.UpstreamModelName)
		if err != nil {
			return nil, errors.Wrap(err, "replace model field failed")
		}
		body = mapped
	}

	// 火山方舟默认给视频盖水印：客户端未显式传 watermark 时注入 false 去水印，
	// 显式传值（含 true）保持原样透传。
	if !a.hasWatermark {
		defaulted, err := sjson.SetBytes(body, "watermark", false)
		if err != nil {
			return nil, errors.Wrap(err, "set default watermark failed")
		}
		body = defaulted
	}

	logBody := string(body)
	if len(logBody) > 2000 {
		logBody = logBody[:2000] + "...(truncated)"
	}
	common.SysLog(fmt.Sprintf("[ArkNative] Submit request body: %s", logBody))

	return bytes.NewReader(body), nil
}

// buildUnifiedRequestBody 解析统一视频协议体并复用 doubao 转换生成 Ark 原生请求体；
// model 字段按渠道模型映射替换，与透传分支语义一致。
func (a *TaskAdaptor) buildUnifiedRequestBody(raw []byte, info *relaycommon.RelayInfo) (io.Reader, error) {
	var req relaycommon.TaskSubmitReq
	if err := common.Unmarshal(raw, &req); err != nil {
		return nil, errors.Wrap(err, "parse unified request failed")
	}
	if len(req.Images) == 0 && strings.TrimSpace(req.Image) != "" {
		req.Images = []string{req.Image}
	}
	body, err := doubao.MarshalUnifiedRequestBody(&req)
	if err != nil {
		return nil, errors.Wrap(err, "convert unified request failed")
	}
	if info.IsModelMapped {
		mapped, err := sjson.SetBytes(body, "model", info.UpstreamModelName)
		if err != nil {
			return nil, errors.Wrap(err, "replace model field failed")
		}
		body = mapped
	} else {
		info.UpstreamModelName = req.Model
	}

	logBody := string(body)
	if len(logBody) > 2000 {
		logBody = logBody[:2000] + "...(truncated)"
	}
	common.SysLog(fmt.Sprintf("[ArkNative] Submit unified request body: %s", logBody))

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

	uri := arkTaskBaseURL(baseUrl) + fmt.Sprintf("/contents/generations/tasks/%s", taskID)

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
