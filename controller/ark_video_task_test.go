package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestArkVideoTaskListFiltersTenantKeyAndOfficialFields(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Task{}))
	tasks := []*model.Task{
		{
			TaskID: "task-old", Platform: "59", UserId: 10, ChannelId: 91, Quota: 123,
			Status: model.TaskStatusSuccess, SubmitTime: 100, UpdatedAt: 110,
			Properties: model.Properties{OriginModelName: "model-a", UpstreamModelName: "upstream-a", RequestURL: "https://internal.example.com"},
			Data:       json.RawMessage(`{"id":"upstream-old","model":"upstream-a","status":"succeeded","content":{"video_url":"https://videos.example.com/a.mp4"},"service_tier":"default","channel_id":999,"internal":"secret"}`),
		},
		{
			TaskID: "task-new", Platform: "61", UserId: 10, ChannelId: 92,
			Status: model.TaskStatusQueued, SubmitTime: 200, UpdatedAt: 210,
			Properties: model.Properties{OriginModelName: "model-a"},
			Data:       json.RawMessage(`{"id":"upstream-new","status":"queued","service_tier":"default"}`),
		},
		{
			TaskID: "task-forbidden", Platform: "59", UserId: 10, Status: model.TaskStatusSuccess,
			Properties: model.Properties{OriginModelName: "model-b"}, Data: json.RawMessage(`{"status":"succeeded"}`),
		},
		{
			TaskID: "task-other-user", Platform: "59", UserId: 11, Status: model.TaskStatusSuccess,
			Properties: model.Properties{OriginModelName: "model-a"}, Data: json.RawMessage(`{"status":"succeeded"}`),
		},
		{
			TaskID: "task-flex", Platform: "59", UserId: 10, Status: model.TaskStatusSuccess,
			Properties: model.Properties{OriginModelName: "model-a"}, Data: json.RawMessage(`{"status":"succeeded","service_tier":"flex"}`),
		},
		{
			TaskID: "task-deleted", Platform: "59", UserId: 10, Status: model.TaskStatusSuccess,
			Properties: model.Properties{OriginModelName: "model-a"}, PrivateData: model.TaskPrivateData{DeletedAt: 1},
			Data: json.RawMessage(`{"status":"succeeded"}`),
		},
	}
	for _, task := range tasks {
		require.NoError(t, db.Create(task).Error)
	}

	invoke := func(target string, agentRestricted bool) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodGet, target, nil)
		c.Set("id", 10)
		if agentRestricted {
			common.SetContextKey(c, constant.ContextKeyUserAgentId, 7)
			common.SetContextKey(c, constant.ContextKeyUserAllowedModels, `["model-a"]`)
		} else {
			common.SetContextKey(c, constant.ContextKeyTokenModelLimitEnabled, true)
			common.SetContextKey(c, constant.ContextKeyTokenModelLimit, map[string]bool{"model-a": true})
		}
		ArkVideoTaskList(c)
		return recorder
	}

	firstPage := invoke("/api/v3/contents/generations/tasks?page_num=1&page_size=1", false)
	require.Equal(t, http.StatusOK, firstPage.Code)
	var response struct {
		Items []map[string]any `json:"items"`
		Total int              `json:"total"`
	}
	require.NoError(t, common.Unmarshal(firstPage.Body.Bytes(), &response))
	assert.Equal(t, 2, response.Total)
	require.Len(t, response.Items, 1)
	assert.Equal(t, "task-new", response.Items[0]["id"])
	assert.Equal(t, "queued", response.Items[0]["status"])
	assert.Equal(t, "model-a", response.Items[0]["model"])
	for _, field := range []string{"channel_id", "quota", "private_data", "internal"} {
		assert.NotContains(t, firstPage.Body.String(), field)
	}

	secondPage := invoke("/api/v3/contents/generations/tasks?page_num=2&page_size=1", false)
	require.NoError(t, common.Unmarshal(secondPage.Body.Bytes(), &response))
	assert.Equal(t, 2, response.Total)
	require.Len(t, response.Items, 1)
	assert.Equal(t, "task-old", response.Items[0]["id"])
	assert.Equal(t, float64(100), response.Items[0]["created_at"])
	assert.Equal(t, "https://videos.example.com/a.mp4", response.Items[0]["content"].(map[string]any)["video_url"])
	assert.NotContains(t, secondPage.Body.String(), "internal.example.com")
	assert.NotContains(t, secondPage.Body.String(), "upstream-a")

	byIDs := invoke("/api/v3/contents/generations/tasks?filter.task_ids=task-old&filter.task_ids=task-other-user", false)
	require.NoError(t, common.Unmarshal(byIDs.Body.Bytes(), &response))
	assert.Equal(t, 1, response.Total)
	require.Len(t, response.Items, 1)
	assert.Equal(t, "task-old", response.Items[0]["id"])

	succeeded := invoke("/api/v3/contents/generations/tasks?filter.status=succeeded", false)
	require.NoError(t, common.Unmarshal(succeeded.Body.Bytes(), &response))
	assert.Equal(t, 1, response.Total)

	flex := invoke("/api/v3/contents/generations/tasks?filter.service_tier=flex", false)
	require.NoError(t, common.Unmarshal(flex.Body.Bytes(), &response))
	assert.Equal(t, 1, response.Total)
	assert.Equal(t, "task-flex", response.Items[0]["id"])

	agentFiltered := invoke("/api/v3/contents/generations/tasks", true)
	require.NoError(t, common.Unmarshal(agentFiltered.Body.Bytes(), &response))
	assert.Equal(t, 2, response.Total)

	forbidden := invoke("/api/v3/contents/generations/tasks?filter.model=model-b", false)
	assert.Equal(t, http.StatusForbidden, forbidden.Code)
	assert.Contains(t, forbidden.Body.String(), "model_forbidden")

	for _, raw := range []string{"0", "501", "-1", "abc", "1.5"} {
		invalidPage := invoke("/api/v3/contents/generations/tasks?page_num="+raw, false)
		assert.Equal(t, http.StatusBadRequest, invalidPage.Code, "page_num=%s", raw)
	}
	invalidStatus := invoke("/api/v3/contents/generations/tasks?filter.status=processing", false)
	assert.Equal(t, http.StatusBadRequest, invalidStatus.Code)
}

func TestArkVideoTaskDeleteLifecycleAndForwarding(t *testing.T) {
	t.Run("queued task uses upstream ID then becomes cancelled", func(t *testing.T) {
		fixture := setupArkDeleteControllerTest(t, model.TaskStatusQueued, http.StatusOK)
		recorder := fixture.invoke(10, false)
		require.Equal(t, http.StatusOK, recorder.Code)
		assert.JSONEq(t, `{}`, recorder.Body.String())
		assert.Equal(t, int32(1), fixture.calls.Load())

		stored, exist, err := model.GetByTaskId(10, "public-task")
		require.NoError(t, err)
		require.True(t, exist)
		assert.Equal(t, string(model.TaskStatusCancelled), string(stored.Status))
		assert.False(t, stored.IsDeleted())
		assert.Zero(t, stored.Quota)
		var user model.User
		require.NoError(t, fixture.db.First(&user, "id = ?", 10).Error)
		assert.Equal(t, 1123, user.Quota)
	})

	t.Run("terminal task is tombstoned without deleting billing row", func(t *testing.T) {
		fixture := setupArkDeleteControllerTest(t, model.TaskStatusSuccess, http.StatusOK)
		recorder := fixture.invoke(10, false)
		require.Equal(t, http.StatusOK, recorder.Code)

		stored, exist, err := model.GetByTaskId(10, "public-task")
		require.NoError(t, err)
		require.True(t, exist)
		assert.True(t, stored.IsDeleted())
		assert.Equal(t, string(model.TaskStatusSuccess), string(stored.Status))

		second := fixture.invoke(10, false)
		assert.Equal(t, http.StatusNotFound, second.Code)
		assert.JSONEq(t, "{\"error\":{\"code\":\"ResourceNotFound\",\"message\":\"The specified resource `public-task` is not found.\",\"param\":\"\",\"type\":\"NotFound\"}}", second.Body.String())
		assert.Equal(t, int32(1), fixture.calls.Load())
	})

	t.Run("running task is rejected before upstream", func(t *testing.T) {
		fixture := setupArkDeleteControllerTest(t, model.TaskStatusInProgress, http.StatusOK)
		recorder := fixture.invoke(10, false)
		assert.Equal(t, http.StatusConflict, recorder.Code)
		assert.JSONEq(t, "{\"error\":{\"code\":\"InvalidAction.RunningTaskDeletion\",\"message\":\"Cannot delete task `public-task` because it is currently running.\",\"param\":\"\",\"type\":\"Conflict\"}}", recorder.Body.String())
		assert.Equal(t, int32(0), fixture.calls.Load())
	})

	t.Run("other tenant cannot delete", func(t *testing.T) {
		fixture := setupArkDeleteControllerTest(t, model.TaskStatusQueued, http.StatusOK)
		recorder := fixture.invoke(11, false)
		assert.Equal(t, http.StatusNotFound, recorder.Code)
		assert.Equal(t, int32(0), fixture.calls.Load())
	})

	t.Run("model restricted key cannot delete", func(t *testing.T) {
		fixture := setupArkDeleteControllerTest(t, model.TaskStatusQueued, http.StatusOK)
		recorder := fixture.invoke(10, true)
		assert.Equal(t, http.StatusForbidden, recorder.Code)
		assert.Equal(t, int32(0), fixture.calls.Load())
	})

	t.Run("upstream failure preserves local state and quota", func(t *testing.T) {
		fixture := setupArkDeleteControllerTest(t, model.TaskStatusQueued, http.StatusBadRequest)
		recorder := fixture.invoke(10, false)
		assert.Equal(t, http.StatusBadRequest, recorder.Code)
		assert.JSONEq(t, `{"error":{"code":"InvalidState","message":"cannot cancel"}}`, recorder.Body.String())

		stored, exist, err := model.GetByTaskId(10, "public-task")
		require.NoError(t, err)
		require.True(t, exist)
		assert.Equal(t, string(model.TaskStatusQueued), string(stored.Status))
		assert.Equal(t, 123, stored.Quota)
		var user model.User
		require.NoError(t, fixture.db.First(&user, "id = ?", 10).Error)
		assert.Equal(t, 1000, user.Quota)
	})
}

type arkDeleteControllerFixture struct {
	db     *gorm.DB
	calls  *atomic.Int32
	invoke func(userID int, restrictModel bool) *httptest.ResponseRecorder
}

func setupArkDeleteControllerTest(t *testing.T, status model.TaskStatus, upstreamStatus int) arkDeleteControllerFixture {
	t.Helper()
	service.InitHttpClient()
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Task{}, &model.Log{}, &model.OrgMember{}))
	require.NoError(t, db.Create(&model.User{Id: 10, Username: "ark-user", Quota: 1000, UsedQuota: 123}).Error)
	calls := &atomic.Int32{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		assert.Equal(t, http.MethodDelete, r.Method)
		assert.Equal(t, "/api/v3/contents/generations/tasks/upstream-task", r.URL.Path)
		assert.Equal(t, "Bearer upstream-secret", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(upstreamStatus)
		if upstreamStatus == http.StatusOK {
			_, _ = w.Write([]byte(`{}`))
		} else {
			_, _ = w.Write([]byte(`{"error":{"code":"InvalidState","message":"cannot cancel"}}`))
		}
	}))
	t.Cleanup(server.Close)
	baseURL := server.URL + "/api/v3"
	require.NoError(t, db.Create(&model.Channel{
		Id: 88, Type: constant.ChannelTypeArkNative, Key: "upstream-secret", Name: "ark", BaseURL: &baseURL,
	}).Error)
	require.NoError(t, db.Create(&model.Task{
		TaskID: "public-task", Platform: "59", UserId: 10, ChannelId: 88, Quota: 123,
		Status: status, Properties: model.Properties{OriginModelName: "model-a"},
		PrivateData: model.TaskPrivateData{UpstreamTaskID: "upstream-task"},
		Data:        json.RawMessage(`{"id":"upstream-task","status":"queued"}`),
	}).Error)

	return arkDeleteControllerFixture{
		db:    db,
		calls: calls,
		invoke: func(userID int, restrictModel bool) *httptest.ResponseRecorder {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodDelete, "/api/v3/contents/generations/tasks/public-task", nil)
			c.Params = gin.Params{{Key: "task_id", Value: "public-task"}}
			c.Set("id", userID)
			if restrictModel {
				common.SetContextKey(c, constant.ContextKeyTokenModelLimitEnabled, true)
				common.SetContextKey(c, constant.ContextKeyTokenModelLimit, map[string]bool{"model-b": true})
			}
			ArkVideoTaskDelete(c)
			return recorder
		},
	}
}

func TestArkTaskListEmptyItemsIsJSONArray(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Task{}))
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v3/contents/generations/tasks", nil)
	c.Set("id", 999)
	ArkVideoTaskList(c)
	require.Equal(t, http.StatusOK, recorder.Code)
	assert.JSONEq(t, `{"items":[],"total":0}`, recorder.Body.String())
}
