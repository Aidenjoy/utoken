package controller

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel/task/sora"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// membershipVideoFixture uses synthetic funds and a loopback-only provider to
// exercise the existing purchase, key issuance and task relay HTTP chain.
func membershipVideoFixture(t *testing.T, modelName string, handler http.HandlerFunc) (*gin.Engine, *gorm.DB, *model.Token, int) {
	t.Helper()
	r, db, _, _ := membershipHTTPFixture(t, handler)
	var text model.Channel
	require.NoError(t, db.First(&text, 8102).Error)
	require.NoError(t, db.Create(&model.Channel{Id: 8110, Name: "mock-video", Type: constant.ChannelTypeSora, Key: "mock-only", BaseURL: text.BaseURL, Models: modelName, Group: "default", Status: common.ChannelStatusEnabled}).Error)
	config, err := common.Marshal([]model.SubscriptionChannelConfig{{ChannelId: 8110, Profile: model.MembershipVideoProfile, Unit: model.MembershipUnitVideos, Models: []string{modelName}, QuantityLimit: 1}})
	require.NoError(t, err)
	require.NoError(t, db.Create(&model.SubscriptionPlan{Id: 8111, Title: "mock video membership", MeterType: model.SubscriptionMeterChannel, ChannelQuotas: model.JSONValue(config), PriceAmount: 1, DurationUnit: model.SubscriptionDurationDay, DurationValue: 1, Enabled: true}).Error)
	purchased := membershipHTTPRequest(r, "/api/subscription/balance/pay", "", `{"plan_id":8111}`)
	var result struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(purchased.Body.Bytes(), &result))
	require.True(t, result.Success, purchased.Body.String())
	var sub model.UserSubscription
	require.NoError(t, db.Where("plan_id = ?", 8111).First(&sub).Error)
	created := membershipHTTPRequest(r, "/api/token", "", fmt.Sprintf(`{"name":"mock-member-video","key_type":"video","video_model":%q,"model_limits_enabled":true,"model_limits":"sora-2","user_subscription_id":%d,"channel_id":8110,"expired_time":-1}`, modelName, sub.Id))
	require.NoError(t, common.Unmarshal(created.Body.Bytes(), &result))
	require.True(t, result.Success, created.Body.String())
	var key model.Token
	require.NoError(t, db.Where("user_subscription_id = ?", sub.Id).First(&key).Error)
	r.POST("/v1/videos", middleware.TokenAuth(), middleware.Distribute(), RelayTask)
	return r, db, &key, sub.Id
}

func TestMembershipHTTPVideoReservationExpiryAndTerminal(t *testing.T) {
	for _, status := range []string{"completed", "failed", "cancelled"} {
		t.Run(status, func(t *testing.T) {
			var calls atomic.Int32
			r, db, key, subID := membershipVideoFixture(t, "sora-2", func(w http.ResponseWriter, req *http.Request) {
				calls.Add(1)
				assert.Equal(t, "/v1/videos", req.URL.Path)
				w.Header().Set("Content-Type", "application/json")
				_, _ = fmt.Fprint(w, `{"id":"mock-video-upstream","model":"sora-2","status":"queued"}`)
			})
			var before model.User
			require.NoError(t, db.First(&before, 8101).Error)
			body := `{"model":"sora-2","prompt":"mock video","seconds":"4","size":"720x1280"}`
			response := membershipHTTPRequest(r, "/v1/videos", key.Key, body)
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())
			var task model.Task
			require.NoError(t, db.Where("channel_id = ?", 8110).First(&task).Error)
			require.NotEmpty(t, task.PrivateData.MembershipRequestId)
			var grant model.SubscriptionChannelQuota
			require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&grant).Error)
			assert.EqualValues(t, 1, grant.QuantityReserved)
			assert.Zero(t, grant.QuantityUsed)
			rejected := membershipHTTPRequest(r, "/v1/videos", key.Key, body)
			assert.Equal(t, http.StatusForbidden, rejected.Code, rejected.Body.String())
			assert.EqualValues(t, 1, calls.Load())
			require.NoError(t, db.Model(&model.UserSubscription{}).Where("id = ?", subID).Update("end_time", common.GetTimestamp()-1).Error)
			require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", 8110).Update("status", common.ChannelStatusManuallyDisabled).Error)
			// A different subscription of the same user cannot read this task.
			foreign := *key
			foreign.Id = 0
			foreign.UserSubscriptionId = subID + 999
			foreignKey, err := common.GenerateKey()
			foreign.Key = foreignKey
			require.NoError(t, err)
			foreign.AccessKey = nil
			require.NoError(t, db.Create(&foreign).Error)
			forbiddenQuery := httptest.NewRequest(http.MethodGet, "/v1/videos/"+task.TaskID, nil)
			forbiddenQuery.Header.Set("Authorization", "Bearer sk-"+foreign.Key)
			forbidden := httptest.NewRecorder()
			r.ServeHTTP(forbidden, forbiddenQuery)
			assert.Equal(t, http.StatusForbidden, forbidden.Code)

			query := httptest.NewRequest(http.MethodGet, "/v1/videos/"+task.TaskID, nil)
			query.Header.Set("Authorization", "Bearer sk-"+key.Key)
			fetched := httptest.NewRecorder()
			r.ServeHTTP(fetched, query)
			require.Equal(t, http.StatusOK, fetched.Code, fetched.Body.String())
			assert.Equal(t, http.StatusForbidden, membershipHTTPRequest(r, "/v1/videos", key.Key, body).Code)
			adapter := &sora.TaskAdaptor{}
			// An unrelated or unknown receipt cannot release the reservation.
			invalid := []byte(`{"id":"other-task","model":"sora-2","status":"failed"}`)
			info, err := adapter.ParseTaskResult(invalid)
			require.NoError(t, err)
			require.Error(t, service.ApplyUpstreamTaskResult(context.Background(), adapter, &task, info, invalid))
			receipt := []byte(fmt.Sprintf(`{"id":"mock-video-upstream","model":"sora-2","status":%q}`, status))
			info, err = adapter.ParseTaskResult(receipt)
			require.NoError(t, err)
			require.NoError(t, service.ApplyUpstreamTaskResult(context.Background(), adapter, &task, info, receipt))
			if status == "completed" {
				content := httptest.NewRequest(http.MethodGet, "/v1/videos/"+task.TaskID+"/content", nil)
				content.Header.Set("Authorization", "Bearer sk-"+key.Key)
				downloaded := httptest.NewRecorder()
				r.ServeHTTP(downloaded, content)
				assert.Equal(t, http.StatusOK, downloaded.Code, downloaded.Body.String())
			}
			require.NoError(t, service.ApplyUpstreamTaskResult(context.Background(), adapter, &task, info, receipt))
			require.NoError(t, db.First(&grant, grant.Id).Error)
			assert.Zero(t, grant.QuantityReserved)
			expected := int64(0)
			if status == "completed" {
				expected = 1
			}
			assert.Equal(t, expected, grant.QuantityUsed)
			assert.Zero(t, grant.InputUsed)
			assert.Zero(t, grant.OutputUsed)
			var record model.SubscriptionChannelRequest
			require.NoError(t, db.Where("request_id = ?", task.PrivateData.MembershipRequestId).First(&record).Error)
			assert.Equal(t, "settled", record.Status)
			assert.Equal(t, expected, record.QuantityUsed)
			var after model.User
			require.NoError(t, db.First(&after, 8101).Error)
			assert.Equal(t, before.Quota, after.Quota)
			assert.Equal(t, before.UsedQuota, after.UsedQuota)
		})
	}
}

// TestMembershipHTTPVideoUnknownOutcomeNeverRetriesOrReturnsCapacity protects
// against duplicate upstream video jobs and accidental refunds after dispatch.
func TestMembershipHTTPVideoUnknownOutcomeNeverRetriesOrReturnsCapacity(t *testing.T) {
	var calls atomic.Int32
	r, db, key, subID := membershipVideoFixture(t, "sora-2", func(w http.ResponseWriter, req *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = fmt.Fprint(w, `{"error":"mock connection outcome unknown"}`)
	})
	response := membershipHTTPRequest(r, "/v1/videos", key.Key, `{"model":"sora-2","prompt":"mock","seconds":"4"}`)
	assert.GreaterOrEqual(t, response.Code, 400)
	assert.EqualValues(t, 1, calls.Load())
	var grant model.SubscriptionChannelQuota
	require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&grant).Error)
	assert.EqualValues(t, 1, grant.QuantityReserved)
	assert.Zero(t, grant.QuantityUsed)
	var record model.SubscriptionChannelRequest
	require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&record).Error)
	assert.Equal(t, "pending", record.Status)
}

// TestMembershipHTTPVideoProSharesTheTaskContract verifies a second model without
// duplicating its reservation, terminal transaction or wallet isolation logic.
func TestMembershipHTTPVideoProSharesTheTaskContract(t *testing.T) {
	r, db, key, subID := membershipVideoFixture(t, "sora-2-pro", func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"id":"mock-pro","model":"sora-2-pro","status":"queued"}`)
	})
	response := membershipHTTPRequest(r, "/v1/videos", key.Key, `{"model":"sora-2-pro","prompt":"mock","seconds":"8","size":"720x1280"}`)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var task model.Task
	require.NoError(t, db.Where("channel_id = ?", 8110).First(&task).Error)
	receipt := []byte(`{"id":"mock-pro","model":"sora-2-pro","status":"completed"}`)
	adapter := &sora.TaskAdaptor{}
	info, err := adapter.ParseTaskResult(receipt)
	require.NoError(t, err)
	require.NoError(t, service.ApplyUpstreamTaskResult(context.Background(), adapter, &task, info, receipt))
	var grant model.SubscriptionChannelQuota
	require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&grant).Error)
	assert.EqualValues(t, 1, grant.QuantityUsed)
	assert.Zero(t, grant.QuantityReserved)
}

// TestMembershipHTTPVideoKeyCannotSubmitArkNativeOrSeedance pins the R01—R12
// sale ban at the HTTP boundary: a valid Sora video membership key is rejected
// before any upstream call on the Ark native task protocol, and Seedance models
// never enter the bounded Sora contract. This is a rejection guard, not a video
// metering implementation for Ark channels.
func TestMembershipHTTPVideoKeyCannotSubmitArkNativeOrSeedance(t *testing.T) {
	var calls atomic.Int32
	r, db, key, subID := membershipVideoFixture(t, "sora-2", func(w http.ResponseWriter, req *http.Request) {
		calls.Add(1)
		t.Error("blocked video protocol reached upstream")
	})
	r.POST("/api/v3/contents/generations/tasks", middleware.TokenAuth(), middleware.Distribute(), RelayTask)
	var wallet model.User
	require.NoError(t, db.First(&wallet, 8101).Error)
	before := wallet.Quota
	for _, body := range []string{
		`{"model":"sora-2","prompt":"membership ark guard"}`,
		`{"model":"doubao-seedance-2.5","content":[{"type":"text","text":"membership ark guard"}]}`,
	} {
		response := membershipHTTPRequest(r, "/api/v3/contents/generations/tasks", key.Key, body)
		assert.Equal(t, http.StatusForbidden, response.Code, body)
	}
	response := membershipHTTPRequest(r, "/v1/videos", key.Key, `{"model":"doubao-seedance-2.5","prompt":"membership ark guard"}`)
	assert.Equal(t, http.StatusForbidden, response.Code, response.Body.String())
	assert.Zero(t, calls.Load())
	var count int64
	require.NoError(t, db.Model(&model.SubscriptionChannelRequest{}).Where("user_subscription_id = ?", subID).Count(&count).Error)
	assert.Zero(t, count)
	require.NoError(t, db.First(&wallet, 8101).Error)
	assert.Equal(t, before, wallet.Quota)
}
