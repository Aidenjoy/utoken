package types

import (
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// RelayErrorHandler builds the error with InitOpenAIError (empty OpenAIError.Message) and
// only fills in Err once the upstream body turns out to be unparsable/empty. The client must
// still see the real reason instead of the bare error type name.
func TestToOpenAIErrorFallsBackToWrappedError(t *testing.T) {
	apiErr := InitOpenAIError(ErrorCodeBadResponseStatusCode, http.StatusNotFound)
	apiErr.Err = errors.New("bad response status code 404")

	oaiErr := apiErr.ToOpenAIError()

	assert.Equal(t, "bad response status code 404", oaiErr.Message)
	assert.Equal(t, string(ErrorCodeBadResponseStatusCode), oaiErr.Type)
	assert.Equal(t, ErrorCodeBadResponseStatusCode, oaiErr.Code)

	claudeErr := apiErr.ToClaudeError()
	assert.Equal(t, "bad response status code 404", claudeErr.Message)
}

func TestToOpenAIErrorKeepsUpstreamMessage(t *testing.T) {
	upstream := OpenAIError{
		Message: "model not found",
		Type:    "invalid_request_error",
		Code:    "model_not_found",
	}
	apiErr := WithOpenAIError(upstream, http.StatusNotFound)
	// Err is rewritten with extra internal context; the upstream message must win.
	apiErr.Err = errors.New("bad response status code 404, message: model not found, body: {}")

	assert.Equal(t, "model not found", apiErr.ToOpenAIError().Message)
}

func TestToOpenAIErrorUsesErrorTypeWhenNothingElseAvailable(t *testing.T) {
	apiErr := WithOpenAIError(OpenAIError{Type: "upstream_error", Code: "unknown"}, http.StatusInternalServerError)
	require.Empty(t, apiErr.Error())

	assert.Equal(t, string(ErrorTypeOpenAIError), apiErr.ToOpenAIError().Message)
	assert.Equal(t, string(ErrorTypeOpenAIError), apiErr.ToClaudeError().Message)
}

// ReplaceClientMessage must rewrite the message the client actually sees. For upstream
// OpenAI/Claude-typed errors, ToOpenAIError/ToClaudeError emit RelayError.Message, so setting
// Err alone (SetMessage) would still leak the raw upstream text; ReplaceClientMessage covers
// both while leaving type/code intact.
func TestReplaceClientMessageOverridesUpstreamMessage(t *testing.T) {
	upstream := OpenAIError{
		Message: "token quota is not enough, token remain quota: ¥1.252816",
		Type:    "invalid_request_error",
		Code:    "insufficient_quota",
	}
	apiErr := WithOpenAIError(upstream, http.StatusForbidden)

	apiErr.ReplaceClientMessage("请稍后重试")

	oaiErr := apiErr.ToOpenAIError()
	assert.Equal(t, "请稍后重试", oaiErr.Message)
	assert.Equal(t, "invalid_request_error", oaiErr.Type)
	assert.Equal(t, "insufficient_quota", oaiErr.Code)
	assert.Equal(t, "请稍后重试", apiErr.ToClaudeError().Message)
	assert.Equal(t, "请稍后重试", apiErr.Error())
}

func TestReplaceClientMessageNilSafe(t *testing.T) {
	var apiErr *NewAPIError
	apiErr.ReplaceClientMessage("请稍后重试")
}
