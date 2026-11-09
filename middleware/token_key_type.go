package middleware

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

// requiredKeyType 把请求路径归类到它要求的密钥类型（语言/图片/视频）。
// 返回空串表示该路径不强制密钥类型（模型列表、Suno、未归类接口等），任何密钥都可调用。
// 路径以 TokenAuth 运行时为准：Kling/即梦官方协议此时已被改写为 /v1/video/generations。
func requiredKeyType(method, path string) string {
	switch {
	// 视频：原生 /v1/video/generations、OpenAI 风格 /v1/videos（含 /content、/remix）、
	// 火山方舟官方协议透传路径。
	case strings.HasPrefix(path, "/v1/video/generations"),
		strings.HasPrefix(path, "/v1/videos"),
		strings.HasPrefix(path, "/api/v3/contents/generations/tasks"):
		return model.TokenKeyTypeVideo

	// 图片：OpenAI 图片接口与 Midjourney（含 /:mode/mj 前缀）。
	case strings.HasPrefix(path, "/v1/images/"),
		strings.HasPrefix(path, "/v1/edits"),
		strings.HasPrefix(path, "/mj"),
		strings.Contains(path, "/mj/"):
		return model.TokenKeyTypeImage

	// 语言：对话/补全/Claude messages/嵌入/重排/审核/音频/实时/引擎嵌入。
	case strings.HasPrefix(path, "/v1/chat/completions"),
		strings.HasPrefix(path, "/v1/completions"),
		strings.HasPrefix(path, "/v1/messages"),
		strings.HasPrefix(path, "/v1/embeddings"),
		strings.HasSuffix(path, "embeddings"),
		strings.HasPrefix(path, "/v1/moderations"),
		strings.HasPrefix(path, "/v1/responses"),
		strings.HasPrefix(path, "/v1/audio/"),
		strings.HasPrefix(path, "/v1/rerank"),
		strings.HasPrefix(path, "/v1/realtime"),
		strings.HasPrefix(path, "/v1/engines/"):
		return model.TokenKeyTypeLanguage

	// Gemini 原生 generateContent 走 POST /v1(beta)/models/...；
	// GET /v1/models、/v1/models/:model、/v1beta/models 是模型列表/详情，属元数据接口，放行。
	case method == http.MethodPost &&
		(strings.HasPrefix(path, "/v1/models/") || strings.HasPrefix(path, "/v1beta/models/")):
		return model.TokenKeyTypeLanguage
	}
	return ""
}

// enforceTokenKeyType 在 TokenAuth 通过后校验密钥类型与请求协议是否匹配，实现语言/图片/
// 视频 Key 的协议级隔离。存量空类型 Key 与未归类路径直接放行，保持原有行为。
func enforceTokenKeyType(c *gin.Context) {
	keyType := c.GetString("token_key_type")
	if keyType == "" {
		return
	}
	required := requiredKeyType(c.Request.Method, c.Request.URL.Path)
	if required == "" || required == keyType {
		return
	}
	label := map[string]string{
		model.TokenKeyTypeLanguage: "语言模型 Key",
		model.TokenKeyTypeImage:    "图片模型 Key",
		model.TokenKeyTypeVideo:    "视频模型 Key",
	}[required]
	abortWithOpenAiMessage(c, http.StatusForbidden,
		fmt.Sprintf("当前密钥不能用于该接口，请使用%s", label),
		types.ErrorCodeAccessDenied)
}
