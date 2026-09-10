package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newOrgMemberParamContext 构造带路径参数 :id 的 gin.Context，用于驱动 loadScopedOrgMember。
func newOrgMemberParamContext(idParam string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/org/members/"+idParam, nil)
	c.Params = gin.Params{{Key: "id", Value: idParam}}
	return c, w
}

// TestLoadScopedOrgMemberHidesCrossOrgExistence 守护跨企业访问不泄露成员存在性：
// 访问属于其它企业的成员，必须与访问根本不存在的成员返回完全相同的“成员不存在”响应，
// 攻击者据此无法区分“存在但不属于你”与“不存在”。
func TestLoadScopedOrgMemberHidesCrossOrgExistence(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Organization{}, &model.OrgMember{}))

	// 成员 123 属于企业 1
	require.NoError(t, db.Create(&model.OrgMember{
		Id: 123, OrgId: 1, UserId: 10, OrgRole: model.OrgRoleMember, Status: model.OrgMemberStatusEnabled,
	}).Error)

	// 本企业访问：命中
	cSame, _ := newOrgMemberParamContext("123")
	member, ok := loadScopedOrgMember(cSame, 1)
	require.True(t, ok)
	require.NotNil(t, member)
	assert.Equal(t, 123, member.Id)

	// 跨企业访问（成员属于企业 1，却以企业 2 的身份请求）：按不存在处理
	cCross, wCross := newOrgMemberParamContext("123")
	crossMember, crossOk := loadScopedOrgMember(cCross, 2)
	assert.False(t, crossOk)
	assert.Nil(t, crossMember)

	// 真正不存在的成员
	cMissing, wMissing := newOrgMemberParamContext("999")
	missingMember, missingOk := loadScopedOrgMember(cMissing, 2)
	assert.False(t, missingOk)
	assert.Nil(t, missingMember)

	// 不泄露存在性：两种失败路径的响应体必须逐字节相同
	assert.Equal(t, wMissing.Body.String(), wCross.Body.String(),
		"cross-org access must be indistinguishable from a non-existent member")
	assert.Equal(t, http.StatusOK, wCross.Code)
}

// TestLoadScopedOrgMemberRejectsBadParam 校验非法 :id 参数（非数字/非正数）同样按“成员不存在”响应。
func TestLoadScopedOrgMemberRejectsBadParam(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Organization{}, &model.OrgMember{}))

	for _, bad := range []string{"abc", "0", "-5"} {
		c, _ := newOrgMemberParamContext(bad)
		member, ok := loadScopedOrgMember(c, 1)
		assert.False(t, ok, "id=%s must be rejected", bad)
		assert.Nil(t, member)
	}
}
