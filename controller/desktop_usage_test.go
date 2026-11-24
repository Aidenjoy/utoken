package controller

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// TestDesktopUsageLogsHTTP runs the real auth/handlers against separate temporary
// main/log databases. No relay or external server exists in this fixture.
func TestDesktopUsageLogsHTTP(t *testing.T) {
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousMainType, previousLogType := common.MainDatabaseType(), common.LogDatabaseType()
	previousRedis := common.RedisEnabled
	mainDB, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "main.db")), &gorm.Config{})
	require.NoError(t, err)
	logDB, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "log.db")), &gorm.Config{})
	require.NoError(t, err)
	mainSQL, err := mainDB.DB()
	require.NoError(t, err)
	logSQL, err := logDB.DB()
	require.NoError(t, err)
	model.DB, model.LOG_DB = mainDB, logDB
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	model.InitCol()
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.RedisEnabled = previousRedis
		common.SetDatabaseTypes(previousMainType, previousLogType)
		model.InitCol()
		require.NoError(t, mainSQL.Close())
		require.NoError(t, logSQL.Close())
	})
	require.NoError(t, mainDB.AutoMigrate(&model.User{}, &model.Channel{}, &model.OrgMember{}, &model.Organization{}, &model.Agent{}, &model.Token{}, &model.UserSubscription{}, &model.DesktopAuthSession{}, &model.ConversationInfo{}, &model.ConversationMessageDetail{}))
	require.NoError(t, logDB.AutoMigrate(&model.Log{}))
	users := []model.User{
		{Id: 801, Username: "usage-a", AffCode: "usage-a", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", Quota: 12345, UsedQuota: 32},
		{Id: 802, Username: "usage-b", AffCode: "usage-b", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", Quota: 5000},
		{Id: 803, Username: "usage-root", AffCode: "usage-root", Role: common.RoleRootUser, Status: common.UserStatusEnabled, Group: "default", Quota: 9999},
		{Id: 804, Username: "usage-empty", AffCode: "usage-empty", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default"},
	}
	users[0].SetAccessToken(strings.Repeat("m", 32))
	for i := range users {
		require.NoError(t, mainDB.Create(&users[i]).Error)
	}
	tokenFor := func(label string) string {
		return base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat(label, 32)[:32]))
	}
	for i, label := range []string{"account-a", "account-b", "root", "empty"} {
		require.NoError(t, mainDB.Create(&model.DesktopAuthSession{Digest: desktopDigest(tokenFor(label)), UserID: users[i].Id, ExpiresAt: model.GetDBTimestamp() + 3600}).Error)
	}
	require.NoError(t, mainDB.Create(&model.DesktopAuthSession{Digest: desktopDigest(tokenFor("expired")), UserID: 801, ExpiresAt: model.GetDBTimestamp() - 1}).Error)
	apiKey := model.Token{Id: 810, UserId: 801, Key: tokenFor("language-key"), Name: "public-key-name", RemainQuota: 777, ExpiredTime: -1}
	require.NoError(t, mainDB.Create(&apiKey).Error)
	subscription := model.UserSubscription{Id: 820, UserId: 801, PlanId: 1, AmountTotal: 10000, AmountUsed: 123, Status: "active", StartTime: 1, EndTime: 9999999999}
	require.NoError(t, mainDB.Create(&subscription).Error)
	logs := []model.Log{
		{Id: 4101, UserId: 801, Type: model.LogTypeConsume, CreatedAt: 3000, ModelName: "model-a", PromptTokens: 11, CompletionTokens: 7, Quota: 5, SubscriptionQuota: 9, TokenName: "public-key-name", RequestId: "public-request", HttpStatus: 200, UseTime: 2, IsStream: true, TaskSettle: true, CacheHit: true, ChannelId: 61, TokenId: 810, UpstreamRequestId: "private-upstream-id", Ip: "private-ip", Content: "private-content", Other: `{"admin_info":{"key":"private-secret"},"model_ratio":99,"request_url":"private-url"}`},
		{Id: 4102, UserId: 801, Type: model.LogTypeConsume, CreatedAt: 4000, ModelName: "model-b", Quota: 8},
		{Id: 4103, UserId: 801, Type: model.LogTypeConsume, CreatedAt: 3000, ModelName: "model-a", Quota: 3},
		{Id: 4104, UserId: 801, Type: model.LogTypeError, CreatedAt: 2000, ModelName: "model-a", HttpStatus: 0},
		{Id: 4201, UserId: 802, Type: model.LogTypeConsume, CreatedAt: 5000, ModelName: "other-account-model"},
		{Id: 4301, UserId: 803, Type: model.LogTypeConsume, CreatedAt: 6000, ModelName: "root-own-model"},
		{Id: 4401, UserId: 801, Type: model.LogTypeError, CreatedAt: 7000, ModelName: ""},
	}
	for i, kind := range []int{model.LogTypeUnknown, model.LogTypeTopup, model.LogTypeManage, model.LogTypeSystem, model.LogTypeRefund, model.LogTypeLogin, model.LogTypeApiCall, model.LogTypeApiQuery} {
		logs = append(logs, model.Log{Id: 4500 + i, UserId: 801, Type: kind, CreatedAt: 9000, ModelName: "must-not-be-in-model-history"})
	}
	require.NoError(t, logDB.Create(&logs).Error)
	// Snapshot full business objects, not just balances. GET must not mutate any.
	var beforeLogs []model.Log
	require.NoError(t, logDB.Order("id").Find(&beforeLogs).Error)
	var beforeSessions []model.DesktopAuthSession
	require.NoError(t, mainDB.Order("digest").Find(&beforeSessions).Error)
	var beforeUser model.User
	require.NoError(t, mainDB.First(&beforeUser, 801).Error)
	var beforeSubscription model.UserSubscription
	require.NoError(t, mainDB.First(&beforeSubscription, 820).Error)
	var beforeToken model.Token
	require.NoError(t, mainDB.First(&beforeToken, 810).Error)
	r := gin.New()
	r.Use(sessions.Sessions("session", cookie.NewStore([]byte("desktop-usage-isolated-secret"))))
	r.GET("/fixture-login/:id", func(c *gin.Context) {
		var user model.User
		require.NoError(t, mainDB.First(&user, c.Param("id")).Error)
		session := sessions.Default(c)
		session.Set("id", user.Id)
		session.Set("username", user.Username)
		session.Set("role", user.Role)
		session.Set("status", user.Status)
		session.Set("group", user.Group)
		require.NoError(t, session.Save())
		c.Status(204)
	})
	r.GET("/api/desktop/usage-logs", middleware.DesktopBalanceAuth(), ConversationAuth, DesktopUsageLogs)
	r.GET("/api/log/self", middleware.UserAuth(), GetUserLogs)
	r.GET("/api/log/", middleware.AdminAuth(), GetAllLogs)
	r.GET("/api/conversations", middleware.DesktopBalanceAuth(), ConversationAuth, ListConversationHistory)
	send := func(path, token string, userID int, cookies ...*http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if userID > 0 {
			req.Header.Set("New-Api-User", fmt.Sprint(userID))
		}
		for _, cookie := range cookies {
			req.AddCookie(cookie)
		}
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		return rec
	}
	type response struct {
		Success bool `json:"success"`
		Data    struct {
			Page     int                   `json:"page"`
			PageSize int                   `json:"page_size"`
			Total    int                   `json:"total"`
			Items    []dto.DesktopUsageLog `json:"items"`
		} `json:"data"`
	}
	const path = "/api/desktop/usage-logs"
	t.Run("L01 L04 credential and original stored values", func(t *testing.T) {
		rec := send(path, tokenFor("account-a"), 0)
		require.Equal(t, 200, rec.Code)
		assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
		var body response
		require.NoError(t, common.Unmarshal(rec.Body.Bytes(), &body))
		require.True(t, body.Success)
		assert.Equal(t, 20, body.Data.PageSize)
		assert.Equal(t, 4, body.Data.Total)
		require.Len(t, body.Data.Items, 4)
		for i, id := range []int{4102, 4103, 4101, 4104} {
			assert.Equal(t, id, body.Data.Items[i].ID)
		}
		item := body.Data.Items[2]
		assert.Equal(t, 11, item.PromptTokens)
		assert.Equal(t, 7, item.CompletionTokens)
		assert.Equal(t, 5, item.Quota)
		assert.Equal(t, 9, item.SubscriptionQuota)
		assert.Equal(t, "public-key-name", item.TokenName)
		assert.Equal(t, "public-request", item.RequestID)
		assert.True(t, item.IsStream)
		assert.True(t, item.CacheHit)
		assert.True(t, item.TaskSettle)
		assert.Equal(t, model.LogTypeError, body.Data.Items[3].Type)
		assert.Zero(t, body.Data.Items[3].HTTPStatus)
		for _, secret := range []string{"private-", "channel", "user_id", "username", "other", "content", "upstream", "model_ratio", "total_tokens", `"status"`} {
			assert.NotContains(t, rec.Body.String(), secret)
		}
	})
	t.Run("L02 L03 missing expired relay and management credentials", func(t *testing.T) {
		for _, token := range []string{"", tokenFor("expired"), "sk-" + apiKey.Key, apiKey.Key, strings.Repeat("m", 32), "not-a-desktop-token"} {
			assert.Equal(t, 401, send(path, token, 0).Code)
		}
	})
	t.Run("L05 L06 owners including root remain isolated", func(t *testing.T) {
		for _, tc := range []struct {
			token string
			id    int
		}{{"account-b", 4201}, {"root", 4301}} {
			rec := send(path, tokenFor(tc.token), 0)
			require.Equal(t, 200, rec.Code)
			var body response
			require.NoError(t, common.Unmarshal(rec.Body.Bytes(), &body))
			require.Len(t, body.Data.Items, 1)
			assert.Equal(t, tc.id, body.Data.Items[0].ID)
		}
		// Supplying an identity or log type never changes the server-enforced scope.
		for _, query := range []string{"user_id=801", "username=usage-a", "type=0", "channel=1"} {
			assert.Equal(t, 400, send(path+"?"+query, tokenFor("account-b"), 0).Code)
		}
	})
	t.Run("L07 L08 L09 paging inclusive times and model matching", func(t *testing.T) {
		for _, tc := range []struct {
			query string
			total int
			ids   []int
		}{{"?p=2&page_size=2", 4, []int{4101, 4104}}, {"?start_timestamp=3000&end_timestamp=3000", 2, []int{4103, 4101}}, {"?model_name=model-a", 3, []int{4103, 4101, 4104}}, {"?model_name=" + url.QueryEscape("model-%"), 4, []int{4102, 4103, 4101, 4104}}, {"?model_name=" + url.QueryEscape("' OR 1=1 --"), 0, []int{}}, {"?p=3&ps=2", 4, []int{}}} {
			rec := send(path+tc.query, tokenFor("account-a"), 0)
			require.Equal(t, 200, rec.Code)
			var body response
			require.NoError(t, common.Unmarshal(rec.Body.Bytes(), &body))
			assert.Equal(t, tc.total, body.Data.Total)
			require.Len(t, body.Data.Items, len(tc.ids))
			for i, id := range tc.ids {
				assert.Equal(t, id, body.Data.Items[i].ID)
			}
		}
	})
	t.Run("L10 invalid bounded input", func(t *testing.T) {
		for _, query := range []string{"p=%zz", "p=0", "p=-1", "p=x", "p=9223372036854775808", "page_size=0", "page_size=101", "page_size=-1", "page_size=oops", "p=501&page_size=20", "p=1&p=2", "page_size=20&ps=20", "start_timestamp=no", "start_timestamp=-1", "end_timestamp=9223372036854775808", "start_timestamp=2&end_timestamp=1", "model_name=" + url.QueryEscape("%%"), "model_name=" + strings.Repeat("a", 257)} {
			rec := send(path+"?"+query, tokenFor("account-a"), 0)
			assert.Equal(t, 400, rec.Code, query)
		}
	})
	t.Run("GET only and forged desktop user header", func(t *testing.T) {
		rec := send(path, tokenFor("account-a"), 802)
		require.Equal(t, 200, rec.Code)
		assert.Contains(t, rec.Body.String(), "public-request")
		assert.NotContains(t, rec.Body.String(), "other-account-model")
		for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
			req := httptest.NewRequest(method, path, nil)
			req.Header.Set("Authorization", "Bearer "+tokenFor("account-a"))
			result := httptest.NewRecorder()
			r.ServeHTTP(result, req)
			assert.Equal(t, http.StatusNotFound, result.Code)
		}
	})
	t.Run("L11 no logs", func(t *testing.T) {
		rec := send(path, tokenFor("empty"), 0)
		require.Equal(t, 200, rec.Code)
		assert.Contains(t, rec.Body.String(), `"items":[]`)
		assert.Contains(t, rec.Body.String(), `"total":0`)
	})
	t.Run("Cookie compatibility L16 L17 existing endpoints", func(t *testing.T) {
		login := send("/fixture-login/801", "", 0)
		require.Equal(t, 204, login.Code)
		rec := send(path, "", 801, login.Result().Cookies()...)
		assert.Equal(t, 200, rec.Code)
		assert.Equal(t, 401, send(path, "", 802, login.Result().Cookies()...).Code)
		self := send("/api/log/self?type=2&p=1&page_size=100", "", 801, login.Result().Cookies()...)
		require.Equal(t, 200, self.Code)
		var body response
		require.NoError(t, common.Unmarshal(self.Body.Bytes(), &body))
		assert.Equal(t, 3, body.Data.Total)
		require.Len(t, body.Data.Items, 3)
		assert.Equal(t, 1, body.Data.Items[0].ID) // Original display IDs remain unchanged.
		rootLogin := send("/fixture-login/803", "", 0)
		require.Equal(t, 204, rootLogin.Code)
		admin := send("/api/log/?type=2&p=1&page_size=100", "", 803, rootLogin.Result().Cookies()...)
		require.Equal(t, 200, admin.Code)
		require.NoError(t, common.Unmarshal(admin.Body.Bytes(), &body))
		require.True(t, body.Success)
		assert.Equal(t, 5, body.Data.Total) // Existing admin handler still has its original global scope.
	})
	t.Run("L18 history uses the unchanged authentication chain", func(t *testing.T) {
		rec := send("/api/conversations", tokenFor("account-a"), 0)
		assert.Equal(t, 200, rec.Code)
		assert.Contains(t, rec.Body.String(), `"items":[]`)
	})
	t.Run("L13 L14 L15 repeated GET is business read only", func(t *testing.T) {
		for i := 0; i < 2; i++ {
			require.Equal(t, 200, send(path, tokenFor("account-a"), 0).Code)
		}
		var afterLogs []model.Log
		require.NoError(t, logDB.Order("id").Find(&afterLogs).Error)
		assert.Equal(t, beforeLogs, afterLogs)
		var afterSessions []model.DesktopAuthSession
		require.NoError(t, mainDB.Order("digest").Find(&afterSessions).Error)
		assert.Equal(t, beforeSessions, afterSessions)
		var afterUser model.User
		require.NoError(t, mainDB.First(&afterUser, 801).Error)
		assert.Equal(t, beforeUser, afterUser)
		var afterSubscription model.UserSubscription
		require.NoError(t, mainDB.First(&afterSubscription, 820).Error)
		assert.Equal(t, beforeSubscription, afterSubscription)
		var afterToken model.Token
		require.NoError(t, mainDB.First(&afterToken, 810).Error)
		assert.Equal(t, beforeToken, afterToken)
	})
	t.Run("L12 controlled database error", func(t *testing.T) {
		// Close only this temporary log connection; authentication's main DB remains available.
		require.NoError(t, logSQL.Close())
		rec := send(path, tokenFor("account-a"), 0)
		assert.Equal(t, 500, rec.Code)
		assert.Contains(t, rec.Body.String(), "usage_logs_unavailable")
		assert.NotContains(t, rec.Body.String(), "database")
		assert.NotContains(t, rec.Body.String(), "SELECT")
	})
}
