package wannative

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/task/ali"
	"github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/billing_setting"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
	"github.com/tidwall/sjson"
)

// TaskAdaptor 阿里 DashScope 万相官方协议透传适配器。
// 对外暴露与官方 DashScope API 完全一致的路径与请求/响应格式
// （POST {base}/api/v1/services/aigc/video-generation/video-synthesis、
// GET {base}/api/v1/tasks/:id），客户端只需替换 base_url 与 key 即可接入：
// 官方请求体除 model 字段按渠道模型映射替换外原样透传上游，
// 上游提交/查询响应也原样返回客户端。
// Playground 同源客户端发送的方舟 content 数组协议（无 input 对象）委托
// ali 包转换为官方结构后发送（wan3 走 input.media 数组协议），
// 不侵入统一协议共享校验器。
// 渠道 base_url 尾部版本路径后缀（/api、/api/v1、/v1）会被归一化剔除，
// 适配器自行追加 /api/v1 路径段，避免拼出双重路径 404。
type TaskAdaptor struct {
	taskcommon.BaseBilling
	ChannelType int
	apiKey      string
	baseURL     string

	// Validate 阶段从原始请求体提取的计费相关字段
	rawBody    []byte
	arkContent bool   // 方舟 content 数组协议体，BuildRequestBody 需转换为官方结构
	resolution string // 归一化分辨率档（480p/720p/1080p/4k，可为空）
	duration   int    // 用户请求时长（-1 智能时长 / 0 未指定）
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.ChannelType = info.ChannelType
	a.baseURL = info.ChannelBaseUrl
	a.apiKey = info.ApiKey
}

// submitProbe 提交请求体的最小解析结构：同时覆盖 DashScope 官方协议与
// Playground 方舟 content 协议字段，用于区分两种格式并提取计费相关字段。
type submitProbe struct {
	Model string `json:"model"`
	Input *struct {
		Prompt string `json:"prompt"`
		ImgURL string `json:"img_url"`
		Media  []struct {
			Type string `json:"type"`
			URL  string `json:"url"`
		} `json:"media"`
	} `json:"input"`
	Parameters *struct {
		Resolution string        `json:"resolution"`
		Duration   *dto.IntValue `json:"duration"`
	} `json:"parameters"`
	// 方舟 content 协议字段（Playground 同源客户端）
	Content []struct {
		Type string `json:"type"`
		Role string `json:"role"`
	} `json:"content"`
	Resolution string        `json:"resolution"`
	Duration   *dto.IntValue `json:"duration"`
}

// ValidateRequestAndSetAction 对原始请求体做最小校验：model 必填；duration 是
// 用户可控的计费乘数，必须强制上下界（计费安全不变量）；分辨率档未配置单价时
// 提前拦截，避免提交上游后才失败与错误预扣费。其余字段全部透传。
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

	if len(req.Content) > 0 {
		a.arkContent = true
		for _, item := range req.Content {
			if item.Type == "video_url" && !ali.IsWan3Model(req.Model) {
				// 仅 wan3 支持参考视频；其余模型静默丢弃会生成与用户预期不符的视频。
				return service.TaskErrorWrapperLocal(fmt.Errorf("%s 不支持参考视频输入", req.Model), "unsupported_input", http.StatusBadRequest)
			}
		}
		if req.Duration != nil {
			duration := int(*req.Duration)
			if taskErr := validateDuration(duration); taskErr != nil {
				return taskErr
			}
			a.duration = duration
		}
		a.resolution = normalizeResolution(req.Resolution)
	} else {
		if req.Input == nil || (strings.TrimSpace(req.Input.Prompt) == "" && strings.TrimSpace(req.Input.ImgURL) == "" && len(req.Input.Media) == 0) {
			return service.TaskErrorWrapperLocal(errors.New("input.prompt is required"), "invalid_request", http.StatusBadRequest)
		}
		if req.Parameters != nil {
			if req.Parameters.Duration != nil {
				duration := int(*req.Parameters.Duration)
				if taskErr := validateDuration(duration); taskErr != nil {
					return taskErr
				}
				a.duration = duration
			}
			a.resolution = normalizeResolution(req.Parameters.Resolution)
		}
	}
	// wan3 上游仅支持 480P/720P/1080P，提前拦截避免提交上游后才失败
	if ali.IsWan3Model(req.Model) && a.resolution != "" && a.resolution != "480p" && a.resolution != "720p" && a.resolution != "1080p" {
		return service.TaskErrorWrapperLocal(fmt.Errorf("wan3.0 仅支持 480P/720P/1080P 分辨率: %s", a.resolution), "unsupported_resolution", http.StatusBadRequest)
	}
	return a.validateWanResolution(info)
}

// validateDuration 校验时长边界：-1 是 wan 智能时长的合法值（输出时长由上游决定），
// 其余负值与超大值作为用户可控计费乘数必须拒绝（计费安全不变量）。
func validateDuration(duration int) *dto.TaskError {
	if duration < -1 || duration > relaycommon.MaxTaskDurationSeconds {
		return service.TaskErrorWrapperLocal(
			fmt.Errorf("duration must be -1 (smart duration) or between 0 and %d, got %d", relaycommon.MaxTaskDurationSeconds, duration),
			"invalid_request", http.StatusBadRequest)
	}
	return nil
}

// normalizeResolution 归一化分辨率档：小写、补 p 后缀（4k 特判），空值返回空。
func normalizeResolution(raw string) string {
	res := strings.ToLower(strings.TrimSpace(raw))
	if res == "" {
		return ""
	}
	if res != "4k" && !strings.HasSuffix(res, "p") {
		res += "p"
	}
	return res
}

// validateWanResolution wan 按秒档价模式：显式指定了未配置单价的分辨率档时
// 返回 400，避免提交上游后才失败与错误预扣费；分辨率落入 info 供预扣按档计费。
// 未指定分辨率时留空，预扣按已配置最高档兜底，结算按上游真实分辨率重算。
func (a *TaskAdaptor) validateWanResolution(info *relaycommon.RelayInfo) *dto.TaskError {
	info.WanResolution = a.resolution
	if a.resolution == "" {
		return nil
	}
	if billing_setting.GetBillingMode(info.OriginModelName) != billing_setting.BillingModeWan {
		return nil
	}
	if _, ok := billing_setting.GetWanConfig(info.OriginModelName); !ok {
		return nil
	}
	if _, ok := billing_setting.GetWanTierPrice(info.OriginModelName, a.resolution); !ok {
		return service.TaskErrorWrapperLocal(fmt.Errorf("此模型暂不支持该分辨率: %s", a.resolution), "unsupported_resolution", http.StatusBadRequest)
	}
	return nil
}

// BuildRequestURL constructs the upstream URL.
func (a *TaskAdaptor) BuildRequestURL(_ *relaycommon.RelayInfo) (string, error) {
	return ali.NormalizeWanBaseURL(a.baseURL) + "/api/v1/services/aigc/video-generation/video-synthesis", nil
}

// BuildRequestHeader sets required headers for DashScope API.
func (a *TaskAdaptor) BuildRequestHeader(_ *gin.Context, req *http.Request, _ *relaycommon.RelayInfo) error {
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-DashScope-Async", "enable") // 阿里异步任务必须设置
	return nil
}

// EstimateBilling 注入 seconds 倍率：wan 按秒档价已在 ModelPriceHelperPerCall 中
// 按每秒绝对单价计费。-1 智能时长/未指定按 5 秒预估，结算按上游真实时长重算。
func (a *TaskAdaptor) EstimateBilling(_ *gin.Context, _ *relaycommon.RelayInfo) map[string]float64 {
	seconds := a.duration
	if seconds <= 0 {
		seconds = 5
	}
	return map[string]float64{
		"seconds": float64(min(seconds, relaycommon.MaxTaskDurationSeconds)),
	}
}

// AdjustBillingOnComplete 任务成功时按上游真实 usage.duration × 实际分辨率档价重算。
// DashScope 响应格式与 wan 结算逻辑与 ali 渠道完全一致，直接委托（无接收器状态依赖），
// ali 包保持零改动。
func (a *TaskAdaptor) AdjustBillingOnComplete(task *model.Task, taskResult *relaycommon.TaskInfo) int {
	return (&ali.TaskAdaptor{}).AdjustBillingOnComplete(task, taskResult)
}

// BuildRequestBody 官方体原样透传（仅按模型映射替换 model）；
// 方舟 content 体转换为 DashScope 官方结构后发送。
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

	if a.arkContent {
		// 委托 ali 包同一条转换链路：方舟 content → 统一协议 → DashScope 官方结构，
		// wan3 走 input.media 数组协议，模型映射/时长边界/分辨率校验与 ali 渠道一致。
		unified, _, err := ali.ConvertArkTaskBody(body)
		if err != nil {
			return nil, errors.Wrap(err, "convert ark content request failed")
		}
		converted, err := ali.BuildOfficialWanBody(unified, info)
		if err != nil {
			return nil, errors.Wrap(err, "convert ark content request failed")
		}
		body = converted
	} else if info.UpstreamModelName != "" {
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
	common.SysLog(fmt.Sprintf("[WanNative] Submit request body: %s", logBody))

	return bytes.NewReader(body), nil
}

// DoRequest delegates to common helper.
func (a *TaskAdaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoTaskApiRequest(a, c, info, requestBody)
}

// DoResponse 原样透传上游提交响应，并以上游任务 ID 作为公开任务 ID
// （官方提交响应 output.task_id 即上游 ID，客户端用它查询，tasks 表 TaskID 必须一致）。
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
	common.SysLog(fmt.Sprintf("[WanNative] Submit response status=%d body=%s", resp.StatusCode, logBody))

	if resp.StatusCode != http.StatusOK {
		var errResp struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		if unmarshalErr := common.Unmarshal(responseBody, &errResp); unmarshalErr == nil && errResp.Message != "" {
			taskErr = service.TaskErrorWrapper(fmt.Errorf("upstream error: %s - %s", errResp.Code, errResp.Message), "upstream_error", resp.StatusCode)
		} else {
			taskErr = service.TaskErrorWrapper(fmt.Errorf("upstream returned status %d: %s", resp.StatusCode, responseBody), "upstream_error", resp.StatusCode)
		}
		return
	}

	var submitResp struct {
		Output struct {
			TaskID string `json:"task_id"`
		} `json:"output"`
	}
	if err := common.Unmarshal(responseBody, &submitResp); err != nil {
		taskErr = service.TaskErrorWrapper(errors.Wrapf(err, "body: %s", responseBody), "unmarshal_response_body_failed", http.StatusInternalServerError)
		return
	}
	if submitResp.Output.TaskID == "" {
		common.SysError(fmt.Sprintf("[WanNative] task_id is empty in response: %s", string(responseBody)))
		taskErr = service.TaskErrorWrapper(fmt.Errorf("task_id is empty"), "invalid_response", http.StatusInternalServerError)
		return
	}

	info.PublicTaskID = submitResp.Output.TaskID

	c.Status(http.StatusOK)
	c.Header("Content-Type", "application/json")
	if _, err := c.Writer.Write(responseBody); err != nil {
		taskErr = service.TaskErrorWrapper(err, "write_response_failed", http.StatusInternalServerError)
		return
	}
	return submitResp.Output.TaskID, responseBody, nil
}

// FetchTask fetch task status via the official DashScope query path.
func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok {
		return nil, fmt.Errorf("invalid task_id")
	}

	uri := ali.NormalizeWanBaseURL(baseUrl) + "/api/v1/tasks/" + url.PathEscape(taskID)

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

// ParseTaskResult 解析 DashScope 官方查询响应，驱动轮询与计费（与 ali 渠道同格式，
// 直接委托，无接收器状态依赖）。
// 注意：本适配器不实现 OpenAIVideoConverter，对外查询走官方格式透传分支。
func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	return (&ali.TaskAdaptor{}).ParseTaskResult(respBody)
}
