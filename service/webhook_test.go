package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSendWebhookNotifyPayloadAndSignature 钉住对外文档化的推送协议：
// POST + application/json，content 按序替换 {{value}} 占位符（不得残留占位符或
// fmt 动词垃圾串），配置 secret 时携带 X-Webhook-Signature 与 Bearer 凭证。
func TestSendWebhookNotifyPayloadAndSignature(t *testing.T) {
	fetchSetting := system_setting.GetFetchSetting()
	original := *fetchSetting
	fetchSetting.EnableSSRFProtection = false
	t.Cleanup(func() { *fetchSetting = original })
	// 测试进程不走 main 初始化，这里补齐发送用的 http.Client
	InitHttpClient()

	var gotMethod, gotContentType, gotBody, gotSignature, gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		gotMethod = r.Method
		gotContentType = r.Header.Get("Content-Type")
		gotBody = string(body)
		gotSignature = r.Header.Get("X-Webhook-Signature")
		gotAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)

	notify := dto.NewNotify(dto.NotifyTypeQuotaExceed, "Organization ACME quota pool running low",
		"Organization {{value}} has {{value}} left.", []interface{}{"ACME", "$1.08"})
	require.NoError(t, SendWebhookNotify(server.URL, "secret", notify))

	require.Equal(t, http.MethodPost, gotMethod)
	require.Equal(t, "application/json", gotContentType)

	var payload WebhookPayload
	require.NoError(t, common.UnmarshalJsonStr(gotBody, &payload))
	assert.Equal(t, dto.NotifyTypeQuotaExceed, payload.Type)
	assert.Equal(t, "Organization ACME quota pool running low", payload.Title)
	assert.Equal(t, "Organization ACME has $1.08 left.", payload.Content)
	assert.NotContains(t, payload.Content, dto.ContentValueParam)
	assert.NotContains(t, payload.Content, "%!(EXTRA")
	assert.Equal(t, []interface{}{"ACME", "$1.08"}, payload.Values)
	assert.Greater(t, payload.Timestamp, int64(0))

	mac := hmac.New(sha256.New, []byte("secret"))
	mac.Write([]byte(gotBody))
	assert.Equal(t, hex.EncodeToString(mac.Sum(nil)), gotSignature)
	assert.Equal(t, "Bearer secret", gotAuth)
}
