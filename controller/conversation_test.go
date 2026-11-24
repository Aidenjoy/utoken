package controller

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
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

// TestConversationCrossDevice exercises the actual HTTP handlers and credentials
// on an isolated SQLite file. No relay route or upstream HTTP client is mounted.
func TestConversationCrossDevice(t *testing.T) {
	oldDB := model.DB
	oldRedis := common.RedisEnabled
	oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "history.db")), &gorm.Config{})
	require.NoError(t, err)
	connection, err := db.DB()
	require.NoError(t, err)
	model.DB = db
	common.RedisEnabled = false
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		require.NoError(t, model.InvalidateUserCache(71))
		model.DB = oldDB
		common.RedisEnabled = oldRedis
		common.SetDatabaseTypes(oldMain, oldLog)
		require.NoError(t, connection.Close())
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.DesktopAuthSession{}, &model.ConversationInfo{}, &model.ConversationMessageDetail{}))
	user := model.User{Id: 71, Username: "history-a", AffCode: "hist-a", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Quota: 12345}
	other := model.User{Id: 72, Username: "history-b", AffCode: "hist-b", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Quota: 9876}
	require.NoError(t, db.Create(&user).Error)
	require.NoError(t, db.Create(&other).Error)
	tokenFor := func(value string) string {
		return base64.RawURLEncoding.EncodeToString([]byte(strings.Repeat(value, 32)[:32]))
	}
	for _, token := range []struct {
		value  string
		userID int
	}{{"device-a", 71}, {"device-b", 71}, {"other", 72}} {
		require.NoError(t, db.Create(&model.DesktopAuthSession{Digest: desktopDigest(tokenFor(token.value)), UserID: token.userID, ExpiresAt: model.GetDBTimestamp() + 3600}).Error)
	}
	r := gin.New()
	r.Use(sessions.Sessions("session", cookie.NewStore([]byte("history-isolated-test-secret"))))
	r.GET("/login", func(c *gin.Context) {
		s := sessions.Default(c)
		s.Set("id", user.Id)
		s.Set("username", user.Username)
		s.Set("role", user.Role)
		s.Set("status", user.Status)
		require.NoError(t, s.Save())
		c.Status(204)
	})
	routes := r.Group("/api/conversations", middleware.DesktopBalanceAuth(), ConversationAuth)
	routes.GET("", ListConversationHistory)
	routes.GET("/:id/messages", GetConversationHistory)
	routes.PATCH("/:id", SaveConversationHistory)
	send := func(method, path, token, body string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+tokenFor(token))
		}
		for _, value := range cookies {
			req.AddCookie(value)
			req.Header.Set("New-Api-User", "71")
		}
		response := httptest.NewRecorder()
		r.ServeHTTP(response, req)
		return response
	}
	const path = "/api/conversations/history-x"
	// Device B has no conversations before device A saves; neither credential is consumed.
	empty := send("GET", "/api/conversations", "device-b", "")
	require.Equal(t, 200, empty.Code)
	assert.Contains(t, empty.Body.String(), `"items":[]`)
	initial := `{"revision":0,"mutation_id":"m1","title":"original","user_id":72,"messages":[{"id":"u1","payload":{"key":"u1","from":"user","versions":[{"id":"v1","content":"hello"}],"attachments":[{"url":"https://example.invalid/one"}]}},{"id":"a1","payload":{"key":"a1","from":"assistant","versions":[{"id":"v2","content":"hi"}],"status":"complete","tool_calls":[{"name":"mock-tool","arguments":{"n":1}}]}}]}`
	require.Equal(t, 200, send("PATCH", path, "device-a", initial).Code)
	listed := send("GET", "/api/conversations", "device-b", "")
	require.Equal(t, 200, listed.Code)
	assert.Contains(t, listed.Body.String(), "history-x")
	// Exact network retry is idempotent, including the original revision.
	require.Equal(t, 200, send("PATCH", path, "device-a", initial).Code)
	var count int64
	require.NoError(t, db.Model(&model.ConversationMessageDetail{}).Count(&count).Error)
	assert.EqualValues(t, 2, count)
	var page struct {
		Data model.ConversationMessagePage `json:"data"`
	}
	newest := send("GET", path+"/messages?limit=1", "device-b", "")
	require.Equal(t, 200, newest.Code)
	require.NoError(t, common.Unmarshal(newest.Body.Bytes(), &page))
	require.Len(t, page.Data.Items, 1)
	assert.Equal(t, "a1", page.Data.Items[0].ID)
	assert.True(t, page.Data.HasMore)
	assert.Contains(t, string(page.Data.Items[0].Payload), `"tool_calls"`)
	older := send("GET", fmt.Sprintf("%s/messages?limit=1&before=%d&revision=1", path, page.Data.Items[0].Sequence), "device-b", "")
	require.Equal(t, 200, older.Code)
	assert.Contains(t, older.Body.String(), `"attachments"`)
	assert.Contains(t, older.Body.String(), `"id":"u1"`)
	continued := `{"revision":1,"mutation_id":"m2","title":"continued","messages":[{"id":"u2","payload":{"key":"u2","from":"user","versions":[{"id":"v3","content":"continue"}]}},{"id":"a2","payload":{"key":"a2","from":"assistant","versions":[{"id":"v4","content":"partial"}],"status":"error","isContentComplete":false}}]}`
	require.Equal(t, 200, send("PATCH", path, "device-b", continued).Code)
	reloaded := send("GET", path+"/messages", "device-a", "")
	require.Equal(t, 200, reloaded.Code)
	require.NoError(t, common.Unmarshal(reloaded.Body.Bytes(), &page))
	require.Len(t, page.Data.Items, 4)
	for i, id := range []string{"u1", "a1", "u2", "a2"} {
		assert.Equal(t, id, page.Data.Items[i].ID)
	}
	assert.Contains(t, string(page.Data.Items[3].Payload), `"status":"error"`)
	// Another device's stale write cannot replace or reorder any messages.
	assert.Equal(t, 409, send("PATCH", path, "device-a", strings.Replace(continued, "m2", "stale", 1)).Code)
	assert.Equal(t, 409, send("GET", path+"/messages?revision=1", "device-a", "").Code)
	for _, method := range []string{"GET", "PATCH"} {
		target := path
		if method == "GET" {
			target += "/messages"
		}
		response := send(method, target, "other", initial)
		assert.Equal(t, 404, response.Code)
	}
	assert.NotContains(t, send("GET", "/api/conversations", "other", "").Body.String(), "history-x")
	assert.Equal(t, 401, send("GET", path+"/messages", "", "").Code)
	assert.Equal(t, 401, send("GET", path+"/messages", "sk-fake-relay-key", "").Code)
	// The browser follows the original Cookie/header auth contract.
	login := send("GET", "/login", "", "")
	require.Equal(t, 204, login.Code)
	browser := send("GET", path+"/messages", "", "", login.Result().Cookies()...)
	assert.Equal(t, 200, browser.Code)
	assert.Equal(t, 200, send("GET", path+"/messages", "device-a", "").Code)
	assert.Equal(t, 200, send("GET", path+"/messages", "device-b", "").Code)
	// Delete/edit operations are revisioned and owner-scoped too.
	removed := `{"revision":2,"mutation_id":"m3","title":"continued","messages":[],"deleted_ids":["a2"]}`
	require.Equal(t, 200, send("PATCH", path, "device-a", removed).Code)
	assert.Equal(t, 404, send("PATCH", path, "other", removed).Code)
	// Reading/writing history never changes wallet or consumes desktop credentials.
	var stored model.User
	require.NoError(t, db.First(&stored, 71).Error)
	assert.Equal(t, user.Quota, stored.Quota)
	assert.Zero(t, stored.UsedQuota)
	require.NoError(t, db.Model(&model.DesktopAuthSession{}).Count(&count).Error)
	assert.EqualValues(t, 3, count)
	// Invalid input cannot mutate a committed revision.
	assert.Equal(t, 400, send("GET", path+"/messages?limit=100000", "device-a", "").Code)
	assert.Equal(t, 400, send("PATCH", path, "device-a", `{"revision":3,"mutation_id":"bad","messages":[{"id":"x","payload":{"key":"y","from":"user"}}]}`).Code)
	// A DB error stays confined to history; no database detail or message leaks.
	require.NoError(t, db.Migrator().DropTable(&model.ConversationMessageDetail{}))
	failure := send("GET", path+"/messages", "device-a", "")
	assert.Equal(t, 500, failure.Code)
	assert.Contains(t, failure.Body.String(), "history_unavailable")
	assert.NotContains(t, failure.Body.String(), "SELECT")
}
