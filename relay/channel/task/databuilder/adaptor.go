package databuilder

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/bce"
	"github.com/QuantumNous/new-api/relay/channel/task/doubao"
	"github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/billing_setting"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
	"github.com/tidwall/sjson"
)

// TaskAdaptor 百度 DataBuilder 视频任务适配器。
//
// DataBuilder 是百度智能云对 seedance 模型的网关代理：对外路径与请求/响应格式
// 和火山方舟官方协议一致（POST/GET {base}/db-ms/seedance/api/v3/contents/
// generations/tasks[/{taskId}]），但鉴权不是 Bearer key，而是 BCE Auth V1
// AK/SK 签名（见 relay/channel/bce）。渠道密钥格式为 "AK|SK"（jimeng 先例），
// 提交与轮询各自解析并签名。
//
// 请求体除 model 字段按渠道模型映射替换外原样透传上游；上游提交/查询响应也
// 原样返回客户端（任务 ID 提取兼容 id/task_id/taskId 与 data/result 包装，
// 与手册官方 Python 示例 extract_task_id 一致）。
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
	// 注入 false 去水印，显式传值则原样透传。
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

// timeNow 签名时间源，单测可替换以做确定性断言。
var timeNow = time.Now

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
		// -1 是视频编辑（含参考视频）任务的合法值：输出时长跟随输入视频；
		// 其余负值与超大值作为用户可控计费乘数必须拒绝（计费安全不变量）。
		if duration < -1 || duration > relaycommon.MaxTaskDurationSeconds {
			return service.TaskErrorWrapperLocal(
				fmt.Errorf("duration must be -1 (follow input video) or between 0 and %d, got %d", relaycommon.MaxTaskDurationSeconds, duration),
				"invalid_request", http.StatusBadRequest)
		}
	}
	// 统一视频协议兼容：云导演/Playground 同源客户端向 /v1/video/generations 发送
	// {prompt, images, metadata}，而官方协议要求 content 数组；缺 content 时按
	// doubao 规则转换（见 buildUnifiedRequestBody）
	if len(req.Content) == 0 && (strings.TrimSpace(req.Prompt) != "" || len(req.Images) > 0 || strings.TrimSpace(req.Image) != "") {
		if taskErr := a.validateUnifiedSubmit(&req); taskErr != nil {
			return taskErr
		}
		return a.validateSeedanceResolution(info, req.Model)
	}
	a.resolution = req.Resolution
	a.hasWatermark = req.Watermark != nil
	for _, item := range req.Content {
		if item.Type == "video_url" {
			a.hasVideo = true
			break
		}
	}
	return a.validateSeedanceResolution(info, req.Model)
}

// validateSeedanceResolution 校验模型是否支持用户请求的分辨率：显式指定了未配置
// 单价的分辨率时返回 400「此模型暂不支持该参数」，避免提交上游后才失败与错误预扣费。
// 同时把分辨率/视频输入落入 info，供预扣费按档绝对单价合成模型倍率。
func (a *TaskAdaptor) validateSeedanceResolution(info *relaycommon.RelayInfo, reqModel string) *dto.TaskError {
	modelName := info.OriginModelName
	if modelName == "" {
		modelName = reqModel
	}
	info.SeedanceResolution = a.resolution
	info.HasVideoInput = a.hasVideo
	if err := doubao.ValidateResolutionSupported(modelName, a.resolution, a.hasVideo); err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
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
				// 与顶层校验同标：-1 合法（视频编辑跟随输入视频），其余负值拒绝
				if duration < -1 || duration > relaycommon.MaxTaskDurationSeconds {
					return service.TaskErrorWrapperLocal(
						fmt.Errorf("duration must be -1 (follow input video) or between 0 and %d, got %d", relaycommon.MaxTaskDurationSeconds, duration),
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
// base_url 归一化到 {base}/db-ms/seedance/api/v3（见 TaskBaseURL）。
func (a *TaskAdaptor) BuildRequestURL(_ *relaycommon.RelayInfo) (string, error) {
	return TaskBaseURL(a.baseURL) + "/contents/generations/tasks", nil
}

// BuildRequestHeader 按 BCE Auth V1 签名（渠道密钥格式 "AK|SK"）。
func (a *TaskAdaptor) BuildRequestHeader(_ *gin.Context, req *http.Request, _ *relaycommon.RelayInfo) error {
	cred, err := bce.ParseAKSK(a.apiKey)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Accept", "application/json")
	bce.SignRequest(req, cred, "", nil, timeNow())
	return nil
}

// EstimateBilling 与豆包视频渠道一致：按输出分辨率档/是否含视频输入相对基准价计费。
func (a *TaskAdaptor) EstimateBilling(c *gin.Context, info *relaycommon.RelayInfo) map[string]float64 {
	// 记录是否含视频输入，提交后存入 BillingContext.HasVideo，供结算阶段按响应分辨率重算
	info.HasVideoInput = a.hasVideo
	// 绝对单价模式（管理员已配置 seedance_config）：档价已在 ModelPriceHelperPerCall 中
	// 按档价/2 合成进 PriceData.ModelRatio，不再追加 video_input 相对倍率。
	if _, hasCfg := billing_setting.GetSeedanceConfig(info.OriginModelName); hasCfg {
		return nil
	}
	ratio, status := doubao.GetVideoInputRatio(info.OriginModelName, a.resolution, a.hasVideo)
	if status != doubao.VideoRatioOK || ratio == 1.0 {
		return nil
	}
	return map[string]float64{"video_input": ratio}
}

// AdjustBillingOnComplete 任务完成时按上游响应的实际分辨率重算 seedance 计费（与 doubao 渠道共用逻辑）。
func (a *TaskAdaptor) AdjustBillingOnComplete(task *model.Task, taskResult *relaycommon.TaskInfo) int {
	return doubao.AdjustSeedanceBillingOnComplete(task, taskResult)
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

	// 客户端未显式传 watermark 时注入 false 去水印，显式传值（含 true）原样透传。
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
	common.SysLog(fmt.Sprintf("[DataBuilder] Submit request body: %s", logBody))

	return bytes.NewReader(body), nil
}

// buildUnifiedRequestBody 解析统一视频协议体并复用 doubao 转换生成官方请求体；
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
	common.SysLog(fmt.Sprintf("[DataBuilder] Submit unified request body: %s", logBody))

	return bytes.NewReader(body), nil
}

// DoRequest delegates to common helper.
func (a *TaskAdaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoTaskApiRequest(a, c, info, requestBody)
}

// DoResponse 原样透传上游提交响应，并以上游任务 ID 作为公开任务 ID。
// 任务 ID 提取兼容 id/task_id/taskId 顶层字段与 data/result 包装
// （与手册官方 Python 示例 extract_task_id 一致）。
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
	common.SysLog(fmt.Sprintf("[DataBuilder] Submit response status=%d body=%s", resp.StatusCode, logBody))

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

	submitID := extractTaskID(responseBody)
	if submitID == "" {
		common.SysError(fmt.Sprintf("[DataBuilder] task_id is empty in response: %s", string(responseBody)))
		taskErr = service.TaskErrorWrapper(fmt.Errorf("task_id is empty"), "invalid_response", http.StatusInternalServerError)
		return
	}

	info.PublicTaskID = submitID

	c.Status(http.StatusOK)
	c.Header("Content-Type", "application/json")
	if _, err := c.Writer.Write(responseBody); err != nil {
		taskErr = service.TaskErrorWrapper(err, "write_response_failed", http.StatusInternalServerError)
		return
	}
	return submitID, responseBody, nil
}

// extractTaskID 从提交响应中递归提取任务 ID：顶层 id/task_id/taskId 优先，
// 其次下探 data/result 包装（镜像手册 Python 示例的 extract_task_id）。
func extractTaskID(body []byte) string {
	var data map[string]any
	if err := common.Unmarshal(body, &data); err != nil {
		return ""
	}
	for _, key := range []string{"id", "task_id", "taskId"} {
		switch v := data[key].(type) {
		case string:
			if v != "" {
				return v
			}
		case float64:
			if v != 0 {
				return fmt.Sprintf("%v", v)
			}
		}
	}
	for _, key := range []string{"data", "result"} {
		nested, ok := data[key]
		if !ok || nested == nil {
			continue
		}
		if b, err := common.Marshal(nested); err == nil && len(b) > 0 {
			if id := extractTaskID(b); id != "" {
				return id
			}
		}
	}
	return ""
}

// FetchTask fetch task status. key 为渠道密钥（"AK|SK"），按 BCE 签名请求。
func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok {
		return nil, fmt.Errorf("invalid task_id")
	}
	cred, err := bce.ParseAKSK(key)
	if err != nil {
		return nil, err
	}

	uri := TaskBaseURL(baseUrl) + fmt.Sprintf("/contents/generations/tasks/%s", taskID)

	req, err := http.NewRequest(http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Accept", "application/json")
	bce.SignRequest(req, cred, "", nil, timeNow())

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

// ParseTaskResult 解析官方格式查询响应，驱动轮询与计费。
// DataBuilder 是 seedance 的方舟同族代理（路径/请求体与方舟官方一致），
// 查询响应假定同为方舟 v3 schema（id/status/content.video_url/usage）。
// 注意：本适配器不实现 OpenAIVideoConverter，对外查询走官方格式透传分支。
func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	return taskcommon.ParseVolcTaskResult(respBody, "[DataBuilder]")
}
