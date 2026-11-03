package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// newAgentEnterpriseWithMemberContext 构造直驱 CreateAgentEnterpriseWithMember 的 gin.Context：
// body 为嵌套 JSON 请求，agent_id 模拟 AgentAuth 注入的服务端归属。
func newAgentEnterpriseWithMemberContext(t *testing.T, agentId int, body string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/agent/members/with-enterprise", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("agent_id", agentId)
	c.Set("id", agentId+1000)
	return c, recorder
}

// decodeWithMemberPayload 从 {"success":..,"data":{...}} 信封取出 data 字段集合。
func decodeWithMemberPayload(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var response struct {
		Success bool           `json:"success"`
		Data    map[string]any `json:"data"`
	}
	require.NoError(t, common.Unmarshal(body, &response))
	require.True(t, response.Success)
	require.NotNil(t, response.Data)
	return response.Data
}

// setupEnterpriseWithMemberDB 在共享测试库上补齐企业/成员/代理商/日志表。
func setupEnterpriseWithMemberDB(t *testing.T) (*gorm.DB, *model.Agent) {
	t.Helper()
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Organization{}, &model.OrgMember{}, &model.Agent{}, &model.Log{}))
	agent := &model.Agent{UserId: 500, Status: model.AgentStatusEnabled}
	require.NoError(t, db.Create(agent).Error)
	return db, agent
}

// TestCreateAgentEnterpriseWithMemberSuccess 锁定快捷复合操作的落库口径：
// 企业绑定代理商、成员账号继承企业归属（users.agent_id/org_id）、org_members 角色正确、
// 子账号标记为 true，且两条管理审计（org.agent_bind + org.member.create）都已写入。
func TestCreateAgentEnterpriseWithMemberSuccess(t *testing.T) {
	db, agent := setupEnterpriseWithMemberDB(t)

	body := `{"org":{"name":"acme-team","display_name":"Acme Inc"},` +
		`"member":{"username":"acme-admin","password":"passw0rd!","display_name":"Acme Admin",` +
		`"email":"admin@acme.test","org_role":"admin"}}`
	c, recorder := newAgentEnterpriseWithMemberContext(t, agent.Id, body)
	CreateAgentEnterpriseWithMember(c)

	require.Equal(t, http.StatusOK, recorder.Code)
	data := decodeWithMemberPayload(t, recorder.Body.Bytes())
	orgId := int(data["org_id"].(float64))
	userId := int(data["user_id"].(float64))
	assert.Equal(t, "acme-team", data["org_name"])
	assert.Equal(t, "acme-admin", data["username"])

	var org model.Organization
	require.NoError(t, db.First(&org, orgId).Error)
	assert.Equal(t, agent.Id, org.AgentId)
	assert.Equal(t, "Acme Inc", org.DisplayName)

	var user model.User
	require.NoError(t, db.First(&user, userId).Error)
	assert.Equal(t, orgId, user.OrgId)
	assert.Equal(t, agent.Id, user.AgentId)
	assert.Equal(t, common.RoleCommonUser, user.Role)

	var member model.OrgMember
	require.NoError(t, db.Where("org_id = ? AND user_id = ?", orgId, userId).First(&member).Error)
	assert.Equal(t, model.OrgRoleAdmin, member.OrgRole)
	assert.True(t, member.SubUser)
	assert.Equal(t, model.OrgMemberStatusEnabled, member.Status)

	// 审计 action 存于 other JSON 的 op.action（logs 表无独立 action 列；
	// other 是 SQL 保留字，不用 Pluck 裸列名，直接查结构体）。
	var auditLogs []model.Log
	require.NoError(t, db.Where("type = ?", model.LogTypeManage).Find(&auditLogs).Error)
	require.Len(t, auditLogs, 2)
	var auditActions []string
	for _, auditLog := range auditLogs {
		var parsed struct {
			Op struct {
				Action string `json:"action"`
			} `json:"op"`
		}
		require.NoError(t, common.UnmarshalJsonStr(auditLog.Other, &parsed))
		auditActions = append(auditActions, parsed.Op.Action)
	}
	assert.Contains(t, auditActions, "org.agent_bind")
	assert.Contains(t, auditActions, "org.member.create")
}

// TestCreateAgentEnterpriseWithMemberTakenOrgName 锁定企业标识重名时整体拒绝：
// 不建企业也不建用户，无残留副作用。
func TestCreateAgentEnterpriseWithMemberTakenOrgName(t *testing.T) {
	db, agent := setupEnterpriseWithMemberDB(t)
	existing := &model.Organization{Name: "acme-team", Group: model.DefaultUserGroup, Status: 1}
	require.NoError(t, db.Create(existing).Error)

	body := `{"org":{"name":"acme-team"},"member":{"username":"fresh-user","password":"passw0rd!","org_role":"admin"}}`
	c, recorder := newAgentEnterpriseWithMemberContext(t, agent.Id, body)
	CreateAgentEnterpriseWithMember(c)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success)

	var orgCount, userCount int64
	require.NoError(t, db.Model(&model.Organization{}).Count(&orgCount).Error)
	assert.Equal(t, int64(1), orgCount)
	require.NoError(t, db.Model(&model.User{}).Where("username = ?", "fresh-user").Count(&userCount).Error)
	assert.Zero(t, userCount)
}

// TestCreateAgentEnterpriseWithMemberExistingUsername 锁定成员侧预检在建企业之前：
// 用户名已占用时直接拒绝，绝不留下刚建出来的空企业。
func TestCreateAgentEnterpriseWithMemberExistingUsername(t *testing.T) {
	db, agent := setupEnterpriseWithMemberDB(t)
	taken := &model.User{Username: "taken-user", Password: "passw0rd!", DisplayName: "Taken"}
	require.NoError(t, db.Create(taken).Error)

	body := `{"org":{"name":"brand-new-org"},"member":{"username":"taken-user","password":"passw0rd!","org_role":"admin"}}`
	c, recorder := newAgentEnterpriseWithMemberContext(t, agent.Id, body)
	CreateAgentEnterpriseWithMember(c)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success)

	var orgCount int64
	require.NoError(t, db.Model(&model.Organization{}).Count(&orgCount).Error)
	assert.Zero(t, orgCount)
}

// TestCreateAgentEnterpriseWithMemberInvalidRole 锁定非法企业角色在建企业之前被拒绝。
func TestCreateAgentEnterpriseWithMemberInvalidRole(t *testing.T) {
	db, agent := setupEnterpriseWithMemberDB(t)

	body := `{"org":{"name":"role-org"},"member":{"username":"role-user","password":"passw0rd!","org_role":"owner"}}`
	c, recorder := newAgentEnterpriseWithMemberContext(t, agent.Id, body)
	CreateAgentEnterpriseWithMember(c)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success)

	var orgCount int64
	require.NoError(t, db.Model(&model.Organization{}).Count(&orgCount).Error)
	assert.Zero(t, orgCount)
}
