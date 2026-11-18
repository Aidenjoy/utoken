package canvas

import (
	"os"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// ===== 智能画布：配置 =====
// 画布本身不直连任何模型供应商的「模型」接口：图片生成/编辑一律经网关自身的
// /v1/images/generations 回环转发（鉴权、限额、计费、日志与真实调用完全一致）。
// 只有 AI MediaKit 的同步图像工具（擦除/抠图/扩图/超分）没有对应的 Relay 适配器，
// 由本包直连其官方同步接口，并在画布层做预扣/结算/退款。
//
// 所有配置都走环境变量（与 DIRECTOR_* 同一约定），未配置时能力接口如实返回
// 「不可用 + 原因」，前端据此禁用对应工具，绝不静默回退到任何默认渠道或凭证。

const (
	// envCanvasImageModel Ark 图片模型 ID（文生图/参考图/局部编辑共用）
	envCanvasImageModel = "CANVAS_IMAGE_MODEL"
	// envCanvasRelayBase 回环地址覆盖（默认复用 DIRECTOR_RELAY_BASE / 本机 PORT）
	envCanvasRelayBase = "CANVAS_RELAY_BASE"
	// envCanvasMediaKitKey AI MediaKit API Key（Bearer）
	envCanvasMediaKitKey = "CANVAS_MEDIAKIT_API_KEY"
	// envCanvasMediaKitBase AI MediaKit 服务地址
	envCanvasMediaKitBase = "CANVAS_MEDIAKIT_BASE_URL"
	// envCanvasTimeout 单次上游调用超时（秒）
	envCanvasTimeout = "CANVAS_UPSTREAM_TIMEOUT"
	// envCanvasPricePrefix 每个工具的单张价格（quota），如 CANVAS_TOOL_PRICE_ERASE=1000
	envCanvasPricePrefix = "CANVAS_TOOL_PRICE_"
	// envCanvasMaxUploadMB 单张上传/参考图体积上限（MB）
	envCanvasMaxUploadMB = "CANVAS_MAX_UPLOAD_MB"
)

const (
	defaultCanvasImageModel = "doubao-seedream-4-0-250828"
	defaultMediaKitBase     = "https://mediakit.cn-beijing.volces.com"
	defaultUpstreamTimeout  = 180
	defaultMaxUploadMB      = 30
	// maxCanvasRefImages 单次请求的参考图硬上限（Ark 各模型上限 <= 14）
	maxCanvasRefImages = 14
	// maxCanvasDocumentBytes 图层文档体积上限，避免超大文档拖垮保存与列表
	maxCanvasDocumentBytes = 8 << 20
	// maxCanvasSide 画布单边上限（像素）
	maxCanvasSide = 8192
)

// imageModel returns the configured Ark image model id ("" means unset).
func imageModel() string {
	if v := strings.TrimSpace(os.Getenv(envCanvasImageModel)); v != "" {
		return v
	}
	return defaultCanvasImageModel
}

// relayBaseURL 回环地址：与云导演共用同一套覆盖变量，默认本机监听端口。
func relayBaseURL() string {
	for _, key := range []string{envCanvasRelayBase, "DIRECTOR_RELAY_BASE"} {
		if base := strings.TrimSpace(os.Getenv(key)); base != "" {
			return strings.TrimRight(base, "/")
		}
	}
	port := os.Getenv("PORT")
	if port == "" && common.Port != nil {
		port = strconv.Itoa(*common.Port)
	}
	if port == "" {
		port = "3000"
	}
	return "http://127.0.0.1:" + port
}

func mediaKitKey() string {
	return strings.TrimSpace(os.Getenv(envCanvasMediaKitKey))
}

func mediaKitBase() string {
	if v := strings.TrimSpace(os.Getenv(envCanvasMediaKitBase)); v != "" {
		return strings.TrimRight(v, "/")
	}
	return defaultMediaKitBase
}

func upstreamTimeoutSeconds() int {
	return common.GetEnvOrDefault(envCanvasTimeout, defaultUpstreamTimeout)
}

func maxUploadBytes() int64 {
	mb := common.GetEnvOrDefault(envCanvasMaxUploadMB, defaultMaxUploadMB)
	if mb <= 0 {
		mb = defaultMaxUploadMB
	}
	return int64(mb) << 20
}

// toolUnitPrice 单个工具的单张价格（quota）。默认 0 表示画布层不计费，
// 此时工具要么走 Relay 计费链路（Ark 工具），要么按免费工具使用。
func toolUnitPrice(tool string) int {
	raw := strings.TrimSpace(os.Getenv(envCanvasPricePrefix + strings.ToUpper(tool)))
	if raw == "" {
		return 0
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v <= 0 {
		return 0
	}
	return v
}

// canvasImageToken 取得用于回环调用的用户图片 Key。
// 优先复用用户已启用的图片类 Key，避免为画布凭空造出一堆密钥；
// 没有可用 Key 时创建一把专用 Key（名称固定，重复调用不会重复创建）。
func canvasImageToken(userID int) (*model.Token, error) {
	var tokens []*model.Token
	err := model.DB.Where("user_id = ? AND status = ? AND key_type = ?",
		userID, common.TokenStatusEnabled, model.TokenKeyTypeImage).
		Order("id ASC").Limit(1).Find(&tokens).Error
	if err == nil && len(tokens) > 0 {
		return tokens[0], nil
	}
	return model.EnsureCanvasImageToken(userID)
}
