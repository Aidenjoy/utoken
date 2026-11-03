package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestIsModelPricingOptionKey pins the exact whitelist that scopes a granted
// (non-root) admin to the 系统管理-计费与支付-模型定价 page. Keys inside the list are
// readable/writable by that admin; everything else — including other billing
// keys such as group ratios and quotas — stays root-only.
func TestIsModelPricingOptionKey(t *testing.T) {
	pricingKeys := []string{
		"ModelPrice",
		"ModelRatio",
		"CompletionRatio",
		"CacheRatio",
		"CreateCacheRatio",
		"ImageRatio",
		"AudioRatio",
		"AudioCompletionRatio",
		"ExposeRatioEnabled",
		"billing_setting.billing_mode",
		"billing_setting.billing_expr",
		"billing_setting.seedance_config",
		"billing_setting.seedream_config",
		"tool_price_setting.prices",
	}
	for _, key := range pricingKeys {
		assert.Truef(t, isModelPricingOptionKey(key), "expected %q to be a model-pricing key", key)
	}

	nonPricingKeys := []string{
		"GroupRatio",
		"TopupGroupRatio",
		"UserUsableGroups",
		"QuotaForNewUser",
		"QuotaForInviter",
		"ThemeName",
		"PayAddress",
		"StripeApiSecret",
		"payment_setting.compliance_confirmed",
		// CompletionRatioMeta is a derived read-only value, never writable.
		"CompletionRatioMeta",
		"",
	}
	for _, key := range nonPricingKeys {
		assert.Falsef(t, isModelPricingOptionKey(key), "expected %q NOT to be a model-pricing key", key)
	}
}

// TestGetOptionsScopesNonRootToModelPricingKeys guards the read side of the
// boundary: a granted admin only receives pricing keys, while root receives every
// non-sensitive option. Sensitive keys are hidden from both.
func TestGetOptionsScopesNonRootToModelPricingKeys(t *testing.T) {
	gin.SetMode(gin.TestMode)

	common.OptionMapRWMutex.Lock()
	original := common.OptionMap
	common.OptionMap = map[string]string{
		"ModelRatio":      "{}",
		"QuotaForNewUser": "100",
		"ThemeName":       "default",
		"StripeApiSecret": "sk_live_secret",
	}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = original
		common.OptionMapRWMutex.Unlock()
	})

	readKeys := func(role int) map[string]bool {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/option/", nil)
		ctx.Set("role", role)

		GetOptions(ctx)

		require.Equal(t, http.StatusOK, recorder.Code)
		var response struct {
			Success bool `json:"success"`
			Data    []struct {
				Key string `json:"key"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		require.True(t, response.Success)
		keys := make(map[string]bool, len(response.Data))
		for _, option := range response.Data {
			keys[option.Key] = true
		}
		return keys
	}

	t.Run("non-root sees only pricing keys", func(t *testing.T) {
		keys := readKeys(common.RoleAdminUser)
		assert.True(t, keys["ModelRatio"], "pricing key must be visible")
		assert.True(t, keys["CompletionRatioMeta"], "derived ratio meta must be visible")
		assert.False(t, keys["QuotaForNewUser"], "non-pricing billing key must be hidden")
		assert.False(t, keys["ThemeName"], "site key must be hidden")
		assert.False(t, keys["StripeApiSecret"], "sensitive key must always be hidden")
	})

	t.Run("root sees all non-sensitive keys", func(t *testing.T) {
		keys := readKeys(common.RoleRootUser)
		assert.True(t, keys["ModelRatio"])
		assert.True(t, keys["QuotaForNewUser"])
		assert.True(t, keys["ThemeName"])
		assert.False(t, keys["StripeApiSecret"], "sensitive key must always be hidden")
	})
}

// TestUpdateOptionRejectsNonRootOutsidePricingWhitelist guards the write side: a
// granted admin attempting to modify any non-pricing option is rejected before the
// change reaches validation or the database.
func TestUpdateOptionRejectsNonRootOutsidePricingWhitelist(t *testing.T) {
	gin.SetMode(gin.TestMode)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		http.MethodPut,
		"/api/option/",
		bytes.NewBufferString(`{"key":"QuotaForNewUser","value":"999"}`),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Set("role", common.RoleAdminUser)

	UpdateOption(ctx)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success, "non-root must not write keys outside the pricing whitelist")
}
