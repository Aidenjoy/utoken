package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSearchUsersByAgentAndOrg 锁定管理端用户检索的归属口径。
//
// 代理商一栏必须同时带出「直接发展的人」与「其名下企业里的所有人」：企业绑定代理商时
// 会把成员的 users.agent_id 刷成该代理商，但那是快照，解绑、存量数据或同步失败都会
// 对不上，所以还得按 org_members 再并一次，否则企业成员会从检索结果里静默漏掉。
// 企业一栏只认 org_members（事实源）。两个条件同时给出时取交集，且无命中必须返回空，
// 不能回退成全量用户。
func TestSearchUsersByAgentAndOrg(t *testing.T) {
	setupOrgAgentFixture(t)

	owner := seedAgentUser(t, 9001, "agent-owner")
	require.NoError(t, DB.Model(&User{}).Where("id = ?", owner.Id).Update("display_name", "Acme Reseller").Error)
	seedAgent(t, 1, 9001, `{"gpt-4o":0.8}`)

	// 直接发展的个人成员：只有 users.agent_id，没有企业。
	direct := &User{
		Id: 7001, Username: "direct-member", AffCode: "aff-7001",
		Status: common.UserStatusEnabled, Group: DefaultUserGroup, AgentId: 1,
	}
	require.NoError(t, DB.Create(direct).Error)

	// 代理商名下企业；成员快照没同步（agent_id 仍为 0），只能靠 org_members 命中。
	agentOrg := seedOrg(t, 10, 0, OrgStatusEnabled)
	seedOrgAttribution(t, agentOrg.Id, map[string]interface{}{"agent_id": 1})
	seedOrgMember(t, agentOrg, 7002, OrgRoleMember, 0, OrgMemberStatusEnabled)

	// 直销企业（无代理商）：其成员不得出现在代理商检索结果里。
	directOrg := seedOrg(t, 11, 0, OrgStatusEnabled)
	seedOrgMember(t, directOrg, 7003, OrgRoleMember, 0, OrgMemberStatusEnabled)

	// 只剩邀请关系的人：旧 referrer 口径已废，代理商检索不该命中他。
	referred := &User{
		Id: 7004, Username: "referred-only", AffCode: "aff-7004",
		Status: common.UserStatusEnabled, Group: DefaultUserGroup, InviterId: 9001,
	}
	require.NoError(t, DB.Create(referred).Error)

	search := func(agentKeyword, orgKeyword string) []string {
		t.Helper()
		users, total, err := SearchUsers("", "", nil, nil, agentKeyword, orgKeyword, 0, 100)
		require.NoError(t, err)
		require.EqualValues(t, len(users), total, "total 必须与实际行数一致")
		names := make([]string, 0, len(users))
		for _, u := range users {
			names = append(names, u.Username)
		}
		return names
	}

	t.Run("agent covers own members and its enterprises' members", func(t *testing.T) {
		assert.ElementsMatch(t, []string{"direct-member", "user-7002"}, search("agent-owner", ""))
		// 归属账号的显示名同样能匹配
		assert.ElementsMatch(t, []string{"direct-member", "user-7002"}, search("Acme Reseller", ""))
	})

	t.Run("org covers only that enterprise's members", func(t *testing.T) {
		assert.ElementsMatch(t, []string{"user-7002"}, search("", agentOrg.Name))
		assert.ElementsMatch(t, []string{"user-7003"}, search("", directOrg.Name))
		// 企业显示名同样能匹配
		assert.ElementsMatch(t, []string{"user-7002"}, search("", agentOrg.DisplayName))
	})

	t.Run("both narrow to the intersection", func(t *testing.T) {
		assert.ElementsMatch(t, []string{"user-7002"}, search("agent-owner", agentOrg.Name))
		// 直销企业不属于该代理商 → 交集为空
		assert.Empty(t, search("agent-owner", directOrg.Name))
	})

	t.Run("no match returns empty instead of everything", func(t *testing.T) {
		assert.Empty(t, search("no-such-agent", ""))
		assert.Empty(t, search("", "no-such-org"))
	})
}
