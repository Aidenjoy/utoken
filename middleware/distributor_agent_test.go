package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newAgentAllowlistContext 构造带代理商授权上下文的 gin.Context。
//
// 只写上下文、不落库：白名单的判定完全基于 user_cache 写入的两个快照键
// （agent_id + allowed_models JSON），这正是运行时 Distribute 拿到的东西。
// 因此这里不需要 Agent 表，也就不会因为夹具数据把测试与 model 层耦合起来。
func newAgentAllowlistContext(t *testing.T, agentId int, allowedModelsJSON string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	require.NoError(t, i18n.Init())
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	common.SetContextKey(c, constant.ContextKeyUserAgentId, agentId)
	common.SetContextKey(c, constant.ContextKeyUserAllowedModels, allowedModelsJSON)
	return c, w
}

// TestAgentModelForbidden 覆盖代理商授权模型白名单的四条分支：
// 无归属放行、授权命中放行、未授权 403、快照缺失 fail-open。
func TestAgentModelForbidden(t *testing.T) {
	const authorized = `["gpt-4o","claude-3-5-sonnet"]`

	t.Run("user without agent is unrestricted", func(t *testing.T) {
		// agent_id=0 时即便上下文里残留了清单也不生效：解绑后的用户不该再受旧白名单约束。
		c, _ := newAgentAllowlistContext(t, 0, authorized)
		assert.False(t, agentModelForbidden(c, "gpt-4o-mini"))
		assert.False(t, c.IsAborted())
	})

	t.Run("negative agent id is unrestricted", func(t *testing.T) {
		c, _ := newAgentAllowlistContext(t, -1, authorized)
		assert.False(t, agentModelForbidden(c, "anything"))
		assert.False(t, c.IsAborted())
	})

	t.Run("authorized model passes", func(t *testing.T) {
		c, _ := newAgentAllowlistContext(t, 7, authorized)
		assert.False(t, agentModelForbidden(c, "gpt-4o"))
		assert.False(t, agentModelForbidden(c, "claude-3-5-sonnet"))
		assert.False(t, c.IsAborted())
	})

	t.Run("normalized variant of an authorized family passes", func(t *testing.T) {
		c, _ := newAgentAllowlistContext(t, 7, `["gpt-4-gizmo-*"]`)
		assert.False(t, agentModelForbidden(c, "gpt-4-gizmo-g-abc123"))
		assert.False(t, c.IsAborted())
	})

	t.Run("unauthorized model is rejected with 403", func(t *testing.T) {
		c, w := newAgentAllowlistContext(t, 7, authorized)
		assert.True(t, agentModelForbidden(c, "gpt-4o-mini"))
		assert.True(t, c.IsAborted(), "the request must not reach channel selection")
		assert.Equal(t, http.StatusForbidden, w.Code)
		assert.Contains(t, w.Body.String(), string(types.ErrorCodeModelNotFound))
		assert.Contains(t, w.Body.String(), "gpt-4o-mini", "the offending model is named in the error")
	})

	t.Run("empty model name passes", func(t *testing.T) {
		// mj/suno 的任务查询类请求模型名未必在请求体里，按空名拒绝会误伤这些接口。
		c, _ := newAgentAllowlistContext(t, 7, authorized)
		assert.False(t, agentModelForbidden(c, ""))
		assert.False(t, c.IsAborted())
	})

	t.Run("missing allowlist snapshot fails open", func(t *testing.T) {
		// 代理行缺失或配置损坏时放行：拒绝会让一处配置异常放大成该代理商全部成员断服。
		for _, snapshot := range []string{"", "   ", "[broken", "[]"} {
			c, w := newAgentAllowlistContext(t, 7, snapshot)
			assert.False(t, agentModelForbidden(c, "any-model"), "snapshot %q must fail open", snapshot)
			assert.False(t, c.IsAborted())
			assert.Equal(t, http.StatusOK, w.Code, "no error body written on fail-open")
		}
	})
}
