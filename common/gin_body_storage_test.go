package common

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newBodyStorageTestContext(body string) *gin.Context {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/pg/video/generations", strings.NewReader(body))
	c.Request.ContentLength = int64(len(body))
	return c
}

// TestReplaceBodyStorageSwapsContent 替换后：上下文缓存/Body/ContentLength 都指向
// 新内容，旧存储已关闭（防止泄漏），GetRequestBody 可反复读取。
func TestReplaceBodyStorageSwapsContent(t *testing.T) {
	c := newBodyStorageTestContext(`{"a":1}`)
	oldStorage, err := GetBodyStorage(c)
	require.NoError(t, err)

	newBody := []byte(`{"a":2,"b":"asset://up-1"}`)
	require.NoError(t, ReplaceBodyStorage(c, newBody))
	defer CleanupBodyStorage(c)

	// 上下文读到的是新内容，且可重复读取
	storage, err := GetBodyStorage(c)
	require.NoError(t, err)
	data, err := storage.Bytes()
	require.NoError(t, err)
	assert.Equal(t, newBody, data)
	data, err = storage.Bytes()
	require.NoError(t, err)
	assert.Equal(t, newBody, data)

	// Body 与 ContentLength 已同步更新，下游 ReadAll 拿到新内容
	assert.Equal(t, int64(len(newBody)), c.Request.ContentLength)
	downstream, err := io.ReadAll(c.Request.Body)
	require.NoError(t, err)
	assert.Equal(t, newBody, downstream)

	// 旧存储已关闭
	_, err = oldStorage.Bytes()
	assert.ErrorIs(t, err, ErrStorageClosed)
}

// TestReplaceBodyStorageWithoutPriorRead 未读过 body 时直接替换：原 Body 尚未
// 建存储，替换后一切以新内容为准，清理语义不变。
func TestReplaceBodyStorageWithoutPriorRead(t *testing.T) {
	c := newBodyStorageTestContext(`{"a":1}`)

	newBody := []byte(`{"rewritten":true}`)
	require.NoError(t, ReplaceBodyStorage(c, newBody))

	storage, err := GetBodyStorage(c)
	require.NoError(t, err)
	data, err := storage.Bytes()
	require.NoError(t, err)
	assert.Equal(t, newBody, data)

	CleanupBodyStorage(c)
	_, err = storage.Bytes()
	assert.ErrorIs(t, err, ErrStorageClosed, "Cleanup 关闭的应是替换后的当前存储")
}
