package router

import (
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// TestPromptRoutesRegisterWithoutConflict 守护 /api/prompt 下的路由树能被 gin 正常注册。
//
// 模板库在同一层级混用了静态段与参数段（/tags 与 /:id、/ 与 /:id/copy），
// gin 只在注册期发现冲突并 panic，一旦冲突整个进程起不来，
// 因此用注册冒烟测试把它挡在构建阶段（与 org 路由的守护测试同一思路）。
func TestPromptRoutesRegisterWithoutConflict(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	api := engine.Group("/api")

	require.NotPanics(t, func() {
		registerPromptRoutes(api)
	})

	registered := map[string]bool{}
	for _, route := range engine.Routes() {
		registered[route.Method+" "+route.Path] = true
	}
	required := []string{
		"GET /api/prompt/",
		"GET /api/prompt/tags",
		"GET /api/prompt/:id",
		"POST /api/prompt/",
		"PUT /api/prompt/:id",
		"DELETE /api/prompt/:id",
		"POST /api/prompt/:id/copy",
		"POST /api/prompt/:id/use",
	}
	for _, item := range required {
		require.True(t, registered[item], "missing route %s", item)
	}
}
