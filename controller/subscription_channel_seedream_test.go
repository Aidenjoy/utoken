package controller

import (
	"fmt"
	"io"
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

// membershipSeedreamFixture purchases a per-image Seedream grant on a VolcEngine Image (type 60)
// channel using only synthetic wallet units and a loopback mock upstream.
func membershipSeedreamFixture(t *testing.T, upstream http.HandlerFunc, modelName string) (*gin.Engine, *gorm.DB, *model.Token, int) {
	t.Helper()
	r, db, _, _ := membershipHTTPFixture(t, upstream)
	var textChannel model.Channel
	require.NoError(t, db.First(&textChannel, 8102).Error)
	channel := &model.Channel{Id: 8106, Type: constant.ChannelTypeVolcEngineImage, Name: "mock-seedream", Key: "mock-upstream", BaseURL: textChannel.BaseURL, Models: modelName, Group: "default", Status: common.ChannelStatusEnabled}
	require.NoError(t, db.Create(channel).Error)
	config, err := common.Marshal([]model.SubscriptionChannelConfig{{ChannelId: channel.Id, Profile: model.MembershipSeedreamImageProfile, Unit: model.MembershipUnitImages, Models: []string{modelName}, QuantityLimit: 2}})
	require.NoError(t, err)
	plan := &model.SubscriptionPlan{Id: 8107, Title: "mock seedream count", MeterType: model.SubscriptionMeterChannel, ChannelQuotas: model.JSONValue(config), PriceAmount: 1, DurationUnit: model.SubscriptionDurationDay, DurationValue: 1, Enabled: true}
	require.NoError(t, db.Create(plan).Error)
	paid := membershipHTTPRequest(r, "/api/subscription/balance/pay", "", `{"plan_id":8107}`)
	var result struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(paid.Body.Bytes(), &result))
	require.True(t, result.Success, paid.Body.String())
	var sub model.UserSubscription
	require.NoError(t, db.Where("plan_id = ?", plan.Id).First(&sub).Error)
	created := membershipHTTPRequest(r, "/api/token", "", fmt.Sprintf(`{"name":"member-seedream","key_type":"image","user_subscription_id":%d,"channel_id":8106,"expired_time":-1}`, sub.Id))
	require.NoError(t, common.Unmarshal(created.Body.Bytes(), &result))
	require.True(t, result.Success, created.Body.String())
	var key model.Token
	require.NoError(t, db.Where("user_subscription_id = ?", sub.Id).First(&key).Error)
	r.POST("/v1/images/generations", middleware.TokenAuth(), middleware.Distribute(), func(c *gin.Context) { Relay(c, types.RelayFormatOpenAIImage) })
	return r, db, &key, sub.Id
}

// TestMembershipHTTPSeedreamSettlesRawGeneratedImages proves the contract settles from the raw
// usage.generated_images receipt (not the returned data length), preserves output_tokens as
// evidence, releases the difference, is idempotent, and never touches the wallet or upstream
// once the count is exhausted.
func TestMembershipHTTPSeedreamSettlesRawGeneratedImages(t *testing.T) {
	var calls atomic.Int32
	var lastBody []byte
	r, db, key, subId := membershipSeedreamFixture(t, func(w http.ResponseWriter, req *http.Request) {
		calls.Add(1)
		assert.Equal(t, "/api/v3/images/generations", req.URL.Path)
		lastBody, _ = io.ReadAll(req.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"created":1,"data":[{"url":"https://mock.invalid/image.png"}],"usage":{"generated_images":1,"output_tokens":4056,"total_tokens":4056}}`)
	}, "doubao-seedream-5-0")
	var before model.User
	require.NoError(t, db.First(&before, 8101).Error)
	response := membershipHTTPRequest(r, "/v1/images/generations", key.Key, `{"model":"doubao-seedream-5-0","prompt":"a cat","n":1,"size":"1024x1024"}`)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())

	// The final Ark payload must stay within the bounded single-image contract.
	var payload map[string]any
	require.NoError(t, common.Unmarshal(lastBody, &payload))
	assert.EqualValues(t, 1, payload["n"])
	assert.Equal(t, false, payload["watermark"])
	for _, forbidden := range []string{"sequential_image_generation", "sequential_image_generation_options", "layer_decomposition", "tools", "image", "stream", "max_tokens"} {
		assert.NotContains(t, payload, forbidden)
	}

	var record model.SubscriptionChannelRequest
	require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&record).Error)
	assert.Equal(t, "settled", record.Status)
	assert.Equal(t, model.MembershipUnitImages, record.Unit)
	assert.Zero(t, record.InputUsed)
	assert.Zero(t, record.OutputUsed)
	assert.EqualValues(t, 1, record.QuantityReserved)
	assert.EqualValues(t, 1, record.QuantityUsed)
	// output_tokens is preserved as raw evidence even though the billing unit is image count.
	assert.Contains(t, string(record.ProviderUsage), `"output_tokens":4056`)
	assert.Contains(t, string(record.ProviderUsage), `"generated_images":1`)

	require.NoError(t, model.FinishMembershipQuantity(record.RequestId, 1, "settled", "duplicate receipt"))
	var grant model.SubscriptionChannelQuota
	require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&grant).Error)
	assert.EqualValues(t, 1, grant.QuantityUsed)
	assert.Zero(t, grant.QuantityReserved)

	// Exhaust the remaining single image, then the next request must not reach upstream.
	require.Equal(t, http.StatusOK, membershipHTTPRequest(r, "/v1/images/generations", key.Key, `{"model":"doubao-seedream-5-0","prompt":"a dog","n":1}`).Code)
	assert.Equal(t, http.StatusForbidden, membershipHTTPRequest(r, "/v1/images/generations", key.Key, `{"model":"doubao-seedream-5-0","prompt":"a bird","n":1}`).Code)
	assert.EqualValues(t, 2, calls.Load(), "exhausted image count never calls upstream")
	var after model.User
	require.NoError(t, db.First(&after, 8101).Error)
	assert.Equal(t, before.Quota, after.Quota)
}

// TestMembershipHTTPSeedreamMissingUsageStaysPending keeps the reservation when the upstream
// omits the raw usage receipt; it must not fall back to counting returned data entries.
func TestMembershipHTTPSeedreamMissingUsageStaysPending(t *testing.T) {
	r, db, key, subId := membershipSeedreamFixture(t, func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"created":1,"data":[{"url":"https://mock.invalid/image.png"}]}`)
	}, "doubao-seedream-5-0-pro")
	response := membershipHTTPRequest(r, "/v1/images/generations", key.Key, `{"model":"doubao-seedream-5-0-pro","prompt":"a cat","n":1}`)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var record model.SubscriptionChannelRequest
	require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&record).Error)
	assert.Equal(t, "pending", record.Status)
	assert.Zero(t, record.QuantityUsed)
	var grant model.SubscriptionChannelQuota
	require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&grant).Error)
	assert.EqualValues(t, 1, grant.QuantityReserved)
	assert.Zero(t, grant.QuantityUsed)
}

// TestMembershipHTTPSeedreamZeroImagesSettlesZero treats a trustworthy zero receipt
// (audit failure with no billable image) as a zero settlement that releases the reservation.
func TestMembershipHTTPSeedreamZeroImagesSettlesZero(t *testing.T) {
	r, db, key, subId := membershipSeedreamFixture(t, func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"created":1,"data":[],"usage":{"generated_images":0,"output_tokens":0,"total_tokens":0}}`)
	}, "doubao-seedream-5-0")
	response := membershipHTTPRequest(r, "/v1/images/generations", key.Key, `{"model":"doubao-seedream-5-0","prompt":"a cat","n":1}`)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var record model.SubscriptionChannelRequest
	require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&record).Error)
	assert.Equal(t, "settled", record.Status)
	assert.Zero(t, record.QuantityUsed)
	var grant model.SubscriptionChannelQuota
	require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&grant).Error)
	assert.Zero(t, grant.QuantityReserved)
	assert.Zero(t, grant.QuantityUsed)
}

// TestMembershipHTTPSeedreamRejectsOutOfContract rejects every request that could exceed one
// billable image or leave the bounded text-to-image contract, before any upstream call.
func TestMembershipHTTPSeedreamRejectsOutOfContract(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
	}{
		{"multiple_n", `{"model":"doubao-seedream-5-0","prompt":"x","n":2}`},
		{"sequential_auto", `{"model":"doubao-seedream-5-0","prompt":"x","n":1,"sequential_image_generation":"auto"}`},
		{"sequential_options", `{"model":"doubao-seedream-5-0","prompt":"x","n":1,"sequential_image_generation_options":{"max_images":5}}`},
		{"layer_decomposition", `{"model":"doubao-seedream-5-0-pro","prompt":"x","n":1,"layer_decomposition":true}`},
		{"reference_image", `{"model":"doubao-seedream-5-0","prompt":"x","n":1,"image":"https://mock.invalid/ref.png"}`},
		{"tools", `{"model":"doubao-seedream-5-0","prompt":"x","n":1,"tools":[{"type":"web_search"}]}`},
		{"stream", `{"model":"doubao-seedream-5-0","prompt":"x","n":1,"stream":true}`},
		{"max_tokens", `{"model":"doubao-seedream-5-0","prompt":"x","n":1,"max_tokens":4096}`},
		{"unsupported_model", `{"model":"doubao-seedream-4-0","prompt":"x","n":1}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			r, db, key, subId := membershipSeedreamFixture(t, func(w http.ResponseWriter, req *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "application/json")
				_, _ = fmt.Fprint(w, `{"created":1,"data":[{"url":"https://mock.invalid/i.png"}],"usage":{"generated_images":1,"output_tokens":4056,"total_tokens":4056}}`)
			}, "doubao-seedream-5-0")
			rejected := membershipHTTPRequest(r, "/v1/images/generations", key.Key, tc.body)
			require.Contains(t, []int{http.StatusBadRequest, http.StatusForbidden}, rejected.Code, rejected.Body.String())
			assert.Zero(t, calls.Load())
			var grant model.SubscriptionChannelQuota
			require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&grant).Error)
			assert.Zero(t, grant.QuantityReserved)
			assert.Zero(t, grant.QuantityUsed)
		})
	}
}

// TestMembershipHTTPSeedreamInconsistentUsageStaysPending keeps the reservation when the raw
// receipt contradicts official Ark semantics (total != output, count mismatch, reference
// images or web search reported), instead of settling an untrustworthy number.
func TestMembershipHTTPSeedreamInconsistentUsageStaysPending(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
	}{
		{"total_mismatch", `{"created":1,"data":[{"url":"https://mock.invalid/i.png"}],"usage":{"generated_images":1,"output_tokens":4056,"total_tokens":9999}}`},
		{"count_mismatch", `{"created":1,"data":[],"usage":{"generated_images":1,"output_tokens":4056,"total_tokens":4056}}`},
		{"input_images", `{"created":1,"data":[{"url":"https://mock.invalid/i.png"}],"usage":{"generated_images":1,"output_tokens":4056,"total_tokens":4056,"input_images":1}}`},
		{"web_search", `{"created":1,"data":[{"url":"https://mock.invalid/i.png"}],"usage":{"generated_images":1,"output_tokens":4056,"total_tokens":4056,"tool_usage":{"web_search":1}}}`},
		{"zero_images_nonzero_tokens", `{"created":1,"data":[],"usage":{"generated_images":0,"output_tokens":4056,"total_tokens":4056}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, db, key, subId := membershipSeedreamFixture(t, func(w http.ResponseWriter, req *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = fmt.Fprint(w, tc.body)
			}, "doubao-seedream-5-0")
			response := membershipHTTPRequest(r, "/v1/images/generations", key.Key, `{"model":"doubao-seedream-5-0","prompt":"x","n":1}`)
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())
			var record model.SubscriptionChannelRequest
			require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&record).Error)
			assert.Equal(t, "pending", record.Status)
			assert.Zero(t, record.QuantityUsed)
			var grant model.SubscriptionChannelQuota
			require.NoError(t, db.Where("user_subscription_id = ?", subId).First(&grant).Error)
			assert.EqualValues(t, 1, grant.QuantityReserved)
			assert.Zero(t, grant.QuantityUsed)
		})
	}
}
