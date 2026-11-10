package controller

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 本文件锁定「API 调用审计日志」的控制器接线契约：
// 素材库 10 个 Action 在鉴权通过后，无论成功失败都要落审计日志（quota=0）：
// 写类 type=LogTypeApiCall 同步落库，查询类 type=LogTypeApiQuery 入队缓冲、
// 冲刷后落库；查询类受 LogQueryApiCallEnabled 开关门控，写类始终记录。
// 视频任务创建/查询/列表/删除不落 API 审计（由任务日志覆盖，避免重复）。
// 落库字段口径与开关/缓冲行为的模型层契约见 model/log_api_call_test.go。

func countApiCallAuditLogsByType(t *testing.T, logType int) int64 {
	t.Helper()
	var n int64
	require.NoError(t, model.LOG_DB.Model(&model.Log{}).Where("type = ?", logType).Count(&n).Error)
	return n
}

func TestRelayArkAssetActionAuditLog(t *testing.T) {
	db := setupArkAssetControllerDB(t)
	require.NoError(t, db.AutoMigrate(&model.Log{}, &model.User{}))
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "alice"}).Error)

	orig := common.LogQueryApiCallEnabled
	defer func() { common.LogQueryApiCallEnabled = orig }()

	// 查询类 Action 开关开启：成功调用入队，冲刷后落一条 type=9 日志，字段完整。
	common.LogQueryApiCallEnabled = true
	c, rec := newArkAssetContext(t, "ListAssets", 1, map[string]any{
		"Filter": map[string]any{"GroupType": "AIGC"}, "ProjectName": "default",
	})
	RelayArkAssetAction(c)
	require.Equal(t, http.StatusOK, rec.Code)
	model.FlushApiCallLogBuffer()
	require.Equal(t, int64(1), countApiCallAuditLogsByType(t, model.LogTypeApiQuery))

	var log model.Log
	require.NoError(t, model.LOG_DB.Where("type = ?", model.LogTypeApiQuery).First(&log).Error)
	assert.Equal(t, "ListAssets", log.ModelName)
	assert.Equal(t, 1, log.UserId)
	assert.Equal(t, "alice", log.Username)
	assert.Equal(t, 0, log.Quota)
	assert.Contains(t, log.Other, `"api":"ark_asset"`)
	assert.Contains(t, log.Other, `"http_status":200`)

	// 查询类 Action 开关关闭：失败调用（404）也不记录。
	common.LogQueryApiCallEnabled = false
	c, rec = newArkAssetContext(t, "GetAsset", 1, map[string]any{"Id": "asset-missing"})
	RelayArkAssetAction(c)
	assert.Equal(t, http.StatusNotFound, rec.Code)
	model.FlushApiCallLogBuffer()
	assert.Equal(t, int64(1), countApiCallAuditLogsByType(t, model.LogTypeApiQuery))

	// 写类路径（无效 Action → 400）：开关关闭也同步记录，便于审计异常调用。
	c, rec = newArkAssetContext(t, "BogusAction", 1, nil)
	RelayArkAssetAction(c)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	require.Equal(t, int64(1), countApiCallAuditLogsByType(t, model.LogTypeApiCall))
	var bogus model.Log
	require.NoError(t, model.LOG_DB.Where("model_name = ?", "BogusAction").First(&bogus).Error)
	assert.Contains(t, bogus.Other, `"http_status":400`)
}
