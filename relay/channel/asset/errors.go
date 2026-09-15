package asset

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/model"
)

// UpstreamError 是素材协议从上游拿到的结构化错误。
//
// 它存在的意义是让轮询侧能区分两类错误，而不必为每个错误码维护本地文案：
//   - 终端错误（Terminal）：上游明确判定这条素材本身不合规（如帧率/分辨率/编码/
//     参数非法），重试永远不会成功，应把素材标记为 failed 并把上游原因透出给前端；
//   - 可重试错误：限流、鉴权、服务端异常、网络抖动等，属于渠道/基础设施层面的临时
//     问题，素材保持 pending 继续轮询即可。
//
// 分类只依赖 HTTP 状态语义与火山 C 系列错误码结构，因此任何新的内容校验类错误
// （HTTP 400/422 或 C400xxx/C422xxx）都会自动被识别为终端错误并展示上游原文，
// 无需为每个错误码单独增加提示文案。
type UpstreamError struct {
	Protocol string // 协议名，仅用于日志定位（如 ark_official）
	Action   string // 触发动作（如 GetAsset）
	Status   int    // HTTP 状态码；0 表示 HTTP 200 但响应体携带业务错误，或网络层错误
	Code     string // 上游业务错误码（如 C400999 / InvalidAsset / INVALID_PARAMETER）
	Message  string // 上游人类可读错误原因
}

func (e *UpstreamError) Error() string {
	var b strings.Builder
	b.WriteString(e.Protocol)
	if e.Action != "" {
		b.WriteString(" ")
		b.WriteString(e.Action)
	}
	b.WriteString(" failed")
	if e.Code != "" {
		b.WriteString(" (code=")
		b.WriteString(e.Code)
		b.WriteString(")")
	}
	if e.Status != 0 {
		b.WriteString(" [http ")
		b.WriteString(strconv.Itoa(e.Status))
		b.WriteString("]")
	}
	if e.Message != "" {
		b.WriteString(": ")
		b.WriteString(e.Message)
	}
	return b.String()
}

// UserMessage 返回可直接展示给用户的失败原因（写入 asset.error_msg）。
// 直接采用上游原文——它已是具体的人类可读原因（如 “Frame rate must be between
// 23.8 FPS and 60 FPS.”），因此无需在本地维护错误码到文案的映射表。
func (e *UpstreamError) UserMessage() string {
	if msg := strings.TrimSpace(e.Message); msg != "" {
		return msg
	}
	if code := strings.TrimSpace(e.Code); code != "" {
		return code
	}
	return "upstream rejected the asset"
}

// Terminal 报告该错误是否为不可恢复的终端错误（重试无意义）。
//
// 规则：仅当上游以 400/422 语义明确拒绝素材内容或参数时才算终端错误——这正是
// 帧率/分辨率/编码/URL 非法等内容校验失败所处的类别。鉴权(401/403)、未找到(404)、
// 限流(408/429)、服务端(5xx)、网络抖动一律视为可重试，避免把渠道级/基础设施级的
// 临时问题误判成素材永久失败。
func (e *UpstreamError) Terminal() bool {
	switch e.effectiveStatus() {
	case http.StatusBadRequest, http.StatusUnprocessableEntity:
		return true
	default:
		return false
	}
}

// effectiveStatus 返回用于分类的 HTTP 状态：优先真实响应状态码；HTTP 200 但携带
// 业务错误时，尝试从火山 C 系列错误码（C+3 位 HTTP 状态+子码，如 C400999→400）解析。
func (e *UpstreamError) effectiveStatus() int {
	if e.Status != 0 {
		return e.Status
	}
	return httpStatusFromArkCode(e.Code)
}

// httpStatusFromArkCode 解析火山 C 系列错误码内嵌的 HTTP 状态；非该格式返回 0。
func httpStatusFromArkCode(code string) int {
	c := strings.TrimSpace(code)
	if len(c) < 4 || (c[0] != 'C' && c[0] != 'c') {
		return 0
	}
	n, err := strconv.Atoi(c[1:4])
	if err != nil || n < 100 || n > 599 {
		return 0
	}
	return n
}

// terminalFailureResult 把终端性上游错误转成 failed 查询结果，供各协议 Query 复用；
// 可重试错误返回 nil，调用方应原样返回 error，让素材保持 pending 继续轮询。
func terminalFailureResult(err error) *QueryResult {
	var upErr *UpstreamError
	if errors.As(err, &upErr) && upErr.Terminal() {
		return &QueryResult{Status: model.AssetStatusFailed, ErrorMsg: upErr.UserMessage()}
	}
	return nil
}
