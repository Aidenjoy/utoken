package controller

import (
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// membershipImageFixture purchases a count-based grant using only synthetic test wallet units.
func membershipImageFixture(t *testing.T, upstream http.HandlerFunc, modelName string) (*gin.Engine, *gorm.DB, *model.Token, int) {
	t.Helper()
	r, db, _, _ := membershipHTTPFixture(t, upstream)
	var textChannel model.Channel
	require.NoError(t, db.First(&textChannel, 8102).Error)
	channel := &model.Channel{Id: 8104, Type: constant.ChannelTypeOpenAI, Name: "mock-image-count", Key: "mock-upstream", BaseURL: textChannel.BaseURL, Models: modelName, Group: "default", Status: common.ChannelStatusEnabled}
	require.NoError(t, db.Create(channel).Error)
	config, err := common.Marshal([]model.SubscriptionChannelConfig{{ChannelId: channel.Id, Profile: model.MembershipImageProfile, Unit: model.MembershipUnitImages, Models: []string{modelName}, QuantityLimit: 2}})
	require.NoError(t, err)
	plan := &model.SubscriptionPlan{Id: 8105, Title: "mock image count", MeterType: model.SubscriptionMeterChannel, ChannelQuotas: model.JSONValue(config), PriceAmount: 1, DurationUnit: model.SubscriptionDurationDay, DurationValue: 1, Enabled: true}
	require.NoError(t, db.Create(plan).Error)
	paid := membershipHTTPRequest(r, "/api/subscription/balance/pay", "", `{"plan_id":8105}`)
	var result struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(paid.Body.Bytes(), &result))
	require.True(t, result.Success, paid.Body.String())
	var sub model.UserSubscription
	require.NoError(t, db.Where("plan_id = ?", plan.Id).First(&sub).Error)
	created := membershipHTTPRequest(r, "/api/token", "", fmt.Sprintf(`{"name":"member-image","key_type":"image","user_subscription_id":%d,"channel_id":8104,"expired_time":-1}`, sub.Id))
	require.NoError(t, common.Unmarshal(created.Body.Bytes(), &result))
	require.True(t, result.Success, created.Body.String())
	var key model.Token
	require.NoError(t, db.Where("user_subscription_id = ?", sub.Id).First(&key).Error)
	r.POST("/v1/images/generations", middleware.TokenAuth(), middleware.Distribute(), func(c *gin.Context) { Relay(c, types.RelayFormatOpenAIImage) })
	return r, db, &key, sub.Id
}

func TestMembershipHTTPImagesUseReturnedCountNotPlaceholderTokens(t *testing.T) {
	var calls atomic.Int32
	r, db, key, subId := membershipImageFixture(t, func(w http.ResponseWriter, req *http.Request) {
		calls.Add(1)
		assert.Equal(t, "/v1/images/generations", req.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"created":1,"data":[{"url":"https://mock.invalid/image.png"}]}`)
	}, "dall-e-2")
	var before model.User
	require.NoError(t, db.First(&before, 8101).Error)
	body := `{"model":"dall-e-2","prompt":"test image","n":2,"size":"1024x1024"}`
	response := membershipHTTPRequest(r, "/v1/images/generations", key.Key, body)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var record model.SubscriptionChannelRequest
	require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&record).Error)
	assert.Equal(t, "settled", record.Status)
	assert.Equal(t, model.MembershipUnitImages, record.Unit)
	assert.Zero(t, record.InputUsed)
	assert.Zero(t, record.OutputUsed)
	assert.EqualValues(t, 2, record.QuantityReserved)
	assert.EqualValues(t, 1, record.QuantityUsed)
	require.NoError(t, model.FinishMembershipQuantity(record.RequestId, 1, "settled", "duplicate receipt"))
	var grant model.SubscriptionChannelQuota
	require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&grant).Error)
	assert.EqualValues(t, 1, grant.QuantityUsed)
	assert.Zero(t, grant.QuantityReserved)
	assert.Equal(t, http.StatusForbidden, membershipHTTPRequest(r, "/v1/images/generations", key.Key, body).Code)
	assert.EqualValues(t, 1, calls.Load(), "insufficient image count never calls upstream")
	var after model.User
	require.NoError(t, db.First(&after, 8101).Error)
	assert.Equal(t, before.Quota, after.Quota)
}

func TestMembershipHTTPImagesMissingResultStaysPending(t *testing.T) {
	r, db, key, subId := membershipImageFixture(t, func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"created":1,"data":[]}`)
	}, "dall-e-2")
	response := membershipHTTPRequest(r, "/v1/images/generations", key.Key, `{"model":"dall-e-2","prompt":"test image","n":2}`)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var record model.SubscriptionChannelRequest
	require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&record).Error)
	assert.Equal(t, "pending", record.Status)
	assert.Zero(t, record.QuantityUsed)
	var grant model.SubscriptionChannelQuota
	require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&grant).Error)
	assert.EqualValues(t, 2, grant.QuantityReserved)
	assert.Zero(t, grant.InputUsed)
	assert.Zero(t, grant.OutputUsed)
}

// TestMembershipHTTPImageProviderBounds rejects provider-invalid counts before
// dispatch and proves that both supported DALL-E contracts settle real results.
func TestMembershipHTTPImageProviderBounds(t *testing.T) {
	for _, tc := range []struct {
		model    string
		invalidN int
	}{{"dall-e-2", 11}, {"dall-e-3", 2}} {
		t.Run(tc.model, func(t *testing.T) {
			var calls atomic.Int32
			r, db, key, subID := membershipImageFixture(t, func(w http.ResponseWriter, req *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "application/json")
				_, _ = fmt.Fprint(w, `{"created":1,"data":[{"b64_json":"mock-image"}]}`)
			}, tc.model)
			rejected := membershipHTTPRequest(r, "/v1/images/generations", key.Key, fmt.Sprintf(`{"model":%q,"prompt":"mock","n":%d}`, tc.model, tc.invalidN))
			require.Equal(t, http.StatusForbidden, rejected.Code, rejected.Body.String())
			assert.Zero(t, calls.Load())
			var grant model.SubscriptionChannelQuota
			require.NoError(t, db.Where("user_subscription_id = ?", subID).First(&grant).Error)
			assert.Zero(t, grant.QuantityReserved)
			accepted := membershipHTTPRequest(r, "/v1/images/generations", key.Key, fmt.Sprintf(`{"model":%q,"prompt":"mock","n":1}`, tc.model))
			require.Equal(t, http.StatusOK, accepted.Code, accepted.Body.String())
			require.NoError(t, db.First(&grant, grant.Id).Error)
			assert.EqualValues(t, 1, grant.QuantityUsed)
			assert.Zero(t, grant.QuantityReserved)
			assert.EqualValues(t, 1, calls.Load())
		})
	}
}
