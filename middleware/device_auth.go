package middleware

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// DeviceCodeRateLimit limits anonymous issuance even when optional dashboard limits are disabled.
func DeviceCodeRateLimit() gin.HandlerFunc { return rateLimitFactory(10, 60, "DC") }

// DeviceConsentRateLimit bounds user-code guessing without requiring an authenticated API user ID.
func DeviceConsentRateLimit() gin.HandlerFunc { return rateLimitFactory(60, 60, "DA") }

// DevicePollRateLimit bounds invalid-code traffic; per-device RFC intervals remain enforced in the DB.
func DevicePollRateLimit() gin.HandlerFunc { return rateLimitFactory(120, 60, "DP") }

// authenticateDeviceAccess enforces an explicit route/scope allowlist before normal account privileges.
// Device credentials never inherit administrator roles or dashboard sessions, even on admin accounts.
func authenticateDeviceAccess(c *gin.Context, minRole int) bool {
	parts := strings.Fields(c.GetHeader("Authorization"))
	if !strings.Contains(c.GetHeader("Authorization"), common.DeviceTokenPrefix) {
		return false
	}
	c.Header("Cache-Control", "no-store")
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || !strings.HasPrefix(parts[1], common.DeviceTokenPrefix) || len(parts[1]) != len(common.DeviceTokenPrefix)+43 {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "error": "invalid_token"})
		return true
	}
	grant, user, err := model.GetDeviceAccessGrant(common.DeviceCredentialDigest(parts[1]), model.GetDBTimestamp())
	if err != nil {
		status := http.StatusUnauthorized
		code := "invalid_token"
		if !errors.Is(err, model.ErrDeviceGrantInvalid) {
			common.SysError("device access validation failed: " + err.Error())
			status, code = http.StatusInternalServerError, "server_error"
		}
		c.AbortWithStatusJSON(status, gin.H{"success": false, "error": code})
		return true
	}
	permission := ""
	switch c.FullPath() {
	case "/api/user/self":
		if c.Request.Method == http.MethodGet {
			permission = "user:read"
		}
	case "/api/log/self", "/api/log/self/stat":
		if c.Request.Method == http.MethodGet {
			permission = "log:read"
		}
	case "/api/token/":
		if c.Request.Method == http.MethodGet || c.Request.Method == http.MethodPost {
			permission = "token:manage"
		}
	case "/api/token/:id":
		if c.Request.Method == http.MethodGet || c.Request.Method == http.MethodDelete {
			permission = "token:manage"
		}
	case "/api/token/:id/key":
		if c.Request.Method == http.MethodPost {
			permission = "token:manage"
		}
	}
	if minRole != common.RoleCommonUser || permission == "" || !strings.Contains(" "+grant.Scope+" ", " "+permission+" ") {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"success": false, "error": "insufficient_scope"})
		return true
	}
	if id := c.GetHeader("New-Api-User"); id != "" && id != strconv.Itoa(user.Id) {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "error": "invalid_user"})
		return true
	}
	c.Set("id", user.Id)
	c.Set("username", user.Username)
	c.Set("role", common.RoleCommonUser)
	c.Set("group", user.Group)
	c.Set("user_group", user.Group)
	c.Set("use_access_token", true)
	c.Set(common.DeviceGrantContextKey, grant)
	c.Next()
	return true
}
