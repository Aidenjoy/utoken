package controller

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"html/template"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
)

const (
	desktopClientID = "yun-token-desktop"
	desktopAuthPath = "/api/desktop-auth/authorize"
	desktopCodeTTL  = time.Minute
	desktopTokenTTL = 10 * time.Minute
)

var (
	desktopRedirectPattern = regexp.MustCompile(`^http://127\.0\.0\.1:([1-9][0-9]{0,4})/desktop-auth/callback$`)
	desktopStatePattern    = regexp.MustCompile(`^[A-Za-z0-9_-]{22,128}$`)
	desktopVerifierPattern = regexp.MustCompile(`^[A-Za-z0-9._~-]{43,128}$`)
)

type desktopAuthorization struct {
	ResponseType string `form:"response_type"`
	ClientID     string `form:"client_id"`
	RedirectURI  string `form:"redirect_uri"`
	State        string `form:"state"`
	Challenge    string `form:"code_challenge"`
	Method       string `form:"code_challenge_method"`
	CSRF         string `form:"csrf_token"`
	Decision     string `form:"decision"`
}

func (a desktopAuthorization) valid() bool {
	return a.ResponseType == "code" && a.ClientID == desktopClientID && validDesktopRedirect(a.RedirectURI) &&
		desktopStatePattern.MatchString(a.State) && a.Method == "S256" && validDesktopRandom(a.Challenge)
}

func validDesktopRedirect(raw string) bool {
	match := desktopRedirectPattern.FindStringSubmatch(raw)
	if len(match) != 2 {
		return false
	}
	port, err := strconv.ParseUint(match[1], 10, 16)
	return err == nil && port > 0
}

func validDesktopRandom(raw string) bool {
	if len(raw) != 43 {
		return false
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(raw)
	return err == nil && len(decoded) == 32
}

func desktopRandom() (string, error) {
	var value [32]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value[:]), nil
}

func desktopDigest(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func (a desktopAuthorization) csrf(cookie string) string {
	mac := hmac.New(sha256.New, []byte(cookie))
	values := url.Values{
		"purpose": {"desktop-auth"}, "client_id": {a.ClientID}, "redirect_uri": {a.RedirectURI},
		"state": {a.State}, "challenge": {a.Challenge},
	}
	_, _ = mac.Write([]byte(values.Encode()))
	return hex.EncodeToString(mac.Sum(nil))
}

var desktopAuthorizationPage = template.Must(template.New("desktop-authorization").Parse(`<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>桌面应用授权</title>
<main>
<h1>桌面应用授权</h1>
{{if .Username}}
<p>允许 New API 桌面应用以 <strong>{{.Username}}</strong> 登录？</p>
<form method="post" action="{{.AuthorizePath}}">
<input type="hidden" name="response_type" value="{{.Authorization.ResponseType}}">
<input type="hidden" name="client_id" value="{{.Authorization.ClientID}}">
<input type="hidden" name="redirect_uri" value="{{.Authorization.RedirectURI}}">
<input type="hidden" name="state" value="{{.Authorization.State}}">
<input type="hidden" name="code_challenge" value="{{.Authorization.Challenge}}">
<input type="hidden" name="code_challenge_method" value="{{.Authorization.Method}}">
<input type="hidden" name="csrf_token" value="{{.Authorization.CSRF}}">
<button name="decision" value="approve">授权并返回客户端</button>
<button name="decision" value="deny">取消</button>
</form>
{{else}}
<p><a href="{{.LoginPath}}" target="_blank" rel="noopener noreferrer">登录账号</a>，登录完成后切回此页确认授权。</p>
<p><a href="{{.RefreshPath}}">我已登录，继续授权</a></p>
{{end}}
</main></html>`))

func DesktopAuthorize(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Frame-Options", "DENY")
	var a desktopAuthorization
	if c.ShouldBindQuery(&a) != nil || !a.valid() {
		desktopOAuthError(c, http.StatusBadRequest, "invalid_request")
		return
	}
	// Chromium also checks form-action on the consent POST's 303 redirect.
	// Allow only the validated loopback callback for this authorization request.
	c.Header("Content-Security-Policy", "default-src 'none'; form-action 'self' "+a.RedirectURI+"; frame-ancestors 'none'; base-uri 'none'")

	loginPath := "/sign-in"
	if common.GetTheme() == "classic" {
		loginPath = "/login"
	}
	var username string
	if id, ok := sessions.Default(c).Get("id").(int); ok {
		user, err := model.GetUserById(id, false)
		cookie, cookieErr := c.Cookie("session")
		if err == nil && user.Status == common.UserStatusEnabled && cookieErr == nil && cookie != "" {
			username = user.Username
			a.CSRF = a.csrf(cookie)
		}
	}

	var output strings.Builder
	err := desktopAuthorizationPage.Execute(&output, struct {
		Username, AuthorizePath, LoginPath, RefreshPath string
		Authorization                                   desktopAuthorization
	}{username, desktopAuthPath, loginPath, c.Request.URL.RequestURI(), a})
	if err != nil {
		desktopOAuthError(c, http.StatusInternalServerError, "server_error")
		return
	}
	if username == "" {
		c.Header("Refresh", "5")
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(output.String()))
}

func DesktopAuthorizeDecision(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	var a desktopAuthorization
	if c.ContentType() != "application/x-www-form-urlencoded" || c.ShouldBind(&a) != nil || !a.valid() {
		desktopOAuthError(c, http.StatusBadRequest, "invalid_request")
		return
	}

	id, ok := sessions.Default(c).Get("id").(int)
	cookie, cookieErr := c.Cookie("session")
	if !ok || cookieErr != nil || cookie == "" || !hmac.Equal([]byte(a.CSRF), []byte(a.csrf(cookie))) {
		desktopOAuthError(c, http.StatusForbidden, "access_denied")
		return
	}
	user, err := model.GetUserById(id, false)
	if err != nil || user.Status != common.UserStatusEnabled {
		desktopOAuthError(c, http.StatusForbidden, "access_denied")
		return
	}

	params := url.Values{"state": {a.State}}
	switch a.Decision {
	case "deny":
		params.Set("error", "access_denied")
	case "approve":
		code, err := desktopRandom()
		if err != nil {
			desktopOAuthError(c, http.StatusInternalServerError, "server_error")
			return
		}
		now := model.GetDBTimestamp()
		err = model.CreateDesktopAuthCode(&model.DesktopAuthCode{
			Digest: desktopDigest(code), UserID: id, ClientID: a.ClientID, RedirectURI: a.RedirectURI,
			Challenge: a.Challenge, ExpiresAt: now + int64(desktopCodeTTL/time.Second),
		}, now)
		if err != nil {
			desktopOAuthError(c, http.StatusInternalServerError, "server_error")
			return
		}
		params.Set("code", code)
	default:
		desktopOAuthError(c, http.StatusBadRequest, "invalid_request")
		return
	}
	// 303 always follows the consent POST with a GET to the registered loopback path.
	c.Redirect(http.StatusSeeOther, a.RedirectURI+"?"+params.Encode())
}

func DesktopExchange(c *gin.Context) {
	var form struct {
		GrantType   string `form:"grant_type"`
		ClientID    string `form:"client_id"`
		Code        string `form:"code"`
		RedirectURI string `form:"redirect_uri"`
		Verifier    string `form:"code_verifier"`
	}
	if c.ContentType() != "application/x-www-form-urlencoded" || c.ShouldBind(&form) != nil ||
		form.GrantType != "authorization_code" || form.ClientID != desktopClientID ||
		!validDesktopRandom(form.Code) || !validDesktopRedirect(form.RedirectURI) || !desktopVerifierPattern.MatchString(form.Verifier) {
		desktopOAuthError(c, http.StatusBadRequest, "invalid_request")
		return
	}

	token, err := desktopRandom()
	if err != nil {
		desktopOAuthError(c, http.StatusInternalServerError, "server_error")
		return
	}
	now := model.GetDBTimestamp()
	ttl := int64(desktopTokenTTL / time.Second)
	hash := sha256.Sum256([]byte(form.Verifier))
	languageKey, err := model.ExchangeDesktopAuthCode(desktopDigest(form.Code), form.ClientID, form.RedirectURI, base64.RawURLEncoding.EncodeToString(hash[:]),
		now, &model.DesktopAuthSession{Digest: desktopDigest(token), ExpiresAt: now + ttl})
	if errors.Is(err, model.ErrDesktopCredentialInvalid) {
		desktopOAuthError(c, http.StatusBadRequest, "invalid_grant")
		return
	}
	if err != nil {
		desktopOAuthError(c, http.StatusInternalServerError, "server_error")
		return
	}

	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.JSON(http.StatusOK, gin.H{"access_token": token, "token_type": "Bearer", "expires_in": ttl, "language_api_key": "sk-" + languageKey.Key})
}

func DesktopProfile(c *gin.Context) {
	user := desktopAuthenticatedUser(c, false)
	if user == nil {
		return
	}
	c.Header("Cache-Control", "no-store")
	common.ApiSuccess(c, gin.H{"id": user.Id, "username": user.Username, "display_name": user.DisplayName})
}

func DesktopCreateDashboardSession(c *gin.Context) {
	user := desktopAuthenticatedUser(c, true)
	if user == nil {
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Header("X-Desktop-Theme", common.GetTheme())
	setupLogin(user, c)
}

func DesktopRevoke(c *gin.Context) {
	token := desktopBearer(c)
	if token == "" {
		desktopOAuthError(c, http.StatusUnauthorized, "invalid_token")
		return
	}
	if err := model.RevokeDesktopAuthSession(desktopDigest(token)); err != nil {
		desktopOAuthError(c, http.StatusInternalServerError, "server_error")
		return
	}
	c.Status(http.StatusNoContent)
}

func desktopBearer(c *gin.Context) string {
	scheme, token, ok := strings.Cut(c.GetHeader("Authorization"), " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") || !validDesktopRandom(token) {
		return ""
	}
	return token
}

func desktopAuthenticatedUser(c *gin.Context, consume bool) *model.User {
	token := desktopBearer(c)
	if token == "" {
		desktopOAuthError(c, http.StatusUnauthorized, "invalid_token")
		return nil
	}
	user, err := model.GetDesktopAuthUser(desktopDigest(token), model.GetDBTimestamp(), consume)
	if errors.Is(err, model.ErrDesktopCredentialInvalid) {
		desktopOAuthError(c, http.StatusUnauthorized, "invalid_token")
		return nil
	}
	if err != nil {
		desktopOAuthError(c, http.StatusInternalServerError, "server_error")
		return nil
	}
	return user
}

func desktopOAuthError(c *gin.Context, status int, code string) {
	c.Header("Cache-Control", "no-store")
	c.JSON(status, gin.H{"error": code})
}
