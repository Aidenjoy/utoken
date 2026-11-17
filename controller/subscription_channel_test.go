package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// membershipHTTPFixture exercises real purchase, key issuance, authentication, distribution and relay.
func membershipHTTPFixture(t *testing.T, upstream http.HandlerFunc) (*gin.Engine, *gorm.DB, *model.Token, int) {
	t.Helper()
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Token{}, &model.Log{}, &model.LogBody{}, &model.TopUp{}, &model.Task{}, &model.Agent{}, &model.OrgMember{}, &model.SubscriptionPlan{}, &model.SubscriptionOrder{}, &model.UserSubscription{}, &model.SubscriptionPreConsumeRecord{}, &model.SubscriptionChannelQuota{}, &model.SubscriptionChannelRequest{}))
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	previousMemory, previousBatch, previousLogs := common.MemoryCacheEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled
	common.MemoryCacheEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled = false, false, true
	t.Cleanup(func() {
		common.MemoryCacheEnabled, common.BatchUpdateEnabled, common.LogConsumeEnabled = previousMemory, previousBatch, previousLogs
	})
	previousTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = previousTimeout })
	confirmPaymentComplianceForTest(t)
	previousRatios := ratio_setting.ModelRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"gpt-4o-mini":1}`))
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(previousRatios)) })
	service.InitHttpClient()
	service.InitTokenEncoders()
	server := httptest.NewServer(upstream)
	t.Cleanup(server.Close)
	require.NoError(t, db.Create(&model.User{Id: 8101, Username: "member-http", AffCode: "member-http", Group: "default", Quota: 10000000, Role: common.RoleCommonUser, Status: common.UserStatusEnabled}).Error)
	channel := &model.Channel{Id: 8102, Name: "mock-membership", Type: constant.ChannelTypeOpenAI, Key: "mock-upstream", Models: "gpt-4o-mini,member-text", Group: "default", BaseURL: &server.URL, Status: common.ChannelStatusEnabled}
	mapping := `{"member-text":"gpt-4o-mini"}`
	channel.ModelMapping = &mapping
	setting, err := common.Marshal(dto.ChannelSettings{SystemPrompt: "test system prompt"})
	require.NoError(t, err)
	settingString := string(setting)
	channel.Setting = &settingString
	require.NoError(t, db.Create(channel).Error)
	require.NoError(t, db.Create(&model.Ability{ChannelId: channel.Id, Model: "gpt-4o-mini", Group: "default", Enabled: true}).Error)
	configs, err := common.Marshal([]model.SubscriptionChannelConfig{{ChannelId: channel.Id, Profile: model.MembershipTextProfile, Unit: model.MembershipUnitTokens, Models: []string{"gpt-4o-mini", "member-text"}, InputLimit: 2000, OutputLimit: 30}})
	require.NoError(t, err)
	plan := &model.SubscriptionPlan{Id: 8103, Title: "mock membership", MeterType: model.SubscriptionMeterChannel, ChannelQuotas: model.JSONValue(configs), PriceAmount: 1, DurationUnit: model.SubscriptionDurationDay, DurationValue: 1, Enabled: true}
	require.NoError(t, db.Create(plan).Error)
	r := gin.New()
	r.Use(middleware.BodyStorageCleanup())
	r.Use(func(c *gin.Context) {
		common.SetContextKey(c, constant.ContextKeyRequestStartTime, time.Now())
		c.Next()
	})
	account := r.Group("/api")
	account.Use(func(c *gin.Context) { c.Set("id", 8101); c.Next() }) // Simulated authenticated account session.
	account.POST("/subscription/balance/pay", SubscriptionRequestBalancePay)
	account.POST("/token", AddToken)
	r.POST("/v1/chat/completions", middleware.TokenAuth(), middleware.Distribute(), func(c *gin.Context) { Relay(c, types.RelayFormatOpenAI) })
	paid := membershipHTTPRequest(r, "/api/subscription/balance/pay", "", `{"plan_id":8103}`)
	require.Equal(t, http.StatusOK, paid.Code, paid.Body.String())
	var response struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(paid.Body.Bytes(), &response))
	require.True(t, response.Success, response.Message)
	var subscription model.UserSubscription
	require.NoError(t, db.Where("user_id = ?", 8101).First(&subscription).Error)
	created := membershipHTTPRequest(r, "/api/token", "", fmt.Sprintf(`{"name":"member","key_type":"language","user_subscription_id":%d,"channel_id":8102,"expired_time":-1}`, subscription.Id))
	require.NoError(t, common.Unmarshal(created.Body.Bytes(), &response))
	require.True(t, response.Success, created.Body.String())
	var key model.Token
	require.NoError(t, db.Where("user_subscription_id = ?", subscription.Id).First(&key).Error)
	return r, db, &key, subscription.Id
}

func membershipHTTPRequest(r http.Handler, path, key, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if key != "" {
		request.Header.Set("Authorization", "Bearer sk-"+key)
	}
	response := httptest.NewRecorder()
	r.ServeHTTP(response, request)
	return response
}

func TestMembershipHTTPTextPurchaseKeyAndWalletIsolation(t *testing.T) {
	var calls atomic.Int32
	r, db, key, subId := membershipHTTPFixture(t, func(w http.ResponseWriter, req *http.Request) {
		calls.Add(1)
		var body dto.GeneralOpenAIRequest
		err := common.DecodeJson(req.Body, &body)
		if !assert.NoError(t, err) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		assert.Equal(t, "test system prompt", body.Messages[0].StringContent())
		assert.EqualValues(t, 20, *body.MaxTokens)
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"id":"chat-mock","object":"chat.completion","model":"gpt-4o-mini","choices":[{"index":0,"message":{"role":"assistant","content":"hello"},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":15,"total_tokens":27}}`)
	})
	body := `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}],"max_tokens":20}`
	var before model.User
	require.NoError(t, db.First(&before, 8101).Error)
	result := membershipHTTPRequest(r, "/v1/chat/completions", key.Key, body)
	require.Equal(t, http.StatusOK, result.Code, result.Body.String())
	assert.EqualValues(t, 1, calls.Load())
	var grant model.SubscriptionChannelQuota
	require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&grant).Error)
	assert.EqualValues(t, 12, grant.InputUsed)
	assert.EqualValues(t, 15, grant.OutputUsed)
	assert.Zero(t, grant.InputReserved)
	assert.Zero(t, grant.OutputReserved)
	// Remaining output is 15: reserve 20 must reject before any upstream call.
	second := membershipHTTPRequest(r, "/api/token", "", fmt.Sprintf(`{"name":"member-second","key_type":"language","user_subscription_id":%d,"channel_id":8102,"expired_time":-1}`, subId))
	require.Equal(t, http.StatusOK, second.Code)
	var secondKey model.Token
	require.NoError(t, db.Where("name = ?", "member-second").First(&secondKey).Error)
	result = membershipHTTPRequest(r, "/v1/chat/completions", secondKey.Key, body)
	assert.Equal(t, http.StatusForbidden, result.Code, result.Body.String())
	assert.EqualValues(t, 1, calls.Load())
	var after model.User
	require.NoError(t, db.First(&after, 8101).Error)
	assert.Equal(t, before.Quota, after.Quota, "membership must not debit the wallet")
	ordinary := &model.Token{UserId: 8101, Key: "ordinarymembershiptest", Name: "ordinary", KeyType: model.TokenKeyTypeLanguage, ExpiredTime: -1, UnlimitedQuota: true, Status: common.TokenStatusEnabled}
	require.NoError(t, db.Create(ordinary).Error)
	result = membershipHTTPRequest(r, "/v1/chat/completions", ordinary.Key, body)
	require.Equal(t, http.StatusOK, result.Code, result.Body.String())
	require.NoError(t, db.First(&after, 8101).Error)
	assert.Less(t, after.Quota, before.Quota, "ordinary key must still debit the wallet")
	assert.EqualValues(t, 2, calls.Load())
	require.NoError(t, db.First(&grant, grant.Id).Error)
	assert.EqualValues(t, 12, grant.InputUsed)
	assert.EqualValues(t, 15, grant.OutputUsed)
}

func TestMembershipHTTPMissingUsageRetainsReservation(t *testing.T) {
	r, db, key, subId := membershipHTTPFixture(t, func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"id":"chat-missing","choices":[{"message":{"role":"assistant","content":"hello"},"finish_reason":"stop"}]}`)
	})
	result := membershipHTTPRequest(r, "/v1/chat/completions", key.Key, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}],"max_tokens":20}`)
	require.Equal(t, http.StatusOK, result.Code, result.Body.String())
	var record model.SubscriptionChannelRequest
	require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&record).Error)
	assert.Equal(t, "pending", record.Status)
	assert.Zero(t, record.InputUsed)
	assert.Zero(t, record.OutputUsed)
	var grant model.SubscriptionChannelQuota
	require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&grant).Error)
	assert.Positive(t, grant.InputReserved)
	assert.EqualValues(t, 20, grant.OutputReserved)
}

func TestMembershipHTTPStreamTerminalAndInterruptedUsage(t *testing.T) {
	for _, completed := range []bool{true, false} {
		t.Run(fmt.Sprintf("completed=%t", completed), func(t *testing.T) {
			r, db, key, subId := membershipHTTPFixture(t, func(w http.ResponseWriter, req *http.Request) {
				var body dto.GeneralOpenAIRequest
				if !assert.NoError(t, common.DecodeJson(req.Body, &body)) {
					w.WriteHeader(400)
					return
				}
				if assert.NotNil(t, body.StreamOptions) {
					assert.True(t, body.StreamOptions.IncludeUsage)
				}
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = fmt.Fprint(w, "data: {\"id\":\"stream-test\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hello\"}}]}\n\n")
				_, _ = fmt.Fprint(w, "data: {\"id\":\"stream-test\",\"choices\":[],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":4,\"total_tokens\":16}}\n\n")
				if completed {
					_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
				}
			})
			result := membershipHTTPRequest(r, "/v1/chat/completions", key.Key, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}],"max_tokens":20,"stream":true,"stream_options":{"include_usage":false}}`)
			require.Equal(t, http.StatusOK, result.Code, result.Body.String())
			var record model.SubscriptionChannelRequest
			require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&record).Error)
			var grant model.SubscriptionChannelQuota
			require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&grant).Error)
			if completed {
				assert.Equal(t, "settled", record.Status)
				assert.EqualValues(t, 12, grant.InputUsed)
				assert.EqualValues(t, 4, grant.OutputUsed)
				assert.Zero(t, grant.OutputReserved)
			} else {
				assert.Equal(t, "pending", record.Status)
				assert.Zero(t, grant.InputUsed)
				assert.EqualValues(t, 20, grant.OutputReserved)
			}
		})
	}
}

func TestMembershipHTTPConcurrentRequestsDoNotOverspend(t *testing.T) {
	var calls atomic.Int32
	r, db, key, subId := membershipHTTPFixture(t, func(w http.ResponseWriter, req *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"id":"concurrent","choices":[{"message":{"role":"assistant","content":"ok"}}],"usage":{"prompt_tokens":12,"completion_tokens":15,"total_tokens":27}}`)
	})
	start := make(chan struct{})
	results := make(chan int, 2)
	var workers sync.WaitGroup
	for range 2 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			result := membershipHTTPRequest(r, "/v1/chat/completions", key.Key, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}],"max_tokens":20}`)
			results <- result.Code
		}()
	}
	close(start)
	workers.Wait()
	close(results)
	counts := map[int]int{}
	for status := range results {
		counts[status]++
	}
	assert.Equal(t, 1, counts[http.StatusOK])
	assert.Equal(t, 1, counts[http.StatusForbidden])
	assert.EqualValues(t, 1, calls.Load())
	var grant model.SubscriptionChannelQuota
	require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&grant).Error)
	assert.EqualValues(t, 15, grant.OutputUsed)
	assert.Zero(t, grant.OutputReserved)
}

func TestMembershipHTTPInputExhaustionAndExpiryBlockUpstream(t *testing.T) {
	var calls atomic.Int32
	r, db, key, subId := membershipHTTPFixture(t, func(w http.ResponseWriter, req *http.Request) { calls.Add(1); w.WriteHeader(500) })
	require.NoError(t, db.Model(&model.SubscriptionChannelQuota{}).Where("user_subscription_id = ?", subId).Update("input_limit", 1).Error)
	body := `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}],"max_tokens":20}`
	assert.Equal(t, http.StatusForbidden, membershipHTTPRequest(r, "/v1/chat/completions", key.Key, body).Code)
	require.NoError(t, db.Model(&model.UserSubscription{}).Where("id = ?", subId).Update("end_time", common.GetTimestamp()-1).Error)
	assert.Equal(t, http.StatusForbidden, membershipHTTPRequest(r, "/v1/chat/completions", key.Key, body).Code)
	assert.Zero(t, calls.Load())
}

func TestMembershipHTTPFinalOverrideDeterminesReservation(t *testing.T) {
	var outputLimit atomic.Uint64
	r, db, key, subId := membershipHTTPFixture(t, func(w http.ResponseWriter, req *http.Request) {
		var body dto.GeneralOpenAIRequest
		if !assert.NoError(t, common.DecodeJson(req.Body, &body)) {
			w.WriteHeader(400)
			return
		}
		if assert.NotNil(t, body.MaxTokens) {
			outputLimit.Store(uint64(*body.MaxTokens))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"id":"override","choices":[{"message":{"role":"assistant","content":"ok"}}],"usage":{"prompt_tokens":12,"completion_tokens":15,"total_tokens":27}}`)
	})
	require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", 8102).Update("param_override", `{"max_tokens":25}`).Error)
	result := membershipHTTPRequest(r, "/v1/chat/completions", key.Key, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}],"max_tokens":20}`)
	require.Equal(t, http.StatusOK, result.Code, result.Body.String())
	assert.EqualValues(t, 25, outputLimit.Load())
	var record model.SubscriptionChannelRequest
	require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&record).Error)
	assert.EqualValues(t, 25, record.OutputReserved)
	assert.Equal(t, "settled", record.Status)
	assert.NotEmpty(t, record.ProviderUsage)
}

func TestMembershipHTTPUnsupportedOrUnreliableUsageIsPending(t *testing.T) {
	for _, usage := range []string{
		`{"total_tokens":27}`,
		`{"prompt_tokens":12,"completion_tokens":15,"total_tokens":28}`,
		`{"prompt_tokens":12,"completion_tokens":25,"total_tokens":37}`,
	} {
		t.Run(usage, func(t *testing.T) {
			r, db, key, subId := membershipHTTPFixture(t, func(w http.ResponseWriter, req *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = fmt.Fprintf(w, `{"id":"unreliable","choices":[{"message":{"role":"assistant","content":"ok"}}],"usage":%s}`, usage)
			})
			result := membershipHTTPRequest(r, "/v1/chat/completions", key.Key, `{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}],"max_tokens":20}`)
			require.Equal(t, http.StatusOK, result.Code, result.Body.String())
			var record model.SubscriptionChannelRequest
			require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&record).Error)
			assert.Equal(t, "pending", record.Status)
			assert.Zero(t, record.InputUsed)
			assert.Zero(t, record.OutputUsed)
			assert.NotEmpty(t, record.ProviderUsage)
		})
	}
}

func TestMembershipHTTPMappedFreeModelStillConsumesMembership(t *testing.T) {
	var upstreamModel atomic.Value
	r, db, key, subId := membershipHTTPFixture(t, func(w http.ResponseWriter, req *http.Request) {
		var body dto.GeneralOpenAIRequest
		if !assert.NoError(t, common.DecodeJson(req.Body, &body)) {
			w.WriteHeader(400)
			return
		}
		upstreamModel.Store(body.Model)
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"id":"mapped","choices":[{"message":{"role":"assistant","content":"ok"}}],"usage":{"prompt_tokens":12,"completion_tokens":15,"total_tokens":27}}`)
	})
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"gpt-4o-mini":0,"member-text":0}`))
	result := membershipHTTPRequest(r, "/v1/chat/completions", key.Key, `{"model":"member-text","messages":[{"role":"user","content":"hello"}],"max_tokens":20}`)
	require.Equal(t, http.StatusOK, result.Code, result.Body.String())
	assert.Equal(t, "gpt-4o-mini", upstreamModel.Load())
	var record model.SubscriptionChannelRequest
	require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&record).Error)
	assert.Equal(t, "member-text", record.Model)
	assert.Equal(t, "settled", record.Status)
	assert.EqualValues(t, 12, record.InputUsed)
	assert.EqualValues(t, 15, record.OutputUsed)
}

func TestMembershipHTTPAzureTextMock(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprintf("stream=%t", stream), func(t *testing.T) {
			var calls atomic.Int32
			r, db, key, subId := membershipHTTPFixture(t, func(w http.ResponseWriter, req *http.Request) {
				calls.Add(1)
				assert.Contains(t, req.URL.Path, "/openai/deployments/gpt-4o-mini/chat/completions")
				assert.Equal(t, "mock-upstream", req.Header.Get("api-key"))
				if stream {
					w.Header().Set("Content-Type", "text/event-stream")
					_, _ = fmt.Fprint(w, "data: {\"id\":\"azure\",\"choices\":[],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":15,\"total_tokens\":27}}\n\ndata: [DONE]\n\n")
					return
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = fmt.Fprint(w, `{"id":"azure","choices":[{"message":{"role":"assistant","content":"ok"}}],"usage":{"prompt_tokens":12,"completion_tokens":15,"total_tokens":27}}`)
			})
			require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", 8102).Updates(map[string]interface{}{"type": constant.ChannelTypeAzure, "other": "2024-06-01"}).Error)
			body := fmt.Sprintf(`{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}],"max_tokens":20,"stream":%t}`, stream)
			result := membershipHTTPRequest(r, "/v1/chat/completions", key.Key, body)
			require.Equal(t, http.StatusOK, result.Code, result.Body.String())
			var grant model.SubscriptionChannelQuota
			require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&grant).Error)
			assert.EqualValues(t, 12, grant.InputUsed)
			assert.EqualValues(t, 15, grant.OutputUsed)
			assert.Equal(t, http.StatusForbidden, membershipHTTPRequest(r, "/v1/chat/completions", key.Key, body).Code)
			assert.EqualValues(t, 1, calls.Load())
		})
	}
}

func TestMembershipHTTPAdditionalTextModelMock(t *testing.T) {
	r, db, key, subId := membershipHTTPFixture(t, func(w http.ResponseWriter, req *http.Request) {
		var body dto.GeneralOpenAIRequest
		if !assert.NoError(t, common.DecodeJson(req.Body, &body)) {
			w.WriteHeader(400)
			return
		}
		assert.Equal(t, "gpt-4.1-mini", body.Model)
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"id":"gpt41","choices":[{"message":{"role":"assistant","content":"ok"}}],"usage":{"prompt_tokens":12,"completion_tokens":15,"total_tokens":27}}`)
	})
	require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", 8102).Update("model_mapping", `{"member-text":"gpt-4.1-mini"}`).Error)
	result := membershipHTTPRequest(r, "/v1/chat/completions", key.Key, `{"model":"member-text","messages":[{"role":"user","content":"hello"}],"max_tokens":20}`)
	require.Equal(t, http.StatusOK, result.Code, result.Body.String())
	var grant model.SubscriptionChannelQuota
	require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&grant).Error)
	assert.EqualValues(t, 12, grant.InputUsed)
	assert.EqualValues(t, 15, grant.OutputUsed)
}

func TestMembershipHTTPUnimplementedProtocolsNeverReachWalletOrUpstream(t *testing.T) {
	r, db, key, _ := membershipHTTPFixture(t, func(w http.ResponseWriter, req *http.Request) { t.Error("unsupported protocol reached upstream") })
	var wallet model.User
	require.NoError(t, db.First(&wallet, 8101).Error)
	before := wallet.Quota
	var accepted atomic.Int32
	for _, endpoint := range []struct{ method, path string }{
		{http.MethodPost, "/v1/audio/transcriptions"},
		{http.MethodPost, "/v1/audio/translations"},
		{http.MethodPost, "/v1/audio/speech"},
		{http.MethodGet, "/v1/realtime"},
		{http.MethodPost, "/v1/videos"},
		{http.MethodPost, "/api/v3/contents/generations/tasks"},
		{http.MethodPost, "/v1/messages"},
		{http.MethodPost, "/v1/responses"},
		{http.MethodPost, "/v1/images/edits"},
	} {
		r.Handle(endpoint.method, endpoint.path, middleware.TokenAuth(), func(c *gin.Context) { accepted.Add(1); c.Status(http.StatusOK) })
		request := httptest.NewRequest(endpoint.method, endpoint.path, strings.NewReader(`{"model":"gpt-4o-mini"}`))
		request.Header.Set("Authorization", "Bearer sk-"+key.Key)
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		r.ServeHTTP(response, request)
		assert.Equal(t, http.StatusForbidden, response.Code, endpoint.path)
	}
	assert.Zero(t, accepted.Load())
	require.NoError(t, db.First(&wallet, 8101).Error)
	assert.Equal(t, before, wallet.Quota)
}
