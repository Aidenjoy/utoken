package common

import (
	"bytes"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"time"
)

// NotifyYunControlPasswordChanged 在密码已提交后异步通知；不发送密码，失败不回滚改密。
// 每次事件固定毫秒时间，有限重试保持幂等；进程退出后不保证补投。
func NotifyYunControlPasswordChanged(userID int) {
	endpoint := os.Getenv("YUNCONTROL_REVOKE_URL")
	secret := os.Getenv("YUNCONTROL_REVOKE_SECRET")
	if endpoint == "" {
		return
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || len(secret) < 32 {
		SysLog("YunControl password notification configuration is invalid")
		return
	}
	changedAt := time.Now().UnixMilli()
	go func() {
		body, err := Marshal(struct {
			UserID    int   `json:"userId"`
			ChangedAt int64 `json:"changedAt"`
		}{userID, changedAt})
		if err != nil {
			SysLog("YunControl password notification encoding failed")
			return
		}
		transport := http.DefaultTransport.(*http.Transport).Clone()
		transport.Proxy = nil
		defer transport.CloseIdleConnections()
		client := &http.Client{Timeout: 3 * time.Second, Transport: transport, CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
		for attempt := 0; attempt < 3; attempt++ {
			if attempt > 0 {
				time.Sleep(time.Duration(attempt) * time.Second)
			}
			req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
			if err != nil {
				break
			}
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Auth-Secret", secret)
			resp, err := client.Do(req)
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode >= 200 && resp.StatusCode < 300 {
					return
				}
				if resp.StatusCode >= 400 && resp.StatusCode < 500 {
					break
				}
			}
		}
		SysLog(fmt.Sprintf("YunControl password notification failed user_id=%d", userID))
	}()
}
