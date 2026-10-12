package middleware

import (
	"errors"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// AgentAuth 代理商鉴权：置于 UserAuth 之后，按当前登录用户查 agents 表。
// 用户未被提升为代理商、或代理商被禁用时返回 403。成功后把代理商上下文写入
// gin.Context，供代理商自助接口（建码/改码时强制折扣范围与归属校验）使用。
//
// 代理商不是系统角色，鉴权走独立的 agents 表，不改 Casbin schema；
// 与 role 无任何交集，普通用户被提升后即可访问 /api/agent 自助接口。
func AgentAuth() func(c *gin.Context) {
	return func(c *gin.Context) {
		agent, err := model.GetAgentByUserId(c.GetInt("id"))
		if err != nil {
			if errors.Is(err, model.ErrAgentNotFound) {
				abortWithAgentForbidden(c, i18n.MsgAgentNotFound)
			} else {
				common.ApiErrorI18n(c, i18n.MsgDatabaseError)
				c.Abort()
			}
			return
		}
		if agent.Status != model.AgentStatusEnabled {
			abortWithAgentForbidden(c, i18n.MsgAgentDisabled)
			return
		}
		c.Set("agent_id", agent.Id)
		c.Set("agent_min_discount", agent.MinDiscount)
		c.Set("agent_max_discount", agent.MaxDiscount)
		c.Next()
	}
}

func abortWithAgentForbidden(c *gin.Context, key string) {
	c.JSON(http.StatusForbidden, gin.H{
		"success": false,
		"message": common.TranslateMessage(c, key),
	})
	c.Abort()
}
