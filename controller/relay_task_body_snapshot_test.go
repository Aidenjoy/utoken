package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestRelayTaskFailureWritesProtocolSnapshot 从 RelayTask 入口验证：task 请求失败时，
// 错误日志所带的 request_id 必须能取到用户原始请求，不再出现「详情有错误、协议详情
// 为空」。响应快照刻意为空：当次上游响应已保存在各错误行的 content 中，前端按行展示，
// 避免同一 request_id 重试多个渠道时共享响应造成串渠道展示。
func TestRelayTaskFailureWritesProtocolSnapshot(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.LogBody{}))

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/video/generations", strings.NewReader(`{"prompt":"attack probe","model":"doubao-seedance-2.0"}`))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(common.RequestIdKey, "req-task-relay-failure")
	c.Set("id", 208)

	RelayTask(c)

	require.GreaterOrEqual(t, w.Code, http.StatusBadRequest)
	require.Eventually(t, func() bool {
		_, ok, err := model.GetLogBodyByRequestId("req-task-relay-failure")
		return err == nil && ok
	}, time.Second, 10*time.Millisecond)
	body, ok, err := model.GetLogBodyByRequestId("req-task-relay-failure")
	require.NoError(t, err)
	require.True(t, ok)
	assert.Contains(t, body.RequestData, "attack probe")
	assert.Empty(t, body.ResponseData)
}
