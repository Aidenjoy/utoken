package controller

import (
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestDesktopLoginBrowserAndToken(t *testing.T) {
	oldDB, oldLogDB := model.DB, model.LOG_DB
	oldMainType, oldLogType := common.MainDatabaseType(), common.LogDatabaseType()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "desktop-auth.db")), &gorm.Config{})
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
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}, &model.Log{}, &model.DesktopAuthCode{}, &model.DesktopAuthSession{}))
	user := model.User{Username: "desktop-tester", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default"}
	require.NoError(t, db.Create(&user).Error)

	router := gin.New()
	router.Use(sessions.Sessions("session", cookie.NewStore([]byte("desktop-auth-test-secret"))))
	router.GET("/test-existing-web-login", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("id", user.Id)
		if err := session.Save(); err != nil {
			c.Status(http.StatusInternalServerError)
			return
		}
		c.Status(http.StatusNoContent)
	})
	router.GET(desktopAuthPath, DesktopAuthorize)
	router.POST(desktopAuthPath, DesktopAuthorizeDecision)
	router.POST("/api/desktop-auth/token", DesktopExchange)
	router.GET("/api/desktop-auth/me", DesktopProfile)
	router.POST("/api/desktop-auth/session", DesktopCreateDashboardSession)
	router.POST("/api/desktop-auth/revoke", DesktopRevoke)

	send := func(method, path string, form url.Values, cookies []*http.Cookie, token string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, strings.NewReader(form.Encode()))
		if form != nil {
			request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		}
		for _, cookie := range cookies {
			request.AddCookie(cookie)
		}
		if token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		return recorder
	}

	verifier := strings.Repeat("a", 43)
	digest := sha256.Sum256([]byte(verifier))
	redirectURI := "http://127.0.0.1:49152/desktop-auth/callback"
	challenge := base64.RawURLEncoding.EncodeToString(digest[:])
	authorize := url.Values{
		"response_type": {"code"}, "client_id": {desktopClientID}, "redirect_uri": {redirectURI},
		"state": {strings.Repeat("s", 32)}, "code_challenge_method": {"S256"}, "code_challenge": {challenge},
	}
	anonymous := send(http.MethodGet, desktopAuthPath+"?"+authorize.Encode(), nil, nil, "")
	require.Equal(t, http.StatusOK, anonymous.Code)
	assert.NotContains(t, anonymous.Body.String(), "csrf_token")
	authorize.Set("redirect_uri", "http://127.0.0.1.example.com:49152/desktop-auth/callback")
	require.Equal(t, http.StatusBadRequest,
		send(http.MethodGet, desktopAuthPath+"?"+authorize.Encode(), nil, nil, "").Code)
	authorize.Set("redirect_uri", redirectURI)

	browserLogin := send(http.MethodGet, "/test-existing-web-login", nil, nil, "")
	require.Equal(t, http.StatusNoContent, browserLogin.Code)
	browserCookies := browserLogin.Result().Cookies()
	require.Len(t, browserCookies, 1)
	consent := send(http.MethodGet, desktopAuthPath+"?"+authorize.Encode(), nil, browserCookies, "")
	require.Equal(t, http.StatusOK, consent.Code)
	assert.Contains(t, consent.Header().Get("Content-Security-Policy"), "form-action 'self' "+redirectURI+";")
	assert.Contains(t, consent.Body.String(), user.Username)
	matches := regexp.MustCompile(`name="csrf_token" value="([a-f0-9]+)"`).FindStringSubmatch(consent.Body.String())
	require.Len(t, matches, 2)

	authorize.Set("decision", "approve")
	authorize.Set("csrf_token", "incorrect")
	assert.Equal(t, http.StatusForbidden, send(http.MethodPost, desktopAuthPath, authorize, browserCookies, "").Code)
	authorize.Set("csrf_token", matches[1])
	approve := send(http.MethodPost, desktopAuthPath, authorize, browserCookies, "")
	require.Equal(t, http.StatusSeeOther, approve.Code)
	location, err := url.Parse(approve.Header().Get("Location"))
	require.NoError(t, err)
	assert.Equal(t, redirectURI, location.Scheme+"://"+location.Host+location.Path)
	assert.Equal(t, authorize.Get("state"), location.Query().Get("state"))
	code := location.Query().Get("code")
	require.NotEmpty(t, code)

	exchange := url.Values{
		"grant_type": {"authorization_code"}, "client_id": {desktopClientID}, "redirect_uri": {redirectURI},
		"code": {code}, "code_verifier": {strings.Repeat("b", 43)},
	}
	wrongVerifier := send(http.MethodPost, "/api/desktop-auth/token", exchange, nil, "")
	require.Equal(t, http.StatusBadRequest, wrongVerifier.Code)
	assert.JSONEq(t, `{"error":"invalid_grant"}`, wrongVerifier.Body.String())
	exchange.Set("code_verifier", verifier)
	exchange.Set("redirect_uri", "http://127.0.0.1:49153/desktop-auth/callback")
	assert.Equal(t, http.StatusBadRequest, send(http.MethodPost, "/api/desktop-auth/token", exchange, nil, "").Code)
	exchange.Set("redirect_uri", redirectURI)
	result := send(http.MethodPost, "/api/desktop-auth/token", exchange, nil, "")
	require.Equal(t, http.StatusOK, result.Code)
	assert.Equal(t, "no-store", result.Header().Get("Cache-Control"))
	var token struct {
		Value    string `json:"access_token"`
		AudioKey string `json:"audio_api_key"`
		Type     string `json:"token_type"`
	}
	require.NoError(t, common.Unmarshal(result.Body.Bytes(), &token))
	require.NotEmpty(t, token.Value)
	var audioKey model.Token
	require.NoError(t, db.Where("user_id = ? AND key_type = ?", user.Id, model.TokenKeyTypeDesktopAudio).First(&audioKey).Error)
	require.Equal(t, "sk-"+audioKey.Key, token.AudioKey)
	require.True(t, audioKey.UnlimitedQuota)
	assert.Equal(t, "Bearer", token.Type)
	replay := send(http.MethodPost, "/api/desktop-auth/token", exchange, nil, "")
	assert.Equal(t, http.StatusBadRequest, replay.Code)
	assert.JSONEq(t, `{"error":"invalid_grant"}`, replay.Body.String())

	profile := send(http.MethodGet, "/api/desktop-auth/me", nil, nil, token.Value)
	require.Equal(t, http.StatusOK, profile.Code)
	assert.Contains(t, profile.Body.String(), user.Username)
	dashboard := send(http.MethodPost, "/api/desktop-auth/session", nil, nil, token.Value)
	require.Equal(t, http.StatusOK, dashboard.Code)
	assert.Contains(t, dashboard.Body.String(), user.Username)
	require.Len(t, dashboard.Result().Cookies(), 1)
	assert.Equal(t, "session", dashboard.Result().Cookies()[0].Name)
	assert.Equal(t, http.StatusUnauthorized,
		send(http.MethodPost, "/api/desktop-auth/session", nil, nil, token.Value).Code)

	reapproval := send(http.MethodPost, desktopAuthPath, authorize, browserCookies, "")
	require.Equal(t, http.StatusSeeOther, reapproval.Code)
	reapprovalLocation, err := url.Parse(reapproval.Header().Get("Location"))
	require.NoError(t, err)
	exchange.Set("code", reapprovalLocation.Query().Get("code"))
	renewed := send(http.MethodPost, "/api/desktop-auth/token", exchange, nil, "")
	require.Equal(t, http.StatusOK, renewed.Code)
	var renewedToken struct {
		AudioKey string `json:"audio_api_key"`
	}
	require.NoError(t, common.Unmarshal(renewed.Body.Bytes(), &renewedToken))
	require.Equal(t, token.AudioKey, renewedToken.AudioKey)
	var count int64
	require.NoError(t, db.Model(&model.Token{}).Where("user_id = ? AND key_type = ?", user.Id, model.TokenKeyTypeDesktopAudio).Count(&count).Error)
	require.EqualValues(t, 1, count)
	require.Equal(t, "客户端语音专用（不建议用于其他用途）", audioKey.Name)

	secondApproval := send(http.MethodPost, desktopAuthPath, authorize, browserCookies, "")
	require.Equal(t, http.StatusSeeOther, secondApproval.Code)
	expiringLocation, err := url.Parse(secondApproval.Header().Get("Location"))
	require.NoError(t, err)
	exchange.Set("code", expiringLocation.Query().Get("code"))
	require.NoError(t, db.Model(&model.DesktopAuthCode{}).Where("digest = ?", desktopDigest(exchange.Get("code"))).
		Update("expires_at", model.GetDBTimestamp()-1).Error)
	expired := send(http.MethodPost, "/api/desktop-auth/token", exchange, nil, "")
	require.Equal(t, http.StatusBadRequest, expired.Code)
	assert.JSONEq(t, `{"error":"invalid_grant"}`, expired.Body.String())
}
