package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResetStatusCode(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name             string
		statusCode       int
		statusCodeConfig string
		expectedCode     int
	}{
		{
			name:             "map string value",
			statusCode:       429,
			statusCodeConfig: `{"429":"503"}`,
			expectedCode:     503,
		},
		{
			name:             "map int value",
			statusCode:       429,
			statusCodeConfig: `{"429":503}`,
			expectedCode:     503,
		},
		{
			name:             "skip invalid string value",
			statusCode:       429,
			statusCodeConfig: `{"429":"bad-code"}`,
			expectedCode:     429,
		},
		{
			name:             "skip status code 200",
			statusCode:       200,
			statusCodeConfig: `{"200":503}`,
			expectedCode:     200,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			newAPIError := &types.NewAPIError{
				StatusCode: tc.statusCode,
			}
			ResetStatusCode(newAPIError, tc.statusCodeConfig)
			require.Equal(t, tc.expectedCode, newAPIError.StatusCode)
		})
	}
}

func TestRelayErrorHandlerTruncatesInvalidJSONBodyInLog(t *testing.T) {
	withDebugEnabled(t, false)

	body := strings.Repeat("b", common.LocalLogContentLimit+256)
	var logBuffer bytes.Buffer

	common.LogWriterMu.Lock()
	oldWriter := gin.DefaultErrorWriter
	gin.DefaultErrorWriter = &logBuffer
	common.LogWriterMu.Unlock()
	t.Cleanup(func() {
		common.LogWriterMu.Lock()
		gin.DefaultErrorWriter = oldWriter
		common.LogWriterMu.Unlock()
	})

	resp := &http.Response{
		StatusCode: http.StatusInternalServerError,
		Body:       io.NopCloser(strings.NewReader(body)),
	}

	newAPIError := RelayErrorHandler(context.Background(), resp, false)

	require.NotNil(t, newAPIError)
	require.Equal(t, "bad response status code 500", newAPIError.Error())
	require.Contains(t, logBuffer.String(), "[truncated")
	require.Contains(t, logBuffer.String(), fmt.Sprintf("original_length=%d", len(body)))
	require.NotContains(t, logBuffer.String(), strings.Repeat("b", common.LocalLogContentLimit+1))
}

func TestRelayErrorHandlerKeepsStructuredErrorMessage(t *testing.T) {
	message := strings.Repeat("c", common.LocalLogContentLimit+256)
	body := `{"message":"` + message + `"}`
	resp := &http.Response{
		StatusCode: http.StatusInternalServerError,
		Body:       io.NopCloser(strings.NewReader(body)),
	}

	newAPIError := RelayErrorHandler(context.Background(), resp, false)

	require.NotNil(t, newAPIError)
	require.Equal(t, message, newAPIError.Error())
}

func TestRelayErrorHandlerKeepsOpenAIErrorMessage(t *testing.T) {
	message := strings.Repeat("d", common.LocalLogContentLimit+256)
	body := `{"error":{"message":"` + message + `","type":"server_error","code":"server_error"}}`
	resp := &http.Response{
		StatusCode: http.StatusInternalServerError,
		Body:       io.NopCloser(strings.NewReader(body)),
	}

	newAPIError := RelayErrorHandler(context.Background(), resp, false)

	require.NotNil(t, newAPIError)
	require.Equal(t, message, newAPIError.Error())
}

func TestRelayErrorHandlerKeepsInvalidJSONBodyInDebugLog(t *testing.T) {
	withDebugEnabled(t, true)

	body := strings.Repeat("e", common.LocalLogContentLimit+256)
	var logBuffer bytes.Buffer

	common.LogWriterMu.Lock()
	oldWriter := gin.DefaultErrorWriter
	gin.DefaultErrorWriter = &logBuffer
	common.LogWriterMu.Unlock()
	t.Cleanup(func() {
		common.LogWriterMu.Lock()
		gin.DefaultErrorWriter = oldWriter
		common.LogWriterMu.Unlock()
	})

	resp := &http.Response{
		StatusCode: http.StatusInternalServerError,
		Body:       io.NopCloser(strings.NewReader(body)),
	}

	newAPIError := RelayErrorHandler(context.Background(), resp, false)

	require.NotNil(t, newAPIError)
	require.NotContains(t, logBuffer.String(), "[truncated")
	require.Contains(t, logBuffer.String(), body)
}

func withDebugEnabled(t *testing.T, enabled bool) {
	t.Helper()

	oldDebug := common.DebugEnabled
	common.DebugEnabled = enabled
	t.Cleanup(func() {
		common.DebugEnabled = oldDebug
	})
}

// TestTaskErrorFromAPIErrorKeepsLocalBillingSemantics 锁定预扣费失败的归属：它是用户
// 令牌额度不足，与渠道无关，既不该被记成渠道错误日志、也不该触发渠道自动禁用或换
// 渠道重试。转换必须原样带上 APIError，否则控制器只能看到一个 403，会把它重新包成
// bad_response_status_code 的渠道错误——生产上曾因此把一次余额不足记成每个重试渠道
// 各一行文案完全相同的错误日志（channel 14/5/33/27…）。
func TestTaskErrorFromAPIErrorKeepsLocalBillingSemantics(t *testing.T) {
	oldDisable := common.AutomaticDisableChannelEnabled
	common.AutomaticDisableChannelEnabled = true
	t.Cleanup(func() { common.AutomaticDisableChannelEnabled = oldDisable })

	apiErr := types.NewErrorWithStatusCode(
		errors.New("token quota is not enough, token remain quota: ¥1.252816, need quota: ¥12.750000"),
		types.ErrorCodePreConsumeTokenQuotaFailed, http.StatusForbidden,
		types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())

	taskErr := TaskErrorFromAPIError(apiErr)
	require.NotNil(t, taskErr)
	require.Same(t, apiErr, taskErr.APIError)
	assert.Equal(t, string(types.ErrorCodePreConsumeTokenQuotaFailed), taskErr.Code)
	assert.Equal(t, http.StatusForbidden, taskErr.StatusCode)

	// 换渠道不可能让用户令牌余额变够
	assert.True(t, types.IsSkipRetryError(taskErr.APIError))
	// 用户侧错误不落渠道错误日志，也不禁用渠道
	assert.False(t, types.IsRecordErrorLog(taskErr.APIError))
	assert.False(t, ShouldDisableChannel(taskErr.APIError))
	// 仍非 LocalError：控制器照样调 processChannelError 输出运行日志（logger.LogError），
	// 只是由 APIError 上的选项决定不落错误日志表、不禁用渠道。
	assert.False(t, taskErr.LocalError)
}

// TestTaskErrorFromAPIErrorNil 保证 nil 输入不产生空壳 TaskError，避免控制器把
// 「没有错误」当成一次失败去重试。
func TestTaskErrorFromAPIErrorNil(t *testing.T) {
	assert.Nil(t, TaskErrorFromAPIError(nil))
}

// TestShouldMaskUpstreamKeywordError 锁定「命中失败关键词时把下游消息换成请稍后重试」的
// 边界：上游渠道欠费要掩码，但用户自己令牌额度不足（同样带 quota 字样、却是 skip-retry 的
// 本地错误）必须原样返回，否则客户会被误导去重试一个重试也不会成功的请求。
func TestShouldMaskUpstreamKeywordError(t *testing.T) {
	oldKeywords := operation_setting.AutomaticDisableKeywords
	oldEnabled := common.AutomaticDisableChannelEnabled
	t.Cleanup(func() {
		operation_setting.AutomaticDisableKeywords = oldKeywords
		common.AutomaticDisableChannelEnabled = oldEnabled
	})
	operation_setting.AutomaticDisableKeywords = []string{"token quota is not enough"}
	common.AutomaticDisableChannelEnabled = true

	const upstreamMsg = "token quota is not enough, token remain quota: ¥1.252816, need quota: ¥12.750000"
	// 上游渠道返回的欠费错误：OpenAI 型、非 skip-retry
	upstreamOutOfQuota := types.NewOpenAIError(errors.New(upstreamMsg), types.ErrorCodeBadResponseStatusCode, http.StatusForbidden)
	// 用户自己令牌额度不足：本地预扣费错误，带 skip-retry
	userOwnQuota := types.NewErrorWithStatusCode(errors.New(upstreamMsg), types.ErrorCodePreConsumeTokenQuotaFailed, http.StatusForbidden, types.ErrOptionWithSkipRetry())
	// 未命中关键词的上游错误
	otherUpstream := types.NewOpenAIError(errors.New("internal server error"), types.ErrorCodeBadResponseStatusCode, http.StatusInternalServerError)

	assert.True(t, ShouldMaskUpstreamKeywordError(upstreamOutOfQuota))
	assert.False(t, ShouldMaskUpstreamKeywordError(userOwnQuota))
	assert.False(t, ShouldMaskUpstreamKeywordError(otherUpstream))
	assert.False(t, ShouldMaskUpstreamKeywordError(nil))

	// 自动禁用关闭时关键词机制整体不生效，不掩码
	common.AutomaticDisableChannelEnabled = false
	assert.False(t, ShouldMaskUpstreamKeywordError(upstreamOutOfQuota))
}
