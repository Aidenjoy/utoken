package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 本文件覆盖「代理商 ↔ 企业成员互斥」与「企业归属字段进出清理」两组不变量。
// 计费只认 users.model_discounts 这一个字段，企业折扣保存时整表覆盖全部成员，
// 因此代理商一旦进入企业，两套折扣体系就会互相冲掉；一人多企业同理会让人
// 同时受两家企业的白名单与价格约束。所有用例跑在内存 SQLite 上，Redis 关闭，
// 缓存失效路径为 no-op，断言只针对落库状态。

// seedOrgAttribution 直接写入企业的归属字段（代理商、折扣、费率及其分子分母），
// 绕过 SetOrganizationAgent/SetOrganizationModelDiscounts 的联动，
// 让用例只考察 AddOrgMember/RemoveOrgMember 对既有企业状态的继承与清理。
func seedOrgAttribution(t *testing.T, orgId int, fields map[string]interface{}) {
	t.Helper()
	require.NoError(t, DB.Model(&Organization{}).Where("id = ?", orgId).Updates(fields).Error)
}

// reloadUserAttribution 绕过缓存直接读库，取出退企/入企断言需要的全部归属字段。
// 不加 Select 白名单：group 是三种数据库各自的保留字，拼列名得走 commonGroupCol，
// 整行读取更直接。
func reloadUserAttribution(t *testing.T, userId int) *User {
	t.Helper()
	var user User
	require.NoError(t, DB.Where("id = ?", userId).First(&user).Error)
	return &user
}

// ---------------------------------------------------------------------------
// 代理商不得进入企业
// ---------------------------------------------------------------------------

// TestAddOrgMemberRejectsAgent 代理商本人不得成为企业成员，且被拒时不留成员记录。
// 管理员身份同样拦不住——企业折扣是整表覆盖，代理商只要在企业里就会被冲掉自身定价。
func TestAddOrgMemberRejectsAgent(t *testing.T) {
	setupOrgAgentFixture(t)
	seedAgent(t, 1, 9001, `{"gpt-4o":0.8}`)
	seedAgentUser(t, 9001, "agent-owner")
	org := seedOrg(t, 10, 0, OrgStatusEnabled)

	err := AddOrgMember(&OrgMember{OrgId: org.Id, UserId: 9001, OrgRole: OrgRoleAdmin})

	require.ErrorIs(t, err, ErrOrgMemberIsAgent)
	var members int64
	require.NoError(t, DB.Model(&OrgMember{}).Where("user_id = ?", 9001).Count(&members).Error)
	assert.Zero(t, members, "入企被拒后不得残留成员记录")
}

// TestCreateOrganizationWithSetupRejectsAgentOwner 代理商不得被任命为建企业时的首位管理员，
// 且资格校验失败要整体回滚，不能像旧实现那样先提交企业再报用户名错误、留下无主企业。
func TestCreateOrganizationWithSetupRejectsAgentOwner(t *testing.T) {
	setupOrgAgentFixture(t)
	seedAgent(t, 1, 9001, `{"gpt-4o":0.8}`)
	seedAgentUser(t, 9001, "agent-owner")
	org := &Organization{
		Name:        fmt.Sprintf("org-agent-owner-%d", common.GetTimestamp()),
		DisplayName: "Agent Owner",
		Group:       "vip",
		Status:      OrgStatusEnabled,
	}

	err := CreateOrganizationWithSetup(org, 0, 9001)

	require.ErrorIs(t, err, ErrOrgMemberIsAgent)
	var orgs int64
	require.NoError(t, DB.Model(&Organization{}).Count(&orgs).Error)
	assert.Zero(t, orgs, "任命管理员失败必须回滚整个建企业事务")
}

// TestSetOrganizationAgentRejectsSelfBind 企业不得绑定到本身是其成员的代理商：
// 绑定会把全部成员的 users.agent_id 刷成该代理商，绑到自己人头上会让代理商
// 出现在自己的成员列表里并能给自己设折扣。
func TestSetOrganizationAgentRejectsSelfBind(t *testing.T) {
	setupOrgAgentFixture(t)
	seedAgent(t, 1, 9001, `{"gpt-4o":0.8}`)
	org := seedOrg(t, 10, 0, OrgStatusEnabled)
	seedOrgMember(t, org, 9001, OrgRoleAdmin, 0, OrgMemberStatusEnabled)

	err := SetOrganizationAgent(org.Id, 1)

	require.ErrorIs(t, err, ErrOrgAgentSelfBind)
	assert.Zero(t, reloadOrg(t, org.Id).AgentId, "绑定被拒后企业不得残留 agent_id")
}

// TestCreateAgentRejectsOrgMember 互斥规则的另一端：已是企业成员的用户不得被提升为代理商。
func TestCreateAgentRejectsOrgMember(t *testing.T) {
	setupOrgAgentFixture(t)
	org := seedOrg(t, 10, 0, OrgStatusEnabled)
	seedOrgMember(t, org, 100, OrgRoleMember, 0, OrgMemberStatusEnabled)

	err := CreateAgent(&Agent{UserId: 100, ModelDiscounts: `{"gpt-4o":0.8}`, Status: AgentStatusEnabled})

	require.ErrorIs(t, err, ErrAgentUserInOrg)
	var agents int64
	require.NoError(t, DB.Model(&Agent{}).Where("user_id = ?", 100).Count(&agents).Error)
	assert.Zero(t, agents)
}

// ---------------------------------------------------------------------------
// 一人一企业
// ---------------------------------------------------------------------------

// TestAddOrgMemberRejectsSecondOrg 已在任一企业内的用户不得再加入第二家企业。
// org_members 的唯一索引是 (org_id, user_id) 复合的，拦不住跨企业重复入企，
// 只能靠事务内的成员计数（配合用户行锁）保证。
func TestAddOrgMemberRejectsSecondOrg(t *testing.T) {
	setupOrgAgentFixture(t)
	first := seedOrg(t, 10, 0, OrgStatusEnabled)
	second := seedOrg(t, 11, 0, OrgStatusEnabled)
	seedOrgMember(t, first, 100, OrgRoleMember, 0, OrgMemberStatusEnabled)

	err := AddOrgMember(&OrgMember{OrgId: second.Id, UserId: 100, OrgRole: OrgRoleMember})

	require.ErrorIs(t, err, ErrOrgUserAlreadyInOrg)
	var members int64
	require.NoError(t, DB.Model(&OrgMember{}).Where("org_id = ? AND user_id = ?", second.Id, 100).Count(&members).Error)
	assert.Zero(t, members, "第二家企业的成员记录不得写入")
	assert.Equal(t, first.Id, reloadUserAttribution(t, 100).OrgId, "原企业归属不得被改动")
}

// TestIsUserInAnyOrgFollowsMemberTable 企业归属判定以 org_members 为事实源。
// users.org_id 只是快照，两者不一致时（例如注册时补登成员记录失败）
// 代理商控制台的邀请/踢出必须按成员表判定，否则企业成员会被当成个人成员邀请走。
func TestIsUserInAnyOrgFollowsMemberTable(t *testing.T) {
	setupOrgAgentFixture(t)
	org := seedOrg(t, 10, 0, OrgStatusEnabled)
	seedAgentUser(t, 100, "member-100")
	require.NoError(t, DB.Create(&OrgMember{
		OrgId: org.Id, UserId: 100, OrgRole: OrgRoleMember,
		Status: OrgMemberStatusEnabled, JoinedAt: common.GetTimestamp(),
	}).Error)

	inOrg, err := IsUserInAnyOrg(100)

	require.NoError(t, err)
	assert.True(t, inOrg, "org_members 有记录即算在企业内，users.org_id 快照缺失不影响判定")
	assert.Zero(t, reloadUserAttribution(t, 100).OrgId, "前置条件：快照确实与成员表不一致")
}

// ---------------------------------------------------------------------------
// 归属字段的进出清理
// ---------------------------------------------------------------------------

// TestAddOrgMemberOverwritesPersonalAttribution 入企时归属字段无条件随企业。
// 旧实现是「企业有值才覆盖」，于是已绑定代理商 A 的用户加入直销企业后仍带着
// agent_id=A 与 A 给的折扣——受 A 的白名单约束，企业却以为自己在管他。
func TestAddOrgMemberOverwritesPersonalAttribution(t *testing.T) {
	setupOrgAgentFixture(t)
	seedAgent(t, 1, 9001, `{"gpt-4o":0.8}`)
	seedAgent(t, 2, 9002, `{"gpt-4o":0.7}`)
	// 直销企业：不归属任何代理商（agent_id=0），但自带一套折扣与费率。
	org := seedOrg(t, 10, 0, OrgStatusEnabled)
	seedOrgAttribution(t, org.Id, map[string]interface{}{
		"agent_id":          0,
		"model_discounts":   `{"gpt-4o":0.95}`,
		"token_rate":        1.25,
		"expected_discount": 0.9,
		"purchase_discount": 0.8,
	})
	// 用户原先挂在代理商 2 名下，带着 2 给的折扣与费率。
	seedAgentUser(t, 100, "member-100")
	require.NoError(t, DB.Model(&User{}).Where("id = ?", 100).Updates(map[string]interface{}{
		"agent_id": 2, "model_discounts": `{"gpt-4o":0.7}`, "token_rate": 2.0,
	}).Error)

	require.NoError(t, AddOrgMember(&OrgMember{OrgId: org.Id, UserId: 100, OrgRole: OrgRoleMember}))

	user := reloadUserAttribution(t, 100)
	assert.Zero(t, user.AgentId, "加入直销企业必须解绑原代理商，否则白名单仍受原代理商约束")
	assert.JSONEq(t, `{"gpt-4o":0.95}`, user.ModelDiscounts, "折扣必须换成企业的，不能留着原代理商给的")
	assert.Equal(t, org.Id, user.OrgId)
	assert.Equal(t, org.Group, user.Group)
	assert.InDelta(t, 1.25, user.TokenRate, 1e-9)
	assert.InDelta(t, 0.9, user.ExpectedDiscount, 1e-9)
	assert.InDelta(t, 0.8, user.PurchaseDiscount, 1e-9)
}

// TestRemoveOrgMemberClearsAttribution 退企把加入时继承的归属字段全部清零，
// 但保留账号本身。留着企业下发的折扣与 agent_id 等于「退企即锁定企业折扣」：
// 人走了还按企业价计费，并继续挂在原代理商名下（ListAgentMembers 按 users.agent_id 查），
// 代理商仍能给他改价。
func TestRemoveOrgMemberClearsAttribution(t *testing.T) {
	setupOrgAgentFixture(t)
	seedAgent(t, 1, 9001, `{"gpt-4o":0.8}`)
	org := seedOrg(t, 10, 0, OrgStatusEnabled)
	seedOrgAttribution(t, org.Id, map[string]interface{}{
		"agent_id":          1,
		"model_discounts":   `{"gpt-4o":0.9}`,
		"token_rate":        1.5,
		"expected_discount": 0.9,
		"purchase_discount": 0.8,
	})
	seedAgentUser(t, 100, "member-100")
	require.NoError(t, AddOrgMember(&OrgMember{OrgId: org.Id, UserId: 100, OrgRole: OrgRoleMember}))
	// 前置：入企确实把归属字段刷成了企业的值，退企清理才有意义。
	require.Equal(t, 1, reloadUserAttribution(t, 100).AgentId)
	require.InDelta(t, 1.5, reloadUserAttribution(t, 100).TokenRate, 1e-9)

	require.NoError(t, RemoveOrgMember(org.Id, 100))

	user := reloadUserAttribution(t, 100)
	assert.Zero(t, user.OrgId)
	assert.Equal(t, DefaultUserGroup, user.Group, "分组回落系统默认组，不能继续走企业分组的价格")
	assert.Zero(t, user.AgentId, "退企后不得继续挂在原代理商名下")
	assert.Empty(t, user.ModelDiscounts, "退企后回到原价，不能继续按企业折扣计费")
	assert.Zero(t, user.TokenRate)
	assert.Zero(t, user.ExpectedDiscount)
	assert.Zero(t, user.PurchaseDiscount)
	var members int64
	require.NoError(t, DB.Model(&OrgMember{}).Where("user_id = ?", 100).Count(&members).Error)
	assert.Zero(t, members)
	// 只解绑不注销：账号还在，退出后可以再加入别的企业。
	require.NoError(t, DB.Select("id").Where("id = ?", 100).First(&User{}).Error)
	inOrg, err := IsUserInAnyOrg(100)
	require.NoError(t, err)
	assert.False(t, inOrg)
}
