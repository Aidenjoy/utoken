package databuilder

import (
	"net/http"
	"strings"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTaskBaseURLNormalization(t *testing.T) {
	want := "http://databuilder.bd.baidubce.com/db-ms/seedance/api/v3"
	for _, base := range []string{
		"",
		"http://databuilder.bd.baidubce.com",
		"http://databuilder.bd.baidubce.com/",
		"http://databuilder.bd.baidubce.com/db-ms/seedance",
		want,
	} {
		assert.Equal(t, want, TaskBaseURL(base), "base=%q", base)
	}
}

func TestMaterialBaseURLNormalization(t *testing.T) {
	want := "http://databuilder.bd.baidubce.com/db-ms/seedance/material"
	for _, base := range []string{
		"",
		"http://databuilder.bd.baidubce.com",
		"http://databuilder.bd.baidubce.com/db-ms/seedance",
		"http://databuilder.bd.baidubce.com/db-ms/seedance/api/v3",
		want,
		want + "/",
	} {
		assert.Equal(t, want, MaterialBaseURL(base), "base=%q", base)
	}
}

func TestExtractTaskID(t *testing.T) {
	tests := []struct {
		name string
		body string
		want string
	}{
		{"top-level id", `{"id":"cgt-2026","status":"queued"}`, "cgt-2026"},
		{"top-level task_id", `{"task_id":"t-1"}`, "t-1"},
		{"camelCase taskId", `{"taskId":"t-2"}`, "t-2"},
		{"data wrapper", `{"data":{"id":"t-3"}}`, "t-3"},
		{"result wrapper", `{"result":{"task_id":"t-4"}}`, "t-4"},
		{"numeric id", `{"id":12345}`, "12345"},
		{"missing", `{"status":"ok"}`, ""},
		{"null wrapper", `{"data":null,"result":null}`, ""},
		{"non-object wrapper", `{"data":5}`, ""},
		{"invalid json", `not-json`, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, extractTaskID([]byte(tt.body)))
		})
	}
}

// newAdaptor 构造已 Init 的适配器（ApiKey/ChannelBaseUrl 是 ChannelMeta 提升字段）。
func newAdaptor(baseURL, apiKey string) *TaskAdaptor {
	a := &TaskAdaptor{}
	a.Init(&relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
		ChannelBaseUrl: baseURL,
		ApiKey:         apiKey,
	}})
	return a
}

func TestBuildRequestURL(t *testing.T) {
	a := newAdaptor("", "ak|sk")
	uri, err := a.BuildRequestURL(nil)
	require.NoError(t, err)
	assert.Equal(t, "http://databuilder.bd.baidubce.com/db-ms/seedance/api/v3/contents/generations/tasks", uri)
}

func TestBuildRequestHeaderSigns(t *testing.T) {
	a := newAdaptor("", "test-ak|test-sk")

	req, err := http.NewRequest(http.MethodPost,
		"http://databuilder.bd.baidubce.com/db-ms/seedance/api/v3/contents/generations/tasks", nil)
	require.NoError(t, err)
	require.NoError(t, a.BuildRequestHeader(nil, req, nil))

	auth := req.Header.Get("Authorization")
	assert.True(t, strings.HasPrefix(auth, "bce-auth-v1/test-ak/"), "got %q", auth)
	assert.Contains(t, auth, "/1800/host/")
	assert.Equal(t, "application/json; charset=utf-8", req.Header.Get("Content-Type"))
	assert.Equal(t, "bd", req.Header.Get("X-Region"))
	assert.Equal(t, "api-gateway", req.Header.Get("X-Via"))
	assert.NotEmpty(t, req.Header.Get("X-Bce-Request-Id"))
	assert.NotEmpty(t, req.Header.Get("X-Bce-Date"))
}

func TestBuildRequestHeaderRejectsPlainKey(t *testing.T) {
	a := newAdaptor("", "plain-bearer-key")

	req, err := http.NewRequest(http.MethodPost, "http://example.com/tasks", nil)
	require.NoError(t, err)
	err = a.BuildRequestHeader(nil, req, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "expected 'ak|sk'")
}

func TestFetchTaskRejectsInvalidKey(t *testing.T) {
	a := &TaskAdaptor{}
	_, err := a.FetchTask("", "no-separator", map[string]any{"task_id": "t-1"}, "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "expected 'ak|sk'")
}
