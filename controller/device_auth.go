package controller

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

var agentUserCodePattern = regexp.MustCompile(`^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$`)
var tokenSourcePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`)

// DeviceCode issues a short-lived device challenge for the registered Agent public client.
func DeviceCode(c *gin.Context) {
	var request struct {
		ClientID   string `form:"client_id"`
		Scope      string `form:"scope"`
		DeviceName string `form:"device_name"`
	}
	if c.ContentType() != "application/x-www-form-urlencoded" || c.ShouldBind(&request) != nil {
		deviceOAuthError(c, http.StatusBadRequest, "invalid_request")
		return
	}
	origin := strings.TrimRight(system_setting.ServerAddress, "/")
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil || parsed.Path != "" {
		common.SysError("device authorization requires an absolute server address without a path")
		deviceOAuthError(c, http.StatusInternalServerError, "server_error")
		return
	}
	if parsed.Scheme == "http" && parsed.Hostname() != "localhost" && parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "::1" {
		common.SysError("device authorization requires HTTPS outside loopback development")
		deviceOAuthError(c, http.StatusInternalServerError, "server_error")
		return
	}
	response, err := service.CreateAgentDeviceAuthorization(request.ClientID, request.Scope, request.DeviceName, origin)
	if err != nil {
		switch err.Error() {
		case "invalid_client", "invalid_scope", "invalid_request":
			deviceOAuthError(c, http.StatusBadRequest, err.Error())
		default:
			common.SysError("device authorization creation failed: " + err.Error())
			deviceOAuthError(c, http.StatusInternalServerError, "server_error")
		}
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.JSON(http.StatusOK, response)
}

// DeviceToken exchanges an approved challenge exactly once, without rotating user.access_token.
func DeviceToken(c *gin.Context) {
	var request struct {
		GrantType  string `form:"grant_type"`
		ClientID   string `form:"client_id"`
		DeviceCode string `form:"device_code"`
	}
	if c.ContentType() != "application/x-www-form-urlencoded" || c.ShouldBind(&request) != nil || !validDesktopRandom(request.DeviceCode) {
		deviceOAuthError(c, http.StatusBadRequest, "invalid_request")
		return
	}
	if request.ClientID != common.DeviceClientID {
		deviceOAuthError(c, http.StatusBadRequest, "invalid_client")
		return
	}
	if request.GrantType != "urn:ietf:params:oauth:grant-type:device_code" {
		deviceOAuthError(c, http.StatusBadRequest, "unsupported_grant_type")
		return
	}
	random, err := common.DeviceCredential()
	if err != nil {
		deviceOAuthError(c, http.StatusInternalServerError, "server_error")
		return
	}
	accessToken := common.DeviceTokenPrefix + random
	grant, protocolError, err := model.PollDeviceGrant(common.DeviceCredentialDigest(request.DeviceCode), request.ClientID,
		common.DeviceCredentialDigest(accessToken), model.GetDBTimestamp(), service.DeviceAccessTTL)
	if err != nil {
		common.SysError("device token exchange failed: " + err.Error())
		deviceOAuthError(c, http.StatusInternalServerError, "server_error")
		return
	}
	if protocolError != "" {
		deviceOAuthError(c, http.StatusBadRequest, protocolError)
		return
	}
	user, err := model.GetUserById(grant.UserID, false)
	if err != nil {
		deviceOAuthError(c, http.StatusInternalServerError, "server_error")
		return
	}
	common.SysLog(fmt.Sprintf("device authorization exchanged grant=%d user=%d client=%s", grant.ID, grant.UserID, grant.ClientID))
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.JSON(http.StatusOK, gin.H{"access_token": accessToken, "token_type": "Bearer", "expires_in": service.DeviceAccessTTL,
		"scope": grant.Scope, "user_id": user.Id, "username": user.Username})
}

// deviceOAuthError preserves OAuth's error shape instead of the dashboard success/data envelope.
func deviceOAuthError(c *gin.Context, status int, code string) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.JSON(status, gin.H{"error": code})
}

// deviceCSRF binds a browser-only decision to its session and the exact code or grant being changed.
func deviceCSRF(cookie, purpose string) string {
	mac := hmac.New(sha256.New, []byte(cookie))
	_, _ = mac.Write([]byte("agent-device:" + purpose))
	return hex.EncodeToString(mac.Sum(nil))
}

// deviceBrowserUser accepts only an enabled browser session; bearer tokens cannot approve themselves.
func deviceBrowserUser(c *gin.Context) (*model.User, string) {
	id, ok := sessions.Default(c).Get("id").(int)
	cookie, err := c.Cookie("session")
	if !ok || err != nil || cookie == "" {
		return nil, ""
	}
	user, err := model.GetUserById(id, false)
	if err != nil || user.Status != common.UserStatusEnabled {
		return nil, ""
	}
	return user, cookie
}

// devicePageData contains display-only values; no device code or access credential enters browser HTML.
type devicePageData struct {
	Username    string
	UserCode    string
	CSRF        string
	DeviceName  string
	Permissions []string
	Message     string
	LoginPath   string
	RefreshPath string
	Manage      bool
	Grants      []deviceGrantRow
	Page        int
	HasNext     bool
}

// deviceGrantRow displays authorization metadata and a record-specific browser CSRF value.
type deviceGrantRow struct {
	ID        int64
	Name      string
	Status    string
	ExpiresAt string
	CSRF      string
	CanRevoke bool
}

var agentDevicePage = template.Must(template.New("agent-device").Parse(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>云大师 Agent 授权</title></head>
<body><main><h1>云大师 Agent 授权</h1>
{{if .Message}}<p role="status">{{.Message}}</p>{{else if not .Username}}
<p><a href="{{.LoginPath}}" target="_blank" rel="noopener noreferrer">登录 utoken 账号</a>，完成后此页会自动继续。</p><p><a href="{{.RefreshPath}}">我已登录，继续</a></p>
{{else if .Manage}}
<p>当前账号：{{.Username}}。撤销授权将同时停用该设备创建的全部模型密钥。</p>
<table><caption>设备授权记录</caption><thead><tr><th>设备</th><th>状态</th><th>有效期至</th><th>操作</th></tr></thead><tbody>
{{range .Grants}}<tr><td>{{.Name}}</td><td>{{.Status}}</td><td>{{.ExpiresAt}}</td><td>{{if .CanRevoke}}<form method="post" action="/oauth/device/grants"><input type="hidden" name="id" value="{{.ID}}"><input type="hidden" name="csrf_token" value="{{.CSRF}}"><button type="submit">撤销授权并停用密钥</button></form>{{end}}</td></tr>{{else}}<tr><td colspan="4">暂无设备授权</td></tr>{{end}}</tbody></table>
<form method="get" action="/oauth/device/grants"><label for="page">页码</label><input id="page" name="p" type="number" min="1" value="{{.Page}}"><button type="submit">查看</button></form>
{{if .HasNext}}<p>还有更多记录，请查看下一页。</p>{{end}}
{{else if .UserCode}}
<p>云大师 Agent 请求访问账号 <strong>{{.Username}}</strong>。</p><p>设备：{{.DeviceName}}</p>
<p>请确认客户端显示的验证码与此处一致：<strong>{{.UserCode}}</strong>。仅批准你本人发起的请求。</p>
<ul>{{range .Permissions}}<li>{{.}}</li>{{end}}</ul><p>授权有效期为 30 天；到期后需重新授权，可随时在个人资料中撤销。</p>
<form method="post" action="/oauth/device"><input type="hidden" name="user_code" value="{{.UserCode}}"><input type="hidden" name="csrf_token" value="{{.CSRF}}"><button name="decision" value="approve">批准</button><button name="decision" value="deny">拒绝</button></form>
{{else}}<form method="get" action="/oauth/device"><label for="user-code">输入客户端显示的验证码</label><input id="user-code" name="user_code" required maxlength="9" autocomplete="off"><button type="submit">继续</button></form>{{end}}
<p><a href="/oauth/device/grants">管理设备授权</a></p></main></body></html>`))

// renderDevicePage applies browser security headers and refreshes only the logged-out waiting page.
func renderDevicePage(c *gin.Context, data devicePageData) {
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Frame-Options", "DENY")
	c.Header("Content-Security-Policy", "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
	if data.Username == "" && data.Message == "" {
		data.LoginPath = "/sign-in"
		if common.GetTheme() == "classic" {
			data.LoginPath = "/login"
		}
		data.RefreshPath = c.Request.URL.RequestURI()
		c.Header("Refresh", "3")
	}
	var output strings.Builder
	if err := agentDevicePage.Execute(&output, data); err != nil {
		common.SysError("device authorization page render failed: " + err.Error())
		deviceOAuthError(c, http.StatusInternalServerError, "server_error")
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(output.String()))
}

// DeviceConsent renders explicit consent after the existing password/OIDC/GitHub browser login.
func DeviceConsent(c *gin.Context) {
	user, cookie := deviceBrowserUser(c)
	data := devicePageData{}
	if user == nil {
		renderDevicePage(c, data)
		return
	}
	data.Username = user.Username
	code := strings.ToUpper(strings.TrimSpace(c.Query("user_code")))
	if code == "" {
		renderDevicePage(c, data)
		return
	}
	if !agentUserCodePattern.MatchString(code) {
		data.Message = "验证码格式错误。"
		renderDevicePage(c, data)
		return
	}
	grant, err := model.GetPendingDeviceGrant(common.DeviceCredentialDigest(code), model.GetDBTimestamp())
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			common.SysError("device consent lookup failed: " + err.Error())
		}
		data.Message = "授权请求无效、已处理或已过期，请从客户端重新发起。"
		renderDevicePage(c, data)
		return
	}
	data.UserCode, data.CSRF, data.DeviceName = code, deviceCSRF(cookie, code), grant.DeviceName
	if data.DeviceName == "" {
		data.DeviceName = "云大师 Agent"
	}
	for _, permission := range strings.Fields(grant.Scope) {
		switch permission {
		case "user:read":
			data.Permissions = append(data.Permissions, "读取用户名、分组及账户余额用量")
		case "token:manage":
			data.Permissions = append(data.Permissions, "创建、查看和删除本客户端授权创建的模型密钥")
		case "log:read":
			data.Permissions = append(data.Permissions, "读取该账号的调用日志与用量统计（包含其他客户端的记录）")
		}
	}
	renderDevicePage(c, data)
}

// DeviceConsentDecision verifies browser CSRF and atomically approves or denies the pending code.
func DeviceConsentDecision(c *gin.Context) {
	var request struct {
		UserCode string `form:"user_code"`
		CSRF     string `form:"csrf_token"`
		Decision string `form:"decision"`
	}
	if c.ContentType() != "application/x-www-form-urlencoded" || c.ShouldBind(&request) != nil || !agentUserCodePattern.MatchString(request.UserCode) || (request.Decision != "approve" && request.Decision != "deny") {
		deviceOAuthError(c, http.StatusBadRequest, "invalid_request")
		return
	}
	user, cookie := deviceBrowserUser(c)
	if user == nil || !hmac.Equal([]byte(request.CSRF), []byte(deviceCSRF(cookie, request.UserCode))) {
		deviceOAuthError(c, http.StatusForbidden, "access_denied")
		return
	}
	err := model.DecideDeviceGrant(common.DeviceCredentialDigest(request.UserCode), user.Id, request.Decision == "approve", model.GetDBTimestamp())
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) && !errors.Is(err, model.ErrDeviceGrantInvalid) {
			common.SysError("device consent decision failed: " + err.Error())
			deviceOAuthError(c, http.StatusInternalServerError, "server_error")
			return
		}
		deviceOAuthError(c, http.StatusBadRequest, "invalid_grant")
		return
	}
	common.SysLog(fmt.Sprintf("device consent decision user=%d client=%s decision=%s", user.Id, common.DeviceClientID, request.Decision))
	message := "已批准授权，请返回客户端继续。"
	if request.Decision == "deny" {
		message = "已拒绝授权。"
	}
	renderDevicePage(c, devicePageData{Username: user.Username, Message: message})
}

// DeviceGrantsPage provides a theme-independent console for reviewing and revoking device consent.
func DeviceGrantsPage(c *gin.Context) {
	user, cookie := deviceBrowserUser(c)
	if user == nil {
		renderDevicePage(c, devicePageData{})
		return
	}
	page := common.GetPageQuery(c)
	grants, total, err := model.ListDeviceGrants(user.Id, page.GetStartIdx(), page.GetPageSize())
	if err != nil {
		common.SysError("device grant listing failed: " + err.Error())
		deviceOAuthError(c, http.StatusInternalServerError, "server_error")
		return
	}
	data := devicePageData{Username: user.Username, Manage: true, Page: page.Page, HasNext: int64(page.GetEndIdx()) < total}
	for _, grant := range grants {
		name := grant.DeviceName
		if name == "" {
			name = "云大师 Agent"
		}
		status := "有效"
		if grant.ExpiresAt <= model.GetDBTimestamp() {
			status = "已过期"
		}
		if grant.Status == model.DeviceRevoked {
			status = "已撤销"
		}
		data.Grants = append(data.Grants, deviceGrantRow{ID: grant.ID, Name: name, Status: status,
			ExpiresAt: time.Unix(grant.ExpiresAt, 0).UTC().Format("2006-01-02 15:04 UTC"), CSRF: deviceCSRF(cookie, strconv.FormatInt(grant.ID, 10)), CanRevoke: grant.Status == model.DeviceConsumed})
	}
	renderDevicePage(c, data)
}

// RevokeDeviceGrantFromPage requires browser ownership and a grant-specific CSRF token.
func RevokeDeviceGrantFromPage(c *gin.Context) {
	var request struct {
		ID   int64  `form:"id"`
		CSRF string `form:"csrf_token"`
	}
	if c.ContentType() != "application/x-www-form-urlencoded" || c.ShouldBind(&request) != nil || request.ID <= 0 {
		deviceOAuthError(c, http.StatusBadRequest, "invalid_request")
		return
	}
	user, cookie := deviceBrowserUser(c)
	if user == nil || !hmac.Equal([]byte(request.CSRF), []byte(deviceCSRF(cookie, strconv.FormatInt(request.ID, 10)))) {
		deviceOAuthError(c, http.StatusForbidden, "access_denied")
		return
	}
	if err := model.RevokeDeviceGrant(request.ID, user.Id); err != nil {
		common.SysError(fmt.Sprintf("device grant revocation failed user=%d grant=%d: %v", user.Id, request.ID, err))
		if !errors.Is(err, gorm.ErrRecordNotFound) && !errors.Is(err, model.ErrDeviceGrantInvalid) {
			deviceOAuthError(c, http.StatusInternalServerError, "server_error")
			return
		}
		deviceOAuthError(c, http.StatusBadRequest, "invalid_grant")
		return
	}
	common.SysLog(fmt.Sprintf("device grant revoked user=%d grant=%d", user.Id, request.ID))
	c.Header("Cache-Control", "no-store")
	c.Redirect(http.StatusSeeOther, "/oauth/device/grants")
}
