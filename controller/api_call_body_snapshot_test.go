package controller

import (
	"net/http"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 本文件锁定「非计费 API 调用端点协议详情快照」契约：素材库 Action 不经 Relay()
// 入口，请求/响应必须旁路捕获落 log_bodies，并与审计行同 request_id 关联（否则
// 使用日志协议详情恒为空）；查询类接口与审计行共用 LogQueryApiCallEnabled 开关，
// 开关关闭时不产生孤立快照。视频任务列表/查询/删除不落 API 审计快照（由任务日志覆盖）。

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
