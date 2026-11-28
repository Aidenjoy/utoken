package controller

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestYuncontrolCloudKeyReusesDesktopKeyAndIsolatesUsers(t *testing.T) {
	oldDB, oldLogDB := model.DB, model.LOG_DB
	oldMainType, oldLogType := common.MainDatabaseType(), common.LogDatabaseType()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "cloud-key.db")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	model.DB, model.LOG_DB = db, db
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.SetDatabaseTypes(oldMainType, oldLogType)
		_ = sqlDB.Close()
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}))
	first := model.User{Username: "cloud-first", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AffCode: "cloud-first"}
	second := model.User{Username: "cloud-second", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AffCode: "cloud-second"}
	disabled := model.User{Username: "cloud-disabled", Role: common.RoleCommonUser, Status: common.UserStatusDisabled, Group: "default", AffCode: "cloud-disabled"}
	require.NoError(t, db.Create(&first).Error)
	require.NoError(t, db.Create(&second).Error)
	require.NoError(t, db.Create(&disabled).Error)
	existing := model.Token{
		UserId: first.Id, Key: strings.Repeat("a", 48), Name: "客户端语言模型专用（不建议用于其他用途）",
		KeyType: model.TokenKeyTypeLanguage, Status: common.TokenStatusEnabled,
		CreatedTime: 1, AccessedTime: 1, ExpiredTime: -1, UnlimitedQuota: true,
	}
	require.NoError(t, db.Create(&existing).Error)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/yuncontrol/cloud-key", YuncontrolCloudKey)
	secret := "test-cloud-key-secret-0123456789abcdef"
	t.Setenv("YUNCONTROL_CLOUD_KEY_SECRET", secret)
	request := func(userID int, credential string) *httptest.ResponseRecorder {
		body := `{"user_id":` + strconv.Itoa(userID) + `}`
		req := httptest.NewRequest(http.MethodPost, "/api/yuncontrol/cloud-key", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if credential != "" {
			req.Header.Set("X-Cloud-Key-Secret", credential)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response
	}
	languageKey := func(response *httptest.ResponseRecorder) string {
		var payload map[string]string
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
		return payload["language_api_key"]
	}

	firstResponse := request(first.Id, secret)
	require.Equal(t, http.StatusOK, firstResponse.Code, firstResponse.Body.String())
	assert.Equal(t, "no-store", firstResponse.Header().Get("Cache-Control"))
	assert.Equal(t, "sk-"+existing.Key, languageKey(firstResponse))
	repeated := request(first.Id, secret)
	require.Equal(t, http.StatusOK, repeated.Code)
	assert.Equal(t, languageKey(firstResponse), languageKey(repeated))

	secondResponse := request(second.Id, secret)
	require.Equal(t, http.StatusOK, secondResponse.Code)
	assert.NotEmpty(t, languageKey(secondResponse))
	assert.NotEqual(t, languageKey(firstResponse), languageKey(secondResponse))
	var keyCount int64
	require.NoError(t, db.Model(&model.Token{}).Where("key_type = ?", model.TokenKeyTypeLanguage).Count(&keyCount).Error)
	assert.Equal(t, int64(2), keyCount)

	for _, credential := range []string{"", "incorrect-cloud-key-secret-0123456789"} {
		denied := request(first.Id, credential)
		assert.Equal(t, http.StatusUnauthorized, denied.Code)
		assert.NotContains(t, denied.Body.String(), existing.Key)
	}
	invalidUser := request(disabled.Id, secret)
	assert.Equal(t, http.StatusNotFound, invalidUser.Code)
	assert.NotContains(t, invalidUser.Body.String(), "language_api_key")

	t.Setenv("YUNCONTROL_CLOUD_KEY_SECRET", "short")
	notConfigured := request(first.Id, "short")
	assert.Equal(t, http.StatusServiceUnavailable, notConfigured.Code)
	assert.NotContains(t, notConfigured.Body.String(), existing.Key)
}
