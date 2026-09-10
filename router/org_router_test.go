package router

import (
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// TestOrgRoutesRegisterWithoutConflict 守护 /api/org 下的路由树能被 gin 正常注册。
//
// 企业接口在同一层级混用了静态段与参数段（/members/create、/members/invite 与
// /members/:id，以及 /admin/:id 与 /admin/），gin 只在注册期发现冲突并 panic，
// 一旦冲突整个进程起不来，因此用注册冒烟测试把它挡在构建阶段。
func TestOrgRoutesRegisterWithoutConflict(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	api := engine.Group("/api")

	require.NotPanics(t, func() {
		registerOrgRoutes(api)
	})

	// 三层权限的关键端点都必须挂上，缺一即视为回归
	registered := map[string]bool{}
	for _, route := range engine.Routes() {
		registered[route.Method+" "+route.Path] = true
	}
	required := []string{
		"GET /api/org/summary",
		"GET /api/org/",
		"PUT /api/org/",
		"GET /api/org/members",
		"POST /api/org/members/create",
		"POST /api/org/members/invite",
		"PUT /api/org/members/:id",
		"DELETE /api/org/members/:id",
		"GET /api/org/usage",
		"GET /api/org/logs",
		"GET /api/org/tokens",
		"GET /api/org/admin/",
		"POST /api/org/admin/",
		"GET /api/org/admin/:id",
		"PUT /api/org/admin/:id",
		"DELETE /api/org/admin/:id",
		"POST /api/org/admin/:id/quota",
		"PATCH /api/org/admin/:id/status",
		"GET /api/org/admin/:id/members",
	}
	for _, item := range required {
		require.True(t, registered[item], "missing route %s", item)
	}
}
