package relay

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestVideoFetchByIDResponseDoesNotExposeInternalTaskFields(t *testing.T) {
	oldDB, oldLogDB := model.DB, model.LOG_DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	model.DB, model.LOG_DB = db, db
	t.Cleanup(func() { model.DB, model.LOG_DB = oldDB, oldLogDB })
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.Task{}, &model.Channel{}))

	arkData := json.RawMessage(`{
		"id":"cgt-ark","model":"doubao-seedance-2.0","status":"succeeded",
		"content":{"video_url":"https://videos.example.com/ark.mp4"},
		"usage":{"completion_tokens":60891,"total_tokens":60891}
	}`)
	arkTask := &model.Task{
		TaskID:      "ark-task",
		Platform:    constant.TaskPlatform("59"),
		UserId:      119,
		Group:       "default",
		ChannelId:   14,
		Quota:       1400493,
		Status:      model.TaskStatusSuccess,
		Properties:  model.Properties{RequestURL: "https://internal-upstream.example.com/tasks"},
		RequestData: json.RawMessage(`{"prompt":"secret request"}`),
		Data:        arkData,
	}
	genericTask := &model.Task{
		TaskID:    "generic-task",
		Platform:  constant.TaskPlatform("generic"),
		UserId:    119,
		Group:     "default",
		ChannelId: 15,
		Quota:     2800986,
		Status:    model.TaskStatusSuccess,
		Progress:  "100%",
		Properties: model.Properties{
			OriginModelName:   "public-model",
			UpstreamModelName: "internal-model",
			RequestURL:        "https://internal-upstream.example.com/tasks",
		},
		PrivateData: model.TaskPrivateData{ResultURL: "https://videos.example.com/generic.mp4"},
		RequestData: json.RawMessage(`{"prompt":"secret request"}`),
		Data:        json.RawMessage(`{"id":"upstream-task","status":"succeeded"}`),
	}
	klingData := json.RawMessage(`{
		"code":0,"message":"success","request_id":"kling-request",
		"data":{"task_id":"kling-upstream","task_status":"succeed",
		"task_result":{"videos":[{"url":"https://videos.example.com/kling.mp4"}]}}
	}`)
	klingTask := &model.Task{
		TaskID: "kling-task", Platform: constant.TaskPlatform("50"), UserId: 119, ChannelId: 16, Quota: 99,
		Status: model.TaskStatusSuccess, Properties: model.Properties{RequestURL: "https://internal-upstream.example.com/kling"},
		RequestData: json.RawMessage(`{"prompt":"secret request"}`), Data: klingData,
	}
	sunoTask := &model.Task{
		TaskID: "suno-task", Platform: constant.TaskPlatform("suno"), UserId: 119, ChannelId: 17, Quota: 100,
		Status: model.TaskStatusSuccess,
		Properties: model.Properties{
			OriginModelName: "public-model", UpstreamModelName: "internal-model", RequestURL: "https://internal-upstream.example.com/suno",
		},
		PrivateData: model.TaskPrivateData{ResultURL: "https://music.example.com/suno.mp3"},
		RequestData: json.RawMessage(`{"prompt":"secret request"}`),
		Data:        json.RawMessage(`[{"id":"song-1","audio_url":"https://music.example.com/suno.mp3"}]`),
	}
	failedTask := &model.Task{
		TaskID: "failed-task", Platform: constant.TaskPlatform("generic"), UserId: 119, ChannelId: 15, Quota: 100,
		Status: model.TaskStatusFailure, FailReason: "upstream channel #15 rejected by vendor",
		Properties: model.Properties{OriginModelName: "public-model", UpstreamModelName: "internal-model"},
	}
	require.NoError(t, db.Create(arkTask).Error)
	require.NoError(t, db.Create(genericTask).Error)
	require.NoError(t, db.Create(klingTask).Error)
	require.NoError(t, db.Create(sunoTask).Error)
	require.NoError(t, db.Create(failedTask).Error)

	tests := []struct {
		name      string
		path      string
		taskID    string
		suno      bool
		rawData   json.RawMessage
		resultURL string
		status    string
	}{
		{name: "official Ark protocol", path: "/api/v3/contents/generations/tasks/ark-task", taskID: "ark-task", rawData: arkData},
		{name: "unified API keeps Ark official protocol", path: "/v1/video/generations/ark-task", taskID: "ark-task", rawData: arkData},
		{name: "Kling text2video keeps official protocol", path: "/kling/v1/videos/text2video/kling-task", taskID: "kling-task", rawData: klingData},
		{name: "Kling image2video keeps official protocol", path: "/kling/v1/videos/image2video/kling-task", taskID: "kling-task", rawData: klingData},
		{name: "unified API generic response uses public whitelist", path: "/v1/video/generations/generic-task", taskID: "generic-task", resultURL: "https://videos.example.com/generic.mp4", status: "SUCCESS"},
		{name: "playground generic response uses public whitelist", path: "/pg/video/generations/generic-task", taskID: "generic-task", resultURL: "https://videos.example.com/generic.mp4", status: "SUCCESS"},
		{name: "Suno fetch by ID uses public whitelist", path: "/suno/fetch/suno-task", taskID: "suno-task", suno: true, resultURL: "https://music.example.com/suno.mp3", status: "SUCCESS"},
		{name: "unified API failure hides upstream reason", path: "/v1/video/generations/failed-task", taskID: "failed-task", status: "FAILURE"},
		{name: "Kling empty snapshot failure uses safe fallback", path: "/kling/v1/videos/text2video/failed-task", taskID: "failed-task", status: "FAILURE"},
		{name: "Suno failure hides upstream reason", path: "/suno/fetch/failed-task", taskID: "failed-task", suno: true, status: "FAILURE"},
	}

	gin.SetMode(gin.TestMode)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodGet, tt.path, nil)
			paramName := "task_id"
			if tt.suno {
				paramName = "id"
			}
			c.Params = gin.Params{{Key: paramName, Value: tt.taskID}}
			c.Set("id", 119)

			body, taskErr := videoFetchByIDRespBodyBuilder(c)
			if tt.suno {
				body, taskErr = sunoFetchByIDRespBodyBuilder(c)
			}
			require.Nil(t, taskErr)
			require.NotEmpty(t, body)

			for _, field := range []string{"user_id", "channel_id", "quota", "platform", "group", "username", "request_url", "request_data", "private_data"} {
				assert.NotContains(t, string(body), `"`+field+`"`)
			}
			assert.NotContains(t, string(body), "internal-upstream.example.com")
			assert.NotContains(t, string(body), "secret request")
			assert.NotContains(t, string(body), "internal-model")
			assert.NotContains(t, string(body), "upstream channel #15 rejected by vendor")

			if tt.rawData != nil {
				assert.JSONEq(t, string(tt.rawData), string(body))
				return
			}

			var response struct {
				Code string         `json:"code"`
				Data map[string]any `json:"data"`
			}
			require.NoError(t, common.Unmarshal(body, &response))
			assert.Equal(t, "success", response.Code)
			assert.Equal(t, tt.taskID, response.Data["task_id"])
			assert.Equal(t, tt.status, response.Data["status"])
			assert.Equal(t, map[string]any{"origin_model_name": "public-model"}, response.Data["properties"])
			if tt.status == "FAILURE" {
				assert.Equal(t, "task failed", response.Data["fail_reason"])
				assert.NotContains(t, response.Data, "result_url")
			} else {
				assert.Equal(t, tt.resultURL, response.Data["result_url"])
			}
			if !tt.suno {
				assert.NotContains(t, response.Data, "data")
				assert.NotContains(t, string(body), "upstream-task")
			}
		})
	}

	t.Run("Jimeng result query uses public whitelist after middleware rewrite", func(t *testing.T) {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/jimeng/?Action=CVSync2AsyncGetResult&Version=2022-08-31", strings.NewReader(`{"task_id":"generic-task"}`))
		c.Request.Header.Set("Content-Type", "application/json")
		middleware.JimengRequestConvert()(c)
		require.Equal(t, "/v1/video/generations/generic-task", c.Request.URL.Path)
		require.Equal(t, "/jimeng/?Action=CVSync2AsyncGetResult&Version=2022-08-31", c.Request.RequestURI)
		c.Set("id", 119)

		body, taskErr := videoFetchByIDRespBodyBuilder(c)
		require.Nil(t, taskErr)
		assert.NotContains(t, string(body), "internal-model")
		assert.NotContains(t, string(body), "internal-upstream.example.com")
		assert.NotContains(t, string(body), `"channel_id"`)
		var response struct {
			Data map[string]any `json:"data"`
		}
		require.NoError(t, common.Unmarshal(body, &response))
		assert.NotContains(t, response.Data, "data")
	})

	t.Run("legacy result URL is limited to successful tasks", func(t *testing.T) {
		legacySuccess := &model.Task{Status: model.TaskStatusSuccess, FailReason: "https://videos.example.com/legacy.mp4"}
		legacyFailure := &model.Task{Status: model.TaskStatusFailure, FailReason: "upstream channel #15 rejected"}
		assert.Equal(t, "https://videos.example.com/legacy.mp4", legacySuccess.GetResultURL())
		assert.Empty(t, legacyFailure.GetResultURL())
	})

	t.Run("OpenAI Video error does not expose internal channel or platform", func(t *testing.T) {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodGet, "/v1/videos/generic-task", nil)
		c.Params = gin.Params{{Key: "task_id", Value: "generic-task"}}
		c.Set("id", 119)

		body, taskErr := videoFetchByIDRespBodyBuilder(c)
		require.Nil(t, body)
		require.NotNil(t, taskErr)
		assert.Equal(t, "invalid_channel_id", taskErr.Code)
		assert.Equal(t, "invalid channel id", taskErr.Message)
		assert.NotContains(t, taskErr.Message, "15")
		assert.NotContains(t, taskErr.Message, "generic")
	})

	t.Run("Suno batch fetch uses public whitelist", func(t *testing.T) {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/suno/fetch", strings.NewReader(`{"ids":["suno-task"]}`))
		c.Set("id", 119)

		body, taskErr := sunoFetchRespBodyBuilder(c)
		require.Nil(t, taskErr)
		for _, field := range []string{"user_id", "channel_id", "quota", "platform", "request_url", "request_data", "private_data"} {
			assert.NotContains(t, string(body), `"`+field+`"`)
		}
		assert.NotContains(t, string(body), "internal-upstream.example.com")
		assert.NotContains(t, string(body), "secret request")
		assert.NotContains(t, string(body), "internal-model")

		var response struct {
			Code string           `json:"code"`
			Data []map[string]any `json:"data"`
		}
		require.NoError(t, common.Unmarshal(body, &response))
		require.Len(t, response.Data, 1)
		assert.Equal(t, "suno-task", response.Data[0]["task_id"])
		assert.Equal(t, "https://music.example.com/suno.mp3", response.Data[0]["result_url"])
	})

	t.Run("deleted Ark task cannot reappear from local snapshot", func(t *testing.T) {
		arkTask.PrivateData.DeletedAt = 1
		require.NoError(t, db.Model(arkTask).Update("private_data", arkTask.PrivateData).Error)
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodGet, "/api/v3/contents/generations/tasks/ark-task", nil)
		c.Params = gin.Params{{Key: "task_id", Value: "ark-task"}}
		c.Set("id", 119)

		body, taskErr := videoFetchByIDRespBodyBuilder(c)
		assert.Nil(t, body)
		require.NotNil(t, taskErr)
		assert.Equal(t, http.StatusNotFound, taskErr.StatusCode)
		assert.Equal(t, "ResourceNotFound", taskErr.Code)
		assert.Equal(t, "The specified resource `ark-task` is not found.", taskErr.Message)
	})

	t.Run("missing Ark task uses official not found error", func(t *testing.T) {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodGet, "/api/v3/contents/generations/tasks/missing-task", nil)
		c.Params = gin.Params{{Key: "task_id", Value: "missing-task"}}
		c.Set("id", 119)

		body, taskErr := videoFetchByIDRespBodyBuilder(c)
		assert.Nil(t, body)
		require.NotNil(t, taskErr)
		assert.Equal(t, http.StatusNotFound, taskErr.StatusCode)
		assert.Equal(t, "ResourceNotFound", taskErr.Code)
		assert.Equal(t, "The specified resource `missing-task` is not found.", taskErr.Message)
	})
}
