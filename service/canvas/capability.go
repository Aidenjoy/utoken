package canvas

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
)

// ===== 智能画布：工具能力注册 =====
// 每个工具的模型、参数、限制都来自官方协议（见 docs/canvas/upstream.md 的对照表）：
//   - Ark 图片生成 API  POST https://ark.cn-beijing.volces.com/api/v3/images/generations
//   - AI MediaKit 同步工具 POST https://mediakit.cn-beijing.volces.com/api/v1/tools-sync/*
// 未配置渠道/凭证、或模型不在已核实的能力表内时，能力接口返回 available=false + 原因，
// 前端禁用该工具并展示原因，不做任何静默降级。

// 工具标识（前端与任务表共用）
const (
	ToolTextToImage       = "text2image"         // 文生图
	ToolImageRefSingle    = "image_ref_single"   // 单图参考生成
	ToolImageRefMulti     = "image_ref_multi"    // 多图参考生成
	ToolErase             = "erase"              // 涂抹消除
	ToolPromptInpaint     = "prompt_inpaint"     // 提示词局部编辑
	ToolRefInpaint        = "ref_inpaint"        // 参考图局部编辑
	ToolOutpaint          = "outpaint"           // 智能扩图
	ToolMatting           = "matting"            // 主体分割 / 透明抠图
	ToolUpscale           = "upscale"            // 普通超分
	ToolGenerativeUpscale = "generative_upscale" // 生成式超分
)

// 上游实现
const (
	UpstreamArk      = "ark"      // 经网关 Relay 转发 Ark 图片生成 API
	UpstreamMediaKit = "mediakit" // 直连 AI MediaKit 同步工具
)

// 蒙版语义
const (
	MaskNone     = "none"     // 接口不接受蒙版
	MaskRequired = "required" // 必须提交与工具要求尺寸一致的蒙版
	MaskOptional = "optional" // 可选
)

// ParamSpec 工具的可调参数（前端按此渲染控件，后端按此校验）
type ParamSpec struct {
	Name    string   `json:"name"`
	Label   string   `json:"label"`
	Type    string   `json:"type"` // string | int | float | bool | enum
	Enum    []string `json:"enum,omitempty"`
	Min     *float64 `json:"min,omitempty"`
	Max     *float64 `json:"max,omitempty"`
	Default any      `json:"default,omitempty"`
	Help    string   `json:"help,omitempty"`
}

// ToolLimits 工具输入限制（能力接口原样下发，前端据此做即时校验）
type ToolLimits struct {
	Tiers             []string `json:"tiers,omitempty"`     // 分辨率档位（1K/1.5K/2K/2K/3K/4K）
	MinPixels         int      `json:"minPixels,omitempty"` // 指定 WxH 时的总像素下限
	MaxPixels         int      `json:"maxPixels,omitempty"` // 指定 WxH 时的总像素上限
	AspectMin         float64  `json:"aspectMin,omitempty"` // 宽高比下限（宽/高）
	AspectMax         float64  `json:"aspectMax,omitempty"` // 宽高比上限
	MaxRefImages      int      `json:"maxRefImages"`
	MinMultiRefImages int      `json:"minMultiRefImages,omitempty"`
	MaxPromptRunes    int      `json:"maxPromptRunes"`
	MaxFileBytes      int64    `json:"maxFileBytes"`
	MaxSidePixels     int      `json:"maxSidePixels,omitempty"`
}

// ToolSpec 工具定义
type ToolSpec struct {
	Tool           string
	Label          string
	Description    string
	Upstream       string
	SupportsMask   string
	MaskHint       string
	RequiresImage  bool
	MinImages      int
	MaxImages      int
	RequiresPrompt bool
	Cancelable     bool
	Params         []ParamSpec
}

func floatPtr(v float64) *float64 { return &v }

// toolRegistry 工具注册表。顺序即前端展示顺序。
var toolRegistry = []ToolSpec{
	{
		Tool: ToolTextToImage, Label: "文生图", Upstream: UpstreamArk,
		Description:  "输入提示词直接生成图片，尺寸按画布目标画幅换算。",
		SupportsMask: MaskNone, Cancelable: false,
		Params: []ParamSpec{
			{Name: "size", Label: "尺寸", Type: "string", Help: "如 2048x2048 或 2K"},
		},
	},
	{
		Tool: ToolImageRefSingle, Label: "单图参考生成", Upstream: UpstreamArk,
		Description:  "以一张参考图为主体，按提示词重绘/改造。",
		SupportsMask: MaskNone, RequiresImage: true, MinImages: 1, MaxImages: 1, RequiresPrompt: true,
		Params: []ParamSpec{
			{Name: "size", Label: "尺寸", Type: "string"},
		},
	},
	{
		Tool: ToolImageRefMulti, Label: "多图参考生成", Upstream: UpstreamArk,
		Description:  "融合多张参考图（主体/风格/场景）生成新图，参考图数量受所选模型限制。",
		SupportsMask: MaskNone, RequiresImage: true, MinImages: 2, MaxImages: maxCanvasRefImages, RequiresPrompt: true,
		Params: []ParamSpec{
			{Name: "size", Label: "尺寸", Type: "string"},
		},
	},
	{
		Tool: ToolErase, Label: "涂抹消除", Upstream: UpstreamMediaKit,
		Description:  "按蒙版擦除指定区域并用背景纹理修复，蒙版尺寸必须与原图一致。",
		SupportsMask: MaskRequired, RequiresImage: true, MinImages: 1, MaxImages: 1,
		MaskHint: "白色为需擦除区域，蒙版宽高必须与输入图完全一致。",
		Params: []ParamSpec{
			{Name: "toolVersion", Label: "模型版本", Type: "enum", Enum: []string{"standard"}, Default: "standard"},
		},
	},
	{
		Tool: ToolPromptInpaint, Label: "提示词局部编辑", Upstream: UpstreamArk,
		Description:  "在提示词中描述要修改的部位与效果，其余区域尽量保持不变。",
		SupportsMask: MaskNone, RequiresImage: true, MinImages: 1, MaxImages: 1, RequiresPrompt: true,
		Params: []ParamSpec{
			{Name: "size", Label: "输出尺寸", Type: "string", Help: "留空表示与原图同尺寸"},
		},
	},
	{
		Tool: ToolRefInpaint, Label: "参考图局部编辑", Upstream: UpstreamArk,
		Description:  "以参考图约束人物/商品一致性，再按提示词局部改造目标图。",
		SupportsMask: MaskNone, RequiresImage: true, MinImages: 1, MaxImages: maxCanvasRefImages, RequiresPrompt: true,
		Params: []ParamSpec{
			{Name: "size", Label: "输出尺寸", Type: "string"},
		},
	},
	{
		Tool: ToolOutpaint, Label: "智能扩图", Upstream: UpstreamMediaKit,
		Description:  "向四边扩展画面，支持等比、目标画幅、四边比例与自定义画布。",
		SupportsMask: MaskNone, RequiresImage: true, MinImages: 1, MaxImages: 1,
		Params: []ParamSpec{
			{Name: "mode", Label: "扩展方式", Type: "enum", Enum: []string{"ratio", "aspect", "edges", "canvas"}, Default: "ratio",
				Help: "ratio=等比扩展；aspect=目标画幅；edges=四边独立比例；canvas=自定义画布尺寸"},
			{Name: "ratio", Label: "等比倍数", Type: "float", Min: floatPtr(1), Max: floatPtr(1.8), Default: 1.25},
			{Name: "targetAspect", Label: "目标画幅", Type: "string", Default: "1:1", Help: "如 1:1、16:9、9:16、4:3"},
			{Name: "top", Label: "上", Type: "float", Min: floatPtr(0), Max: floatPtr(0.4), Default: 0.1},
			{Name: "bottom", Label: "下", Type: "float", Min: floatPtr(0), Max: floatPtr(0.4), Default: 0.1},
			{Name: "left", Label: "左", Type: "float", Min: floatPtr(0), Max: floatPtr(0.4), Default: 0.1},
			{Name: "right", Label: "右", Type: "float", Min: floatPtr(0), Max: floatPtr(0.4), Default: 0.1},
			{Name: "targetWidth", Label: "目标宽", Type: "int"},
			{Name: "targetHeight", Label: "目标高", Type: "int"},
		},
	},
	{
		Tool: ToolMatting, Label: "主体分割 / 透明抠图", Upstream: UpstreamMediaKit,
		Description:  "识别主体并移除背景，输出透明底 PNG。",
		SupportsMask: MaskNone, RequiresImage: true, MinImages: 1, MaxImages: 1,
		Params: []ParamSpec{
			{Name: "scene", Label: "场景", Type: "enum", Enum: []string{"general", "human", "product"}, Default: "general"},
			{Name: "needContour", Label: "主体描边", Type: "bool", Default: false},
			{Name: "contourColor", Label: "描边颜色", Type: "string", Default: "#FFFFFF"},
			{Name: "contourSize", Label: "描边宽度", Type: "int", Min: floatPtr(1), Max: floatPtr(100), Default: 10},
			{Name: "cropBackground", Label: "裁剪透明边", Type: "bool", Default: false},
		},
	},
	{
		Tool: ToolUpscale, Label: "普通超分", Upstream: UpstreamMediaKit,
		Description:  "保真优先的画质增强，按倍数或目标尺寸放大。",
		SupportsMask: MaskNone, RequiresImage: true, MinImages: 1, MaxImages: 1,
		Params: []ParamSpec{
			{Name: "toolVersion", Label: "模型版本", Type: "enum", Enum: []string{"standard", "professional"}, Default: "standard"},
			{Name: "multiple", Label: "放大倍数", Type: "float", Min: floatPtr(1), Max: floatPtr(8), Default: 2},
			{Name: "targetWidth", Label: "目标宽", Type: "int"},
			{Name: "targetHeight", Label: "目标高", Type: "int"},
		},
	},
	{
		Tool: ToolGenerativeUpscale, Label: "生成式超分", Upstream: UpstreamMediaKit,
		Description:  "基于生成式大模型修复画质并补充自然纹理（MediaKit 大模型增强版）。",
		SupportsMask: MaskNone, RequiresImage: true, MinImages: 1, MaxImages: 1,
		Params: []ParamSpec{
			{Name: "toolVersion", Label: "模型版本", Type: "enum", Enum: []string{"max"}, Default: "max"},
			{Name: "multiple", Label: "放大倍数", Type: "float", Min: floatPtr(1), Max: floatPtr(30), Default: 2},
			{Name: "generativeEnhanceMode", Label: "增强策略", Type: "enum", Enum: []string{"generative_first"}, Default: "generative_first"},
			{Name: "enableCorrectColor", Label: "色彩校正", Type: "bool", Default: true},
			{Name: "targetWidth", Label: "目标宽", Type: "int"},
			{Name: "targetHeight", Label: "目标高", Type: "int"},
		},
	},
}

// GetToolSpec 按标识取工具定义
func GetToolSpec(tool string) (ToolSpec, bool) {
	for _, spec := range toolRegistry {
		if spec.Tool == tool {
			return spec, true
		}
	}
	return ToolSpec{}, false
}

// imageModelProfile 已核实的 Ark 图片模型能力（取自官方「图片生成 API」文档）。
type imageModelProfile struct {
	Family              string
	Tiers               []string
	MinPixels           int
	MaxPixels           int
	AspectMin           float64
	AspectMax           float64
	MaxRefImages        int
	MinMultiRefImages   int
	SupportsSequential  bool
	SupportsTransparent bool
}

// imageModelProfiles 按模型 ID 前缀匹配。只登记文档中明确给出限制的模型家族；
// 未登记的模型一律判为不可用，而不是套用近似限制——错误的上限校验会直接导致上游 400。
var imageModelProfiles = []struct {
	Prefix  string
	Profile imageModelProfile
}{
	{"doubao-seedream-5-5", imageModelProfile{
		Family: "seedream-5.5", Tiers: []string{"1K", "1.5K", "2K"},
		MinPixels: 921600, MaxPixels: 4624220, AspectMin: 1.0 / 16, AspectMax: 16,
		MaxRefImages: 10, MinMultiRefImages: 2, SupportsSequential: false, SupportsTransparent: true,
	}},
	{"doubao-seedream-5-0-pro", imageModelProfile{
		Family: "seedream-5.0-pro", Tiers: []string{"1K", "1.5K", "2K"},
		MinPixels: 921600, MaxPixels: 4624220, AspectMin: 1.0 / 16, AspectMax: 16,
		MaxRefImages: 10, MinMultiRefImages: 2, SupportsSequential: false, SupportsTransparent: true,
	}},
	{"doubao-seedream-5-0-flash", imageModelProfile{
		Family: "seedream-5.0-flash", Tiers: []string{"1K", "1.5K", "2K"},
		MinPixels: 921600, MaxPixels: 4624220, AspectMin: 1.0 / 16, AspectMax: 16,
		MaxRefImages: 10, MinMultiRefImages: 2, SupportsSequential: false, SupportsTransparent: true,
	}},
	{"doubao-seedream-5-0-lite", imageModelProfile{
		Family: "seedream-5.0-lite", Tiers: []string{"2K", "3K", "4K"},
		MinPixels: 921600, MaxPixels: 16777216, AspectMin: 1.0 / 16, AspectMax: 16,
		MaxRefImages: 14, MinMultiRefImages: 2, SupportsSequential: true, SupportsTransparent: false,
	}},
	{"doubao-seedream-4-5", imageModelProfile{
		Family: "seedream-4.5", Tiers: []string{"2K", "4K"},
		MinPixels: 3686400, MaxPixels: 16777216, AspectMin: 1.0 / 16, AspectMax: 16,
		MaxRefImages: 14, MinMultiRefImages: 2, SupportsSequential: true, SupportsTransparent: false,
	}},
	{"doubao-seedream-4-0", imageModelProfile{
		Family: "seedream-4.0", Tiers: []string{"1K", "2K", "4K"},
		MinPixels: 921600, MaxPixels: 16777216, AspectMin: 1.0 / 16, AspectMax: 16,
		MaxRefImages: 14, MinMultiRefImages: 2, SupportsSequential: true, SupportsTransparent: false,
	}},
}

// resolveImageModel 返回模型能力；未知模型返回 false（能力接口据此判不可用）。
func resolveImageModel(modelName string) (imageModelProfile, bool) {
	name := strings.ToLower(strings.TrimSpace(modelName))
	for _, item := range imageModelProfiles {
		if strings.HasPrefix(name, item.Prefix) {
			return item.Profile, true
		}
	}
	return imageModelProfile{}, false
}

// arkChannelFor 找出承载该图片模型的可用渠道（45=VolcEngine，60=VolcEngine Image）。
func arkChannelFor(modelName string) (*model.Channel, error) {
	channels, err := model.GetEnabledChannels()
	if err != nil {
		return nil, err
	}
	target := strings.TrimSpace(modelName)
	for _, ch := range channels {
		if ch.Type != constant.ChannelTypeVolcEngine && ch.Type != constant.ChannelTypeVolcEngineImage {
			continue
		}
		for _, item := range strings.Split(ch.Models, ",") {
			if strings.TrimSpace(item) == target {
				return ch, nil
			}
		}
	}
	return nil, fmt.Errorf("未找到承载模型 %s 的可用火山方舟图片渠道", target)
}

// Capability 能力接口返回给前端的工具能力
type Capability struct {
	Tool              string      `json:"tool"`
	Label             string      `json:"label"`
	Description       string      `json:"description"`
	Upstream          string      `json:"upstream"`
	Available         bool        `json:"available"`
	UnavailableReason string      `json:"unavailableReason,omitempty"`
	Model             string      `json:"model,omitempty"`
	ChannelID         int         `json:"channelId,omitempty"`
	ChannelName       string      `json:"channelName,omitempty"`
	SupportsMask      string      `json:"supportsMask"`
	MaskHint          string      `json:"maskHint,omitempty"`
	RequiresImage     bool        `json:"requiresImage"`
	MinImages         int         `json:"minImages"`
	MaxImages         int         `json:"maxImages"`
	RequiresPrompt    bool        `json:"requiresPrompt"`
	Cancelable        bool        `json:"cancelable"`
	UnitPrice         int         `json:"unitPrice"`
	Limits            ToolLimits  `json:"limits"`
	Params            []ParamSpec `json:"params"`
}

// Capabilities 汇总当前部署下每个工具的真实可用性。
// Ark 工具取决于「模型已登记 + 渠道存在」；MediaKit 工具取决于 API Key 是否配置。
func Capabilities() []Capability {
	modelName := imageModel()
	profile, modelKnown := resolveImageModel(modelName)
	channel, channelErr := arkChannelFor(modelName)

	out := make([]Capability, 0, len(toolRegistry))
	for _, spec := range toolRegistry {
		cap := Capability{
			Tool: spec.Tool, Label: spec.Label, Description: spec.Description,
			Upstream: spec.Upstream, SupportsMask: spec.SupportsMask, MaskHint: spec.MaskHint,
			RequiresImage: spec.RequiresImage, MinImages: spec.MinImages, MaxImages: spec.MaxImages,
			RequiresPrompt: spec.RequiresPrompt, Cancelable: spec.Cancelable,
			UnitPrice: toolUnitPrice(spec.Tool), Params: spec.Params,
			Limits: ToolLimits{
				MaxRefImages:   maxCanvasRefImages,
				MaxPromptRunes: 2000,
				MaxFileBytes:   maxUploadBytes(),
				MaxSidePixels:  maxCanvasSide,
			},
		}
		switch spec.Upstream {
		case UpstreamArk:
			cap.Model = modelName
			switch {
			case !modelKnown:
				cap.UnavailableReason = fmt.Sprintf("图片模型 %s 未登记在画布能力表内，请配置受支持的 Seedream 模型", modelName)
			case channelErr != nil:
				cap.UnavailableReason = channelErr.Error()
			default:
				cap.Available = true
				cap.ChannelID = channel.Id
				cap.ChannelName = channel.Name
				cap.Limits.Tiers = profile.Tiers
				cap.Limits.MinPixels = profile.MinPixels
				cap.Limits.MaxPixels = profile.MaxPixels
				cap.Limits.AspectMin = profile.AspectMin
				cap.Limits.AspectMax = profile.AspectMax
				cap.Limits.MaxRefImages = profile.MaxRefImages
				cap.Limits.MinMultiRefImages = profile.MinMultiRefImages
				if spec.MaxImages > profile.MaxRefImages {
					cap.MaxImages = profile.MaxRefImages
				}
			}
		case UpstreamMediaKit:
			cap.Model = mediaKitToolModel(spec.Tool)
			if mediaKitKey() == "" {
				cap.UnavailableReason = "未配置 AI MediaKit API Key（CANVAS_MEDIAKIT_API_KEY），该工具暂不可用"
			} else {
				cap.Available = true
			}
		}
		out = append(out, cap)
	}
	return out
}

// mediaKitToolModel 返回工具对应的 MediaKit 接口名（用于前端展示与联调清单）
func mediaKitToolModel(tool string) string {
	switch tool {
	case ToolErase:
		return "tools-sync/erase-image"
	case ToolOutpaint:
		return "tools-sync/expand-image-canvas"
	case ToolMatting:
		return "tools-sync/remove-image-background"
	case ToolUpscale, ToolGenerativeUpscale:
		return "tools-sync/enhance-image"
	}
	return ""
}

// GetCapability 取单个工具能力
func GetCapability(tool string) (Capability, bool) {
	for _, cap := range Capabilities() {
		if cap.Tool == tool {
			return cap, true
		}
	}
	return Capability{}, false
}

// parseSize 解析 "WxH" 尺寸字符串。
func parseSize(size string) (int, int, bool) {
	parts := strings.Split(strings.ToLower(strings.TrimSpace(size)), "x")
	if len(parts) != 2 {
		return 0, 0, false
	}
	w, errW := strconv.Atoi(strings.TrimSpace(parts[0]))
	h, errH := strconv.Atoi(strings.TrimSpace(parts[1]))
	if errW != nil || errH != nil || w <= 0 || h <= 0 {
		return 0, 0, false
	}
	return w, h, true
}
