package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// seedRateOrganization 写一条带内部费率三件套的企业：token_rate/expected_discount/purchase_discount
// 反映上游采购成本与费率口径（仅超管可见），model_discounts 是售价侧折扣（企业/代理商可看自身）。
// agentId>0 表示挂在某代理商名下，用于驱动代理商企业列表路径。
func seedRateOrganization(t *testing.T, db *gorm.DB, id int, agentId int) *model.Organization {
	t.Helper()
	org := &model.Organization{
		Id:               id,
		Name:             fmt.Sprintf("rate-org-%d", id),
		DisplayName:      "Rate Org",
		Group:            model.DefaultUserGroup,
		Status:           1,
		AgentId:          agentId,
		TokenRate:        1.16,
		ExpectedDiscount: 0.91,
		PurchaseDiscount: 0.77,
		ModelDiscounts:   `{"gpt-4o":0.85}`,
	}
	require.NoError(t, db.Create(org).Error)
	return org
}

// decodeOrgPayload 从 {"success":..,"data":{"organization":{...}}} 信封里取出企业对象。
func decodeOrgPayload(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Organization map[string]any `json:"organization"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(body, &response))
	require.True(t, response.Success)
	require.NotNil(t, response.Data.Organization)
	return response.Data.Organization
}

// TestOrganizationRateFieldsHiddenFromOrgAdminAndAgent 锁定企业内部费率三件套的可见性口径：
//   - 企业管理员（GetOrganization）：purchase_discount/token_rate/expected_discount 必须为 0，
//     售价侧 model_discounts 保留；
//   - 代理商（ListAgentOrganizations）：名下企业同样剥离三件套；
//   - 超级管理员（AdminGetOrganization）：保留全部真实值用于对账。
//
// 这守护"企业管理员/代理商 ≠ 超管"的费率口径不变量：即便 F12 抓包也拿不到上游采购成本与毛利。
func TestOrganizationRateFieldsHiddenFromOrgAdminAndAgent(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Organization{}, &model.OrgMember{}, &model.Agent{}))

	// 直销企业（agent_id=0）供企业管理员 vs 超管对比
	directOrg := seedRateOrganization(t, db, 1, 0)
	// 代理商名下企业（agent_id=agent.Id）供代理商列表路径
	agent := &model.Agent{UserId: 500, Status: model.AgentStatusEnabled}
	require.NoError(t, db.Create(agent).Error)
	agentOrg := seedRateOrganization(t, db, 2, agent.Id)

	t.Run("org admin sees zeroed rate fields but keeps own discount", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/org/", nil)
		// 企业管理员：企业范围来自鉴权上下文，系统角色为普通用户（非超管）
		c.Set(string(constant.ContextKeyUserOrgId), directOrg.Id)
		c.Set("role", common.RoleCommonUser)
		GetOrganization(c)

		require.Equal(t, http.StatusOK, recorder.Code)
		org := decodeOrgPayload(t, recorder.Body.Bytes())
		assert.Equal(t, float64(0), org["purchase_discount"])
		assert.Equal(t, float64(0), org["token_rate"])
		assert.Equal(t, float64(0), org["expected_discount"])
		// 售价侧折扣仍下发（企业可查看自身折扣）
		assert.Equal(t, map[string]any{"gpt-4o": 0.85}, org["model_discounts"])
		// 真实成本值不得出现在响应体任何位置
		body := recorder.Body.String()
		assert.NotContains(t, body, "0.77")
		assert.NotContains(t, body, "1.16")
		assert.NotContains(t, body, "0.91")
	})

	t.Run("super admin retains real rate fields for reconciliation", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/org/admin/"+strconv.Itoa(directOrg.Id), nil)
		c.Params = gin.Params{{Key: "id", Value: strconv.Itoa(directOrg.Id)}}
		c.Set("role", common.RoleRootUser)
		AdminGetOrganization(c)

		require.Equal(t, http.StatusOK, recorder.Code)
		org := decodeOrgPayload(t, recorder.Body.Bytes())
		assert.InDelta(t, 0.77, org["purchase_discount"], 1e-9)
		assert.InDelta(t, 1.16, org["token_rate"], 1e-9)
		assert.InDelta(t, 0.91, org["expected_discount"], 1e-9)
	})

	t.Run("agent list strips rate fields of owned organizations", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/agent/enterprises?p=1&page_size=100", nil)
		c.Set("agent_id", agent.Id)
		ListAgentOrganizations(c)

		require.Equal(t, http.StatusOK, recorder.Code)
		var response struct {
			Success bool `json:"success"`
			Data    struct {
				Items []map[string]any `json:"items"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		require.True(t, response.Success)
		require.Len(t, response.Data.Items, 1)
		org := response.Data.Items[0]
		assert.Equal(t, float64(agentOrg.Id), org["id"])
		assert.Equal(t, float64(0), org["purchase_discount"])
		assert.Equal(t, float64(0), org["token_rate"])
		assert.Equal(t, float64(0), org["expected_discount"])
		assert.Equal(t, map[string]any{"gpt-4o": 0.85}, org["model_discounts"])
		body := recorder.Body.String()
		assert.NotContains(t, body, "0.77")
		assert.NotContains(t, body, "1.16")
		assert.NotContains(t, body, "0.91")
	})
}
