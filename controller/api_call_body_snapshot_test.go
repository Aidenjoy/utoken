package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 本文件锁定「非计费 API 调用端点协议详情快照」契约：素材库 Action 与视频任务
// 列表/查询/删除不经 Relay() 入口，请求/响应必须旁路捕获落 log_bodies，并与审计行
// 同 request_id 关联（否则使用日志协议详情恒为空）；查询类接口与审计行共用
// LogQueryApiCallEnabled 开关，开关关闭时不产生孤立快照。

func requireLogBody(t *testing.T, requestId string) *model.LogBody {
	t.Helper()
	require.Eventually(t, func() bool {
		_, ok, err := model.GetLogBodyByRequestId(requestId)
		return err == nil && ok
	}, time.Second, 10*time.Millisecond)
	body, ok, err := model.GetLogBodyByRequestId(requestId)
	require.NoError(t, err)
	require.True(t, ok)
	return body
}

func TestRelayArkAssetActionWritesBodySnapshot(t *testing.T) {
	db := setupArkAssetControllerDB(t)
	require.NoError(t, db.AutoMigrate(&model.Log{}, &model.LogBody{}, &model.User{}))
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "alice"}).Error)

	orig := common.LogQueryApiCallEnabled
	defer func() { common.LogQueryApiCallEnabled = orig }()
	common.LogQueryApiCallEnabled = true

	// 查询类 Action：请求体与官方响应信封均落库。
	c, rec := newArkAssetContext(t, "ListAssets", 1, map[string]any{
		"Filter": map[string]any{"GroupType": "AIGC"}, "ProjectName": "default",
	})
	c.Set(common.RequestIdKey, "req-ark-query")
	RelayArkAssetAction(c)
	require.Equal(t, http.StatusOK, rec.Code)
	body := requireLogBody(t, "req-ark-query")
	assert.Contains(t, body.RequestData, "AIGC")
	assert.Contains(t, body.ResponseData, "ResponseMetadata")

	// 写类 Action（无效 Action → 400）：开关关闭也落快照，请求回退请求行、响应为官方错误信封。
	common.LogQueryApiCallEnabled = false
	c, rec = newArkAssetContext(t, "BogusAction", 1, nil)
	c.Set(common.RequestIdKey, "req-ark-write")
	RelayArkAssetAction(c)
	require.Equal(t, http.StatusBadRequest, rec.Code)
	body = requireLogBody(t, "req-ark-write")
	assert.Contains(t, body.RequestData, "POST /?Action=BogusAction")
	assert.Contains(t, body.ResponseData, "InvalidAction")

	// 查询类 + 开关关闭：无审计行，也不产生孤立快照。
	c, _ = newArkAssetContext(t, "GetAsset", 1, map[string]any{"Id": "asset-missing"})
	c.Set(common.RequestIdKey, "req-ark-query-off")
	RelayArkAssetAction(c)
	time.Sleep(50 * time.Millisecond)
	_, ok, err := model.GetLogBodyByRequestId("req-ark-query-off")
	require.NoError(t, err)
	assert.False(t, ok)
}

func TestArkVideoTaskListWritesBodySnapshot(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Task{}, &model.Log{}, &model.LogBody{}))
	require.NoError(t, db.Create(&model.User{Id: 10, Username: "alice"}).Error)

	orig := common.LogQueryApiCallEnabled
	defer func() { common.LogQueryApiCallEnabled = orig }()
	common.LogQueryApiCallEnabled = true

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v3/contents/generations/tasks?page_num=1&page_size=3", nil)
	c.Set("id", 10)
	c.Set(common.RequestIdKey, "req-task-list")
	ArkVideoTaskList(c)
	require.Equal(t, http.StatusOK, recorder.Code)

	// 无 body 的 GET：传入参数回退「方法 路径?查询」，响应为官方列表信封。
	body := requireLogBody(t, "req-task-list")
	assert.Contains(t, body.RequestData, "GET /api/v3/contents/generations/tasks?page_num=1&page_size=3")
	assert.Contains(t, body.ResponseData, "items")
}

func TestArkVideoTaskDeleteWritesBodySnapshot(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Task{}, &model.Log{}, &model.LogBody{}))
	require.NoError(t, db.Create(&model.User{Id: 10, Username: "alice"}).Error)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodDelete, "/api/v3/contents/generations/tasks/cgt-missing", nil)
	c.Params = gin.Params{{Key: "task_id", Value: "cgt-missing"}}
	c.Set("id", 10)
	c.Set(common.RequestIdKey, "req-task-delete")
	ArkVideoTaskDelete(c)
	require.Equal(t, http.StatusNotFound, recorder.Code)

	// 写类接口不受查询开关影响：删除不存在任务的错误响应同样落快照。
	body := requireLogBody(t, "req-task-delete")
	assert.Contains(t, body.RequestData, "DELETE /api/v3/contents/generations/tasks/cgt-missing")
	assert.Contains(t, body.ResponseData, "cgt-missing")
}
