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
// gin.Context，供代理商自助接口使用（建码/改码的归属校验、给成员设折扣时的
// 授权清单与折扣下限）。
//
// 代理商不是系统角色，鉴权走独立的 agents 表，不改 Casbin schema；
// 与 role 无任何交集，普通用户被提升后即可访问 /api/agent 自助接口。
//
// 注意：Disabled 只冻结代理商自己的控制台（这里直接 403），不影响其成员的
// 模型访问——成员是付过费的终端用户，不应因代理被禁用而断服。
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
		// agent_id 是 agents 表主键，也是其成员的 users.agent_id；
		// agent_model_discounts 存原始 JSON（{模型名: 折扣下限}），
		// 由 controller 按需解析。两者一律以服务端记录为准，忽略客户端传入值。
		c.Set("agent_id", agent.Id)
		c.Set("agent_model_discounts", agent.ModelDiscounts)
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
