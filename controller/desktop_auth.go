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
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>桌面应用授权</title>
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#f5f5f7;color:#18181b;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
.card{width:100%;max-width:400px;background:#fff;border:1px solid rgba(24,24,27,.08);border-radius:18px;padding:36px 32px 28px;box-shadow:0 1px 2px rgba(24,24,27,.04),0 16px 40px -16px rgba(24,24,27,.16)}
.mark{width:52px;height:52px;border-radius:15px;display:flex;align-items:center;justify-content:center;background:#f4f4f5;color:#18181b;margin-bottom:22px}
h1{font-size:21px;font-weight:600;letter-spacing:-.01em;line-height:1.3;margin:0 0 8px}
.lede{font-size:13.5px;line-height:1.6;color:#71717a;margin:0 0 22px}
.account{display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid rgba(24,24,27,.07);background:#fafafa;border-radius:12px;margin-bottom:24px}
.avatar{width:34px;height:34px;border-radius:50%;background:#18181b;color:#fff;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.who{display:flex;flex-direction:column;gap:3px;min-width:0}
.who strong{font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.who span{font-size:12px;line-height:1.4;color:#71717a}
form,.actions{display:flex;flex-direction:column;gap:9px;margin:0}
.primary,.ghost{height:44px;border-radius:11px;font-size:14px;font-family:inherit;display:flex;align-items:center;justify-content:center;text-decoration:none;transition:background .15s ease,transform .15s ease}
.primary{border:0;background:#18181b;color:#fff;font-weight:500;cursor:pointer}
.primary:hover{background:#27272a}
.primary:active{transform:translateY(1px)}
.ghost{border:1px solid rgba(24,24,27,.12);background:transparent;color:#3f3f46;cursor:pointer}
.ghost:hover{background:#f4f4f5}
.foot{font-size:11.5px;line-height:1.6;color:#a1a1aa;text-align:center;margin:22px 0 0}
.primary:focus-visible,.ghost:focus-visible{outline:2px solid #18181b;outline-offset:2px}
@media (prefers-color-scheme: dark){
body{background:#09090b;color:#fafafa}
.card{background:#141416;border-color:rgba(250,250,250,.09);box-shadow:none}
.mark{background:#1f1f23;color:#fafafa}
.lede{color:#a1a1aa}
.account{background:#1a1a1d;border-color:rgba(250,250,250,.08)}
.avatar{background:#fafafa;color:#18181b}
.who span{color:#a1a1aa}
.primary{background:#fafafa;color:#18181b}
.primary:hover{background:#e4e4e7}
.ghost{border-color:rgba(250,250,250,.16);color:#d4d4d8}
.ghost:hover{background:#1f1f23}
.foot{color:#71717a}
.primary:focus-visible,.ghost:focus-visible{outline-color:#fafafa}
}
</style>
</head>
<body>
<main class="card">
<div class="mark">
<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.6"/><path d="M8 10.5V7.6a4 4 0 018 0v2.9"/><path d="M12 14.6v2"/></svg>
</div>
{{if .Username}}
<h1>桌面应用授权</h1>
<p class="lede">{{.SystemName}} 桌面应用请求使用你的账号登录</p>
<div class="account">
<span class="avatar">{{.Initial}}</span>
<div class="who">
<strong>{{.Username}}</strong>
<span>授权后客户端将获得登录会话与模型密钥</span>
</div>
</div>
<form method="post" action="{{.AuthorizePath}}">
<input type="hidden" name="response_type" value="{{.Authorization.ResponseType}}">
<input type="hidden" name="client_id" value="{{.Authorization.ClientID}}">
<input type="hidden" name="redirect_uri" value="{{.Authorization.RedirectURI}}">
<input type="hidden" name="state" value="{{.Authorization.State}}">
<input type="hidden" name="code_challenge" value="{{.Authorization.Challenge}}">
<input type="hidden" name="code_challenge_method" value="{{.Authorization.Method}}">
<input type="hidden" name="csrf_token" value="{{.Authorization.CSRF}}">
<button class="primary" name="decision" value="approve">授权并返回客户端</button>
<button class="ghost" name="decision" value="deny">取消</button>
</form>
<p class="foot">你可以随时在客户端内退出登录，撤销本次授权。</p>
{{else}}
<h1>请先登录</h1>
<p class="lede">登录 {{.SystemName}} 账号后，返回本页继续授权。</p>
<div class="actions">
<a class="primary" href="{{.LoginPath}}" target="_blank" rel="noopener noreferrer">登录账号</a>
<a class="ghost" href="{{.RefreshPath}}">我已登录，继续授权</a>
</div>
<p class="foot">登录完成后，本页面会自动刷新。</p>
{{end}}
</main>
</body>
</html>`))

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
	// 样式全部内联在模板里，因此只放开 style-src；脚本、图片、字体仍为 none。
	c.Header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' "+a.RedirectURI+"; frame-ancestors 'none'; base-uri 'none'")

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

	systemName := strings.TrimSpace(common.SystemName)
	if systemName == "" {
		systemName = "New API"
	}
	initial := ""
	for _, r := range username {
		initial = strings.ToUpper(string(r))
		break
	}

	var output strings.Builder
	err := desktopAuthorizationPage.Execute(&output, struct {
		Username, Initial, SystemName, AuthorizePath, LoginPath, RefreshPath string
		Authorization                                                        desktopAuthorization
	}{username, initial, systemName, desktopAuthPath, loginPath, c.Request.URL.RequestURI(), a})
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
	languageKey, account, err := model.ExchangeDesktopAuthCode(desktopDigest(form.Code), form.ClientID, form.RedirectURI, base64.RawURLEncoding.EncodeToString(hash[:]),
		now, &model.DesktopAuthSession{Digest: desktopDigest(token), ExpiresAt: now + ttl})
	if errors.Is(err, model.ErrDesktopCredentialInvalid) {
		desktopOAuthError(c, http.StatusBadRequest, "invalid_grant")
		return
	}
	if err != nil {
		desktopOAuthError(c, http.StatusInternalServerError, "server_error")
		return
	}

	payload := gin.H{"access_token": token, "token_type": "Bearer", "expires_in": ttl, "language_api_key": "sk-" + languageKey.Key}
	// 账号信息随凭证一起返回，客户端拿到即可展示昵称，不必再请求一次资料接口。
	if account != nil {
		payload["user"] = desktopUserPayload(account)
	}
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.JSON(http.StatusOK, payload)
}

// desktopUserPayload 是下发给桌面客户端的账号信息，只包含展示与鉴权判断所需字段，
// 不含邮箱、手机号、余额等敏感或体积较大的内容。
func desktopUserPayload(user *model.User) gin.H {
	return gin.H{
		"id":           user.Id,
		"username":     user.Username,
		"display_name": user.DisplayName,
		"role":         user.Role,
		"group":        user.Group,
	}
}

func DesktopProfile(c *gin.Context) {
	user := desktopAuthenticatedUser(c, false)
	if user == nil {
		return
	}
	c.Header("Cache-Control", "no-store")
	common.ApiSuccess(c, desktopUserPayload(user))
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
