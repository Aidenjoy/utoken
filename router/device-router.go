package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-gonic/gin"
)

// SetDeviceRouter registers protocol endpoints before the frontend catch-all, for both themes.
func SetDeviceRouter(router *gin.Engine) {
	device := router.Group("/oauth/device", middleware.RouteTag("api"), middleware.DisableCache(), middleware.GlobalAPIRateLimit())
	device.POST("/code", middleware.DeviceCodeRateLimit(), middleware.AnonymousRequestBodyLimit(), controller.DeviceCode)
	// RFC polling is limited per device_code in the DB; a global critical limiter would break 5s polling.
	device.POST("/token", middleware.DevicePollRateLimit(), middleware.AnonymousRequestBodyLimit(), controller.DeviceToken)
	device.GET("", middleware.DeviceConsentRateLimit(), controller.DeviceConsent)
	device.POST("", middleware.DeviceConsentRateLimit(), middleware.AnonymousRequestBodyLimit(), controller.DeviceConsentDecision)
	device.GET("/grants", controller.DeviceGrantsPage)
	device.POST("/grants", middleware.CriticalRateLimit(), middleware.AnonymousRequestBodyLimit(), controller.RevokeDeviceGrantFromPage)
}
