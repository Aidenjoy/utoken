package controller

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestShouldRetryTaskRelaySkipsLocalBillingErrors 锁定任务（视频）重试的边界：只有渠道
// 侧故障才值得换渠道再试，本地/用户侧错误换渠道不可能成功。
//
// 回归 2026-10-29 生产事故：用户令牌余额不足时，预扣费返回的 403 在 task 路径被丢掉
// SkipRetry 语义，一个请求依次撞了 14→5（另一个撞 33→27），每次尝试都往错误日志里写
// 一行文案完全相同、只有 channel_id 不同的记录，看起来像所有渠道同时余额不足。
func TestShouldRetryTaskRelaySkipsLocalBillingErrors(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/video/generations", nil)

	preConsumeErr := service.TaskErrorFromAPIError(types.NewErrorWithStatusCode(
		errors.New("token quota is not enough, token remain quota: ¥1.252816, need quota: ¥12.750000"),
		types.ErrorCodePreConsumeTokenQuotaFailed, http.StatusForbidden,
		types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog()))
	duplicateRequestErr := service.TaskErrorFromAPIError(types.NewErrorWithStatusCode(
		errors.New("重复的请求（requestId=req-1），请勿重试已受理的请求"),
		types.ErrorCodeInvalidRequest, http.StatusConflict,
		types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog()))

	testCases := []struct {
		name     string
		taskErr  *dto.TaskError
		expected bool
	}{
		{"token quota exhausted does not hop channels", preConsumeErr, false},
		{"duplicate request does not hop channels", duplicateRequestErr, false},
		{
			"upstream 5xx still retries",
			service.TaskErrorWrapper(errors.New(`{"error":"internal"}`), "fail_to_fetch_task", http.StatusInternalServerError),
			true,
		},
		{
			"upstream 429 still retries",
			service.TaskErrorWrapper(errors.New("rate limited"), "fail_to_fetch_task", http.StatusTooManyRequests),
			true,
		},
		{
			"upstream 400 does not retry",
			service.TaskErrorWrapper(errors.New("input image may contain real person"), "fail_to_fetch_task", http.StatusBadRequest),
			false,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.expected, shouldRetryTaskRelay(c, 14, tc.taskErr, 1))
		})
	}

	assert.False(t, shouldRetryTaskRelay(c, 14, nil, 1))
}

func TestRelayTaskBoundVideoKeyRetriesSameChannel(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Log{}, &model.LogBody{}))

	var boundCalls atomic.Int32
	boundUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		boundCalls.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"bound upstream failed"}`))
	}))
	t.Cleanup(boundUpstream.Close)

	var otherCalls atomic.Int32
	otherUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		otherCalls.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"other upstream failed"}`))
	}))
	t.Cleanup(otherUpstream.Close)

	const modelName = "retry-video-model"
	for _, channel := range []*model.Channel{
		{Id: 14, Name: "bound", Type: constant.ChannelTypeArkNative, Key: "sk-bound", BaseURL: &boundUpstream.URL},
		{Id: 5, Name: "other", Type: constant.ChannelTypeArkNative, Key: "sk-other", BaseURL: &otherUpstream.URL},
	} {
		channel.Status = common.ChannelStatusEnabled
		channel.Group = "default"
		channel.Models = modelName
		require.NoError(t, db.Create(channel).Error)
		require.NoError(t, db.Create(&model.Ability{
			Group: "default", Model: modelName, ChannelId: channel.Id, Enabled: true, Priority: common.GetPointer(int64(1)), Weight: 100,
		}).Error)
	}

	oldMemoryCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() { common.MemoryCacheEnabled = oldMemoryCache })
	oldRetryTimes := common.RetryTimes
	common.RetryTimes = 1
	t.Cleanup(func() { common.RetryTimes = oldRetryTimes })
	oldModelPrices := ratio_setting.ModelPrice2JSONString()
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"retry-video-model":0}`))
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(oldModelPrices)) })
	oldFreeModelPreConsume := operation_setting.GetQuotaSetting().EnableFreeModelPreConsume
	operation_setting.GetQuotaSetting().EnableFreeModelPreConsume = false
	t.Cleanup(func() { operation_setting.GetQuotaSetting().EnableFreeModelPreConsume = oldFreeModelPreConsume })

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/video/generations", strings.NewReader(`{"model":"retry-video-model","prompt":"retry isolation"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(common.RequestIdKey, "req-bound-video-retry")
	c.Set("id", 208)
	c.Set("token_id", 208)
	c.Set("token_channel_id", 14)
	c.Set("relay_mode", relayconstant.RelayModeVideoSubmit)
	common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
	common.SetContextKey(c, constant.ContextKeyUsingGroup, "default")
	common.SetContextKey(c, constant.ContextKeyTokenGroup, "default")

	boundChannel, err := model.GetChannelById(14, true)
	require.NoError(t, err)
	require.Nil(t, middleware.SetupContextForSelectedChannel(c, boundChannel, modelName))
	service.InitHttpClient()

	RelayTask(c)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
	assert.Equal(t, int32(2), boundCalls.Load(), "首次请求和唯一一次重试都必须到达绑定渠道")
	assert.Zero(t, otherCalls.Load(), "绑定视频 Key 不得因重试调用其他渠道")
	assert.Equal(t, []string{"14", "14"}, c.GetStringSlice("use_channel"))
}

func TestLockTokenBoundVideoChannelScope(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Channel{}))

	newInfo := func() *relaycommon.RelayInfo {
		return &relaycommon.RelayInfo{
			RelayMode:     relayconstant.RelayModeVideoSubmit,
			TaskRelayInfo: &relaycommon.TaskRelayInfo{},
		}
	}
	newContext := func() *gin.Context {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Set("token_id", 208)
		c.Set("token_channel_id", 14)
		return c
	}

	t.Run("origin task lock takes precedence", func(t *testing.T) {
		info := newInfo()
		originChannel := &model.Channel{Id: 5}
		info.LockedChannel = originChannel
		require.Nil(t, lockTokenBoundVideoChannel(newContext(), info))
		assert.Same(t, originChannel, info.LockedChannel)
	})

	t.Run("playground keeps dynamic channel selection", func(t *testing.T) {
		c := newContext()
		c.Set("token_id", 0)
		info := newInfo()
		require.Nil(t, lockTokenBoundVideoChannel(c, info))
		assert.Nil(t, info.LockedChannel)
	})

	t.Run("non-video token request keeps dynamic channel selection", func(t *testing.T) {
		info := newInfo()
		info.RelayMode = relayconstant.RelayModeUnknown
		require.Nil(t, lockTokenBoundVideoChannel(newContext(), info))
		assert.Nil(t, info.LockedChannel)
	})

	t.Run("missing bound channel fails closed", func(t *testing.T) {
		c := newContext()
		c.Set("token_channel_id", 999)
		info := newInfo()
		taskErr := lockTokenBoundVideoChannel(c, info)
		require.NotNil(t, taskErr)
		assert.Equal(t, http.StatusInternalServerError, taskErr.StatusCode)
		assert.Nil(t, info.LockedChannel)
	})
}

// TestTaskErrorAsChannelErrorKeepsLocalErrorSemantics 锁定「任务错误 → 渠道错误」的换算：
// 预扣费失败必须原样带上 APIError，一旦归一化成 bad_response_status_code 就丢了真实
// error_code 与 SkipRetry / NoRecordErrorLog 选项，用户令牌余额不足会被当成渠道故障。
func TestTaskErrorAsChannelErrorKeepsLocalErrorSemantics(t *testing.T) {
	preConsumeErr := service.TaskErrorFromAPIError(types.NewErrorWithStatusCode(
		errors.New("token quota is not enough"), types.ErrorCodePreConsumeTokenQuotaFailed, http.StatusForbidden,
		types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog()))
	require.NotNil(t, preConsumeErr)

	// 本地生成的类型化错误：原对象下传，选项不丢
	assert.Same(t, preConsumeErr.APIError, taskErrorAsChannelError(preConsumeErr))

	// 本地错误（setup/取渠道/读 body 失败）与渠道无关，不走渠道错误处理
	assert.Nil(t, taskErrorAsChannelError(
		service.TaskErrorWrapperLocal(errors.New("invalid api platform"), "invalid_api_platform", http.StatusBadRequest)))
	assert.Nil(t, taskErrorAsChannelError(nil))

	// 上游错误：归一化为 bad_response_status_code，保留状态码与文案
	upstream := taskErrorAsChannelError(
		service.TaskErrorWrapper(errors.New("upstream boom"), "fail_to_fetch_task", http.StatusInternalServerError))
	require.NotNil(t, upstream)
	assert.Equal(t, types.ErrorCodeBadResponseStatusCode, upstream.GetErrorCode())
	assert.Equal(t, http.StatusInternalServerError, upstream.StatusCode)
	assert.Contains(t, upstream.Error(), "upstream boom")
}

// TestProcessChannelErrorDoesNotLogLocalBillingFailure 锁定错误日志的渠道归属：预扣费
// 失败带 NoRecordErrorLog，processChannelError 不得把它写成渠道错误日志行。
//
// 回归 2026-10-29 生产事故：一次用户令牌余额不足在每个重试渠道上各留一行文案完全
// 相同的错误日志（channel 14/5/33/27…），看起来像所有渠道同时欠费。同一上下文里换成
// 上游错误必须照常落一行，证明「不落库」来自错误自身的选项而非整条日志通路被关掉。
func TestProcessChannelErrorDoesNotLogLocalBillingFailure(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Log{}))

	oldErrorLogEnabled := constant.ErrorLogEnabled
	constant.ErrorLogEnabled = true
	t.Cleanup(func() { constant.ErrorLogEnabled = oldErrorLogEnabled })

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/video/generations", nil)
	c.Set("id", 208)
	c.Set("original_model", "doubao-seedance-2.0")

	preConsumeErr := service.TaskErrorFromAPIError(types.NewErrorWithStatusCode(
		errors.New("token quota is not enough, token remain quota: ¥1.252816, need quota: ¥12.750000"),
		types.ErrorCodePreConsumeTokenQuotaFailed, http.StatusForbidden,
		types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog()))
	require.NotNil(t, preConsumeErr)

	// 连续两个渠道各失败一次（生产事故形态：14→5），错误日志表必须一行都不留
	for _, ch := range []struct {
		id   int
		name string
	}{{14, "qd8"}, {5, "备用渠道"}} {
		c.Set("channel_id", ch.id)
		c.Set("channel_name", ch.name)
		processChannelError(c, *types.NewChannelError(ch.id, 59, ch.name, false, "sk-test", false),
			taskErrorAsChannelError(preConsumeErr))
	}

	var errorLogs int64
	require.NoError(t, db.Model(&model.Log{}).Where("type = ?", model.LogTypeError).Count(&errorLogs).Error)
	assert.Zero(t, errorLogs, "用户令牌余额不足与渠道无关，连续换渠道也不该落渠道错误日志")

	// 对照：上游错误经控制器归一化后仍须落一行，且带上当前渠道
	c.Set("channel_id", 14)
	c.Set("channel_name", "qd8")
	upstreamErr := service.TaskErrorWrapper(errors.New("upstream boom"), "fail_to_fetch_task", http.StatusInternalServerError)
	processChannelError(c, *types.NewChannelError(14, 59, "qd8", false, "sk-test", false),
		taskErrorAsChannelError(upstreamErr))

	var recorded []model.Log
	require.NoError(t, db.Where("type = ?", model.LogTypeError).Find(&recorded).Error)
	require.Len(t, recorded, 1)
	assert.Equal(t, 14, recorded[0].ChannelId)
	assert.Contains(t, recorded[0].Content, "upstream boom")
}

// TestProcessChannelErrorAttributesToOriginatingChannel 锁定「谁的错误记在谁头上」：
// 落库的渠道身份必须来自构造错误时的那个渠道（channelError），而不是 gin context 里
// 当前的 channel_id —— 重试选下一个渠道时 context 会被覆盖，读 context 就会把渠道 A
// 的错误记到渠道 B 头上。两个渠道各自的错误文案也绝不能互相串。
func TestProcessChannelErrorAttributesToOriginatingChannel(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Log{}))

	oldErrorLogEnabled := constant.ErrorLogEnabled
	constant.ErrorLogEnabled = true
	t.Cleanup(func() { constant.ErrorLogEnabled = oldErrorLogEnabled })

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/video/generations", nil)
	c.Set("id", 208)
	c.Set("original_model", "doubao-seedance-2.0")
	c.Set("channel_id", 14)
	c.Set("channel_name", "qd8")
	c.Set("channel_type", 59)

	errOn14 := types.NewOpenAIError(errors.New("channel 14 boom"), types.ErrorCodeBadResponseStatusCode, http.StatusInternalServerError)
	channel14 := *types.NewChannelError(14, 59, "qd8", false, "sk-14", false)

	// 渠道 14 的错误还没落库，重试已经把上下文切到渠道 5
	c.Set("channel_id", 5)
	c.Set("channel_name", "备用渠道")
	c.Set("channel_type", 1)
	processChannelError(c, channel14, errOn14)

	// 渠道 5 自己的错误：另起一行，文案只属于自己的上游响应
	errOn5 := types.NewOpenAIError(errors.New("channel 5 boom"), types.ErrorCodeBadResponseStatusCode, http.StatusBadGateway)
	processChannelError(c, *types.NewChannelError(5, 1, "备用渠道", false, "sk-5", false), errOn5)

	var recorded []model.Log
	require.NoError(t, db.Where("type = ?", model.LogTypeError).Order("id").Find(&recorded).Error)
	require.Len(t, recorded, 2)

	assert.Equal(t, 14, recorded[0].ChannelId, "上下文已切到渠道 5，渠道 14 的错误仍必须记在 14 头上")
	assert.Contains(t, recorded[0].Content, "channel 14 boom")
	assert.NotContains(t, recorded[0].Content, "channel 5 boom")

	assert.Equal(t, 5, recorded[1].ChannelId)
	assert.Contains(t, recorded[1].Content, "channel 5 boom")
	assert.NotContains(t, recorded[1].Content, "channel 14 boom")

	for i, want := range []struct {
		id   float64
		name string
		typ  float64
	}{{14, "qd8", 59}, {5, "备用渠道", 1}} {
		var other map[string]interface{}
		require.NoError(t, common.UnmarshalJsonStr(recorded[i].Other, &other))
		assert.Equal(t, want.id, other["channel_id"], "other.channel_id 必须与行渠道一致")
		assert.Equal(t, want.name, other["channel_name"])
		assert.Equal(t, want.typ, other["channel_type"])
	}
}
