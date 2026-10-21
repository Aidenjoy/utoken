package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSaveAndGetLogBody 锁定使用日志请求/返回体快照的存取往返：SaveLogBody 落库后
// GetLogBodyByRequestId 能按 request_id 原样取回两侧文本，且 CreatedAt 被写入。
func TestSaveAndGetLogBody(t *testing.T) {
	truncateTables(t)

	req := []byte(`{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`)
	resp := []byte(`{"choices":[{"message":{"content":"hello"}}]}`)
	require.NoError(t, SaveLogBody("req-roundtrip", req, resp))

	body, ok, err := GetLogBodyByRequestId("req-roundtrip")
	require.NoError(t, err)
	require.True(t, ok)
	require.NotNil(t, body)
	assert.Equal(t, "req-roundtrip", body.RequestId)
	assert.Equal(t, string(req), body.RequestData)
	assert.Equal(t, string(resp), body.ResponseData)
	assert.Greater(t, body.CreatedAt, int64(0))
}

// TestSaveLogBodySkipsEmpty 锁定跳过硬边界：requestId 为空、或两侧皆空时直接返回 nil
// 且不落库（不产生空行，也不因缺 request_id 触发唯一索引冲突）；单侧非空仍应保留。
func TestSaveLogBodySkipsEmpty(t *testing.T) {
	truncateTables(t)

	// requestId 为空 → 跳过
	require.NoError(t, SaveLogBody("", []byte("req"), []byte("resp")))
	_, ok, err := GetLogBodyByRequestId("")
	require.NoError(t, err)
	assert.False(t, ok)

	// 两侧皆空 → 跳过（即使 requestId 非空）
	require.NoError(t, SaveLogBody("req-empty", nil, nil))
	_, ok, err = GetLogBodyByRequestId("req-empty")
	require.NoError(t, err)
	assert.False(t, ok)

	// 单侧非空 → 落库（返回体为空也应保留请求体）
	require.NoError(t, SaveLogBody("req-only", []byte("req"), nil))
	body, ok, err := GetLogBodyByRequestId("req-only")
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, "req", body.RequestData)
	assert.Empty(t, body.ResponseData)
}

// TestSaveLogBodyDuplicateRequestIdIdempotent 锁定幂等防重：同一 request_id 重复写入
// 不报错（OnConflict DoNothing），且只保留第一条内容——重试不会覆盖已有快照。
func TestSaveLogBodyDuplicateRequestIdIdempotent(t *testing.T) {
	truncateTables(t)

	require.NoError(t, SaveLogBody("req-dup", []byte("first-req"), []byte("first-resp")))
	// 重复写入同一 request_id：不报错，且不覆盖第一条
	require.NoError(t, SaveLogBody("req-dup", []byte("second-req"), []byte("second-resp")))

	body, ok, err := GetLogBodyByRequestId("req-dup")
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, "first-req", body.RequestData)
	assert.Equal(t, "first-resp", body.ResponseData)

	// 唯一索引保证只有一行
	var count int64
	require.NoError(t, DB.Model(&LogBody{}).Where("request_id = ?", "req-dup").Count(&count).Error)
	assert.Equal(t, int64(1), count)
}

// TestGetLogBodyByRequestIdMissing 锁定未命中语义：不存在的 request_id 返回
// (nil, false, nil)——历史日志无快照时详情接口据此回空，而非报错。
func TestGetLogBodyByRequestIdMissing(t *testing.T) {
	truncateTables(t)

	body, ok, err := GetLogBodyByRequestId("does-not-exist")
	require.NoError(t, err)
	assert.False(t, ok)
	assert.Nil(t, body)
}

// TestGetLogUserIdByRequestId 锁定 bodies 接口鉴权所依赖的归属查询：命中返回该日志行的
// user_id 与 true；空 requestId 或未命中返回 (0, false, nil)（handler 据此回 404）。
func TestGetLogUserIdByRequestId(t *testing.T) {
	truncateTables(t)

	require.NoError(t, DB.Create(&Log{UserId: 42, RequestId: "req-owner", Type: LogTypeConsume}).Error)

	userId, found, err := GetLogUserIdByRequestId("req-owner")
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, 42, userId)

	// 未命中
	userId, found, err = GetLogUserIdByRequestId("nope")
	require.NoError(t, err)
	assert.False(t, found)
	assert.Equal(t, 0, userId)

	// 空 requestId
	userId, found, err = GetLogUserIdByRequestId("")
	require.NoError(t, err)
	assert.False(t, found)
	assert.Equal(t, 0, userId)
}
