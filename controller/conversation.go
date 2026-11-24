package controller

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ConversationAuth reuses dashboard Cookie validation when present; otherwise
// accepts only the existing desktop credential, never relay or management keys.
func ConversationAuth(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if c.GetBool("use_access_token") {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "message": "invalid_token"})
		return
	}
	if c.GetInt("id") <= 0 {
		user := desktopAuthenticatedUser(c, false)
		if user == nil {
			c.Abort()
			return
		}
		c.Set("id", user.Id)
	}
	c.Next()
}

// ListConversationHistory returns owner-scoped metadata without touching relay.
func ListConversationHistory(c *gin.Context) {
	offset, err := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if err != nil || offset < 0 || offset > 1000000 {
		conversationError(c, model.ErrConversationInput)
		return
	}
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "30"))
	if err != nil || limit < 1 || limit > 100 {
		conversationError(c, model.ErrConversationInput)
		return
	}
	items, err := model.ListConversations(c.GetInt("id"), offset, limit+1)
	if err != nil {
		conversationError(c, err)
		return
	}
	more := len(items) > limit
	if more {
		items = items[:limit]
	}
	common.ApiSuccess(c, gin.H{"items": items, "has_more": more})
}

// GetConversationHistory returns one bounded message page in ascending order.
func GetConversationHistory(c *gin.Context) {
	before, err := strconv.ParseInt(c.DefaultQuery("before", "0"), 10, 64)
	if err != nil || before < 0 {
		conversationError(c, model.ErrConversationInput)
		return
	}
	revision, err := strconv.ParseInt(c.DefaultQuery("revision", "-1"), 10, 64)
	if err != nil || revision < -1 {
		conversationError(c, model.ErrConversationInput)
		return
	}
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if err != nil || limit < 1 || limit > 100 {
		conversationError(c, model.ErrConversationInput)
		return
	}
	page, err := model.ReadConversationMessages(c.GetInt("id"), c.Param("id"), before, revision, limit)
	if err != nil {
		conversationError(c, err)
		return
	}
	common.ApiSuccess(c, page)
}

// SaveConversationHistory saves a revisioned patch independently of model billing.
func SaveConversationHistory(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2*1024*1024)
	var change model.ConversationChange
	if err := common.DecodeJson(c.Request.Body, &change); err != nil {
		conversationError(c, model.ErrConversationInput)
		return
	}
	conversation, err := model.SaveConversation(c.GetInt("id"), c.Param("id"), &change)
	if err != nil {
		conversationError(c, err)
		return
	}
	common.SysLog(fmt.Sprintf("history saved user=%d conversation=%q revision=%d changed=%d deleted=%d request=%q", c.GetInt("id"), conversation.ID, conversation.Revision, len(change.Messages), len(change.DeletedIDs), c.GetString(common.RequestIdKey)))
	common.ApiSuccess(c, conversation)
}

// conversationError distinguishes ownership/validation/conflict from DB failures;
// logs contain correlation keys, never message text or credentials.
func conversationError(c *gin.Context, err error) {
	status, code := http.StatusInternalServerError, "history_unavailable"
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		status, code = http.StatusNotFound, "history_not_found"
	case errors.Is(err, model.ErrConversationInput):
		status, code = http.StatusBadRequest, "history_invalid"
	case errors.Is(err, model.ErrConversationConflict):
		status, code = http.StatusConflict, "history_conflict"
	default:
		common.SysError(fmt.Sprintf("history operation failed user=%d conversation=%q request=%q: %v", c.GetInt("id"), c.Param("id"), c.GetString(common.RequestIdKey), err))
	}
	c.JSON(status, gin.H{"success": false, "message": code})
}
