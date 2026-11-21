package ali

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/samber/lo"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

// ============================
// Request / Response structures
// ============================

// AliVideoRequest 阿里通义万相视频生成请求
type AliVideoRequest struct {
	Model      string              `json:"model"`
	Input      AliVideoInput       `json:"input"`
	Parameters *AliVideoParameters `json:"parameters,omitempty"`
}

// AliVideoMedia describes Wan2.7 image-to-video media inputs.
type AliVideoMedia struct {
	Type string `json:"type"`
	URL  string `json:"url"`
}

// AliVideoInput 视频输入参数
type AliVideoInput struct {
	Prompt         string          `json:"prompt,omitempty"`          // 文本提示词
	ImgURL         string          `json:"img_url,omitempty"`         // 首帧图像URL或Base64（图生视频）
	FirstFrameURL  string          `json:"first_frame_url,omitempty"` // 首帧图片URL（首尾帧生视频）
	LastFrameURL   string          `json:"last_frame_url,omitempty"`  // 尾帧图片URL（首尾帧生视频）
	AudioURL       string          `json:"audio_url,omitempty"`       // 音频URL（wan2.5支持）
	Media          []AliVideoMedia `json:"media,omitempty"`           // 媒体列表（wan2.7-i2v新协议）
	NegativePrompt string          `json:"negative_prompt,omitempty"` // 反向提示词
	Template       string          `json:"template,omitempty"`        // 视频特效模板
}

// AliVideoParameters 视频参数
type AliVideoParameters struct {
	Resolution   string `json:"resolution,omitempty"`    // 分辨率: 480P/720P/1080P（图生视频、首尾帧生视频）
	Size         string `json:"size,omitempty"`          // 尺寸: 如 "832*480"（文生视频）
	Ratio        string `json:"ratio,omitempty"`         // 画面比例（wan3.0：adaptive/16:9/9:16 等）
	Duration     int    `json:"duration,omitempty"`      // 时长: 3-10秒
	PromptExtend bool   `json:"prompt_extend,omitempty"` // 是否开启prompt智能改写
	Watermark    bool   `json:"watermark,omitempty"`     // 是否添加水印
	Audio        *bool  `json:"audio,omitempty"`         // 是否添加音频（wan2.5）
	Seed         int    `json:"seed,omitempty"`          // 随机数种子
}

// AliVideoResponse 阿里通义万相响应
type AliVideoResponse struct {
	Output    AliVideoOutput `json:"output"`
	RequestID string         `json:"request_id"`
	Code      string         `json:"code,omitempty"`
	Message   string         `json:"message,omitempty"`
	Usage     *AliUsage      `json:"usage,omitempty"`
}

// AliVideoOutput 输出信息
type AliVideoOutput struct {
	TaskID        string `json:"task_id"`
	TaskStatus    string `json:"task_status"`
	SubmitTime    string `json:"submit_time,omitempty"`
	ScheduledTime string `json:"scheduled_time,omitempty"`
	EndTime       string `json:"end_time,omitempty"`
	OrigPrompt    string `json:"orig_prompt,omitempty"`
	ActualPrompt  string `json:"actual_prompt,omitempty"`
	VideoURL      string `json:"video_url,omitempty"`
	Code          string `json:"code,omitempty"`
	Message       string `json:"message,omitempty"`
}

// AliUsage 使用统计
type AliUsage struct {
	Duration   dto.FloatValue `json:"duration,omitempty"` // wan3.0 返回浮点秒数（输入+输出视频总时长）
	VideoCount dto.IntValue   `json:"video_count,omitempty"`
	SR         dto.IntValue   `json:"SR,omitempty"`
}

type AliMetadata struct {
	// Input 相关
	AudioURL       string          `json:"audio_url,omitempty"`       // 音频URL
	ImgURL         string          `json:"img_url,omitempty"`         // 图片URL（图生视频）
	FirstFrameURL  string          `json:"first_frame_url,omitempty"` // 首帧图片URL（首尾帧生视频）
	LastFrameURL   string          `json:"last_frame_url,omitempty"`  // 尾帧图片URL（首尾帧生视频）
	Media          []AliVideoMedia `json:"media,omitempty"`           // 媒体列表（wan2.7-i2v新协议）
	NegativePrompt string          `json:"negative_prompt,omitempty"` // 反向提示词
	Template       string          `json:"template,omitempty"`        // 视频特效模板

	// Parameters 相关
	Resolution   *string `json:"resolution,omitempty"`    // 分辨率: 480P/720P/1080P
	Size         *string `json:"size,omitempty"`          // 尺寸: 如 "832*480"
	Duration     *int    `json:"duration,omitempty"`      // 时长
	PromptExtend *bool   `json:"prompt_extend,omitempty"` // 是否开启prompt智能改写
	Watermark    *bool   `json:"watermark,omitempty"`     // 是否添加水印
	Audio        *bool   `json:"audio,omitempty"`         // 是否添加音频
	Seed         *int    `json:"seed,omitempty"`          // 随机数种子
}

// ============================
// Adaptor implementation
// ============================

type TaskAdaptor struct {
	taskcommon.BaseBilling
	ChannelType int
	apiKey      string
	baseURL     string
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.ChannelType = info.ChannelType
	a.baseURL = info.ChannelBaseUrl
	a.apiKey = info.ApiKey
}

func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) (taskErr *dto.TaskError) {
	// Playground 同源客户端发送方舟 content 数组协议（无 prompt 字段），
	// 先转换为统一协议体再走共享校验，否则 prompt 为空被误拒。
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	rawBody, err := io.ReadAll(storage)
	if err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	if unified, isArk, convErr := ConvertArkTaskBody(rawBody); convErr != nil {
		return service.TaskErrorWrapperLocal(convErr, "invalid_request", http.StatusBadRequest)
	} else if isArk {
		if replaceErr := common.ReplaceBodyStorage(c, unified); replaceErr != nil {
			return service.TaskErrorWrapperLocal(replaceErr, "invalid_request", http.StatusInternalServerError)
		}
	}
	// ValidateMultipartDirect 负责解析并将原始 TaskSubmitReq 存入 context
	if taskErr = relaycommon.ValidateMultipartDirect(c, info); taskErr != nil {
		return taskErr
	}
	taskReq, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil
	}
	// 提取用户显式指定的分辨率档（顶层 size 或 metadata.parameters）
	raw := strings.TrimSpace(taskReq.Size)
	if raw == "" && taskReq.Metadata != nil {
		if params, ok := taskReq.Metadata["parameters"].(map[string]interface{}); ok {
			if v, ok := params["resolution"].(string); ok && strings.TrimSpace(v) != "" {
				raw = strings.TrimSpace(v)
			} else if v, ok := params["size"].(string); ok {
				raw = strings.TrimSpace(v)
			}
		}
	}
	// wan3.0 上游仅支持 480P/720P/1080P，提前拦截避免提交上游后才失败
	if IsWan3Model(taskReq.Model) && raw != "" {
		res := strings.ToLower(raw)
		if !strings.HasSuffix(res, "p") && res != "4k" {
			res += "p"
		}
		if res != "480p" && res != "720p" && res != "1080p" {
			return service.TaskErrorWrapper(fmt.Errorf("wan3.0 仅支持 480P/720P/1080P 分辨率: %s", raw), "unsupported_resolution", http.StatusBadRequest)
		}
	}
	// wan 按秒档价模式：校验用户显式指定的分辨率档，未填的档 = 不支持，直接 400 拒绝。
	// 未指定分辨率时留空，预扣按已配置最高档兜底，结算按上游真实分辨率重算。
	if billing_setting.GetBillingMode(info.OriginModelName) != billing_setting.BillingModeWan {
		return nil
	}
	if _, ok := billing_setting.GetWanConfig(info.OriginModelName); !ok {
		return nil
	}
	if raw == "" {
		return nil
	}
	resolution := strings.ToLower(raw)
	if strings.Contains(raw, "*") {
		mapped, err := sizeToResolution(raw)
		if err != nil {
			return service.TaskErrorWrapper(err, "unsupported_resolution", http.StatusBadRequest)
		}
		resolution = strings.ToLower(mapped)
	} else if !strings.HasSuffix(resolution, "p") && resolution != "4k" {
		resolution += "p"
	}
	if _, ok := billing_setting.GetWanTierPrice(info.OriginModelName, resolution); !ok {
		return service.TaskErrorWrapper(fmt.Errorf("此模型暂不支持该分辨率: %s", raw), "unsupported_resolution", http.StatusBadRequest)
	}
	info.WanResolution = resolution
	return nil
}

// NormalizeWanBaseURL 归一化 DashScope base_url：去掉尾部斜杠与版本路径后缀
// （/api/v1、/api、/v1）。适配器自行追加 /api/v1 路径段，用户常把 base_url
// 配成含 /api 或 /api/v1 后缀的地址，直接拼接会拼出双重路径 404。
func NormalizeWanBaseURL(baseURL string) string {
	trimmed := strings.TrimSuffix(baseURL, "/")
	trimmed = strings.TrimSuffix(trimmed, "/api/v1")
	trimmed = strings.TrimSuffix(trimmed, "/api")
	trimmed = strings.TrimSuffix(trimmed, "/v1")
	return trimmed
}

func (a *TaskAdaptor) BuildRequestURL(info *relaycommon.RelayInfo) (string, error) {
	return NormalizeWanBaseURL(a.baseURL) + "/api/v1/services/aigc/video-generation/video-synthesis", nil
}

// BuildRequestHeader sets required headers for Ali API
func (a *TaskAdaptor) BuildRequestHeader(c *gin.Context, req *http.Request, info *relaycommon.RelayInfo) error {
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-DashScope-Async", "enable") // 阿里异步任务必须设置
	return nil
}

func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	taskReq, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil, errors.Wrap(err, "get_task_request_failed")
	}

	aliReq, err := a.convertToAliRequest(info, taskReq)
	if err != nil {
		return nil, errors.Wrap(err, "convert_to_ali_request_failed")
	}
	logger.LogJson(c, "ali video request body", aliReq)

	bodyBytes, err := common.Marshal(aliReq)
	if err != nil {
		return nil, errors.Wrap(err, "marshal_ali_request_failed")
	}
	return bytes.NewReader(bodyBytes), nil
}

var (
	size480p = []string{
		"832*480",
		"480*832",
		"624*624",
	}
	size720p = []string{
		"1280*720",
		"720*1280",
		"960*960",
		"1088*832",
		"832*1088",
	}
	size1080p = []string{
		"1920*1080",
		"1080*1920",
		"1440*1440",
		"1632*1248",
		"1248*1632",
	}
)

func sizeToResolution(size string) (string, error) {
	if lo.Contains(size480p, size) {
		return "480P", nil
	} else if lo.Contains(size720p, size) {
		return "720P", nil
	} else if lo.Contains(size1080p, size) {
		return "1080P", nil
	}
	return "", fmt.Errorf("invalid size: %s", size)
}

func ProcessAliOtherRatios(aliReq *AliVideoRequest) (map[string]float64, error) {
	otherRatios := make(map[string]float64)
	aliRatios := map[string]map[string]float64{
		"wan2.6-i2v": {
			"720P":  1,
			"1080P": 1 / 0.6,
		},
		"wan2.5-t2v-preview": {
			"480P":  1,
			"720P":  2,
			"1080P": 1 / 0.3,
		},
		"wan2.2-t2v-plus": {
			"480P":  1,
			"1080P": 0.7 / 0.14,
		},
		"wan2.5-i2v-preview": {
			"480P":  1,
			"720P":  2,
			"1080P": 1 / 0.3,
		},
		"wan2.2-i2v-plus": {
			"480P":  1,
			"1080P": 0.7 / 0.14,
		},
		"wan2.2-kf2v-flash": {
			"480P":  1,
			"720P":  2,
			"1080P": 4.8,
		},
		"wan2.2-i2v-flash": {
			"480P": 1,
			"720P": 2,
		},
		"wan2.2-s2v": {
			"480P": 1,
			"720P": 0.9 / 0.5,
		},
	}
	var resolution string

	// size match
	if aliReq.Parameters.Size != "" {
		toResolution, err := sizeToResolution(aliReq.Parameters.Size)
		if err != nil {
			return nil, err
		}
		resolution = toResolution
	} else {
		resolution = strings.ToUpper(aliReq.Parameters.Resolution)
		if !strings.HasSuffix(resolution, "P") {
			resolution = resolution + "P"
		}
	}
	if otherRatio, ok := aliRatios[aliReq.Model]; ok {
		if ratio, ok := otherRatio[resolution]; ok {
			otherRatios[fmt.Sprintf("resolution-%s", resolution)] = ratio
		}
	}
	return otherRatios, nil
}

func isWan27I2VModel(model string) bool {
	return strings.HasPrefix(model, "wan2.7-i2v")
}

// IsWan3Model 判断 wan3 系列模型：使用官方 input.media 数组协议，
// 支持参考图/参考视频/参考音频输入，分辨率仅 480P/720P/1080P。
func IsWan3Model(model string) bool {
	return strings.HasPrefix(model, "wan3")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func firstTaskImage(req relaycommon.TaskSubmitReq) string {
	if image := strings.TrimSpace(req.Image); image != "" {
		return image
	}
	for _, image := range req.Images {
		if trimmed := strings.TrimSpace(image); trimmed != "" {
			return trimmed
		}
	}
	if inputReference := strings.TrimSpace(req.InputReference); inputReference != "" {
		return inputReference
	}
	return ""
}

func secondTaskImage(req relaycommon.TaskSubmitReq) string {
	nonEmptyImages := 0
	for _, image := range req.Images {
		trimmed := strings.TrimSpace(image)
		if trimmed == "" {
			continue
		}
		nonEmptyImages++
		if nonEmptyImages == 2 {
			return trimmed
		}
	}
	return ""
}

func normalizeWan27I2VInput(aliReq *AliVideoRequest, req relaycommon.TaskSubmitReq) error {
	if !isWan27I2VModel(aliReq.Model) {
		return nil
	}

	if len(aliReq.Input.Media) == 0 {
		firstFrameURL := firstNonEmpty(aliReq.Input.FirstFrameURL, aliReq.Input.ImgURL, firstTaskImage(req))
		lastFrameURL := firstNonEmpty(aliReq.Input.LastFrameURL, secondTaskImage(req))
		audioURL := aliReq.Input.AudioURL

		if firstFrameURL != "" {
			aliReq.Input.Media = append(aliReq.Input.Media, AliVideoMedia{
				Type: "first_frame",
				URL:  firstFrameURL,
			})
		}
		if lastFrameURL != "" {
			aliReq.Input.Media = append(aliReq.Input.Media, AliVideoMedia{
				Type: "last_frame",
				URL:  lastFrameURL,
			})
		}
		if audioURL != "" {
			aliReq.Input.Media = append(aliReq.Input.Media, AliVideoMedia{
				Type: "driving_audio",
				URL:  audioURL,
			})
		}
	}

	if len(aliReq.Input.Media) == 0 {
		return fmt.Errorf("wan2.7-i2v requires image, images, input_reference, or input.media")
	}

	// Wan2.7 image-to-video uses the new input.media protocol. Avoid sending
	// legacy fields that belong to wan2.6 and earlier image-to-video APIs.
	aliReq.Input.ImgURL = ""
	aliReq.Input.FirstFrameURL = ""
	aliReq.Input.LastFrameURL = ""
	aliReq.Input.AudioURL = ""
	return nil
}

func (a *TaskAdaptor) convertToAliRequest(info *relaycommon.RelayInfo, req relaycommon.TaskSubmitReq) (*AliVideoRequest, error) {
	upstreamModel := req.Model
	if info.IsModelMapped {
		upstreamModel = info.UpstreamModelName
	}
	aliReq := &AliVideoRequest{
		Model: upstreamModel,
		Input: AliVideoInput{
			Prompt: req.Prompt,
			ImgURL: firstTaskImage(req),
		},
		Parameters: &AliVideoParameters{
			PromptExtend: true, // 默认开启智能改写
			Watermark:    false,
		},
	}

	// 处理分辨率映射
	if req.Size != "" {
		// text to video size must be contained *
		if strings.Contains(req.Model, "t2v") && !strings.Contains(req.Size, "*") {
			return nil, fmt.Errorf("invalid size: %s, example: %s", req.Size, "1920*1080")
		}
		if strings.Contains(req.Size, "*") {
			aliReq.Parameters.Size = req.Size
		} else {
			resolution := strings.ToUpper(req.Size)
			// 支持 480p, 720p, 1080p 或 480P, 720P, 1080P
			if !strings.HasSuffix(resolution, "P") {
				resolution = resolution + "P"
			}
			aliReq.Parameters.Resolution = resolution
		}
	} else {
		// 根据模型设置默认分辨率
		if strings.Contains(req.Model, "t2v") { // image to video
			if strings.HasPrefix(req.Model, "wan2.5") {
				aliReq.Parameters.Size = "1920*1080"
			} else if strings.HasPrefix(req.Model, "wan2.2") {
				aliReq.Parameters.Size = "1920*1080"
			} else {
				aliReq.Parameters.Size = "1280*720"
			}
		} else {
			if strings.HasPrefix(req.Model, "wan2.6") {
				aliReq.Parameters.Resolution = "1080P"
			} else if strings.HasPrefix(req.Model, "wan2.5") {
				aliReq.Parameters.Resolution = "1080P"
			} else if strings.HasPrefix(req.Model, "wan2.2-i2v-flash") {
				aliReq.Parameters.Resolution = "720P"
			} else if strings.HasPrefix(req.Model, "wan2.2-i2v-plus") {
				aliReq.Parameters.Resolution = "1080P"
			} else {
				aliReq.Parameters.Resolution = "720P"
			}
		}
	}

	// 处理时长
	if req.Duration > 0 {
		aliReq.Parameters.Duration = req.Duration
	} else if req.Seconds != "" {
		seconds, err := strconv.Atoi(req.Seconds)
		if err != nil {
			return nil, errors.Wrap(err, "convert seconds to int failed")
		} else {
			aliReq.Parameters.Duration = seconds
		}
	}
	if aliReq.Parameters.Duration <= 0 {
		aliReq.Parameters.Duration = 5 // 默认5秒
	}

	// 从 metadata 中提取额外参数
	if req.Metadata != nil {
		if metadataBytes, err := common.Marshal(req.Metadata); err == nil {
			err = common.Unmarshal(metadataBytes, aliReq)
			if err != nil {
				return nil, errors.Wrap(err, "unmarshal metadata failed")
			}
		} else {
			return nil, errors.Wrap(err, "marshal metadata failed")
		}
	}

	if aliReq.Model != upstreamModel {
		return nil, errors.New("can't change model with metadata")
	}

	// metadata 可绕过顶层时长校验：duration 是计费乘数，必须强制上下界。
	// -1 是 wan3 智能时长的合法值（预扣按 5 秒估算，结算按上游真实时长），
	// 其余模型不支持智能时长，归入默认 5 秒。
	// 模型映射可能把 wan3 映射为别名（或反向），协议判定同时看原始与上游模型名。
	wan3 := IsWan3Model(aliReq.Model) || IsWan3Model(req.Model)
	if aliReq.Parameters.Duration > relaycommon.MaxTaskDurationSeconds || aliReq.Parameters.Duration < -1 {
		return nil, fmt.Errorf("duration must be -1 (smart duration) or between 0 and %d", relaycommon.MaxTaskDurationSeconds)
	}
	if aliReq.Parameters.Duration <= 0 {
		if aliReq.Parameters.Duration == -1 && wan3 {
			// 保留 -1 透传上游智能时长
		} else {
			aliReq.Parameters.Duration = 5
		}
	}
	if !wan3 {
		// ratio 仅 wan3 支持，legacy 模型发送会被上游拒绝
		aliReq.Parameters.Ratio = ""
	}

	if err := normalizeWan27I2VInput(aliReq, req); err != nil {
		return nil, err
	}
	if err := normalizeWan3Input(aliReq, req); err != nil {
		return nil, err
	}

	return aliReq, nil
}

// EstimateBilling 根据用户请求参数计算 OtherRatios（时长、分辨率等）。
// 在 ValidateRequestAndSetAction 之后、价格计算之前调用。
func (a *TaskAdaptor) EstimateBilling(c *gin.Context, info *relaycommon.RelayInfo) map[string]float64 {
	taskReq, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil
	}

	aliReq, err := a.convertToAliRequest(info, taskReq)
	if err != nil {
		return nil
	}

	// metadata can override Duration past standard request validation;
	// cap it because it is used as a billing multiplier.
	// -1 智能时长/未指定按 5 秒预估，结算按上游真实时长重算。
	seconds := aliReq.Parameters.Duration
	if seconds <= 0 {
		seconds = 5
	}
	otherRatios := map[string]float64{
		"seconds": float64(min(seconds, relaycommon.MaxTaskDurationSeconds)),
	}
	// wan 按秒档价模式：档价已在 ModelPriceHelperPerCall 中按每秒绝对单价计费，
	// 只注入 seconds 倍率，不再叠加 legacy 分辨率相对倍率。
	if billing_setting.GetBillingMode(info.OriginModelName) == billing_setting.BillingModeWan {
		if _, ok := billing_setting.GetWanConfig(info.OriginModelName); ok {
			return otherRatios
		}
	}
	ratios, err := ProcessAliOtherRatios(aliReq)
	if err != nil {
		return otherRatios
	}
	for k, v := range ratios {
		otherRatios[k] = v
	}
	return otherRatios
}

// AdjustBillingOnComplete 任务成功时按上游真实 usage.duration × 实际分辨率档价重算 wan 按秒计费。
// 提交预扣用的是请求分辨率（或最高档兜底）× 预估秒数，可能与实际输出不同；
// 返回 > 0 触发差额结算（多退少补）；返回 0 表示保持预扣（非 wan 模式 / 响应缺结算依据 / 档未配置）。
func (a *TaskAdaptor) AdjustBillingOnComplete(task *model.Task, taskResult *relaycommon.TaskInfo) int {
	if task == nil || taskResult == nil || taskResult.Status != model.TaskStatusSuccess {
		return 0
	}
	modelName := task.Properties.OriginModelName
	if bc := task.PrivateData.BillingContext; bc != nil && bc.OriginModelName != "" {
		modelName = bc.OriginModelName
	}
	if billing_setting.GetBillingMode(modelName) != billing_setting.BillingModeWan {
		return 0
	}
	resolution := strings.TrimSpace(taskResult.Resolution)
	if resolution == "" || taskResult.Duration <= 0 {
		return 0
	}
	tierPrice, ok := billing_setting.GetWanTierPrice(modelName, resolution)
	if !ok {
		return 0
	}
	quota, ok := service.ComputeTaskQuotaBySeconds(task, taskResult.Duration, tierPrice)
	if !ok || quota <= 0 {
		return 0
	}
	return quota
}

// DoRequest delegates to common helper
func (a *TaskAdaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoTaskApiRequest(a, c, info, requestBody)
}

// DoResponse handles upstream response
func (a *TaskAdaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (taskID string, taskData []byte, taskErr *dto.TaskError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		taskErr = service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
		return
	}
	_ = resp.Body.Close()

	// 解析阿里响应
	var aliResp AliVideoResponse
	if err := common.Unmarshal(responseBody, &aliResp); err != nil {
		taskErr = service.TaskErrorWrapper(errors.Wrapf(err, "body: %s", responseBody), "unmarshal_response_body_failed", http.StatusInternalServerError)
		return
	}

	// 检查错误
	if aliResp.Code != "" {
		taskErr = service.TaskErrorWrapper(fmt.Errorf("%s: %s", aliResp.Code, aliResp.Message), "ali_api_error", resp.StatusCode)
		return
	}

	if aliResp.Output.TaskID == "" {
		taskErr = service.TaskErrorWrapper(fmt.Errorf("task_id is empty"), "invalid_response", http.StatusInternalServerError)
		return
	}

	// 转换为 OpenAI 格式响应
	openAIResp := dto.NewOpenAIVideo()
	openAIResp.ID = info.PublicTaskID
	openAIResp.TaskID = info.PublicTaskID
	openAIResp.Model = c.GetString("model")
	if openAIResp.Model == "" && info != nil {
		openAIResp.Model = info.OriginModelName
	}
	openAIResp.Status = convertAliStatus(aliResp.Output.TaskStatus)
	openAIResp.CreatedAt = common.GetTimestamp()

	// 返回 OpenAI 格式
	c.JSON(http.StatusOK, openAIResp)

	return aliResp.Output.TaskID, responseBody, nil
}

// FetchTask 查询任务状态
func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok {
		return nil, fmt.Errorf("invalid task_id")
	}

	uri := NormalizeWanBaseURL(baseUrl) + "/api/v1/tasks/" + url.PathEscape(taskID)

	req, err := http.NewRequest(http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}

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

// ParseTaskResult 解析任务结果
func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	var aliResp AliVideoResponse
	if err := common.Unmarshal(respBody, &aliResp); err != nil {
		return nil, errors.Wrap(err, "unmarshal task result failed")
	}

	taskResult := relaycommon.TaskInfo{
		Code: 0,
	}

	// 状态映射
	switch aliResp.Output.TaskStatus {
	case "PENDING":
		taskResult.Status = model.TaskStatusQueued
	case "RUNNING":
		taskResult.Status = model.TaskStatusInProgress
	case "SUCCEEDED":
		taskResult.Status = model.TaskStatusSuccess
		// 阿里直接返回视频URL，不需要额外的代理端点
		taskResult.Url = aliResp.Output.VideoURL
		// wan 按秒结算依据：实际输出分辨率（SR）与计费时长（duration，可为浮点）
		if aliResp.Usage != nil {
			if sr := int(aliResp.Usage.SR); sr > 0 {
				if sr >= 2160 {
					taskResult.Resolution = "4k"
				} else {
					taskResult.Resolution = fmt.Sprintf("%dp", sr)
				}
			}
			taskResult.Duration = float64(aliResp.Usage.Duration)
		}
	case "FAILED", "CANCELED", "UNKNOWN":
		taskResult.Status = model.TaskStatusFailure
		if aliResp.Message != "" {
			taskResult.Reason = aliResp.Message
		} else if aliResp.Output.Message != "" {
			taskResult.Reason = fmt.Sprintf("task failed, code: %s , message: %s", aliResp.Output.Code, aliResp.Output.Message)
		} else {
			taskResult.Reason = "task failed"
		}
	default:
		taskResult.Status = model.TaskStatusQueued
	}

	// 完成时间采用上游 end_time（DashScope 返回北京时间，可带毫秒）：漏结算任务
	// 被很久后的实时查询/补录结算时，本地检测时刻会严重偏离真实完成时间，结算日志
	// 时间与耗时展示随之漂移（与 volc 采用 updated_at 同一约定）。解析失败保持 0，
	// ApplyUpstreamTaskResult 的时钟守卫会回退本地检测时刻。
	if endTime := strings.TrimSpace(aliResp.Output.EndTime); endTime != "" {
		if t, err := time.ParseInLocation("2006-01-02 15:04:05", endTime, time.FixedZone("UTC+8", 8*3600)); err == nil {
			taskResult.FinishTime = t.Unix()
		}
	}

	return &taskResult, nil
}

func (a *TaskAdaptor) ConvertToOpenAIVideo(task *model.Task) ([]byte, error) {
	var aliResp AliVideoResponse
	if err := common.Unmarshal(task.Data, &aliResp); err != nil {
		return nil, errors.Wrap(err, "unmarshal ali response failed")
	}

	openAIResp := dto.NewOpenAIVideo()
	openAIResp.ID = task.TaskID
	openAIResp.Status = convertAliStatus(aliResp.Output.TaskStatus)
	openAIResp.Model = task.Properties.OriginModelName
	openAIResp.SetProgressStr(task.Progress)
	openAIResp.CreatedAt = task.CreatedAt
	openAIResp.CompletedAt = task.UpdatedAt

	// 设置视频URL（核心字段）
	openAIResp.SetMetadata("url", aliResp.Output.VideoURL)

	// 错误处理
	if aliResp.Code != "" {
		openAIResp.Error = &dto.OpenAIVideoError{
			Code:    aliResp.Code,
			Message: aliResp.Message,
		}
	} else if aliResp.Output.Code != "" {
		openAIResp.Error = &dto.OpenAIVideoError{
			Code:    aliResp.Output.Code,
			Message: aliResp.Output.Message,
		}
	}

	return common.Marshal(openAIResp)
}

func convertAliStatus(aliStatus string) string {
	switch aliStatus {
	case "PENDING":
		return dto.VideoStatusQueued
	case "RUNNING":
		return dto.VideoStatusInProgress
	case "SUCCEEDED":
		return dto.VideoStatusCompleted
	case "FAILED", "CANCELED", "UNKNOWN":
		return dto.VideoStatusFailed
	default:
		return dto.VideoStatusUnknown
	}
}
