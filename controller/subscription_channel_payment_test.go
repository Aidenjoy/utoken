package controller

import (
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
