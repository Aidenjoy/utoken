package relay

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// 回归：万相官方提交路径说的是 DashScope 官方协议（input.prompt / parameters），
// 绑定 Ali(17) 统一协议渠道的视频 Key 按文档提交时，必须改走 WanNative 官方
// 透传适配器，而不是被 ali 统一协议校验器以 "prompt is required" 误拒。
// 统一协议路径与查询路径上的 Ali 渠道仍走 ali 适配器，不受影响。
func TestResolveTaskPlatformWanOfficialPathOnAliChannel(t *testing.T) {
	wanOfficialSubmit := "/api/v1/services/aigc/video-generation/video-synthesis"
	aliPlatform := constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeAli))
	wanNativePlatform := constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeWanNative))

	tests := []struct {
		name         string
		channelType  int
		path         string
		explicit     string
		wantPlatform constant.TaskPlatform
	}{
		{name: "Ali channel on wan official submit path", channelType: constant.ChannelTypeAli, path: wanOfficialSubmit, wantPlatform: wanNativePlatform},
		{name: "WanNative channel on wan official submit path", channelType: constant.ChannelTypeWanNative, path: wanOfficialSubmit, wantPlatform: wanNativePlatform},
		{name: "Ali channel on unified submit path keeps ali", channelType: constant.ChannelTypeAli, path: "/v1/video/generations", wantPlatform: aliPlatform},
		{name: "Ali channel on playground submit path keeps ali", channelType: constant.ChannelTypeAli, path: "/pg/video/generations", wantPlatform: aliPlatform},
		{name: "Ali channel on wan official query path keeps ali", channelType: constant.ChannelTypeAli, path: "/api/v1/tasks/wan-task", wantPlatform: aliPlatform},
		{name: "DoubaoVideo channel on wan official path unchanged", channelType: constant.ChannelTypeDoubaoVideo, path: wanOfficialSubmit, wantPlatform: constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeDoubaoVideo))},
		{name: "explicit platform wins on wan official path", channelType: constant.ChannelTypeAli, path: wanOfficialSubmit, explicit: "suno", wantPlatform: constant.TaskPlatform("suno")},
	}

	gin.SetMode(gin.TestMode)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, tt.path, nil)
			c.Set("channel_type", tt.channelType)
			if tt.explicit != "" {
				c.Set("platform", tt.explicit)
			}
			assert.Equal(t, tt.wantPlatform, resolveTaskPlatform(c))
		})
	}
}

// 回归：官方路径提交到 Ali 渠道的万相任务 platform 记为 WanNative，官方查询
// 路径的实时透传分支必须同样接受 Ali 渠道（上游同为 DashScope），返回上游
// 原始响应并同步本地任务状态，而不是回退本地快照。
func TestArkNativePassthroughFetchAcceptsAliWanChannel(t *testing.T) {
	oldDB, oldLogDB := model.DB, model.LOG_DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	model.DB, model.LOG_DB = db, db
	t.Cleanup(func() { model.DB, model.LOG_DB = oldDB, oldLogDB })
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	model.InitCol()
	service.InitHttpClient()
	require.NoError(t, db.AutoMigrate(&model.Task{}, &model.Channel{}))

	upstreamBody := `{"request_id":"req-1","output":{"task_id":"wan-upstream-1","task_status":"PENDING"}}`
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		assert.Equal(t, "Bearer sk-ali-test", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(upstreamBody))
	}))
	t.Cleanup(server.Close)

	channel := &model.Channel{
		Id:      42,
		Type:    constant.ChannelTypeAli,
		Name:    "wan",
		Key:     "sk-ali-test",
		Status:  common.ChannelStatusEnabled,
		BaseURL: common.GetPointer(server.URL),
		Models:  "wan3.0-video",
		Group:   "default",
	}
	require.NoError(t, db.Create(channel).Error)
	task := &model.Task{
		TaskID:      "wan-public-1",
		Platform:    constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeWanNative)),
		UserId:      1,
		ChannelId:   42,
		Group:       "default",
		Status:      model.TaskStatusSubmitted,
		SubmitTime:  time.Now().Unix(),
		Quota:       100,
		Properties:  model.Properties{OriginModelName: "wan3.0-video"},
		PrivateData: model.TaskPrivateData{UpstreamTaskID: "wan-upstream-1"},
	}
	require.NoError(t, db.Create(task).Error)

	body := arkNativePassthroughFetch(task)
	require.NotEmpty(t, body)
	assert.JSONEq(t, upstreamBody, string(body))
	assert.Equal(t, "/api/v1/tasks/wan-upstream-1", gotPath)

	var latest model.Task
	require.NoError(t, db.First(&latest, "task_id = ?", "wan-public-1").Error)
	assert.Equal(t, model.TaskStatus(model.TaskStatusQueued), latest.Status)
}
