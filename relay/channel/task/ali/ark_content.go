package ali

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

// 方舟 content 数组协议（Playground 同源客户端）→ 统一任务协议转换。
// 统一协议以 prompt/images/size/duration 描述任务，媒体语义按模型区分：
// wan3 系列走官方 input.media 数组（支持参考图/参考视频/参考音频），
// wan2.7-i2v 走 first_frame/last_frame/driving_audio，legacy 模型走 img_url/audio_url。

// arkMediaURL 兼容方舟 content 协议的媒体字段：字符串 URL 或 {url} 对象。
type arkMediaURL struct {
	URL string
}

func (m *arkMediaURL) UnmarshalJSON(data []byte) error {
	var s string
	if err := common.Unmarshal(data, &s); err == nil {
		m.URL = s
		return nil
	}
	var obj struct {
		URL string `json:"url"`
	}
	if err := common.Unmarshal(data, &obj); err != nil {
		return err
	}
	m.URL = obj.URL
	return nil
}

type arkContentItem struct {
	Type     string       `json:"type"`
	Role     string       `json:"role"`
	Text     string       `json:"text"`
	ImageURL *arkMediaURL `json:"image_url"`
	VideoURL *arkMediaURL `json:"video_url"`
	AudioURL *arkMediaURL `json:"audio_url"`
}

type arkTaskBody struct {
	Model         string           `json:"model"`
	Content       []arkContentItem `json:"content"`
	Resolution    string           `json:"resolution"`
	Ratio         string           `json:"ratio"`
	Duration      *dto.IntValue    `json:"duration"`
	GenerateAudio *dto.BoolValue   `json:"generate_audio"`
	Watermark     *dto.BoolValue   `json:"watermark"`
}

// ConvertArkTaskBody 识别方舟 content 协议体并转换为统一协议体。
// 非方舟体（无 content 数组或非法 JSON）返回 isArk=false，交由共享校验器处理。
// 转换失败（不支持的输入/越界时长）返回错误，调用方应以 400 拒绝。
func ConvertArkTaskBody(raw []byte) (unified []byte, isArk bool, err error) {
	var req arkTaskBody
	if unmarshalErr := common.Unmarshal(raw, &req); unmarshalErr != nil {
		return nil, false, nil
	}
	if len(req.Content) == 0 {
		return nil, false, nil
	}

	wan3 := IsWan3Model(req.Model)
	wan27 := isWan27I2VModel(req.Model)

	var texts, images []string
	var media []AliVideoMedia
	legacyAudio := ""
	for _, item := range req.Content {
		switch item.Type {
		case "text":
			if strings.TrimSpace(item.Text) != "" {
				texts = append(texts, item.Text)
			}
		case "image_url":
			if item.ImageURL == nil {
				continue
			}
			u := strings.TrimSpace(item.ImageURL.URL)
			if u == "" {
				continue
			}
			images = append(images, u)
			if wan3 || wan27 {
				mediaType := "first_frame"
				if item.Role == "last_frame" {
					mediaType = "last_frame"
				} else if wan3 && item.Role == "reference_image" {
					mediaType = "reference_image"
				}
				media = append(media, AliVideoMedia{Type: mediaType, URL: u})
			}
		case "video_url":
			if item.VideoURL == nil {
				continue
			}
			u := strings.TrimSpace(item.VideoURL.URL)
			if u == "" {
				continue
			}
			if !wan3 {
				return nil, true, fmt.Errorf("%s 不支持参考视频输入", req.Model)
			}
			media = append(media, AliVideoMedia{Type: "reference_video", URL: u})
		case "audio_url":
			if item.AudioURL == nil {
				continue
			}
			u := strings.TrimSpace(item.AudioURL.URL)
			if u == "" {
				continue
			}
			if wan3 {
				media = append(media, AliVideoMedia{Type: "reference_audio", URL: u})
			} else if wan27 {
				media = append(media, AliVideoMedia{Type: "driving_audio", URL: u})
			} else if legacyAudio == "" {
				legacyAudio = u
			}
		}
	}
	if wan3 {
		if err := validateWan3Media(media); err != nil {
			return nil, true, err
		}
	}

	// 分辨率档 → 统一 size 字段；t2v 模型需要具体尺寸，按档位映射代表尺寸
	size := ""
	if res := strings.ToLower(strings.TrimSpace(req.Resolution)); res != "" {
		if res != "4k" && !strings.HasSuffix(res, "p") {
			res += "p"
		}
		size = strings.ToUpper(res)
		if strings.Contains(req.Model, "t2v") {
			switch size {
			case "480P":
				size = "832*480"
			case "720P":
				size = "1280*720"
			case "1080P":
				size = "1920*1080"
			default:
				return nil, true, fmt.Errorf("%s 不支持该分辨率: %s", req.Model, req.Resolution)
			}
		}
	}

	parameters := map[string]any{}
	if req.Duration != nil {
		duration := int(*req.Duration)
		if duration < -1 || duration > relaycommon.MaxTaskDurationSeconds {
			return nil, true, fmt.Errorf("duration must be -1 (smart duration) or between 0 and %d", relaycommon.MaxTaskDurationSeconds)
		}
		if duration != 0 {
			parameters["duration"] = duration
		}
	}
	if ratio := strings.TrimSpace(req.Ratio); ratio != "" {
		parameters["ratio"] = ratio
	}
	if req.GenerateAudio != nil {
		parameters["audio"] = bool(*req.GenerateAudio)
	}
	if req.Watermark != nil {
		parameters["watermark"] = bool(*req.Watermark)
	} else {
		parameters["watermark"] = false
	}

	body := map[string]any{
		"model": req.Model,
	}
	if prompt := strings.Join(texts, "\n"); prompt != "" {
		body["prompt"] = prompt
	}
	if len(images) > 0 {
		body["images"] = images
	}
	if size != "" {
		body["size"] = size
	}
	// 正时长走顶层字段接受共享上下界校验；-1 智能时长仅放入 parameters，
	// 由 convertToAliRequest 按模型校验（共享校验器不接受负值）。
	if d, ok := parameters["duration"].(int); ok && d > 0 {
		body["duration"] = d
	}
	metadata := map[string]any{}
	if len(parameters) > 0 {
		metadata["parameters"] = parameters
	}
	input := map[string]any{}
	if len(media) > 0 {
		input["media"] = media
	}
	if legacyAudio != "" {
		input["audio_url"] = legacyAudio
	}
	if len(input) > 0 {
		metadata["input"] = input
	}
	if len(metadata) > 0 {
		body["metadata"] = metadata
	}

	unified, err = common.Marshal(body)
	if err != nil {
		return nil, true, err
	}
	return unified, true, nil
}

// BuildOfficialWanBody 把统一协议体转换为 DashScope 官方请求体，
// 供 wan-native 适配器转换方舟 content 体时复用同一条转换链路。
func BuildOfficialWanBody(unifiedBody []byte, info *relaycommon.RelayInfo) ([]byte, error) {
	var req relaycommon.TaskSubmitReq
	if err := common.Unmarshal(unifiedBody, &req); err != nil {
		return nil, err
	}
	a := &TaskAdaptor{}
	aliReq, err := a.convertToAliRequest(info, req)
	if err != nil {
		return nil, err
	}
	return common.Marshal(aliReq)
}

// validateWan3Media 按官方文档校验 wan3.0 media 数组：
// first_frame/last_frame 各 ≤1，reference_image ≤10，reference_video/reference_audio 各 ≤5，
// file/link 各 ≤1；首尾帧与参考素材互斥，file 与 link 互斥。
func validateWan3Media(media []AliVideoMedia) error {
	counts := map[string]int{}
	hasFrame, hasReference, hasFile, hasLink := false, false, false, false
	for _, item := range media {
		if strings.TrimSpace(item.URL) == "" {
			return fmt.Errorf("media url is required")
		}
		switch item.Type {
		case "first_frame", "last_frame":
			hasFrame = true
		case "reference_image", "reference_video", "reference_audio":
			hasReference = true
		case "file":
			hasFile = true
		case "link":
			hasLink = true
		default:
			return fmt.Errorf("wan3.0 不支持的媒体类型: %s", item.Type)
		}
		counts[item.Type]++
	}
	limits := map[string]int{
		"first_frame": 1, "last_frame": 1,
		"reference_image": 10, "reference_video": 5, "reference_audio": 5,
		"file": 1, "link": 1,
	}
	for mediaType, count := range counts {
		if count > limits[mediaType] {
			return fmt.Errorf("wan3.0 %s 输入数量超过上限 %d", mediaType, limits[mediaType])
		}
	}
	if hasFrame && hasReference {
		return fmt.Errorf("wan3.0 首尾帧与参考素材不能同时使用")
	}
	if hasFile && hasLink {
		return fmt.Errorf("wan3.0 file 与 link 不能同时使用")
	}
	return nil
}

// normalizeWan3Input 把 wan3 请求归一化为官方 input.media 数组协议：
// 未显式提供 media 时从 legacy 图片/音频字段组装，随后清除 legacy 字段
// （wan3 上游不识别 img_url 等旧字段）。文生视频允许无 media。
func normalizeWan3Input(aliReq *AliVideoRequest, req relaycommon.TaskSubmitReq) error {
	if !IsWan3Model(aliReq.Model) && !IsWan3Model(req.Model) {
		return nil
	}

	if len(aliReq.Input.Media) == 0 {
		firstFrameURL := firstNonEmpty(aliReq.Input.FirstFrameURL, aliReq.Input.ImgURL, firstTaskImage(req))
		lastFrameURL := firstNonEmpty(aliReq.Input.LastFrameURL, secondTaskImage(req))
		audioURL := aliReq.Input.AudioURL
		if firstFrameURL != "" {
			aliReq.Input.Media = append(aliReq.Input.Media, AliVideoMedia{Type: "first_frame", URL: firstFrameURL})
		}
		if lastFrameURL != "" {
			aliReq.Input.Media = append(aliReq.Input.Media, AliVideoMedia{Type: "last_frame", URL: lastFrameURL})
		}
		if audioURL != "" {
			aliReq.Input.Media = append(aliReq.Input.Media, AliVideoMedia{Type: "reference_audio", URL: audioURL})
		}
	}
	if err := validateWan3Media(aliReq.Input.Media); err != nil {
		return err
	}

	// size（如 1280*720）映射为分辨率档，wan3 不接受具体尺寸
	if aliReq.Parameters.Size != "" {
		resolution, err := sizeToResolution(aliReq.Parameters.Size)
		if err != nil {
			return err
		}
		aliReq.Parameters.Resolution = resolution
		aliReq.Parameters.Size = ""
	}
	if res := aliReq.Parameters.Resolution; res != "" && res != "480P" && res != "720P" && res != "1080P" {
		return fmt.Errorf("wan3.0 仅支持 480P/720P/1080P 分辨率: %s", res)
	}
	if aliReq.Parameters.Duration != -1 && (aliReq.Parameters.Duration < 2 || aliReq.Parameters.Duration > 30) {
		return fmt.Errorf("wan3.0 duration must be -1 (smart duration) or between 2 and 30")
	}

	aliReq.Input.ImgURL = ""
	aliReq.Input.FirstFrameURL = ""
	aliReq.Input.LastFrameURL = ""
	aliReq.Input.AudioURL = ""
	return nil
}
