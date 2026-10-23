package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestBackfillTokenRateDiscounts 守护「设置费率」两字段改造的旧数据回填契约：
// 已有 token_rate 但未经新 UI 设置（purchase_discount=0）的行，按旧公式口径回填「渠道采购折扣=1、客户期望折扣=token_rate」
// （公式改为 采购/期望 后该组合不再复现费率，但 token_rate 是持久化计费真源，存量费率不受影响）；
// token_rate=0 的行不动；已用新 UI 设置过（purchase_discount>0）的行不被覆盖；重复运行结果不变（幂等）。
func TestBackfillTokenRateDiscounts(t *testing.T) {
	setupOrgFixture(t)

	require.NoError(t, DB.Create(&User{Id: 1, Username: "legacy", AffCode: "aff-legacy", TokenRate: 1.5}).Error)
	require.NoError(t, DB.Create(&User{Id: 2, Username: "norate", AffCode: "aff-norate", TokenRate: 0}).Error)
	require.NoError(t, DB.Create(&User{Id: 3, Username: "set", AffCode: "aff-set", TokenRate: 1.5, ExpectedDiscount: 0.9, PurchaseDiscount: 0.6}).Error)
	require.NoError(t, DB.Create(&Organization{Id: 1, Name: "org-legacy", DisplayName: "Org Legacy", Group: "vip", Status: OrgStatusEnabled, TokenRate: 1.2}).Error)

	require.NoError(t, backfillTokenRateDiscounts())

	var legacy User
	require.NoError(t, DB.First(&legacy, 1).Error)
	assert.InDelta(t, 1.5, legacy.TokenRate, 1e-9)
	assert.InDelta(t, 1.0, legacy.PurchaseDiscount, 1e-9)
	assert.InDelta(t, 1.5, legacy.ExpectedDiscount, 1e-9)

	var noRate User
	require.NoError(t, DB.First(&noRate, 2).Error)
	assert.Zero(t, noRate.PurchaseDiscount)
	assert.Zero(t, noRate.ExpectedDiscount)

	var alreadySet User
	require.NoError(t, DB.First(&alreadySet, 3).Error)
	assert.InDelta(t, 0.9, alreadySet.ExpectedDiscount, 1e-9)
	assert.InDelta(t, 0.6, alreadySet.PurchaseDiscount, 1e-9)

	var org Organization
	require.NoError(t, DB.First(&org, 1).Error)
	assert.InDelta(t, 1.0, org.PurchaseDiscount, 1e-9)
	assert.InDelta(t, 1.2, org.ExpectedDiscount, 1e-9)

	// 幂等：再次运行不改变已回填或已用新 UI 设置过的行
	require.NoError(t, backfillTokenRateDiscounts())
	require.NoError(t, DB.First(&legacy, 1).Error)
	assert.InDelta(t, 1.0, legacy.PurchaseDiscount, 1e-9)
	assert.InDelta(t, 1.5, legacy.ExpectedDiscount, 1e-9)
	require.NoError(t, DB.First(&alreadySet, 3).Error)
	assert.InDelta(t, 0.9, alreadySet.ExpectedDiscount, 1e-9)
	assert.InDelta(t, 0.6, alreadySet.PurchaseDiscount, 1e-9)
}

// TestSetOrganizationTokenRatePropagatesDiscounts 守护企业费率「保存即覆盖」：
// 设置企业费率时，token_rate 与折扣分子分母一并写入企业及全部成员，并同步费率缓存；清除时三者归零。
func TestSetOrganizationTokenRatePropagatesDiscounts(t *testing.T) {
	setupOrgFixture(t)

	org := seedOrg(t, 1, 0, OrgStatusEnabled)
	seedOrgMember(t, org, 10, OrgRoleMember, 0, OrgMemberStatusEnabled)
	seedOrgMember(t, org, 11, OrgRoleMember, 0, OrgMemberStatusEnabled)

	require.NoError(t, SetOrganizationTokenRate(org.Id, 1.5, 0.9, 0.6))

	reloaded := reloadOrg(t, org.Id)
	assert.InDelta(t, 1.5, reloaded.TokenRate, 1e-9)
	assert.InDelta(t, 0.9, reloaded.ExpectedDiscount, 1e-9)
	assert.InDelta(t, 0.6, reloaded.PurchaseDiscount, 1e-9)

	for _, uid := range []int{10, 11} {
		var member User
		require.NoError(t, DB.First(&member, uid).Error)
		assert.InDelta(t, 1.5, member.TokenRate, 1e-9)
		assert.InDelta(t, 0.9, member.ExpectedDiscount, 1e-9)
		assert.InDelta(t, 0.6, member.PurchaseDiscount, 1e-9)
		// 缓存同步：计费读路径直接命中新费率，无需回源查库
		assert.InDelta(t, 1.5, GetUserTokenRate(uid), 1e-9)
	}

	require.NoError(t, SetOrganizationTokenRate(org.Id, 0, 0, 0))

	reloaded = reloadOrg(t, org.Id)
	assert.Zero(t, reloaded.TokenRate)
	assert.Zero(t, reloaded.ExpectedDiscount)
	assert.Zero(t, reloaded.PurchaseDiscount)

	var member User
	require.NoError(t, DB.First(&member, 10).Error)
	assert.Zero(t, member.TokenRate)
	assert.Zero(t, member.ExpectedDiscount)
	assert.Zero(t, member.PurchaseDiscount)
	assert.Zero(t, GetUserTokenRate(10))
}
