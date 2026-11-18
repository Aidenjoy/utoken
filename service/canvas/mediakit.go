package canvas

import (
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// ===== 智能画布：AI MediaKit 同步图像工具 =====
// 官方协议（均为同步接口，直接在响应体返回结果）：
//   POST /api/v1/tools-sync/erase-image               图像擦除修复（涂抹消除）
//   POST /api/v1/tools-sync/expand-image-canvas       智能扩图
//   POST /api/v1/tools-sync/remove-image-background   图像背景移除（智能抠图）
//   POST /api/v1/tools-sync/enhance-image             图像画质增强（普通/生成式超分）
// 鉴权为 Bearer <MediaKit API Key>，未配置 Key 时工具在能力接口中标记不可用。

// mediaKitResponse 同步接口统一响应信封
type mediaKitResponse struct {
	Success   bool   `json:"success"`
	TaskID    string `json:"task_id"`
	TaskType  string `json:"task_type"`
	RequestID string `json:"request_id"`
	ExpiresAt int64  `json:"expires_at"`
	Result    struct {
		ImageURL    string `json:"image_url"`
		ImageSize   int64  `json:"image_size"`
		ImageFormat string `json:"image_format"`
		ImageWidth  int    `json:"image_width"`
		ImageHeight int    `json:"image_height"`
	} `json:"result"`
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// mediaKitError Body 参数不足等本地校验错误
var mediaKitError = errors.New("mediakit request invalid")

// mediaKitPost 发起一次同步工具调用，解析统一信封。
// 非 2xx 且带可解析错误体时判为 definite 失败（不计费需退款）；
// 网络错误/超时判为 indeterminate，进入待核对。
func mediaKitPost(path string, body any) (*mediaKitResponse, error) {
	key := mediaKitKey()
	if key == "" {
		return nil, fmt.Errorf("%w: 未配置 CANVAS_MEDIAKIT_API_KEY", mediaKitError)
	}
	payload, err := common.Marshal(body)
	if err != nil {
		return nil, err
	}
	url := mediaKitBase() + path
	req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(payload)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)

	client := &http.Client{Timeout: time.Duration(upstreamTimeoutSeconds()) * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, &upstreamError{indeterminate: true, code: "network", err: fmt.Errorf("请求 MediaKit 失败: %w", err)}
	}
	defer resp.Body.Close()
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if readErr != nil {
		return nil, &upstreamError{indeterminate: true, code: "read_failed", err: readErr}
	}
	var out mediaKitResponse
	parseErr := common.Unmarshal(raw, &out)
	if resp.StatusCode >= 500 {
		return nil, &upstreamError{
			indeterminate: parseErr != nil || !out.Success,
			code:          fmt.Sprintf("http_%d", resp.StatusCode),
			err:           fmt.Errorf("MediaKit 返回 %d: %s", resp.StatusCode, truncateText(string(raw), 300)),
		}
	}
	if parseErr != nil {
		return nil, &upstreamError{code: "decode_failed", err: fmt.Errorf("解析 MediaKit 响应失败: %w", parseErr)}
	}
	if !out.Success || out.Result.ImageURL == "" {
		msg := out.Error.Message
		if msg == "" {
			msg = truncateText(string(raw), 300)
		}
		code := out.Error.Code
		if code == "" {
			code = fmt.Sprintf("http_%d", resp.StatusCode)
		}
		return nil, &upstreamError{code: code, err: fmt.Errorf("MediaKit 处理失败: %s", msg)}
	}
	return &out, nil
}

// 分辨率与体积限制（官方「使用限制」，按工具分别校验）
type mediaKitLimit struct {
	MaxLongSide  int
	MaxShortSide int
	MaxPixels    int
	MaxAspect    float64
}

func mediaKitLimitFor(tool string, scene string) mediaKitLimit {
	switch tool {
	case ToolErase:
		return mediaKitLimit{MaxLongSide: 2560, MaxShortSide: 1440}
	case ToolOutpaint:
		return mediaKitLimit{MaxLongSide: 4160, MaxShortSide: 4160}
	case ToolMatting:
		if scene == "human" || scene == "product" {
			return mediaKitLimit{MaxLongSide: 7680, MaxShortSide: 4320}
		}
		return mediaKitLimit{MaxLongSide: 10240, MaxShortSide: 6000, MaxPixels: 40000000}
	case ToolUpscale, ToolGenerativeUpscale:
		return mediaKitLimit{MaxLongSide: 10240, MaxShortSide: 10240, MaxAspect: 32}
	}
	return mediaKitLimit{}
}

func validateMediaKitImage(tool, scene string, info ImageInfo) error {
	limit := mediaKitLimitFor(tool, scene)
	longSide, shortSide := info.Width, info.Height
	if shortSide > longSide {
		longSide, shortSide = shortSide, longSide
	}
	if limit.MaxLongSide > 0 && longSide > limit.MaxLongSide {
		return fmt.Errorf("原图长边 %d 超过该工具上限 %d", longSide, limit.MaxLongSide)
	}
	if limit.MaxShortSide > 0 && shortSide > limit.MaxShortSide {
		return fmt.Errorf("原图短边 %d 超过该工具上限 %d", shortSide, limit.MaxShortSide)
	}
	if limit.MaxPixels > 0 && info.Width*info.Height > limit.MaxPixels {
		return fmt.Errorf("原图像素 %d 超过该工具上限 %d", info.Width*info.Height, limit.MaxPixels)
	}
	if limit.MaxAspect > 0 && shortSide > 0 && float64(longSide)/float64(shortSide) > limit.MaxAspect {
		return fmt.Errorf("原图长宽比超过该工具上限 %.0f", limit.MaxAspect)
	}
	return nil
}

// ---------- 涂抹消除 ----------

// buildEraseBody 擦除修复请求体：selected_area_erase 场景下 mask_url 必填。
func buildEraseBody(imageURL, maskURL string, params map[string]any) map[string]any {
	version := stringParam(params, "toolVersion", "standard")
	return map[string]any{
		"image_url":      imageURL,
		"mask_url":       maskURL,
		"standard_scene": "selected_area_erase",
		"tool_version":   version,
	}
}

// ---------- 智能扩图 ----------

// expandRatios 把「等比 / 目标画幅 / 四边 / 自定义画布」统一换算为官方四边比例。
// 官方定义：每个方向的比例相对原图短边，取值 [0, 0.4]，0 表示该方向不扩展。
func expandRatios(mode string, params map[string]any, width, height int) (top, bottom, left, right float64, err error) {
	if width <= 0 || height <= 0 {
		return 0, 0, 0, 0, errors.New("缺少原图尺寸，无法计算扩图比例")
	}
	shortSide := math.Min(float64(width), float64(height))
	toRatio := func(pixels float64) float64 { return pixels / shortSide }

	top, bottom, left, right, err = convertExpandMode(mode, params, width, height, toRatio)
	if err != nil {
		return 0, 0, 0, 0, err
	}
	if err := validateExpandRange(top, bottom, left, right); err != nil {
		return 0, 0, 0, 0, err
	}
	return top, bottom, left, right, nil
}

func convertExpandMode(mode string, params map[string]any, width, height int, toRatio func(float64) float64) (top, bottom, left, right float64, err error) {
	switch mode {
	case "", "ratio":
		factor := floatParam(params, "ratio", 1.25)
		if factor <= 1 {
			return 0, 0, 0, 0, errors.New("等比倍数必须大于 1")
		}
		edge := (factor - 1) / 2
		return edge, edge, edge, edge, nil
	case "edges":
		return floatParam(params, "top", 0.1), floatParam(params, "bottom", 0.1),
			floatParam(params, "left", 0.1), floatParam(params, "right", 0.1), nil
	case "aspect":
		ratio, parseErr := parseAspect(stringParam(params, "targetAspect", "1:1"))
		if parseErr != nil {
			return 0, 0, 0, 0, parseErr
		}
		current := float64(width) / float64(height)
		if math.Abs(ratio-current) < 1e-6 {
			return 0, 0, 0, 0, errors.New("目标画幅与原图一致，无需扩图")
		}
		if ratio > current {
			// 横向补足：高度不变，宽度按目标比例放大
			extra := (float64(height)*ratio - float64(width)) / 2
			r := toRatio(extra)
			return 0, 0, r, r, nil
		}
		extra := (float64(width)/ratio - float64(height)) / 2
		r := toRatio(extra)
		return r, r, 0, 0, nil
	case "canvas":
		targetW := intParam(params, "targetWidth", 0)
		targetH := intParam(params, "targetHeight", 0)
		if targetW < width || targetH < height {
			return 0, 0, 0, 0, errors.New("目标画布不能小于原图（如需裁切请使用画布裁剪）")
		}
		return toRatio(float64(targetH-height) / 2), toRatio(float64(targetH-height) / 2),
			toRatio(float64(targetW-width) / 2), toRatio(float64(targetW-width) / 2), nil
	}
	return 0, 0, 0, 0, fmt.Errorf("不支持的扩图方式: %s", mode)
}

// validateExpandRange 校验四边比例落在官方 [0, 0.4] 区间。
// 目标画幅/自定义画布换算后可能超限（例如把 1:2 的图直接拉到 16:9），
// 这种请求必须在本地拦下并说明原因，而不是丢给上游 400。
func validateExpandRange(top, bottom, left, right float64) error {
	for _, item := range []struct {
		name  string
		value float64
	}{{"上", top}, {"下", bottom}, {"左", left}, {"右", right}} {
		if math.IsNaN(item.value) || item.value < 0 || item.value > 0.4 {
			return fmt.Errorf("%s边需要扩展 %.3f（相对短边），超出官方 [0, 0.4] 上限，请改用更接近原图的画幅",
				item.name, item.value)
		}
	}
	return nil
}

// buildExpandBody 智能扩图请求体。
func buildExpandBody(imageURL string, top, bottom, left, right float64) (map[string]any, error) {
	for _, item := range []struct {
		name  string
		value float64
	}{{"上", top}, {"下", bottom}, {"左", left}, {"右", right}} {
		if item.value < 0 || item.value > 0.4 {
			return nil, fmt.Errorf("%s边扩展比例 %.3f 超出官方 [0, 0.4] 范围", item.name, item.value)
		}
	}
	return map[string]any{
		"image_url":     imageURL,
		"expand_top":    round4(top),
		"expand_bottom": round4(bottom),
		"expand_left":   round4(left),
		"expand_right":  round4(right),
	}, nil
}

// ---------- 主体分割 / 透明抠图 ----------

func buildMattingBody(imageURL string, params map[string]any) map[string]any {
	scene := stringParam(params, "scene", "general")
	switch scene {
	case "general", "human", "product":
	default:
		scene = "general"
	}
	body := map[string]any{
		"image_url": imageURL,
		"scene":     scene,
	}
	if boolParam(params, "needContour", false) && scene != "general" {
		body["need_contour"] = true
		body["contour_color"] = stringParam(params, "contourColor", "#FFFFFF")
		body["contour_size"] = intParam(params, "contourSize", 10)
	}
	if boolParam(params, "cropBackground", false) {
		body["need_crop_background"] = true
	}
	return body
}

// ---------- 画质增强（普通 / 生成式超分）----------

func buildEnhanceBody(imageURL string, params map[string]any, generative bool) map[string]any {
	version := "standard"
	if generative {
		version = "max"
	}
	if v := stringParam(params, "toolVersion", ""); v != "" {
		version = v
	}
	body := map[string]any{
		"image_url":    imageURL,
		"tool_version": version,
	}
	if multiple := floatParam(params, "multiple", 0); multiple > 0 {
		body["multiple"] = round4(multiple)
	}
	if w := intParam(params, "targetWidth", 0); w > 0 {
		body["target_width"] = w
	}
	if h := intParam(params, "targetHeight", 0); h > 0 {
		body["target_height"] = h
	}
	if generative {
		body["enable_correct_color"] = boolParam(params, "enableCorrectColor", true)
		if mode := stringParam(params, "generativeEnhanceMode", ""); mode != "" {
			body["generative_enhance_mode"] = mode
		}
	}
	return body
}

// ---------- 工具调度 ----------

// runMediaKitTool 执行一次 MediaKit 工具调用并转存结果。
func runMediaKitTool(tool, imageURL, maskURL string, params map[string]any, info ImageInfo, userID, projectID int) ([]ResultImage, error) {
	var (
		path string
		body map[string]any
		err  error
	)
	switch tool {
	case ToolErase:
		path = "/api/v1/tools-sync/erase-image"
		body = buildEraseBody(imageURL, maskURL, params)
	case ToolOutpaint:
		mode := stringParam(params, "mode", "ratio")
		var top, bottom, left, right float64
		top, bottom, left, right, err = expandRatios(mode, params, info.Width, info.Height)
		if err != nil {
			return nil, err
		}
		path = "/api/v1/tools-sync/expand-image-canvas"
		body, err = buildExpandBody(imageURL, top, bottom, left, right)
		if err != nil {
			return nil, err
		}
	case ToolMatting:
		path = "/api/v1/tools-sync/remove-image-background"
		body = buildMattingBody(imageURL, params)
	case ToolUpscale:
		path = "/api/v1/tools-sync/enhance-image"
		body = buildEnhanceBody(imageURL, params, false)
	case ToolGenerativeUpscale:
		path = "/api/v1/tools-sync/enhance-image"
		body = buildEnhanceBody(imageURL, params, true)
	default:
		return nil, fmt.Errorf("工具 %s 没有 MediaKit 实现", tool)
	}

	resp, err := mediaKitPost(path, body)
	if err != nil {
		return nil, err
	}
	format := resp.Result.ImageFormat
	if format == "" {
		format = "png"
	}
	img := ResultImage{
		Width:  resp.Result.ImageWidth,
		Height: resp.Result.ImageHeight,
		Format: format,
	}
	name := fmt.Sprintf("mk_%s_%d.%s", tool, time.Now().UnixNano(), format)
	if stored, err := storeRemoteToCanvasBucket(resp.Result.ImageURL, name, userID, projectID); err == nil {
		img.URL = stored
	} else {
		// 上游已成功：保留原始链接（24h）并在结果里带告警，避免重跑模型造成重复计费
		img.URL = resp.Result.ImageURL
	}
	if img.Width == 0 || img.Height == 0 {
		if meta, err := fetchRemoteImageInfo(img.URL); err == nil {
			img.Width, img.Height = meta.Width, meta.Height
		}
	}
	return []ResultImage{img}, nil
}

// ---------- 参数读取 ----------

func stringParam(params map[string]any, key, fallback string) string {
	if params == nil {
		return fallback
	}
	if raw, ok := params[key]; ok {
		if v, ok := raw.(string); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return fallback
}

func floatParam(params map[string]any, key string, fallback float64) float64 {
	if params == nil {
		return fallback
	}
	raw, ok := params[key]
	if !ok {
		return fallback
	}
	switch v := raw.(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	case int64:
		return float64(v)
	}
	return fallback
}

func intParam(params map[string]any, key string, fallback int) int {
	value := floatParam(params, key, float64(fallback))
	return int(math.Round(value))
}

func boolParam(params map[string]any, key string, fallback bool) bool {
	if params == nil {
		return fallback
	}
	if raw, ok := params[key]; ok {
		if v, ok := raw.(bool); ok {
			return v
		}
	}
	return fallback
}

// parseAspect 解析 "16:9" 形式的画幅比
func parseAspect(aspect string) (float64, error) {
	parts := strings.Split(strings.TrimSpace(aspect), ":")
	if len(parts) != 2 {
		return 0, fmt.Errorf("画幅格式应为 W:H，收到 %s", aspect)
	}
	var w, h float64
	if _, err := fmt.Sscanf(strings.TrimSpace(parts[0]), "%f", &w); err != nil {
		return 0, fmt.Errorf("画幅格式应为 W:H，收到 %s", aspect)
	}
	if _, err := fmt.Sscanf(strings.TrimSpace(parts[1]), "%f", &h); err != nil {
		return 0, fmt.Errorf("画幅格式应为 W:H，收到 %s", aspect)
	}
	if w <= 0 || h <= 0 {
		return 0, fmt.Errorf("画幅必须为正数，收到 %s", aspect)
	}
	return w / h, nil
}

func round4(v float64) float64 {
	return math.Round(v*10000) / 10000
}
