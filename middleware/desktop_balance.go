package middleware

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
)

// DesktopBalanceAuth 对 Cookie 复用现有用户鉴权；无登录会话时由余额处理器校验桌面 Token。
func DesktopBalanceAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if sessions.Default(c).Get("id") != nil {
			authHelper(c, common.RoleCommonUser)
			return
		}
		c.Next()
	}
}
