package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestOptionSectionsForKey(t *testing.T) {
	tests := []struct {
		name     string
		key      string
		expected []authz.Permission
	}{
		{name: "exact billing key", key: "ModelRatio", expected: []authz.Permission{authz.SettingsBilling}},
		{name: "exact shared key", key: "ServerAddress", expected: []authz.Permission{authz.SettingsSite, authz.SettingsAuth}},
		{name: "site prefix", key: "theme.default", expected: []authz.Permission{authz.SettingsSite}},
		{name: "models prefix", key: "channel_affinity_setting.enabled", expected: []authz.Permission{authz.SettingsModels}},
		{name: "exact key beats namespace fallback", key: "general_setting.docs_link", expected: []authz.Permission{authz.SettingsBilling}},
		{name: "unknown key is root only", key: "FutureSecretSetting", expected: nil},
		{name: "unclassified general setting is root only", key: "general_setting.future", expected: nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, optionSectionsForKey(tt.key))
		})
	}
}

func TestOptionKeyAllowedUsesGrantedSettingsSections(t *testing.T) {
	granted := map[string]bool{authz.ActionSettingsBilling: true}

	assert.True(t, optionKeyAllowed("ModelRatio", granted))
	assert.True(t, optionKeyAllowed("payment_setting.compliance_confirmed", granted))
	assert.False(t, optionKeyAllowed("SystemName", granted))
	assert.False(t, optionKeyAllowed("ServerAddress", granted))
	assert.False(t, optionKeyAllowed("FutureSecretSetting", granted))

	granted[authz.ActionSettingsAuth] = true
	assert.True(t, optionKeyAllowed("ServerAddress", granted))
}

func TestGetOptionsScopesNonRootToGrantedSettings(t *testing.T) {
	setupOptionAuthzTest(t)
	gin.SetMode(gin.TestMode)

	common.OptionMapRWMutex.Lock()
	original := common.OptionMap
	common.OptionMap = map[string]string{
		"ModelRatio":       "{}",
		"QuotaForNewUser":  "100",
		"SystemName":       "Example",
		"StripeApiSecret":  "sk_live_secret",
		"FutureRootOption": "root-only",
	}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = original
		common.OptionMapRWMutex.Unlock()
	})

	require.NoError(t, authz.SetUserPermissions(42, authz.PermissionsMap{
		authz.ResourceSettings: {authz.ActionSettingsBilling: true},
	}))

	readKeys := func(userID int, role int) map[string]bool {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/option/", nil)
		ctx.Set("id", userID)
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

	t.Run("billing admin sees only granted billing keys", func(t *testing.T) {
		keys := readKeys(42, common.RoleAdminUser)
		assert.True(t, keys["ModelRatio"])
		assert.True(t, keys["QuotaForNewUser"])
		assert.True(t, keys["CompletionRatioMeta"])
		assert.False(t, keys["SystemName"])
		assert.False(t, keys["FutureRootOption"])
		assert.False(t, keys["StripeApiSecret"])
	})

	t.Run("root sees all non-sensitive keys", func(t *testing.T) {
		keys := readKeys(1, common.RoleRootUser)
		assert.True(t, keys["ModelRatio"])
		assert.True(t, keys["QuotaForNewUser"])
		assert.True(t, keys["SystemName"])
		assert.True(t, keys["FutureRootOption"])
		assert.False(t, keys["StripeApiSecret"])
	})
}

func TestUpdateOptionRejectsNonRootOutsideGrantedSettings(t *testing.T) {
	setupOptionAuthzTest(t)
	gin.SetMode(gin.TestMode)
	require.NoError(t, authz.SetUserPermissions(42, authz.PermissionsMap{
		authz.ResourceSettings: {authz.ActionSettingsBilling: true},
	}))

	for _, key := range []string{"SystemName", "FutureRootOption"} {
		t.Run(key, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(
				http.MethodPut,
				"/api/option/",
				bytes.NewBufferString(`{"key":`+`"`+key+`"`+`,"value":"changed"}`),
			)
			ctx.Request.Header.Set("Content-Type", "application/json")
			ctx.Set("id", 42)
			ctx.Set("role", common.RoleAdminUser)

			UpdateOption(ctx)

			require.Equal(t, http.StatusOK, recorder.Code)
			var response struct {
				Success bool `json:"success"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			assert.False(t, response.Success)
		})
	}
}

func setupOptionAuthzTest(t *testing.T) {
	t.Helper()
	wasMaster := common.IsMasterNode
	common.IsMasterNode = true
	t.Cleanup(func() {
		common.IsMasterNode = wasMaster
	})
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.CasbinRule{}, &model.AuthzRole{}))
	require.NoError(t, authz.Init(db))
}
