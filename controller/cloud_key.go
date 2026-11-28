package controller

import (
	"crypto/hmac"
	"errors"
	"net/http"
	"os"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// YuncontrolCloudKey 仅向持有独立共享密钥的 yuncontrol Server 下发专用语言 Key。
func YuncontrolCloudKey(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	secret := os.Getenv("YUNCONTROL_CLOUD_KEY_SECRET")
	if len(secret) < 32 {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "cloud_key_not_configured"})
		return
	}
	if !hmac.Equal([]byte(c.GetHeader("X-Cloud-Key-Secret")), []byte(secret)) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_cloud_key_credential"})
		return
	}
	var payload struct {
		UserID int `json:"user_id"`
	}
	if c.ContentType() != "application/json" || common.DecodeJson(c.Request.Body, &payload) != nil || payload.UserID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_request"})
		return
	}
	languageKey, err := model.GetOrCreateDesktopLanguageKey(payload.UserID, model.GetDBTimestamp())
	if errors.Is(err, model.ErrDesktopCredentialInvalid) {
		c.JSON(http.StatusNotFound, gin.H{"error": "user_not_found"})
		return
	}
	if err != nil || languageKey.Key == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "server_error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"language_api_key": "sk-" + languageKey.Key})
}
