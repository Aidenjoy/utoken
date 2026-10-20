package model

import (
	"fmt"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// seedAgent 直接写入一条代理商记录，主键与归属用户显式给定，
// 供 agent 与 invite_code 两组测试共用（后者要靠 agents.id 复现注册绑定）。
// 绕过 CreateAgent 的授权校验：测试需要构造合法与非法两种配置。
func seedAgent(t *testing.T, id int, userId int, modelDiscountsJSON string) *Agent {
	t.Helper()
	agent := &Agent{
		Id:             id,
		UserId:         userId,
		ModelDiscounts: modelDiscountsJSON,
		Status:         AgentStatusEnabled,
	}
	require.NoError(t, DB.Create(agent).Error)
	return agent
}

func seedAgentUser(t *testing.T, id int, username string) *User {
	t.Helper()
	u := &User{
		Id: id, Username: username, AffCode: fmt.Sprintf("aff-%d", id),
		Status: common.UserStatusEnabled, Group: DefaultUserGroup,
	}
	require.NoError(t, DB.Create(u).Error)
	return u
}

// TestValidateAgentModelDiscounts 覆盖授权配置落库前的校验：
// 空清单单独报错（有自己的 i18n 文案），其余违规一律收敛为 ErrAgentModelDiscountsInvalid。
func TestValidateAgentModelDiscounts(t *testing.T) {
	tests := []struct {
		name    string
		json    string
		wantErr error
	}{
		{name: "single model accepted", json: `{"gpt-4o":0.8}`, wantErr: nil},
		{name: "multiple models accepted", json: `{"gpt-4o":0.8,"claude-3-5-sonnet":1}`, wantErr: nil},
		{name: "empty object rejected", json: `{}`, wantErr: common.ErrAgentModelsEmpty},
		{name: "empty string rejected", json: ``, wantErr: common.ErrAgentModelsEmpty},
		// 损坏的 JSON 被 ParseModelDiscounts 解析成 nil，等价于"没有授权任何模型"，
		// 因此同样落到 ErrAgentModelsEmpty。写入路径由 controller 序列化规范化结果，
		// 正常不会产生损坏 JSON，这里只锁定"损坏不会被当成有效配置放行"。
		{name: "malformed json rejected", json: `{"gpt-4o":`, wantErr: common.ErrAgentModelsEmpty},
		{name: "wildcard key rejected", json: `{"gpt-4o*":0.8}`, wantErr: ErrAgentModelDiscountsInvalid},
		{name: "global wildcard rejected", json: `{"*":0.8}`, wantErr: ErrAgentModelDiscountsInvalid},
		{name: "zero discount rejected", json: `{"gpt-4o":0}`, wantErr: ErrAgentModelDiscountsInvalid},
		{name: "negative discount rejected", json: `{"gpt-4o":-0.5}`, wantErr: ErrAgentModelDiscountsInvalid},
		{name: "discount above one rejected", json: `{"gpt-4o":1.2}`, wantErr: ErrAgentModelDiscountsInvalid},
		{name: "empty model name rejected", json: `{"  ":0.8}`, wantErr: ErrAgentModelDiscountsInvalid},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := validateAgentModelDiscounts(tc.json)
			if tc.wantErr == nil {
				assert.NoError(t, err)
				return
			}
			assert.ErrorIs(t, err, tc.wantErr)
		})
	}

	t.Run("too long model name rejected", func(t *testing.T) {
		long := strings.Repeat("m", common.MaxModelDiscountKeyLength+1)
		err := validateAgentModelDiscounts(fmt.Sprintf(`{%q:0.8}`, long))
		assert.ErrorIs(t, err, ErrAgentModelDiscountsInvalid)
	})

	t.Run("too many entries rejected", func(t *testing.T) {
		entries := make([]string, 0, common.MaxModelDiscountEntries+1)
		for i := 0; i <= common.MaxModelDiscountEntries; i++ {
			entries = append(entries, fmt.Sprintf(`"model-%d":0.8`, i))
		}
		err := validateAgentModelDiscounts("{" + strings.Join(entries, ",") + "}")
		assert.ErrorIs(t, err, ErrAgentModelDiscountsInvalid)
	})
}

// TestAgentModelFloorsAndAllowedModelsJSON 验证授权配置的两个派生视图：
// 折扣下限 map（给成员折扣编辑器用）与模型清单 JSON（写进用户缓存快照）。
func TestAgentModelFloorsAndAllowedModelsJSON(t *testing.T) {
	agent := &Agent{ModelDiscounts: `{"gpt-4o":0.8,"claude-3-5-sonnet":0.95,"a-model":1}`}

	floors := agent.ModelFloors()
	require.Len(t, floors, 3)
	assert.InDelta(t, 0.8, floors["gpt-4o"], 1e-9)
	assert.InDelta(t, 0.95, floors["claude-3-5-sonnet"], 1e-9)
	assert.InDelta(t, 1.0, floors["a-model"], 1e-9)

	// 清单必须排序稳定：它会被前端当模型下拉的数据源，map 遍历顺序随机会让下拉每次刷新都换序。
	var names []string
	require.NoError(t, common.Unmarshal([]byte(agent.AllowedModelsJSON()), &names))
	assert.Equal(t, []string{"a-model", "claude-3-5-sonnet", "gpt-4o"}, names)

	t.Run("empty config yields no allowlist", func(t *testing.T) {
		empty := &Agent{ModelDiscounts: ""}
		assert.Nil(t, empty.ModelFloors())
		assert.Empty(t, empty.AllowedModelsJSON(), "empty JSON keeps fail-open semantics")
	})

	t.Run("malformed config yields no allowlist", func(t *testing.T) {
		broken := &Agent{ModelDiscounts: `{"gpt-4o":`}
		assert.Nil(t, broken.ModelFloors())
		assert.Empty(t, broken.AllowedModelsJSON())
	})
}

func TestParseAllowedModels(t *testing.T) {
	t.Run("empty and malformed parse to nil", func(t *testing.T) {
		assert.Nil(t, ParseAllowedModels(""))
		assert.Nil(t, ParseAllowedModels("   "))
		assert.Nil(t, ParseAllowedModels("[broken"))
	})

	t.Run("blank entries dropped", func(t *testing.T) {
		allowed := ParseAllowedModels(`["gpt-4o", "  ", "claude-3-5-sonnet"]`)
		assert.Len(t, allowed, 2)
	})

	t.Run("normalized model name also registered", func(t *testing.T) {
		// 与渠道能力表同构：额外登记归一化名，使带后缀的变体能命中族名配置。
		allowed := ParseAllowedModels(`["gpt-4-gizmo-*"]`)
		assert.True(t, allowed.Allows("gpt-4-gizmo-g-abc123"), "date/gizmo variants normalize onto the family name")
		assert.False(t, allowed.Allows("gpt-4o"))
	})
}

func TestAllowedModelsAllows(t *testing.T) {
	allowed := ParseAllowedModels(`["gpt-4o","claude-3-5-sonnet"]`)

	assert.True(t, allowed.Allows("gpt-4o"))
	assert.True(t, allowed.Allows("claude-3-5-sonnet"))
	assert.False(t, allowed.Allows("gpt-4o-mini"), "authorization is by exact model name, no prefix matching")
	assert.False(t, allowed.Allows(""), "empty model name never matches")

	var empty AllowedModels
	assert.False(t, empty.Allows("gpt-4o"), "empty allowlist denies by itself; caller decides fail-open")
}

func TestAllowedModelsFilter(t *testing.T) {
	candidates := []string{"gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet", "doubao-seedance"}

	t.Run("keeps only authorized models in input order", func(t *testing.T) {
		allowed := ParseAllowedModels(`["claude-3-5-sonnet","gpt-4o"]`)
		assert.Equal(t, []string{"gpt-4o", "claude-3-5-sonnet"}, allowed.Filter(candidates))
	})

	t.Run("no intersection yields empty list", func(t *testing.T) {
		allowed := ParseAllowedModels(`["some-other-model"]`)
		assert.Empty(t, allowed.Filter(candidates))
	})

	// 空清单等价于"不受限"（无代理归属或 fail-open）。若在这里清空列表，
	// 一处代理配置损坏就会把用户的可用模型清成空，比放行严重得多。
	t.Run("empty allowlist passes everything through", func(t *testing.T) {
		var empty AllowedModels
		assert.Equal(t, candidates, empty.Filter(candidates))
		assert.Nil(t, empty.Filter(nil))
	})
}

func TestResolveAllowedModels(t *testing.T) {
	t.Run("no agent means no restriction", func(t *testing.T) {
		// agentId<=0 时即使快照里有内容也不生效：解绑后的用户不该再受旧清单约束。
		assert.Nil(t, ResolveAllowedModels(0, `["gpt-4o"]`))
		assert.Nil(t, ResolveAllowedModels(-1, `["gpt-4o"]`))
	})

	t.Run("agent with valid snapshot restricts", func(t *testing.T) {
		allowed := ResolveAllowedModels(7, `["gpt-4o"]`)
		require.NotNil(t, allowed)
		assert.True(t, allowed.Allows("gpt-4o"))
		assert.False(t, allowed.Allows("gpt-4o-mini"))
	})

	t.Run("agent with broken snapshot fails open", func(t *testing.T) {
		// 返回 nil，调用方靠 len()==0 走 fail-open 放行 + SysError。
		assert.Nil(t, ResolveAllowedModels(7, ""))
		assert.Nil(t, ResolveAllowedModels(7, "[broken"))
	})
}

func TestCreateAgent(t *testing.T) {
	setupInviteFixture(t)
	seedAgentUser(t, 11, "agent_alice")

	t.Run("rejects nil and non-positive user id", func(t *testing.T) {
		assert.ErrorIs(t, CreateAgent(nil), ErrAgentNotFound)
		assert.ErrorIs(t, CreateAgent(&Agent{UserId: 0, ModelDiscounts: `{"gpt-4o":0.8}`}), ErrAgentNotFound)
	})

	t.Run("rejects empty authorization", func(t *testing.T) {
		err := CreateAgent(&Agent{UserId: 11, ModelDiscounts: ""})
		assert.ErrorIs(t, err, common.ErrAgentModelsEmpty)

		var count int64
		require.NoError(t, DB.Model(&Agent{}).Where("user_id = ?", 11).Count(&count).Error)
		assert.Equal(t, int64(0), count, "invalid config must not create a row")
	})

	t.Run("rejects wildcard authorization", func(t *testing.T) {
		err := CreateAgent(&Agent{UserId: 11, ModelDiscounts: `{"gpt-4o*":0.8}`})
		assert.ErrorIs(t, err, ErrAgentModelDiscountsInvalid)
	})

	t.Run("creates with default status", func(t *testing.T) {
		require.NoError(t, CreateAgent(&Agent{UserId: 11, ModelDiscounts: `{"gpt-4o":0.8}`, CreatedBy: 1}))
		agent, err := GetAgentByUserId(11)
		require.NoError(t, err)
		assert.Equal(t, AgentStatusEnabled, agent.Status, "status defaults to enabled")
		assert.Equal(t, 1, agent.CreatedBy)
	})

	t.Run("same user cannot be promoted twice", func(t *testing.T) {
		err := CreateAgent(&Agent{UserId: 11, ModelDiscounts: `{"claude-3-5-sonnet":0.9}`})
		assert.ErrorIs(t, err, ErrAgentAlreadyExists)
	})
}

func TestGetAgentLookups(t *testing.T) {
	setupInviteFixture(t)
	agent := seedAgent(t, 5, 15, `{"gpt-4o":0.8}`)

	byId, err := GetAgentById(5)
	require.NoError(t, err)
	assert.Equal(t, 15, byId.UserId)

	byUser, err := GetAgentByUserId(15)
	require.NoError(t, err)
	assert.Equal(t, agent.Id, byUser.Id)

	_, err = GetAgentById(0)
	assert.ErrorIs(t, err, ErrAgentNotFound)
	_, err = GetAgentById(999999)
	assert.ErrorIs(t, err, ErrAgentNotFound)
	_, err = GetAgentByUserId(0)
	assert.ErrorIs(t, err, ErrAgentNotFound)
	_, err = GetAgentByUserId(999999)
	assert.ErrorIs(t, err, ErrAgentNotFound)
}

func TestUpdateAgentFields(t *testing.T) {
	setupInviteFixture(t)
	seedAgent(t, 1, 11, `{"gpt-4o":0.8}`)

	t.Run("rejects unknown agent", func(t *testing.T) {
		assert.ErrorIs(t, UpdateAgentFields(0, map[string]interface{}{"remark": "x"}), ErrAgentNotFound)
		assert.ErrorIs(t, UpdateAgentFields(999999, map[string]interface{}{"remark": "x"}), ErrAgentNotFound)
	})

	t.Run("empty field set is a no-op", func(t *testing.T) {
		assert.NoError(t, UpdateAgentFields(1, map[string]interface{}{}))
	})

	t.Run("updates status and remark without touching authorization", func(t *testing.T) {
		require.NoError(t, UpdateAgentFields(1, map[string]interface{}{
			"status": AgentStatusDisabled,
			"remark": "paused",
		}))
		agent, err := GetAgentById(1)
		require.NoError(t, err)
		assert.Equal(t, AgentStatusDisabled, agent.Status)
		assert.Equal(t, "paused", agent.Remark)
		assert.JSONEq(t, `{"gpt-4o":0.8}`, agent.ModelDiscounts)
	})

	// 授权清单是整体替换：按模型逐个 merge 会让"取消授权某个模型"无法表达。
	t.Run("replaces the whole authorization list", func(t *testing.T) {
		require.NoError(t, UpdateAgentFields(1, map[string]interface{}{
			"model_discounts": `{"claude-3-5-sonnet":0.9,"gpt-4o-mini":0.7}`,
		}))
		agent, err := GetAgentById(1)
		require.NoError(t, err)
		assert.Equal(t, map[string]float64{"claude-3-5-sonnet": 0.9, "gpt-4o-mini": 0.7}, agent.ModelFloors())
	})

	t.Run("rejects invalid authorization and keeps the old one", func(t *testing.T) {
		err := UpdateAgentFields(1, map[string]interface{}{"model_discounts": `{}`})
		assert.ErrorIs(t, err, common.ErrAgentModelsEmpty)

		err = UpdateAgentFields(1, map[string]interface{}{"model_discounts": `{"gpt-4o*":0.8}`})
		assert.ErrorIs(t, err, ErrAgentModelDiscountsInvalid)

		err = UpdateAgentFields(1, map[string]interface{}{"model_discounts": `{"gpt-4o":0}`})
		assert.ErrorIs(t, err, ErrAgentModelDiscountsInvalid)

		agent, reloadErr := GetAgentById(1)
		require.NoError(t, reloadErr)
		assert.Equal(t, map[string]float64{"claude-3-5-sonnet": 0.9, "gpt-4o-mini": 0.7}, agent.ModelFloors(),
			"rejected updates must not partially apply")
	})
}

// TestDeleteAgentUnbindsMembers 验证删除代理商会解除其成员归属：
// 成员恢复全模型访问，而不是被永久锁死在一个已不存在的白名单外。
func TestDeleteAgentUnbindsMembers(t *testing.T) {
	setupInviteFixture(t)
	seedAgent(t, 1, 11, `{"gpt-4o":0.8}`)
	seedAgent(t, 2, 12, `{"claude-3-5-sonnet":0.9}`)

	seedMember := func(id, agentId int) *User {
		u := &User{
			Id: id, Username: fmt.Sprintf("u-%d", id), AffCode: fmt.Sprintf("aff-%d", id),
			Status: common.UserStatusEnabled, Group: DefaultUserGroup, AgentId: agentId,
		}
		require.NoError(t, DB.Create(u).Error)
		return u
	}
	seedMember(201, 1)
	seedMember(202, 1)
	seedMember(203, 2)
	seedMember(204, 0)

	require.NoError(t, DeleteAgent(1))

	_, err := GetAgentById(1)
	assert.ErrorIs(t, err, ErrAgentNotFound)

	assert.Equal(t, 0, reloadUserAgentId(t, 201), "members are unbound, not deleted")
	assert.Equal(t, 0, reloadUserAgentId(t, 202))
	assert.Equal(t, 2, reloadUserAgentId(t, 203), "other agents' members untouched")
	assert.Equal(t, 0, reloadUserAgentId(t, 204))

	var memberCount int64
	require.NoError(t, DB.Model(&User{}).Count(&memberCount).Error)
	assert.Equal(t, int64(4), memberCount, "deleting an agent never deletes users")

	assert.ErrorIs(t, DeleteAgent(1), ErrAgentNotFound, "second delete finds nothing")
	assert.ErrorIs(t, DeleteAgent(0), ErrAgentNotFound)
}

func reloadUserAgentId(t *testing.T, userId int) int {
	t.Helper()
	var agentId int
	require.NoError(t, DB.Model(&User{}).Where("id = ?", userId).Pluck("agent_id", &agentId).Error)
	return agentId
}

// TestListAgents 验证列表回填：代理商展示信息与其名下邀请码数量（一次聚合，不做 N+1）。
func TestListAgents(t *testing.T) {
	setupInviteFixture(t)
	seedAgentUser(t, 11, "agent_alice")
	seedAgentUser(t, 12, "agent_bob")
	seedAgent(t, 1, 11, `{"gpt-4o":0.8}`)
	seedAgent(t, 2, 12, `{"claude-3-5-sonnet":0.9}`)

	seedInviteCode(t, "A1", OwnerTypeAgent, 11, 0, 0, 0, InviteCodeStatusEnabled)
	seedInviteCode(t, "A2", OwnerTypeAgent, 11, 0, 0, 0, InviteCodeStatusDisabled)
	seedInviteCode(t, "B1", OwnerTypeAgent, 12, 0, 0, 0, InviteCodeStatusEnabled)
	seedInviteCode(t, "ADMIN1", OwnerTypeAdmin, 11, 0, 0, 0, InviteCodeStatusEnabled)

	agents, total, err := ListAgents(&common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	require.Len(t, agents, 2)

	byUser := map[int]*Agent{}
	for _, a := range agents {
		byUser[a.UserId] = a
	}
	require.Contains(t, byUser, 11)
	require.Contains(t, byUser, 12)
	assert.Equal(t, "agent_alice", byUser[11].Username)
	assert.Equal(t, int64(2), byUser[11].InviteCount, "disabled codes count, admin-owned codes do not")
	assert.Equal(t, int64(1), byUser[12].InviteCount)

	t.Run("paging", func(t *testing.T) {
		page2, page2Total, err := ListAgents(&common.PageInfo{Page: 2, PageSize: 1})
		require.NoError(t, err)
		assert.Equal(t, int64(2), page2Total, "total is not page-scoped")
		require.Len(t, page2, 1)
	})

	t.Run("empty table", func(t *testing.T) {
		DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Agent{})
		empty, emptyTotal, err := ListAgents(&common.PageInfo{Page: 1, PageSize: 10})
		require.NoError(t, err)
		assert.Equal(t, int64(0), emptyTotal)
		assert.Empty(t, empty)
	})
}
