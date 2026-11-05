package router

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestChannelRoutesRegisterWithoutConflict(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	api := engine.Group("/api")

	require.NotPanics(t, func() {
		registerChannelRoutes(api)
	})

	routes := engine.Routes()
	assertChannelRouteHandler(t, routes, http.MethodGet, "/api/channel/", controller.GetAllChannels)
	assertChannelRouteHandler(t, routes, http.MethodGet, "/api/channel/search", controller.SearchChannels)
	assertChannelRouteHandler(t, routes, http.MethodPost, "/api/channel/:id/status", controller.UpdateChannelStatus)
	assertChannelRouteHandler(t, routes, http.MethodPost, "/api/channel/status/batch", controller.BatchUpdateChannelStatus)
	assertChannelRouteHandler(t, routes, http.MethodPut, "/api/channel/", controller.UpdateChannel)
	assertChannelRouteHandler(t, routes, http.MethodDelete, "/api/channel/:id", controller.DeleteChannel)
	assertChannelRouteHandler(t, routes, http.MethodPost, "/api/channel/batch", controller.DeleteChannelBatch)
	assertChannelRouteHandler(t, routes, http.MethodDelete, "/api/channel/disabled", controller.DeleteDisabledChannel)
	assertChannelRouteHandler(t, routes, http.MethodPut, "/api/channel/tag", controller.EditTagChannels)
	assertChannelRouteHandler(t, routes, http.MethodPost, "/api/channel/batch/tag", controller.BatchSetChannelTag)
}

func TestRequirePermissionEnforcesRevokedMenuAccess(t *testing.T) {
	setupRouterAuthzTest(t)
	engine := newPermissionTestEngine(authz.MenuChannels)

	require.NoError(t, authz.SetUserPermissions(42, authz.PermissionsMap{
		authz.ResourceMenu: {authz.ActionMenuChannels: false},
	}))
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/restricted", nil)
	engine.ServeHTTP(recorder, request)

	assert.Equal(t, http.StatusForbidden, recorder.Code)
}

func TestRequireAnyPermissionSupportsSharedChannelBillingReadAccess(t *testing.T) {
	setupRouterAuthzTest(t)
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set("id", 42)
		c.Set("role", common.RoleAdminUser)
	})
	engine.GET("/restricted", middleware.RequireAnyPermission(
		authz.MenuChannels,
		authz.MenuChannelBilling,
	), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	require.NoError(t, authz.SetUserPermissions(42, authz.PermissionsMap{
		authz.ResourceMenu: {
			authz.ActionMenuChannels: false,
		},
	}))
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/restricted", nil)
	engine.ServeHTTP(recorder, request)
	assert.Equal(t, http.StatusNoContent, recorder.Code)

	require.NoError(t, authz.SetUserPermissions(42, authz.PermissionsMap{
		authz.ResourceMenu: {
			authz.ActionMenuChannels:       false,
			authz.ActionMenuChannelBilling: false,
		},
	}))
	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/restricted", nil)
	engine.ServeHTTP(recorder, request)
	assert.Equal(t, http.StatusForbidden, recorder.Code)
}

func setupRouterAuthzTest(t *testing.T) {
	t.Helper()
	wasMaster := common.IsMasterNode
	common.IsMasterNode = true
	t.Cleanup(func() {
		common.IsMasterNode = wasMaster
	})
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.CasbinRule{}, &model.AuthzRole{}))
	require.NoError(t, authz.Init(db))
}

func newPermissionTestEngine(permission authz.Permission) *gin.Engine {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set("id", 42)
		c.Set("role", common.RoleAdminUser)
	})
	engine.GET("/restricted", middleware.RequirePermission(permission), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})
	return engine
}

func assertChannelRouteHandler(t *testing.T, routes gin.RoutesInfo, method string, path string, handler any) {
	t.Helper()
	for _, route := range routes {
		if route.Method == method && route.Path == path {
			assert.Equal(t, reflect.ValueOf(handler).Pointer(), reflect.ValueOf(route.HandlerFunc).Pointer())
			return
		}
	}
	t.Fatalf("route %s %s not found", method, path)
}
