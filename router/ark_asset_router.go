package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"

	"github.com/gin-gonic/gin"
)

// SetArkAssetRouter 注册火山方舟官方兼容素材库 API：POST /?Action=<Action>&Version=2024-01-01。
// 下游把火山官方 SDK/curl 的 endpoint 指向本站根路径即可原样调用 10 个 Action，
// 鉴权走 AK/SK V4 签名（ArkAssetV4Auth）。
//
// 关键时序：必须在 SetWebRouter 之前注册——SetWebRouter 通过 router.Use 挂载 gzip、
// Cache、GlobalWebRateLimit 与 static.Serve("/")，而 Gin 在路由注册时即固化中间件链，
// 故本路由不会挂载这些 Web 中间件；且 POST "/" 与前端 GET 静态服务按 HTTP 方法区分，互不冲突。
func SetArkAssetRouter(router *gin.Engine) {
	arkAssetRouter := router.Group("", middleware.RouteTag("relay"), middleware.ArkAssetV4Auth())
	{
		arkAssetRouter.POST("/", controller.RelayArkAssetAction)
	}
}
