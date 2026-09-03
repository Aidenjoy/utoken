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
