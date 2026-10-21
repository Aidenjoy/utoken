package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// logBodiesResponse 解析 GET /api/log/bodies 的响应体。
type logBodiesResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Data    struct {
		RequestData  string `json:"request_data"`
		ResponseData string `json:"response_data"`
	} `json:"data"`
}

// newLogBodiesContext 构造带 role/id 身份与 request_id 查询串的 gin.Context，直接驱动
// GetLogBodies（不经中间件：身份由上下文注入，等价于 UserAuth 通过后的状态）。
func newLogBodiesContext(requestId string, role int, userId int) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	target := "/api/log/bodies"
	if requestId != "" {
		target += "?request_id=" + requestId
	}
	c.Request = httptest.NewRequest(http.MethodGet, target, nil)
	c.Set("role", role)
	c.Set("id", userId)
	return c, w
}

// setupLogBodiesFixtures 铺陈鉴权矩阵夹具：
//   - 日志行 request_id → owner：req-owner(1) / req-member(2) / req-nonmember(3) /
//     req-nobodies(1，有日志无快照)；
//   - 前三条各带一份 log_bodies 快照；
//   - 启用态代理商(user_id=50) + 名下成员 user(id=2, agent_id=agent.Id)，非成员 user(id=3)。
func setupLogBodiesFixtures(t *testing.T) {
	t.Helper()
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Log{}, &model.LogBody{}, &model.Agent{}))

	logs := []*model.Log{
		{UserId: 1, RequestId: "req-owner", Type: model.LogTypeConsume},
		{UserId: 2, RequestId: "req-member", Type: model.LogTypeConsume},
		{UserId: 3, RequestId: "req-nonmember", Type: model.LogTypeConsume},
		{UserId: 1, RequestId: "req-nobodies", Type: model.LogTypeConsume},
	}
	for _, l := range logs {
		require.NoError(t, db.Create(l).Error)
	}

	require.NoError(t, model.SaveLogBody("req-owner", []byte("owner-req"), []byte("owner-resp")))
	require.NoError(t, model.SaveLogBody("req-member", []byte("member-req"), []byte("member-resp")))
	require.NoError(t, model.SaveLogBody("req-nonmember", []byte("nm-req"), []byte("nm-resp")))

	agent := &model.Agent{UserId: 50, Status: model.AgentStatusEnabled}
	require.NoError(t, db.Create(agent).Error)
	require.NoError(t, db.Create(&model.User{Id: 2, Username: "member", AffCode: "aff-member", AgentId: agent.Id, Quota: 100}).Error)
	require.NoError(t, db.Create(&model.User{Id: 3, Username: "nonmember", AffCode: "aff-nonmember", AgentId: 0, Quota: 100}).Error)
}

// TestGetLogBodiesAdminCanViewAny 锁定管理员放行：role>=ADMIN 可取任意人的快照。
func TestGetLogBodiesAdminCanViewAny(t *testing.T) {
	setupLogBodiesFixtures(t)

	c, w := newLogBodiesContext("req-owner", common.RoleAdminUser, 999)
	GetLogBodies(c)

	require.Equal(t, http.StatusOK, w.Code)
	var resp logBodiesResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.True(t, resp.Success)
	assert.Equal(t, "owner-req", resp.Data.RequestData)
	assert.Equal(t, "owner-resp", resp.Data.ResponseData)
}

// TestGetLogBodiesSelfCanViewOwn 锁定本人放行：普通用户可取自己日志的快照。
func TestGetLogBodiesSelfCanViewOwn(t *testing.T) {
	setupLogBodiesFixtures(t)

	c, w := newLogBodiesContext("req-owner", common.RoleCommonUser, 1)
	GetLogBodies(c)

	require.Equal(t, http.StatusOK, w.Code)
	var resp logBodiesResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.True(t, resp.Success)
	assert.Equal(t, "owner-req", resp.Data.RequestData)
	assert.Equal(t, "owner-resp", resp.Data.ResponseData)
}

// TestGetLogBodiesAgentCanViewMember 锁定代理商放行名下成员：agent(user 50) 可取成员(user 2)的快照。
func TestGetLogBodiesAgentCanViewMember(t *testing.T) {
	setupLogBodiesFixtures(t)

	c, w := newLogBodiesContext("req-member", common.RoleCommonUser, 50)
	GetLogBodies(c)

	require.Equal(t, http.StatusOK, w.Code)
	var resp logBodiesResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.True(t, resp.Success)
	assert.Equal(t, "member-req", resp.Data.RequestData)
	assert.Equal(t, "member-resp", resp.Data.ResponseData)
}

// TestGetLogBodiesAgentCannotViewNonMember 锁定代理商越权回空：成员外(user 3)的快照返回
// 空数据而非 403——不泄露该 request_id 是否存在快照。
func TestGetLogBodiesAgentCannotViewNonMember(t *testing.T) {
	setupLogBodiesFixtures(t)

	c, w := newLogBodiesContext("req-nonmember", common.RoleCommonUser, 50)
	GetLogBodies(c)

	require.Equal(t, http.StatusOK, w.Code)
	var resp logBodiesResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.True(t, resp.Success)
	assert.Empty(t, resp.Data.RequestData)
	assert.Empty(t, resp.Data.ResponseData)
}

// TestGetLogBodiesOtherUserGetsEmpty 锁定无关用户越权回空：非本人、非管理员、非其代理商 → 空数据。
func TestGetLogBodiesOtherUserGetsEmpty(t *testing.T) {
	setupLogBodiesFixtures(t)

	c, w := newLogBodiesContext("req-owner", common.RoleCommonUser, 99)
	GetLogBodies(c)

	require.Equal(t, http.StatusOK, w.Code)
	var resp logBodiesResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.True(t, resp.Success)
	assert.Empty(t, resp.Data.RequestData)
	assert.Empty(t, resp.Data.ResponseData)
}

// TestGetLogBodiesMissingLogReturns404 锁定无日志行 → 404（先校验日志归属，再谈快照）。
func TestGetLogBodiesMissingLogReturns404(t *testing.T) {
	setupLogBodiesFixtures(t)

	c, w := newLogBodiesContext("req-does-not-exist", common.RoleAdminUser, 999)
	GetLogBodies(c)

	assert.Equal(t, http.StatusNotFound, w.Code)
	var resp logBodiesResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.False(t, resp.Success)
}

// TestGetLogBodiesNoSnapshotReturnsEmpty 锁定历史日志（有日志行、无快照）→ 成功但空数据，
// 前端 JsonBlock 据此显示「None」。
func TestGetLogBodiesNoSnapshotReturnsEmpty(t *testing.T) {
	setupLogBodiesFixtures(t)

	c, w := newLogBodiesContext("req-nobodies", common.RoleAdminUser, 999)
	GetLogBodies(c)

	require.Equal(t, http.StatusOK, w.Code)
	var resp logBodiesResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.True(t, resp.Success)
	assert.Empty(t, resp.Data.RequestData)
	assert.Empty(t, resp.Data.ResponseData)
}

// TestGetLogBodiesRequiresRequestId 锁定缺参 → success=false（ApiErrorMsg，200）。
func TestGetLogBodiesRequiresRequestId(t *testing.T) {
	setupLogBodiesFixtures(t)

	c, w := newLogBodiesContext("", common.RoleAdminUser, 999)
	GetLogBodies(c)

	require.Equal(t, http.StatusOK, w.Code)
	var resp logBodiesResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.False(t, resp.Success)
	assert.Equal(t, "request_id is required", resp.Message)
}
