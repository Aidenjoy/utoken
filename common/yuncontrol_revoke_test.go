package common

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// TestYunControlPasswordNotification 验证异步通知的认证头及稳定重试事件，不修改真实密码。
func TestYunControlPasswordNotification(t *testing.T) {
	received := make(chan []byte, 3)
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("X-Auth-Secret") != "test-secret-123456789012345678901234567890" {
			t.Error("invalid notification request")
		}
		body, _ := io.ReadAll(r.Body)
		calls++
		received <- body
		if calls == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	t.Setenv("YUNCONTROL_REVOKE_URL", server.URL)
	t.Setenv("YUNCONTROL_REVOKE_SECRET", "test-secret-123456789012345678901234567890")
	NotifyYunControlPasswordChanged(123)
	var first []byte
	for i := 0; i < 2; i++ {
		select {
		case body := <-received:
			if i == 0 {
				first = body
			} else if string(body) != string(first) {
				t.Error("retry changed event timestamp")
			}
			var event struct {
				UserID    int   `json:"userId"`
				ChangedAt int64 `json:"changedAt"`
			}
			if err := Unmarshal(body, &event); err != nil || event.UserID != 123 || event.ChangedAt <= 0 {
				t.Error("invalid event body")
			}
		case <-time.After(5 * time.Second):
			t.Fatal("notification not received")
		}
	}
}
