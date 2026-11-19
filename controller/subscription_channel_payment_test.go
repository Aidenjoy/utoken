package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestMembershipEpayMockLifecycle uses only local signing and a disposable test database.
// No checkout page, payment service, real account or real wallet is ever contacted.
func TestMembershipEpayMockLifecycle(t *testing.T) {
	r, db, _, _ := membershipHTTPFixture(t, func(w http.ResponseWriter, req *http.Request) {
		t.Error("payment test must never call a model provider")
	})
	previousAddress, previousID, previousKey := operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey
	operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey = "http://127.0.0.1/mock-payment", "mock-merchant", "mock-signing-key"
	t.Cleanup(func() {
		operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey = previousAddress, previousID, previousKey
	})
	r.POST("/api/subscription/epay/pay", func(c *gin.Context) { c.Set("id", 8101); SubscriptionRequestEpay(c) })
	r.GET("/api/subscription/epay/notify", SubscriptionEpayNotify)
	response := membershipHTTPRequest(r, "/api/subscription/epay/pay", "", `{"plan_id":8103,"payment_method":"alipay"}`)
	require.Equal(t, http.StatusOK, response.Code)
	var result struct {
		Message string `json:"message"`
		URL     string `json:"url"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	require.Equal(t, "success", result.Message, response.Body.String())
	var order model.SubscriptionOrder
	require.NoError(t, db.Where("payment_provider = ?", model.PaymentProviderEpay).First(&order).Error)
	assert.NotEmpty(t, order.PlanSnapshot)
	assert.Equal(t, common.TopUpStatusPending, order.Status)
	countGrants := func() int64 {
		var count int64
		require.NoError(t, db.Model(&model.SubscriptionChannelQuota{}).Count(&count).Error)
		return count
	}
	assert.EqualValues(t, 1, countGrants(), "only the fixture balance purchase is active")
	callback := func(status, amount string, validSignature bool) string {
		params := epay.GenerateParams(map[string]string{"pid": "mock-merchant", "out_trade_no": order.TradeNo, "trade_no": "mock-provider-receipt", "type": "alipay", "money": amount, "trade_status": status, "sign_type": "MD5"}, "mock-signing-key")
		if !validSignature {
			params["sign"] = "invalid"
		}
		query := url.Values{}
		for key, value := range params {
			query.Set(key, value)
		}
		recorder := httptest.NewRecorder()
		r.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/subscription/epay/notify?"+query.Encode(), nil))
		return recorder.Body.String()
	}
	assert.Equal(t, "fail", callback("TRADE_CLOSED", "1.00", true))
	assert.Equal(t, "fail", callback(epay.StatusTradeSuccess, "1.00", false))
	assert.Equal(t, "fail", callback(epay.StatusTradeSuccess, "0.01", true))
	assert.EqualValues(t, 1, countGrants())
	// Updating current plan rights must not change the already quoted order's rights.
	require.NoError(t, db.Model(&model.SubscriptionPlan{}).Where("id = ?", 8103).Update("channel_quotas", model.JSONValue(`[]`)).Error)
	require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", 8102).Update("status", common.ChannelStatusManuallyDisabled).Error)
	assert.Equal(t, "success", callback(epay.StatusTradeSuccess, "1.00", true))
	assert.Equal(t, "success", callback(epay.StatusTradeSuccess, "1.00", true))
	assert.EqualValues(t, 2, countGrants(), "duplicate signed callbacks grant exactly once")
	require.NoError(t, db.First(&order, order.Id).Error)
	assert.Equal(t, common.TopUpStatusSuccess, order.Status)
}

func TestMembershipUpgradeEpayUsesSignedQuote(t *testing.T) {
	r, db, _, _ := membershipHTTPFixture(t, func(http.ResponseWriter, *http.Request) {
		t.Error("upgrade test must never call a model provider")
	})
	previousAddress, previousID, previousKey := operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey
	operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey = "http://127.0.0.1/mock-payment", "mock-merchant", "mock-signing-key"
	t.Cleanup(func() {
		operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey = previousAddress, previousID, previousKey
	})
	for id, price := range map[int]float64{8301: 1, 8302: 2} {
		require.NoError(t, db.Create(&model.SubscriptionPlan{
			Id: id, Title: "mock token plan", Currency: "USD", PriceAmount: price,
			MeterType: model.SubscriptionMeterSharedTokens, InputTokenLimit: int64(id) * 100, OutputTokenLimit: int64(id) * 10,
			DurationUnit: model.SubscriptionDurationDay, DurationValue: 30, Enabled: true,
		}).Error)
	}
	require.NoError(t, model.PurchaseSubscriptionWithBalance(8101, 8301))
	var sub model.UserSubscription
	require.NoError(t, db.Where("plan_id = ?", 8301).First(&sub).Error)
	r.POST("/api/subscription/upgrade/quote", func(c *gin.Context) { c.Set("id", 8101); SubscriptionRequestUpgradeQuote(c) })
	r.POST("/api/subscription/epay/pay", func(c *gin.Context) { c.Set("id", 8101); SubscriptionRequestEpay(c) })
	r.GET("/api/subscription/epay/notify", SubscriptionEpayNotify)
	quoted := membershipHTTPRequest(r, "/api/subscription/upgrade/quote", "", fmt.Sprintf(`{"subscription_id":%d,"target_plan_id":8302}`, sub.Id))
	var result struct {
		Success bool
		Data    struct {
			Token string `json:"quote_token"`
			Quote model.SubscriptionUpgradeQuote
		}
	}
	require.NoError(t, common.Unmarshal(quoted.Body.Bytes(), &result))
	require.True(t, result.Success, quoted.Body.String())
	require.NotEmpty(t, result.Data.Token)
	orderRequest := func(token string) *httptest.ResponseRecorder {
		return membershipHTTPRequest(r, "/api/subscription/epay/pay", "", fmt.Sprintf(`{"plan_id":8302,"payment_method":"alipay","upgrade_quote":%q}`, token))
	}
	require.NotContains(t, orderRequest(result.Data.Token+"tampered").Body.String(), "mock-payment")
	require.Contains(t, orderRequest(result.Data.Token).Body.String(), "mock-payment")
	var order model.SubscriptionOrder
	require.NoError(t, db.Where("plan_id = ? AND status = ?", 8302, common.TopUpStatusPending).First(&order).Error)
	require.InDelta(t, result.Data.Quote.Amount.InexactFloat64(), order.Money, 0.001)
	params := epay.GenerateParams(map[string]string{"pid": "mock-merchant", "out_trade_no": order.TradeNo,
		"trade_no": "mock-upgrade-receipt", "type": "alipay", "money": result.Data.Quote.Amount.StringFixed(2),
		"trade_status": epay.StatusTradeSuccess, "sign_type": "MD5"}, "mock-signing-key")
	query := url.Values{}
	for key, value := range params {
		query.Set(key, value)
	}
	recorder := httptest.NewRecorder()
	r.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/subscription/epay/notify?"+query.Encode(), nil))
	require.Equal(t, "success", recorder.Body.String())
	var updated model.UserSubscription
	require.NoError(t, db.First(&updated, sub.Id).Error)
	require.Equal(t, 8302, updated.PlanId)
	require.Equal(t, sub.EndTime, updated.EndTime)
}
