package middleware

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestArkNativeTaskModelExtraction(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousDB := model.DB
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	t.Cleanup(func() {
		model.DB = previousDB
		sqlDB, dbErr := db.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})
	require.NoError(t, db.AutoMigrate(&model.Task{}))
	require.NoError(t, db.Create(&model.Task{
		TaskID: "task-a", Platform: "59", UserId: 10, Status: model.TaskStatusQueued,
		Properties: model.Properties{OriginModelName: "model-a"},
	}).Error)
	require.NoError(t, db.Create(&model.Task{
		TaskID: "task-b", Platform: "59", UserId: 11, Status: model.TaskStatusQueued,
		Properties: model.Properties{OriginModelName: "model-b"},
	}).Error)

	tests := []struct {
		name       string
		method     string
		target     string
		taskID     string
		userID     int
		wantModel  string
		wantSelect bool
	}{
		{name: "list without model", method: http.MethodGet, target: "/api/v3/contents/generations/tasks", userID: 10, wantSelect: false},
		{name: "list model filter", method: http.MethodGet, target: "/api/v3/contents/generations/tasks?filter.model=model-a", userID: 10, wantModel: "model-a", wantSelect: false},
		{name: "single fetch", method: http.MethodGet, target: "/api/v3/contents/generations/tasks/task-a", taskID: "task-a", userID: 10, wantModel: "model-a", wantSelect: false},
		{name: "delete", method: http.MethodDelete, target: "/api/v3/contents/generations/tasks/task-a", taskID: "task-a", userID: 10, wantModel: "model-a", wantSelect: false},
		{name: "other tenant task has no model", method: http.MethodDelete, target: "/api/v3/contents/generations/tasks/task-b", taskID: "task-b", userID: 10, wantSelect: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(tt.method, tt.target, nil)
			c.Set("id", tt.userID)
			if tt.taskID != "" {
				c.Params = gin.Params{{Key: "task_id", Value: tt.taskID}}
			}
			request, shouldSelect, err := getModelRequest(c)
			require.NoError(t, err)
			assert.Equal(t, tt.wantModel, request.Model)
			assert.Equal(t, tt.wantSelect, shouldSelect)
		})
	}
}

func TestArkNativeListDoesNotNeedBoundChannelOrModel(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v3/contents/generations/tasks", nil)
	common.SetContextKey(c, constant.ContextKeyTokenSpecificChannelId, "999999")
	common.SetContextKey(c, constant.ContextKeyTokenModelLimitEnabled, true)
	common.SetContextKey(c, constant.ContextKeyTokenModelLimit, map[string]bool{"model-a": true})
	c.Set("id", 10)

	Distribute()(c)

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, 0, c.GetInt("channel_id"))
}
