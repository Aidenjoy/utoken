package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTaskLogResponsesRespectProtocolPermissions(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Task{}))
	require.NoError(t, db.Create(&model.Task{
		TaskID: "private-task", Platform: "59", UserId: 119, Group: "default", ChannelId: 14, Quota: 1400493,
		Action: "generate", Status: model.TaskStatusSuccess,
		Properties: model.Properties{
			OriginModelName: "public-model", UpstreamModelName: "internal-model", RequestURL: "https://internal-upstream.example.com/tasks",
		},
		PrivateData: model.TaskPrivateData{ResultURL: "https://videos.example.com/result.mp4"},
		Data:        json.RawMessage(`{"status":"succeeded","content":{"video_url":"https://videos.example.com/result.mp4"}}`),
		RequestData: json.RawMessage(`{"prompt":"private request"}`),
	}).Error)

	tests := []struct {
		name  string
		self  bool
		role  int
		check func(t *testing.T, body string, item map[string]any)
	}{
		{
			name: "self task list uses public fields without upstream payload",
			self: true,
			role: common.RoleCommonUser,
			check: func(t *testing.T, body string, item map[string]any) {
				for _, field := range []string{"id", "user_id", "platform", "group", "channel_id", "quota", "data", "request_data"} {
					assert.NotContains(t, item, field)
				}
				assert.NotContains(t, body, "request_url")
				assert.NotContains(t, body, "internal-upstream.example.com")
				assert.NotContains(t, body, "private request")
				assert.NotContains(t, body, "internal-model")
				assert.Equal(t, map[string]any{"origin_model_name": "public-model"}, item["properties"])
				assert.Equal(t, "private-task", item["task_id"])
				assert.Equal(t, "https://videos.example.com/result.mp4", item["result_url"])
			},
		},
		{
			name: "regular admin keeps operations fields but not protocol snapshots",
			role: common.RoleAdminUser,
			check: func(t *testing.T, body string, item map[string]any) {
				assert.Equal(t, float64(119), item["user_id"])
				assert.Equal(t, float64(14), item["channel_id"])
				assert.Nil(t, item["data"])
				assert.NotContains(t, item, "request_data")
				assert.NotContains(t, body, "request_url")
				assert.NotContains(t, body, "internal-upstream.example.com")
				assert.NotContains(t, body, "private request")
			},
		},
		{
			name: "super admin retains protocol snapshots",
			role: common.RoleRootUser,
			check: func(t *testing.T, body string, item map[string]any) {
				assert.NotNil(t, item["data"])
				assert.NotNil(t, item["request_data"])
				assert.Contains(t, body, "request_url")
				assert.Contains(t, body, "internal-upstream.example.com")
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodGet, "/api/task/self?p=1&page_size=100", nil)
			c.Set("id", 119)
			c.Set("role", tt.role)
			if tt.self {
				GetUserTask(c)
			} else {
				GetAllTask(c)
			}

			require.Equal(t, http.StatusOK, recorder.Code)
			var response struct {
				Success bool `json:"success"`
				Data    struct {
					Items []map[string]any `json:"items"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			require.True(t, response.Success)
			require.Len(t, response.Data.Items, 1)
			tt.check(t, recorder.Body.String(), response.Data.Items[0])
		})
	}
}

func TestAgentTaskLogUsesPublicFields(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Task{}, &model.Agent{}))
	agent := &model.Agent{UserId: 500, Status: model.AgentStatusEnabled}
	require.NoError(t, db.Create(agent).Error)
	require.NoError(t, db.Create(&model.User{Id: 119, Username: "member", AgentId: agent.Id}).Error)
	require.NoError(t, db.Create(&model.Task{
		TaskID: "agent-task", Platform: "59", UserId: 119, Group: "default", ChannelId: 14, Quota: 1400493,
		Action: "generate", Status: model.TaskStatusSuccess,
		Properties: model.Properties{
			OriginModelName: "public-model", UpstreamModelName: "internal-model", RequestURL: "https://internal-upstream.example.com/tasks",
		},
		Data:        json.RawMessage(`{"status":"succeeded"}`),
		RequestData: json.RawMessage(`{"prompt":"private request"}`),
	}).Error)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/agent/self/tasks?p=1&page_size=100", nil)
	c.Set("id", 500)
	c.Set("agent_id", agent.Id)
	GetAgentTasks(c)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Items []map[string]any `json:"items"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	require.Len(t, response.Data.Items, 1)
	item := response.Data.Items[0]
	assert.Equal(t, float64(119), item["user_id"])
	assert.Equal(t, "member", item["username"])
	assert.Equal(t, "agent-task", item["task_id"])
	for _, field := range []string{"id", "platform", "group", "channel_id", "quota", "data", "request_data"} {
		assert.NotContains(t, item, field)
	}
	assert.NotContains(t, recorder.Body.String(), "request_url")
	assert.NotContains(t, recorder.Body.String(), "internal-upstream.example.com")
	assert.NotContains(t, recorder.Body.String(), "private request")
	assert.NotContains(t, recorder.Body.String(), "internal-model")
}

func TestExternalMidjourneyLogsHideChannelAndQuota(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Midjourney{}, &model.Agent{}))
	agent := &model.Agent{UserId: 500, Status: model.AgentStatusEnabled}
	require.NoError(t, db.Create(agent).Error)
	require.NoError(t, db.Create(&model.User{Id: 119, Username: "member", AgentId: agent.Id}).Error)
	require.NoError(t, db.Create(&model.Midjourney{
		UserId: 119, MjId: "mj-task", Action: "IMAGINE", Status: "FAILURE", FailReason: "upstream channel #14 rejected",
		ChannelId: 14, Quota: 12345,
	}).Error)

	tests := []struct {
		name        string
		scope       string
		wantChannel float64
		wantQuota   float64
	}{
		{name: "self", scope: "self", wantChannel: 0, wantQuota: 0},
		{name: "agent", scope: "agent", wantChannel: 0, wantQuota: 0},
		{name: "admin retains operations fields", scope: "admin", wantChannel: 14, wantQuota: 12345},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodGet, "/api/mj/self?p=1&page_size=100", nil)
			c.Set("id", 119)
			switch tt.scope {
			case "agent":
				c.Set("id", 500)
				c.Set("agent_id", agent.Id)
				GetAgentMidjourney(c)
			case "admin":
				GetAllMidjourney(c)
			default:
				GetUserMidjourney(c)
			}

			require.Equal(t, http.StatusOK, recorder.Code)
			var response struct {
				Success bool `json:"success"`
				Data    struct {
					Items []map[string]any `json:"items"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			require.True(t, response.Success)
			require.Len(t, response.Data.Items, 1)
			item := response.Data.Items[0]
			assert.Equal(t, "mj-task", item["mj_id"])
			assert.Equal(t, tt.wantChannel, item["channel_id"])
			assert.Equal(t, tt.wantQuota, item["quota"])
			if tt.scope == "admin" {
				assert.Equal(t, "upstream channel #14 rejected", item["fail_reason"])
			} else {
				assert.Empty(t, item["fail_reason"])
				assert.NotContains(t, recorder.Body.String(), "upstream channel #14 rejected")
			}
		})
	}
}
