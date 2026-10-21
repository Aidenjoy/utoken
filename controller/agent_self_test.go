package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

// newAgentScopeContext 构造一个仅带 user_ids 查询串的 gin.Context，
// 用于直接驱动 effectiveScopeIds 的交集逻辑。
func newAgentScopeContext(userIds string) *gin.Context {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	target := "/api/agent/logs"
	if userIds != "" {
		target += "?user_ids=" + userIds
	}
	c.Request = httptest.NewRequest(http.MethodGet, target, nil)
	return c
}

// TestEffectiveScopeIds 锁定代理商范围交集的安全语义：
//   - 缺省 / "all" → 返回全部 allowedIds（整个可见范围）；
//   - 明确 id → 与 allowedIds 取交集，越权 id 被剔除；
//   - 全部越权或无合法 id → 返回空（调用方必须回空结果，绝不回退全量）。
func TestEffectiveScopeIds(t *testing.T) {
	allowed := []int{1, 2, 3}

	tests := []struct {
		name    string
		userIds string
		want    []int
	}{
		{"unset returns full allowed range", "", []int{1, 2, 3}},
		{"explicit all returns full allowed range", "all", []int{1, 2, 3}},
		{"ALL is case-insensitive", "ALL", []int{1, 2, 3}},
		{"subset intersection", "1,3", []int{1, 3}},
		{"overreach id is dropped", "2,99", []int{2}},
		{"all overreach yields empty", "98,99", nil},
		{"garbage yields empty", "abc", nil},
		{"non-positive ids are ignored", "0,-1", nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := newAgentScopeContext(tt.userIds)
			got := effectiveScopeIds(c, allowed)
			if tt.want == nil {
				assert.Empty(t, got)
				return
			}
			assert.ElementsMatch(t, tt.want, got)
		})
	}
}

// TestAgentBillingFilterForcesScopes 锁定代理商账单过滤器：用户维度限定为
// effectiveIds（为空则 None → 空结果），企业维度恒为 None（代理商不管理企业）。
func TestAgentBillingFilterForcesScopes(t *testing.T) {
	c := newAgentScopeContext("")

	// 非空范围 → Ids 模式，orgScope 恒 None
	f := agentBillingFilter(c, []int{5, 6})
	assert.Equal(t, model.BillingScopeIds, f.userScope.Mode)
	assert.ElementsMatch(t, []int{5, 6}, f.userScope.Ids)
	assert.Equal(t, model.BillingScopeNone, f.orgScope.Mode)
	assert.Empty(t, f.orgScope.Ids)

	// 空范围 → userScope 落到 None（空结果），绝不回退全量
	f = agentBillingFilter(c, nil)
	assert.Equal(t, model.BillingScopeNone, f.userScope.Mode)
	assert.Empty(t, f.userScope.Ids)
}
