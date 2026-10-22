package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// 本文件覆盖「代理商企业发展 + 个人账户禁用」方案的模型层不变量：
// 企业↔代理商绑定/解绑的成员同步、企业折扣覆盖与加入继承、钱包权限矩阵、
// 充值下单快照入池与确认幂等。所有用例都在内存 SQLite 上跑，Redis 关闭，
// 因此缓存失效路径为 no-op，断言只针对落库状态。

// setupOrgAgentFixture 迁移企业/成员/代理商/充值相关表并注册清理。
// TestMain 只迁移核心表，这里按需补齐 Agent/Organization/OrgMember。
func setupOrgAgentFixture(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&Organization{}, &OrgMember{}, &User{}, &Agent{}, &TopUp{}, &QuotaData{}, &Log{}))
	cleanup := func() {
		DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&OrgMember{})
		DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Organization{})
		DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Agent{})
		DB.Exec("DELETE FROM users")
		DB.Exec("DELETE FROM top_ups")
		DB.Exec("DELETE FROM quota_data")
		DB.Exec("DELETE FROM logs")
	}
	cleanup()
	t.Cleanup(cleanup)
}

// reloadUserAgent 直接查库读取用户的 agent_id 与 model_discounts，绕过任何缓存。
func reloadUserAgent(t *testing.T, userId int) (int, string) {
	t.Helper()
	var user User
	require.NoError(t, DB.Select("id, agent_id, model_discounts, quota").Where("id = ?", userId).First(&user).Error)
	return user.AgentId, user.ModelDiscounts
}

// ---------------------------------------------------------------------------
// 绑定 / 解绑
// ---------------------------------------------------------------------------

// TestSetOrganizationAgentBindSync 绑定企业到代理商后，org.agent_id 与全部成员
// users.agent_id 同步写入；企业归属优先——成员原属其他代理商时被强制改绑。
func TestSetOrganizationAgentBindSync(t *testing.T) {
	setupOrgAgentFixture(t)
	seedAgent(t, 1, 9001, `{"gpt-4o":0.8}`)
	seedAgent(t, 2, 9002, `{"gpt-4o":0.7}`)
	org := seedOrg(t, 10, 0, OrgStatusEnabled)
	seedOrgMember(t, org, 100, OrgRoleAdmin, 0, OrgMemberStatusEnabled)
	seedOrgMember(t, org, 101, OrgRoleMember, 0, OrgMemberStatusEnabled)
	// 成员 101 原属代理商 2，绑定企业到代理商 1 时应被强制改绑（企业归属优先）。
	require.NoError(t, DB.Model(&User{}).Where("id = ?", 101).Update("agent_id", 2).Error)

	require.NoError(t, SetOrganizationAgent(org.Id, 1))

	assert.Equal(t, 1, reloadOrg(t, org.Id).AgentId)
	agentA, _ := reloadUserAgent(t, 100)
	agentB, _ := reloadUserAgent(t, 101)
	assert.Equal(t, 1, agentA)
	assert.Equal(t, 1, agentB, "成员原属其他代理商时应被强制改绑到企业归属的代理商")
}

// TestSetOrganizationAgentUnbind 解绑（收回直销）：org.agent_id=0 且企业折扣清空，
// 成员 agent_id 清零；成员个人折扣只清「授权清单内」的键，清单外（超管直设）保留。
func TestSetOrganizationAgentUnbind(t *testing.T) {
	setupOrgAgentFixture(t)
	seedAgent(t, 1, 9001, `{"gpt-4o":0.8}`)
	org := seedOrg(t, 10, 0, OrgStatusEnabled)
	seedOrgMember(t, org, 100, OrgRoleAdmin, 0, OrgMemberStatusEnabled)
	require.NoError(t, SetOrganizationAgent(org.Id, 1))
	// 企业折扣 + 成员带一个授权键（gpt-4o）与一个清单外键（claude-3-5-sonnet）。
	require.NoError(t, SetOrganizationModelDiscounts(org.Id, `{"gpt-4o":0.9}`))
	require.NoError(t, DB.Model(&User{}).Where("id = ?", 100).
		Update("model_discounts", `{"claude-3-5-sonnet":0.95,"gpt-4o":0.9}`).Error)

	require.NoError(t, SetOrganizationAgent(org.Id, 0))

	updated := reloadOrg(t, org.Id)
	assert.Equal(t, 0, updated.AgentId)
	assert.Equal(t, "", updated.ModelDiscounts, "解绑应清空企业折扣")
	agentId, discounts := reloadUserAgent(t, 100)
	assert.Equal(t, 0, agentId)
	parsed := common.ParseModelDiscounts(discounts)
	assert.NotContains(t, parsed, "gpt-4o", "授权清单内的折扣键应被清零")
	assert.Contains(t, parsed, "claude-3-5-sonnet", "清单外折扣键（超管直设）应保留")
}

// TestSetOrganizationAgentDisabled 停用代理商不得再绑定企业。
func TestSetOrganizationAgentDisabled(t *testing.T) {
	setupOrgAgentFixture(t)
	agent := seedAgent(t, 1, 9001, `{"gpt-4o":0.8}`)
	require.NoError(t, DB.Model(&Agent{}).Where("id = ?", agent.Id).Update("status", AgentStatusDisabled).Error)
	org := seedOrg(t, 10, 0, OrgStatusEnabled)

	assert.ErrorIs(t, SetOrganizationAgent(org.Id, 1), ErrAgentDisabled)
	assert.Equal(t, 0, reloadOrg(t, org.Id).AgentId, "绑定失败不得留下半成品归属")
}

// TestSetOrganizationAgentIdempotent 重复绑定同一代理商是无副作用的 no-op。
func TestSetOrganizationAgentIdempotent(t *testing.T) {
	setupOrgAgentFixture(t)
	seedAgent(t, 1, 9001, `{"gpt-4o":0.8}`)
	org := seedOrg(t, 10, 0, OrgStatusEnabled)
	seedOrgMember(t, org, 100, OrgRoleAdmin, 0, OrgMemberStatusEnabled)
	require.NoError(t, SetOrganizationAgent(org.Id, 1))
	require.NoError(t, SetOrganizationAgent(org.Id, 1))
	assert.Equal(t, 1, reloadOrg(t, org.Id).AgentId)
}

// ---------------------------------------------------------------------------
// 企业折扣覆盖与加入继承
// ---------------------------------------------------------------------------

// TestSetOrganizationModelDiscountsOverwritesMembers 企业折扣整表覆盖全部成员个人折扣。
func TestSetOrganizationModelDiscountsOverwritesMembers(t *testing.T) {
	setupOrgAgentFixture(t)
	org := seedOrg(t, 10, 0, OrgStatusEnabled)
	seedOrgMember(t, org, 100, OrgRoleAdmin, 0, OrgMemberStatusEnabled)
	seedOrgMember(t, org, 101, OrgRoleMember, 0, OrgMemberStatusEnabled)
	// 成员原有各自不同的个人折扣，覆盖后应统一为企业折扣。
	require.NoError(t, DB.Model(&User{}).Where("id = ?", 100).Update("model_discounts", `{"gpt-4o":0.5}`).Error)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", 101).Update("model_discounts", `{"claude-3-5-sonnet":0.6}`).Error)

	require.NoError(t, SetOrganizationModelDiscounts(org.Id, `{"gpt-4o":0.9}`))

	assert.Equal(t, `{"gpt-4o":0.9}`, reloadOrg(t, org.Id).ModelDiscounts)
	_, d100 := reloadUserAgent(t, 100)
	_, d101 := reloadUserAgent(t, 101)
	assert.Equal(t, `{"gpt-4o":0.9}`, d100)
	assert.Equal(t, `{"gpt-4o":0.9}`, d101)
}

// TestAddOrgMemberInheritsDiscountAndAgent 新成员加入时继承企业折扣与代理商归属。
func TestAddOrgMemberInheritsDiscountAndAgent(t *testing.T) {
	setupOrgAgentFixture(t)
	seedAgent(t, 1, 9001, `{"gpt-4o":0.8}`)
	org := seedOrg(t, 10, 1000, OrgStatusEnabled)
	require.NoError(t, SetOrganizationAgent(org.Id, 1))
	require.NoError(t, SetOrganizationModelDiscounts(org.Id, `{"gpt-4o":0.9}`))

	// 新既有用户（带旧的个人折扣与旧代理商归属）加入企业。
	seedAgentUser(t, 200, "user-200")
	require.NoError(t, DB.Model(&User{}).Where("id = ?", 200).
		Updates(map[string]interface{}{"model_discounts": `{"old-model":0.5}`, "agent_id": 2}).Error)
	require.NoError(t, AddOrgMember(&OrgMember{OrgId: org.Id, UserId: 200, OrgRole: OrgRoleMember, Status: OrgMemberStatusEnabled}))

	agentId, discounts := reloadUserAgent(t, 200)
	assert.Equal(t, 1, agentId, "加入企业应继承企业的代理商归属")
	assert.Equal(t, `{"gpt-4o":0.9}`, discounts, "加入企业应以企业折扣整表覆盖个人折扣")
}

// ---------------------------------------------------------------------------
// 钱包权限矩阵
// ---------------------------------------------------------------------------

// TestOrgWalletPolicyMatrix 表驱动覆盖四列角色 × 充值/个人钱包动作的判权。
func TestOrgWalletPolicyMatrix(t *testing.T) {
	tests := []struct {
		name           string
		policy         *OrgWalletPolicy
		wantCanTopUp   bool
		wantTopUpOrgId int
		wantPersonal   bool
	}{
		{
			name:           "非成员不受限",
			policy:         nil,
			wantCanTopUp:   true,
			wantTopUpOrgId: 0,
			wantPersonal:   true,
		},
		{
			name:           "企业管理员(既有用户)开关开:充值入池,禁个人钱包",
			policy:         &OrgWalletPolicy{OrgId: 10, IsAdmin: true, SubUser: false, WalletDisabled: true},
			wantCanTopUp:   true,
			wantTopUpOrgId: 10,
			wantPersonal:   false,
		},
		{
			name:           "企业管理员(子账号)开关开:充值入池,禁个人钱包",
			policy:         &OrgWalletPolicy{OrgId: 10, IsAdmin: true, SubUser: true, WalletDisabled: true},
			wantCanTopUp:   true,
			wantTopUpOrgId: 10,
			wantPersonal:   false,
		},
		{
			name:           "普通成员(既有用户)开关关:充值入个人,可用个人钱包",
			policy:         &OrgWalletPolicy{OrgId: 10, IsAdmin: false, SubUser: false, WalletDisabled: false},
			wantCanTopUp:   true,
			wantTopUpOrgId: 0,
			wantPersonal:   true,
		},
		{
			name:           "普通成员(既有用户)开关开:拦截充值,禁个人钱包",
			policy:         &OrgWalletPolicy{OrgId: 10, IsAdmin: false, SubUser: false, WalletDisabled: true},
			wantCanTopUp:   false,
			wantTopUpOrgId: 0,
			wantPersonal:   false,
		},
		{
			name:           "子账号成员开关关:永远拦截充值,永远禁个人钱包",
			policy:         &OrgWalletPolicy{OrgId: 10, IsAdmin: false, SubUser: true, WalletDisabled: false},
			wantCanTopUp:   false,
			wantTopUpOrgId: 0,
			wantPersonal:   false,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.wantCanTopUp, tc.policy.CanTopUp())
			assert.Equal(t, tc.wantTopUpOrgId, tc.policy.TopUpOrgId())
			assert.Equal(t, tc.wantPersonal, tc.policy.CanUsePersonalWallet())
		})
	}
}

// TestGetUserOrgWalletPolicy 校验策略读取：子账号标记、管理员入池、非成员返回 nil。
func TestGetUserOrgWalletPolicy(t *testing.T) {
	setupOrgAgentFixture(t)
	org := seedOrg(t, 10, 1000, OrgStatusEnabled)
	require.NoError(t, DB.Model(&Organization{}).Where("id = ?", org.Id).
		Update("disable_personal_wallet", true).Error)

	// 管理员（既有用户）
	seedOrgMember(t, org, 100, OrgRoleAdmin, 0, OrgMemberStatusEnabled)
	// 子账号成员
	subMember := seedOrgMember(t, org, 101, OrgRoleMember, 0, OrgMemberStatusEnabled)
	require.NoError(t, DB.Model(&OrgMember{}).Where("id = ?", subMember.Id).Update("sub_user", true).Error)

	adminPolicy, err := GetUserOrgWalletPolicy(100)
	require.NoError(t, err)
	require.NotNil(t, adminPolicy)
	assert.True(t, adminPolicy.IsAdmin)
	assert.True(t, adminPolicy.WalletDisabled)
	assert.Equal(t, 10, adminPolicy.TopUpOrgId())

	subPolicy, err := GetUserOrgWalletPolicy(101)
	require.NoError(t, err)
	require.NotNil(t, subPolicy)
	assert.True(t, subPolicy.SubUser)
	assert.False(t, subPolicy.CanTopUp())
	assert.False(t, subPolicy.CanUsePersonalWallet())

	// 非成员返回 (nil, nil)
	seedAgentUser(t, 300, "user-300")
	nonePolicy, err := GetUserOrgWalletPolicy(300)
	require.NoError(t, err)
	assert.Nil(t, nonePolicy)
}

// ---------------------------------------------------------------------------
// 充值下单快照入池 + 确认幂等
// ---------------------------------------------------------------------------

func seedPendingTopUp(t *testing.T, tradeNo string, userId int, orgId int, amount int64, provider string) *TopUp {
	t.Helper()
	topUp := &TopUp{
		UserId:          userId,
		OrgId:           orgId,
		Amount:          amount,
		TradeNo:         tradeNo,
		PaymentMethod:   provider,
		PaymentProvider: provider,
		Status:          common.TopUpStatusPending,
		CreateTime:      common.GetTimestamp(),
	}
	require.NoError(t, DB.Create(topUp).Error)
	return topUp
}

// TestSettleTopUpCreditsOrgPool OrgId>0 的订单入账计入企业池，个人钱包不变。
func TestSettleTopUpCreditsOrgPool(t *testing.T) {
	setupOrgAgentFixture(t)
	org := seedOrg(t, 10, 500, OrgStatusEnabled)
	seedOrgMember(t, org, 100, OrgRoleAdmin, 0, OrgMemberStatusEnabled)
	seedPendingTopUp(t, "trade-pool-1", 100, org.Id, 10, PaymentProviderEpay)

	expected := int(decimal.NewFromInt(10).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).IntPart())
	topUp, settled, err := SettleTopUpByTradeNo("trade-pool-1", PaymentProviderEpay, nil)
	require.NoError(t, err)
	assert.True(t, settled)
	assert.Equal(t, common.TopUpStatusSuccess, topUp.Status)
	assert.Equal(t, 500+expected, reloadOrg(t, org.Id).Quota, "充值应直入企业池")
	assert.Equal(t, 0, reloadUserQuota(t, 100), "个人钱包不得因入池充值而变化")
}

// TestSettleTopUpCreditsPersonalWallet OrgId=0 的订单入账计入个人钱包，企业池不变。
func TestSettleTopUpCreditsPersonalWallet(t *testing.T) {
	setupOrgAgentFixture(t)
	org := seedOrg(t, 10, 500, OrgStatusEnabled)
	seedOrgMember(t, org, 100, OrgRoleAdmin, 0, OrgMemberStatusEnabled)
	seedPendingTopUp(t, "trade-personal-1", 100, 0, 10, PaymentProviderEpay)

	expected := int(decimal.NewFromInt(10).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).IntPart())
	_, settled, err := SettleTopUpByTradeNo("trade-personal-1", PaymentProviderEpay, nil)
	require.NoError(t, err)
	assert.True(t, settled)
	assert.Equal(t, expected, reloadUserQuota(t, 100))
	assert.Equal(t, 500, reloadOrg(t, org.Id).Quota, "个人充值不得动企业池")
}

// TestSettleTopUpIdempotent 已成功的订单再次确认不重复入账（幂等），settled=false。
func TestSettleTopUpIdempotent(t *testing.T) {
	setupOrgAgentFixture(t)
	org := seedOrg(t, 10, 0, OrgStatusEnabled)
	seedOrgMember(t, org, 100, OrgRoleAdmin, 0, OrgMemberStatusEnabled)
	seedPendingTopUp(t, "trade-idem-1", 100, org.Id, 10, PaymentProviderEpay)

	_, settled1, err := SettleTopUpByTradeNo("trade-idem-1", PaymentProviderEpay, nil)
	require.NoError(t, err)
	require.True(t, settled1)
	quotaAfterFirst := reloadOrg(t, org.Id).Quota

	_, settled2, err := SettleTopUpByTradeNo("trade-idem-1", PaymentProviderEpay, nil)
	require.NoError(t, err)
	assert.False(t, settled2, "重复确认应幂等返回 settled=false")
	assert.Equal(t, quotaAfterFirst, reloadOrg(t, org.Id).Quota, "重复确认不得二次入账")
}

// TestSettleTopUpProviderMismatch 支付网关不匹配的订单被拒绝入账。
func TestSettleTopUpProviderMismatch(t *testing.T) {
	setupOrgAgentFixture(t)
	org := seedOrg(t, 10, 0, OrgStatusEnabled)
	seedPendingTopUp(t, "trade-mismatch-1", 100, org.Id, 10, PaymentProviderEpay)

	_, _, err := SettleTopUpByTradeNo("trade-mismatch-1", PaymentProviderStripe, nil)
	assert.ErrorIs(t, err, ErrPaymentMethodMismatch)
	assert.Equal(t, 0, reloadOrg(t, org.Id).Quota)
}

// TestSettleTopUpOrgMissingFallback 下单后企业被删（OrgId 悬空）时降级入个人钱包，资金不丢。
func TestSettleTopUpOrgMissingFallback(t *testing.T) {
	setupOrgAgentFixture(t)
	seedOrgMember(t, seedOrg(t, 10, 0, OrgStatusEnabled), 100, OrgRoleAdmin, 0, OrgMemberStatusEnabled)
	// 订单快照指向一个不存在的企业 999。
	seedPendingTopUp(t, "trade-fallback-1", 100, 999, 10, PaymentProviderEpay)

	expected := int(decimal.NewFromInt(10).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).IntPart())
	_, settled, err := SettleTopUpByTradeNo("trade-fallback-1", PaymentProviderEpay, nil)
	require.NoError(t, err)
	assert.True(t, settled)
	assert.Equal(t, expected, reloadUserQuota(t, 100), "企业缺失应降级入个人钱包")
}

// TestCreditQuotaProviders 各网关的额度换算口径：Creem 原值、Stripe 按 Money、其他按 Amount。
func TestCreditQuotaProviders(t *testing.T) {
	perUnit := decimal.NewFromFloat(common.QuotaPerUnit)
	tests := []struct {
		name     string
		topUp    *TopUp
		expected int
	}{
		{name: "creem 按 Amount 原值", topUp: &TopUp{PaymentProvider: PaymentProviderCreem, Amount: 12345}, expected: 12345},
		{
			name:     "stripe 按 Money*QuotaPerUnit",
			topUp:    &TopUp{PaymentProvider: PaymentProviderStripe, Money: 20},
			expected: int(decimal.NewFromFloat(20).Mul(perUnit).IntPart()),
		},
		{
			name:     "epay 按 Amount*QuotaPerUnit",
			topUp:    &TopUp{PaymentProvider: PaymentProviderEpay, Amount: 10},
			expected: int(decimal.NewFromInt(10).Mul(perUnit).IntPart()),
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.expected, tc.topUp.CreditQuota())
		})
	}
}

// TestSettleTopUpByTradeNoNotFound 不存在的订单号返回 ErrTopUpNotFound。
func TestSettleTopUpByTradeNoNotFound(t *testing.T) {
	setupOrgAgentFixture(t)
	_, _, err := SettleTopUpByTradeNo(fmt.Sprintf("nope-%d", common.GetTimestamp()), "", nil)
	assert.ErrorIs(t, err, ErrTopUpNotFound)
}

// TestSettleTopUpCreditRejectsNonPositive 计费不变量：入账额度非正时拒绝，池余额不变（不产生负值）。
func TestSettleTopUpCreditRejectsNonPositive(t *testing.T) {
	setupOrgAgentFixture(t)
	org := seedOrg(t, 10, 500, OrgStatusEnabled)
	topUp := &TopUp{UserId: 100, OrgId: org.Id, Amount: 0}
	err := DB.Transaction(func(tx *gorm.DB) error {
		return SettleTopUpCredit(tx, topUp, 0)
	})
	assert.Error(t, err)
	assert.Equal(t, 500, reloadOrg(t, org.Id).Quota)
}
