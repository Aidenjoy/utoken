package model

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newApiCallTestContext 构造带令牌鉴权上下文键的 gin 测试上下文。
// username 为空时模拟 Ark 素材库 AK/SK 鉴权（中间件不写 username）。
func newApiCallTestContext(username string) *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/?Action=ListAssets", nil)
	c.Set("id", 1)
	if username != "" {
		c.Set("username", username)
	}
	return c
}

func countApiCallLogsByType(t *testing.T, logType int) int64 {
	t.Helper()
	var count int64
	require.NoError(t, LOG_DB.Model(&Log{}).Where("type = ?", logType).Count(&count).Error)
	return count
}

// TestRecordApiCallLogQuerySwitch 锁定 API 调用审计日志的开关与缓冲契约：
// 写类调用（IsQuery=false）无论开关如何都同步落库（type=LogTypeApiCall）；
// 查询类调用仅在 LogQueryApiCallEnabled 开启时入队，且冲刷后才落库
// （type=LogTypeApiQuery）——这是「轮询高频写缓冲批量落库 + 一键关闭」
// 方案的核心行为边界。
func TestRecordApiCallLogQuerySwitch(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.Create(&User{Id: 1, Username: "alice"}).Error)

	orig := common.LogQueryApiCallEnabled
	defer func() { common.LogQueryApiCallEnabled = orig }()

	params := func(isQuery bool) RecordApiCallLogParams {
		return RecordApiCallLogParams{
			ModelName: "ListAssets",
			Content:   "素材库接口 ListAssets 调用，状态码 200",
			TokenName: "tok",
			TokenId:   7,
			IsQuery:   isQuery,
			Other:     map[string]interface{}{"action": "ListAssets", "http_status": 200},
		}
	}

	// 开关关闭：写类仍记录，查询类被跳过（冲刷也不产生行）。
	common.LogQueryApiCallEnabled = false
	RecordApiCallLog(newApiCallTestContext("alice"), 1, params(false))
	RecordApiCallLog(newApiCallTestContext("alice"), 1, params(true))
	FlushApiCallLogBuffer()
	assert.Equal(t, int64(1), countApiCallLogsByType(t, LogTypeApiCall))
	assert.Equal(t, int64(0), countApiCallLogsByType(t, LogTypeApiQuery))

	// 开关开启：查询类先入队（落库前不可见），冲刷后以 type=9 批量落库。
	common.LogQueryApiCallEnabled = true
	RecordApiCallLog(newApiCallTestContext("alice"), 1, params(true))
	assert.Equal(t, int64(0), countApiCallLogsByType(t, LogTypeApiQuery))
	FlushApiCallLogBuffer()
	assert.Equal(t, int64(1), countApiCallLogsByType(t, LogTypeApiQuery))
	assert.Equal(t, int64(1), countApiCallLogsByType(t, LogTypeApiCall))
}

// TestApiCallLogBufferBatchFlush 锁定缓冲批量落库契约：多条查询类日志入队后
// 一次冲刷全部落库，且队列被清空（二次冲刷不重复写入）。
func TestApiCallLogBufferBatchFlush(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.Create(&User{Id: 1, Username: "alice"}).Error)

	orig := common.LogQueryApiCallEnabled
	defer func() { common.LogQueryApiCallEnabled = orig }()
	common.LogQueryApiCallEnabled = true

	for i := 0; i < 3; i++ {
		RecordApiCallLog(newApiCallTestContext("alice"), 1, RecordApiCallLogParams{
			ModelName: "ListAssets",
			Content:   "素材库接口 ListAssets 调用，状态码 200",
			IsQuery:   true,
		})
	}
	require.Equal(t, int64(0), countApiCallLogsByType(t, LogTypeApiQuery))

	FlushApiCallLogBuffer()
	assert.Equal(t, int64(3), countApiCallLogsByType(t, LogTypeApiQuery))

	FlushApiCallLogBuffer()
	assert.Equal(t, int64(3), countApiCallLogsByType(t, LogTypeApiQuery))
}

// TestGetAllLogsShowsAllTypesByDefault 锁定列表默认可见性契约：未显式选型时返回
// 全部类型（含素材库写类 type=8 与查询类 type=9），不再隐藏任何类型；
// 显式选型时只返回所选类型。
func TestGetAllLogsShowsAllTypesByDefault(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.Create(&User{Id: 1, Username: "alice"}).Error)
	require.NoError(t, LOG_DB.Create(&Log{UserId: 1, Type: LogTypeConsume, Content: "consume"}).Error)
	require.NoError(t, LOG_DB.Create(&Log{UserId: 1, Type: LogTypeApiCall, Content: "write"}).Error)
	require.NoError(t, LOG_DB.Create(&Log{UserId: 1, Type: LogTypeApiQuery, Content: "poll"}).Error)

	logs, total, err := GetAllLogs(LogTypeUnknown, 0, 0, "", "", "", 0, 10, 0, "", "", "", "", "")
	require.NoError(t, err)
	assert.Equal(t, int64(3), total)
	gotTypes := make([]int, 0, len(logs))
	for _, l := range logs {
		gotTypes = append(gotTypes, l.Type)
	}
	assert.ElementsMatch(t, []int{LogTypeConsume, LogTypeApiCall, LogTypeApiQuery}, gotTypes)

	// 显式选型时只返回所选类型。
	logs, total, err = GetAllLogs(LogTypeApiQuery, 0, 0, "", "", "", 0, 10, 0, "", "", "", "", "")
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, logs, 1)
	assert.Equal(t, "poll", logs[0].Content)
}

// TestGetAllLogsStatusFilter 锁定通用日志「状态」筛选口径（与前端
// deriveCommonLogStatus 一致）：http_status>=400 或 type=5(错误) 归失败；
// 1xx-3xx 或非 API 行(type∉{0,5}) 归成功；type=0(未知) 两者都不纳入，仅在「全部」出现。
func TestGetAllLogsStatusFilter(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.Create(&User{Id: 1, Username: "alice"}).Error)
	rows := []*Log{
		{UserId: 1, Type: LogTypeApiCall, HttpStatus: 200, Content: "api-ok"},
		{UserId: 1, Type: LogTypeApiCall, HttpStatus: 502, Content: "api-bad"},
		{UserId: 1, Type: LogTypeError, HttpStatus: 0, Content: "err-log"},
		{UserId: 1, Type: LogTypeConsume, HttpStatus: 0, Content: "consume"},
		{UserId: 1, Type: LogTypeUnknown, HttpStatus: 0, Content: "unknown"},
	}
	for _, r := range rows {
		require.NoError(t, LOG_DB.Create(r).Error)
	}

	contents := func(status string) []string {
		logs, total, err := GetAllLogs(LogTypeUnknown, 0, 0, "", "", "", 0, 10, 0, "", "", "", "", status)
		require.NoError(t, err)
		require.Equal(t, int64(len(logs)), total)
		got := make([]string, 0, len(logs))
		for _, l := range logs {
			got = append(got, l.Content)
		}
		return got
	}

	assert.ElementsMatch(t, []string{"api-bad", "err-log"}, contents("error"))
	assert.ElementsMatch(t, []string{"api-ok", "consume"}, contents("success"))
	assert.ElementsMatch(t, []string{"api-ok", "api-bad", "err-log", "consume", "unknown"}, contents(""))
	assert.ElementsMatch(t, []string{"api-ok", "api-bad", "err-log", "consume", "unknown"}, contents("all"))
}

// TestRecordApiCallLogFields 锁定落库字段口径：查询类 type=9、quota=0（不污染消费统计），
// 上下文缺失 username 时回查用户表补齐（Ark AK/SK 鉴权路径）。
func TestRecordApiCallLogFields(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.Create(&User{Id: 1, Username: "alice"}).Error)

	orig := common.LogQueryApiCallEnabled
	defer func() { common.LogQueryApiCallEnabled = orig }()
	common.LogQueryApiCallEnabled = true

	// 不带 username 上下文：应回查用户表得到 alice。
	RecordApiCallLog(newApiCallTestContext(""), 1, RecordApiCallLogParams{
		ModelName:      "GetAsset",
		Content:        "素材库接口 GetAsset 调用，状态码 200",
		TokenName:      "tok",
		TokenId:        7,
		ChannelId:      3,
		UseTimeSeconds: 2,
		IsQuery:        true,
		Other:          map[string]interface{}{"action": "GetAsset"},
	})
	FlushApiCallLogBuffer()

	var log Log
	require.NoError(t, LOG_DB.Where("type = ?", LogTypeApiQuery).First(&log).Error)
	assert.Equal(t, 1, log.UserId)
	assert.Equal(t, "alice", log.Username)
	assert.Equal(t, "GetAsset", log.ModelName)
	assert.Equal(t, "tok", log.TokenName)
	assert.Equal(t, 7, log.TokenId)
	assert.Equal(t, 3, log.ChannelId)
	assert.Equal(t, 2, log.UseTime)
	assert.Equal(t, 0, log.Quota)
	assert.Contains(t, log.Other, `"action":"GetAsset"`)
}
