package service

import (
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setupOrgServiceFixture 迁移企业相关表并注册清理。
// service 包的 TestMain 只迁移计费核心表，Organization/OrgMember 在此按需迁移。
func setupOrgServiceFixture(t *testing.T) {
	t.Helper()
	require.NoError(t, model.DB.AutoMigrate(&model.Organization{}, &model.OrgMember{}, &model.User{}))
	cleanup := func() {
		model.DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&model.OrgMember{})
		model.DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&model.Organization{})
		model.DB.Exec("DELETE FROM users")
	}
	cleanup()
	t.Cleanup(cleanup)
}

func seedServiceOrg(t *testing.T, id int, quota int, status int, allowFallback bool) *model.Organization {
	t.Helper()
	org := &model.Organization{
		Id:                  id,
		Name:                fmt.Sprintf("svc-org-%d", id),
		DisplayName:         fmt.Sprintf("Svc Org %d", id),
		Group:               "default",
		Status:              status,
		Quota:               quota,
		AllowWalletFallback: allowFallback,
	}
	require.NoError(t, model.DB.Create(org).Error)
	return org
}

func seedServiceMember(t *testing.T, org *model.Organization, userId int, role string, limit int, status int) *model.OrgMember {
	t.Helper()
	user := &model.User{
		Id:       userId,
		Username: fmt.Sprintf("svc-user-%d", userId),
		AffCode:  fmt.Sprintf("svc-aff-%d", userId),
		Status:   common.UserStatusEnabled,
		Group:    org.Group,
		OrgId:    org.Id,
	}
	require.NoError(t, model.DB.Create(user).Error)
	member := &model.OrgMember{OrgId: org.Id, UserId: userId, OrgRole: role, QuotaLimit: limit, Status: status}
	require.NoError(t, model.DB.Create(member).Error)
	return member
}

func assertOrgPool(t *testing.T, orgId int, wantQuota int, wantUsed int) {
	t.Helper()
	org, err := model.GetOrganizationById(orgId)
	require.NoError(t, err)
	assert.Equal(t, wantQuota, org.Quota, "pool balance")
	assert.Equal(t, wantUsed, org.UsedQuota, "pool used")
}

func assertMemberUsed(t *testing.T, memberId int, wantUsed int) {
	t.Helper()
	member, err := model.GetOrgMemberById(memberId)
	require.NoError(t, err)
	assert.Equal(t, wantUsed, member.QuotaUsed, "member sub-quota used")
}

// TestOrganizationFundingLifecycle 校验企业资金来源的预扣/结算（补扣与退回）都落到
// 企业池与成员子额度上，且金额精确。
func TestOrganizationFundingLifecycle(t *testing.T) {
	setupOrgServiceFixture(t)
	org := seedServiceOrg(t, 1, 1000, model.OrgStatusEnabled, false)
	member := seedServiceMember(t, org, 501, model.OrgRoleMember, 0, model.OrgMemberStatusEnabled)

	f := &OrganizationFunding{orgId: org.Id, userId: member.UserId, orgName: org.Name}
	assert.Equal(t, BillingSourceOrganization, f.Source())
	assert.Equal(t, org.Id, f.OrgId())
	assert.Equal(t, org.Name, f.OrgName())

	// 预扣 300
	require.NoError(t, f.PreConsume(300))
	assertOrgPool(t, org.Id, 700, 300)
	assertMemberUsed(t, member.Id, 300)

	// 结算补扣 +50（实际消耗高于预扣）
	require.NoError(t, f.Settle(50))
	assertOrgPool(t, org.Id, 650, 350)
	assertMemberUsed(t, member.Id, 350)

	// 结算退回 -100（实际消耗低于预扣）
	require.NoError(t, f.Settle(-100))
	assertOrgPool(t, org.Id, 750, 250)
	assertMemberUsed(t, member.Id, 250)

	// Settle(0) 是 no-op
	require.NoError(t, f.Settle(0))
	assertOrgPool(t, org.Id, 750, 250)
}

// TestOrganizationFundingRefundReturnsPreConsumed 校验退款把预扣额度原路退回企业池与成员子额度。
func TestOrganizationFundingRefundReturnsPreConsumed(t *testing.T) {
	setupOrgServiceFixture(t)
	org := seedServiceOrg(t, 1, 1000, model.OrgStatusEnabled, false)
	member := seedServiceMember(t, org, 501, model.OrgRoleMember, 0, model.OrgMemberStatusEnabled)

	f := &OrganizationFunding{orgId: org.Id, userId: member.UserId}
	require.NoError(t, f.PreConsume(300))
	require.NoError(t, f.Refund())
	assertOrgPool(t, org.Id, 1000, 0)
	assertMemberUsed(t, member.Id, 0)

	// 未预扣时 Refund 是 no-op（consumed<=0）
	empty := &OrganizationFunding{orgId: org.Id, userId: member.UserId}
	require.NoError(t, empty.Refund())
	assertOrgPool(t, org.Id, 1000, 0)
}

// TestOrganizationFundingPreConsumeRespectsMemberLimit 校验成员子额度超限时预扣失败且不改动池，
// 以及非正数预扣是 no-op。
func TestOrganizationFundingPreConsumeRespectsMemberLimit(t *testing.T) {
	setupOrgServiceFixture(t)
	org := seedServiceOrg(t, 1, 10000, model.OrgStatusEnabled, false)
	member := seedServiceMember(t, org, 501, model.OrgRoleMember, 200, model.OrgMemberStatusEnabled)

	f := &OrganizationFunding{orgId: org.Id, userId: member.UserId}
	require.ErrorIs(t, f.PreConsume(500), model.ErrOrgMemberQuotaExceeded)
	assertOrgPool(t, org.Id, 10000, 0)
	assertMemberUsed(t, member.Id, 0)

	// 非正数预扣不产生任何扣费
	require.NoError(t, f.PreConsume(0))
	require.NoError(t, f.PreConsume(-10))
	assertOrgPool(t, org.Id, 10000, 0)
}

// TestShouldTrustDisabledForOrganization 守护企业计费关闭信任额度旁路：
// 旁路会把 effectiveQuota 置 0，从而跳过 ConsumeOrgQuota 的成员子额度校验，
// 成员就能超额消费企业池。钱包路径在同样条件下仍允许旁路，用以对照。
func TestShouldTrustDisabledForOrganization(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	trust := common.GetTrustQuota()
	require.Greater(t, trust, 0)

	baseInfo := func() *relaycommon.RelayInfo {
		return &relaycommon.RelayInfo{TokenUnlimited: true, UserQuota: trust + 1}
	}

	orgSession := &BillingSession{relayInfo: baseInfo(), funding: &OrganizationFunding{orgId: 1, userId: 1}}
	assert.False(t, orgSession.shouldTrust(c), "organization billing must never take the trust bypass")

	walletSession := &BillingSession{relayInfo: baseInfo(), funding: &WalletFunding{userId: 1}}
	assert.True(t, walletSession.shouldTrust(c), "wallet with ample quota still trusts (control case)")

	// ForcePreConsume 关闭一切旁路
	forced := &BillingSession{relayInfo: func() *relaycommon.RelayInfo { i := baseInfo(); i.ForcePreConsume = true; return i }(), funding: &WalletFunding{userId: 1}}
	assert.False(t, forced.shouldTrust(c))
}

// TestTryOrganizationBillingFallbackPolicy 校验企业池/子额度不足时的回落策略：
// AllowWalletFallback=false 直接判额度不足（handled=true），true 则回落到个人资金（handled=false）。
// 无论谁付费，本次请求都归属该企业（relayInfo.OrgId 被回填）。
func TestTryOrganizationBillingFallbackPolicy(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name             string
		allowFallback    bool
		poolQuota        int
		memberLimit      int
		preConsumed      int
		wantHandled      bool
		wantInsufficient bool
	}{
		{
			name:             "pool insufficient without fallback is terminal",
			allowFallback:    false,
			poolQuota:        100,
			memberLimit:      0,
			preConsumed:      5000,
			wantHandled:      true,
			wantInsufficient: true,
		},
		{
			name:          "pool insufficient with fallback defers to wallet",
			allowFallback: true,
			poolQuota:     100,
			memberLimit:   0,
			preConsumed:   5000,
			wantHandled:   false,
		},
		{
			name:             "member sub-quota exceeded without fallback is terminal",
			allowFallback:    false,
			poolQuota:        100000,
			memberLimit:      100,
			preConsumed:      500,
			wantHandled:      true,
			wantInsufficient: true,
		},
		{
			name:          "member sub-quota exceeded with fallback defers to wallet",
			allowFallback: true,
			poolQuota:     100000,
			memberLimit:   100,
			preConsumed:   500,
			wantHandled:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setupOrgServiceFixture(t)
			org := seedServiceOrg(t, 1, tt.poolQuota, model.OrgStatusEnabled, tt.allowFallback)
			member := seedServiceMember(t, org, 601, model.OrgRoleMember, tt.memberLimit, model.OrgMemberStatusEnabled)

			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			relayInfo := &relaycommon.RelayInfo{UserId: member.UserId}

			session, apiErr, handled := tryOrganizationBilling(c, relayInfo, tt.preConsumed)
			assert.Equal(t, tt.wantHandled, handled)
			// 归属始终回填，供日志与报表使用
			assert.Equal(t, org.Id, relayInfo.OrgId)

			if tt.wantInsufficient {
				require.Nil(t, session)
				require.NotNil(t, apiErr)
				assert.Equal(t, types.ErrorCodeInsufficientUserQuota, apiErr.GetErrorCode())
			} else {
				assert.Nil(t, session)
				assert.Nil(t, apiErr)
			}
		})
	}
}

// TestTryOrganizationBillingNonMemberDefers 校验非企业成员完全走个人计费路径（handled=false），
// 企业计费不改变非成员的任何行为。
func TestTryOrganizationBillingNonMemberDefers(t *testing.T) {
	setupOrgServiceFixture(t)
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	relayInfo := &relaycommon.RelayInfo{UserId: 999} // 无企业归属
	session, apiErr, handled := tryOrganizationBilling(c, relayInfo, 100)
	assert.False(t, handled)
	assert.Nil(t, session)
	assert.Nil(t, apiErr)
	assert.Equal(t, 0, relayInfo.OrgId)
}
