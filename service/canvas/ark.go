package canvas

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// ===== 智能画布：Ark 图片生成/编辑（经网关门回环） =====
// 官方协议：POST https://ark.cn-beijing.volces.com/api/v3/images/generations
// 该接口同时承载文生图、单图参考、多图参考与指令编辑，字段为
// model / prompt / image / size / response_format / watermark / output_format /
// background / seed / guidance_scale / sequential_image_generation。
//
// 画布不直连 Ark：带用户图片 Key 回环到网关自身的 /v1/images/generations，
// 由既有 Relay 链路完成渠道选择、限额、计费与日志，画布层不再二次扣费。

// arkImageRequest 一次 Ark 图片调用
type arkImageRequest struct {
	Model        string
	Prompt       string
	Images       []string
	Size         string
	OutputFormat string
	Background   string
	Seed         *int
	Guidance     *float64
	Watermark    bool
}

// arkImageItem 上游返回的单张图片
type arkImageItem struct {
	URL          string
	B64          string
	Size         string
	OutputFormat string
}

// ResultImage 画布统一结果图（已转存到自有存储）
type ResultImage struct {
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Format string `json:"format"`
}

// canvasUserToken 用户用于回环调用的图片 Key 明文
func canvasUserToken(userID int) (string, error) {
	token, err := canvasImageToken(userID)
	if err != nil {
		return "", err
	}
	if token == nil || strings.TrimSpace(token.Key) == "" {
		return "", errors.New("未找到可用的图片 Key，无法提交生成任务")
	}
	return token.Key, nil
}

// buildArkBody 组装官方请求体。image 单图下发字符串、多图下发数组（与官方一致）。
func buildArkBody(req arkImageRequest) map[string]any {
	body := map[string]any{
		"model":           req.Model,
		"prompt":          req.Prompt,
		"response_format": "url",
		// Ark 默认给生成图打「AI 生成」水印，画布产出物需要干净底图
		"watermark": req.Watermark,
	}
	if len(req.Images) == 1 {
		body["image"] = req.Images[0]
	} else if len(req.Images) > 1 {
		body["image"] = req.Images
	}
	if req.Size != "" {
		body["size"] = req.Size
	}
	if req.OutputFormat != "" {
		body["output_format"] = req.OutputFormat
	}
	if req.Background != "" {
		body["background"] = req.Background
	}
	if req.Seed != nil {
		body["seed"] = *req.Seed
	}
	if req.Guidance != nil {
		body["guidance_scale"] = *req.Guidance
	}
	return body
}

// arkImageResponse 官方非流式响应（只取画布用得到的字段）
type arkImageResponse struct {
	Model string `json:"model"`
	Data  []struct {
		URL          string `json:"url"`
		B64JSON      string `json:"b64_json"`
		Size         string `json:"size"`
		OutputFormat string `json:"output_format"`
		Error        *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	} `json:"data"`
	Usage struct {
		GeneratedImages int `json:"generated_images"`
		InputImages     int `json:"input_images"`
		OutputTokens    int `json:"output_tokens"`
	} `json:"usage"`
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// callArkImage 回环调用 /v1/images/generations，返回上游原始图片条目。
// 错误分两类：definite（4xx/带错误体的 5xx，可判定失败）与 indeterminate
// （网络中断/超时/无响应体，上游是否已受理未知），由调用方决定退款还是待核对。
func callArkImage(userID int, req arkImageRequest) ([]arkImageItem, error) {
	key, err := canvasUserToken(userID)
	if err != nil {
		return nil, err
	}
	payload, err := common.Marshal(buildArkBody(req))
	if err != nil {
		return nil, err
	}
	url := relayBaseURL() + "/v1/images/generations"
	httpReq, err := http.NewRequest(http.MethodPost, url, strings.NewReader(string(payload)))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+key)

	client := &http.Client{Timeout: time.Duration(upstreamTimeoutSeconds()) * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, &upstreamError{indeterminate: true, err: fmt.Errorf("请求上游失败: %w", err)}
	}
	defer resp.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if readErr != nil {
		return nil, &upstreamError{indeterminate: true, err: fmt.Errorf("读取上游响应失败: %w", readErr)}
	}
	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
		// 限流/服务端错误：上游可能已计费也可能未执行，进入待核对更安全
		return nil, &upstreamError{
			indeterminate: resp.StatusCode >= 500,
			code:          fmt.Sprintf("http_%d", resp.StatusCode),
			err:           fmt.Errorf("上游返回 %d: %s", resp.StatusCode, truncateText(string(body), 300)),
		}
	}
	if resp.StatusCode != http.StatusOK {
		var failure arkImageResponse
		_ = common.Unmarshal(body, &failure)
		msg := ""
		code := fmt.Sprintf("http_%d", resp.StatusCode)
		if failure.Error != nil {
			msg = failure.Error.Message
			if failure.Error.Code != "" {
				code = failure.Error.Code
			}
		}
		if msg == "" {
			msg = truncateText(string(body), 300)
		}
		return nil, &upstreamError{code: code, err: fmt.Errorf("%s", msg)}
	}

	var result arkImageResponse
	if err := common.Unmarshal(body, &result); err != nil {
		return nil, &upstreamError{indeterminate: true, code: "decode_failed", err: fmt.Errorf("解析上游响应失败: %w", err)}
	}
	items := make([]arkImageItem, 0, len(result.Data))
	for _, d := range result.Data {
		if d.Error != nil {
			return nil, &upstreamError{
				code: d.Error.Code,
				err:  fmt.Errorf("上游生成失败: %s", d.Error.Message),
			}
		}
		if d.URL == "" && d.B64JSON == "" {
			continue
		}
		items = append(items, arkImageItem{URL: d.URL, B64: d.B64JSON, Size: d.Size, OutputFormat: d.OutputFormat})
	}
	if len(items) == 0 {
		return nil, &upstreamError{indeterminate: true, code: "empty_result", err: errors.New("上游未返回任何图片")}
	}
	return items, nil
}

// persistArkItems 把上游结果转存到自有 TOS，返回画布结果图。
// 转存失败不视为生成失败：上游已成功，保留原始链接并在结果里标注，
// 避免「上游成功却整单失败」导致重复生成与重复计费。
func persistArkItems(items []arkImageItem, userID, projectID int) ([]ResultImage, []string) {
	out := make([]ResultImage, 0, len(items))
	warnings := make([]string, 0)
	for i, item := range items {
		format := item.OutputFormat
		if format == "" {
			format = "png"
		}
		width, height, _ := parseSize(item.Size)
		img := ResultImage{Width: width, Height: height, Format: format}
		stored := false
		if item.B64 != "" {
			if data, err := base64.StdEncoding.DecodeString(item.B64); err == nil {
				name := fmt.Sprintf("ark_%d_%d.%s", time.Now().UnixNano(), i, format)
				if url, err := storeBytesFromCanvas(data, name, userID, projectID); err == nil {
					img.URL = url
					stored = true
				} else {
					warnings = append(warnings, fmt.Sprintf("结果转存失败: %v", err))
				}
			}
		}
		if !stored && item.URL != "" {
			name := fmt.Sprintf("ark_%d_%d.%s", time.Now().UnixNano(), i, format)
			if url, err := storeRemoteToCanvasBucket(item.URL, name, userID, projectID); err == nil {
				img.URL = url
				stored = true
			} else {
				warnings = append(warnings, fmt.Sprintf("结果转存失败: %v", err))
			}
		}
		if !stored {
			// 上游链接 24 小时有效，先返回让用户可用，并在结果里记录告警
			img.URL = item.URL
			img.Format = format
		}
		if img.URL == "" {
			continue
		}
		if img.Width == 0 || img.Height == 0 {
			if info, err := fetchRemoteImageInfo(img.URL); err == nil {
				img.Width, img.Height = info.Width, info.Height
			}
		}
		out = append(out, img)
	}
	return out, warnings
}

// upstreamError 上游调用错误，indeterminate 表示无法判定上游是否已受理。
type upstreamError struct {
	indeterminate bool
	code          string
	err           error
}

func (e *upstreamError) Error() string { return e.err.Error() }
func (e *upstreamError) Unwrap() error { return e.err }

func truncateText(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n]) + "…"
}
