package model

import (
	"fmt"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setupInviteFixture 迁移邀请码/代理商相关表并注册清理。
// model 包的 TestMain 只迁移核心表，InviteCode 与 Agent 在此按需迁移。
func setupInviteFixture(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&InviteCode{}, &Agent{}, &User{}, &TopUp{}, &OrgMember{}))
	cleanup := func() {
		DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&InviteCode{})
		DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Agent{})
		DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&OrgMember{})
		DB.Exec("DELETE FROM users")
		DB.Exec("DELETE FROM top_ups")
	}
	cleanup()
	t.Cleanup(cleanup)
}

// seedInviteCode 直接写入一条邀请码，字段显式给定，用于构造禁用/过期/用尽等状态。
func seedInviteCode(t *testing.T, code string, ownerType string, ownerUserId int, maxUses, usedCount int, expiresAt int64, status int) *InviteCode {
	t.Helper()
	ic := &InviteCode{
		Code:        code,
		OwnerType:   ownerType,
		OwnerUserId: ownerUserId,
		MaxUses:     maxUses,
		UsedCount:   usedCount,
		ExpiresAt:   expiresAt,
		Status:      status,
	}
	require.NoError(t, DB.Create(ic).Error)
	return ic
}

func reloadInviteCode(t *testing.T, code string) *InviteCode {
	t.Helper()
	ic, err := GetInviteCodeByCode(code)
	require.NoError(t, err)
	return ic
}

func TestInviteCode_CheckUsable(t *testing.T) {
	now := common.GetTimestamp()
	tests := []struct {
		name    string
		code    InviteCode
		wantErr error
	}{
		{
			name:    "enabled unlimited never expires",
			code:    InviteCode{Status: InviteCodeStatusEnabled, MaxUses: 0, UsedCount: 99, ExpiresAt: 0},
			wantErr: nil,
		},
		{
			name:    "disabled rejected",
			code:    InviteCode{Status: InviteCodeStatusDisabled},
			wantErr: ErrInviteCodeDisabled,
		},
		{
			name:    "expired rejected",
			code:    InviteCode{Status: InviteCodeStatusEnabled, ExpiresAt: now - 10},
			wantErr: ErrInviteCodeExpired,
		},
		{
			name:    "future expiry passes",
			code:    InviteCode{Status: InviteCodeStatusEnabled, ExpiresAt: now + 3600},
			wantErr: nil,
		},
		{
			name:    "exhausted rejected",
			code:    InviteCode{Status: InviteCodeStatusEnabled, MaxUses: 2, UsedCount: 2},
			wantErr: ErrInviteCodeExhausted,
		},
		{
			name:    "one use remaining passes",
			code:    InviteCode{Status: InviteCodeStatusEnabled, MaxUses: 2, UsedCount: 1},
			wantErr: nil,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.code.CheckUsable(now)
			if tc.wantErr == nil {
				assert.NoError(t, err)
			} else {
				assert.ErrorIs(t, err, tc.wantErr)
			}
		})
	}
}

func TestGenerateUniqueInviteCode(t *testing.T) {
	setupInviteFixture(t)
	seen := make(map[string]struct{}, 200)
	for i := 0; i < 200; i++ {
		code, err := generateUniqueInviteCode()
		require.NoError(t, err)
		assert.Len(t, code, 8)
		assert.Equal(t, code, upper(code), "code should be uppercase")
		_, dup := seen[code]
		assert.False(t, dup, "generated code should be unique, got duplicate %s", code)
		seen[code] = struct{}{}
	}
}

func upper(s string) string {
	out := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'a' && c <= 'z' {
			c -= 'a' - 'A'
		}
		out[i] = c
	}
	return string(out)
}

func TestCreateInviteCode(t *testing.T) {
	setupInviteFixture(t)

	t.Run("auto generates code and applies defaults", func(t *testing.T) {
		ic := &InviteCode{OwnerType: OwnerTypeAdmin, OwnerUserId: 1, MaxUses: -5, ExpiresAt: -1}
		require.NoError(t, CreateInviteCode(ic))
		assert.NotEmpty(t, ic.Code)
		assert.Len(t, ic.Code, 8)
		assert.Equal(t, InviteCodeStatusEnabled, ic.Status)
		assert.Equal(t, 0, ic.MaxUses, "negative max uses normalized to unlimited")
		assert.Equal(t, int64(0), ic.ExpiresAt, "negative expiry normalized to never")
	})

	t.Run("keeps an explicitly provided code", func(t *testing.T) {
		ic := &InviteCode{Code: "MYCODE01", OwnerType: OwnerTypeAgent, OwnerUserId: 2}
		require.NoError(t, CreateInviteCode(ic))
		assert.Equal(t, "MYCODE01", ic.Code)
	})

	t.Run("rejects nil", func(t *testing.T) {
		assert.ErrorIs(t, CreateInviteCode(nil), ErrInviteCodeNotFound)
	})
}

func TestConsumeInviteCode(t *testing.T) {
	now := common.GetTimestamp()

	t.Run("normal unlimited consume increments used count", func(t *testing.T) {
		setupInviteFixture(t)
		seedInviteCode(t, "UNLIMITED", OwnerTypeAgent, 1, 0, 0, 0, InviteCodeStatusEnabled)

		ic, err := ConsumeInviteCode("UNLIMITED")
		require.NoError(t, err)
		assert.Equal(t, OwnerTypeAgent, ic.OwnerType, "owner type is what registration binds on")
		assert.Equal(t, 1, ic.UsedCount, "returned copy reflects increment")

		assert.Equal(t, 1, reloadInviteCode(t, "UNLIMITED").UsedCount, "db row incremented")
	})

	t.Run("not found does not consume", func(t *testing.T) {
		setupInviteFixture(t)
		_, err := ConsumeInviteCode("MISSING")
		assert.ErrorIs(t, err, ErrInviteCodeNotFound)
	})

	t.Run("empty code rejected", func(t *testing.T) {
		setupInviteFixture(t)
		_, err := ConsumeInviteCode("   ")
		assert.ErrorIs(t, err, ErrInviteCodeNotFound)
	})

	t.Run("disabled rejected", func(t *testing.T) {
		setupInviteFixture(t)
		seedInviteCode(t, "DISABLED", OwnerTypeAgent, 1, 0, 0, 0, InviteCodeStatusDisabled)
		_, err := ConsumeInviteCode("DISABLED")
		assert.ErrorIs(t, err, ErrInviteCodeDisabled)
		assert.Equal(t, 0, reloadInviteCode(t, "DISABLED").UsedCount)
	})

	t.Run("expired rejected", func(t *testing.T) {
		setupInviteFixture(t)
		seedInviteCode(t, "EXPIRED", OwnerTypeAgent, 1, 0, 0, now-10, InviteCodeStatusEnabled)
		_, err := ConsumeInviteCode("EXPIRED")
		assert.ErrorIs(t, err, ErrInviteCodeExpired)
		assert.Equal(t, 0, reloadInviteCode(t, "EXPIRED").UsedCount)
	})

	t.Run("exhausted rejected", func(t *testing.T) {
		setupInviteFixture(t)
		seedInviteCode(t, "EXHAUSTED", OwnerTypeAgent, 1, 1, 1, 0, InviteCodeStatusEnabled)
		_, err := ConsumeInviteCode("EXHAUSTED")
		assert.ErrorIs(t, err, ErrInviteCodeExhausted)
		assert.Equal(t, 1, reloadInviteCode(t, "EXHAUSTED").UsedCount, "no oversell")
	})

	t.Run("respects max uses across sequential consumes", func(t *testing.T) {
		setupInviteFixture(t)
		seedInviteCode(t, "MAX2", OwnerTypeAgent, 1, 2, 0, 0, InviteCodeStatusEnabled)

		_, err := ConsumeInviteCode("MAX2")
		require.NoError(t, err)
		_, err = ConsumeInviteCode("MAX2")
		require.NoError(t, err)
		_, err = ConsumeInviteCode("MAX2")
		assert.ErrorIs(t, err, ErrInviteCodeExhausted)
		assert.Equal(t, 2, reloadInviteCode(t, "MAX2").UsedCount)
	})
}

// TestConsumeInviteCode_ConcurrentNoOversell 验证并发消费不超发：
// MaxUses=5 时 30 个并发消费只允许 5 个成功，最终 UsedCount 恰好为 5。
func TestConsumeInviteCode_ConcurrentNoOversell(t *testing.T) {
	setupInviteFixture(t)
	seedInviteCode(t, "RACE", OwnerTypeAgent, 1, 5, 0, 0, InviteCodeStatusEnabled)

	const goroutines = 30
	var wg sync.WaitGroup
	var mu sync.Mutex
	success := 0

	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			_, err := ConsumeInviteCode("RACE")
			if err == nil {
				mu.Lock()
				success++
				mu.Unlock()
				return
			}
			assert.ErrorIs(t, err, ErrInviteCodeExhausted)
		}()
	}
	wg.Wait()

	assert.Equal(t, 5, success, "exactly MaxUses consumes succeed")
	assert.Equal(t, 5, reloadInviteCode(t, "RACE").UsedCount, "no oversell in db")
}

func TestReleaseInviteCode(t *testing.T) {
	t.Run("rolls back a consumed use", func(t *testing.T) {
		setupInviteFixture(t)
		ic := seedInviteCode(t, "ROLLBACK", OwnerTypeAgent, 1, 0, 0, 0, InviteCodeStatusEnabled)
		_, err := ConsumeInviteCode("ROLLBACK")
		require.NoError(t, err)
		require.Equal(t, 1, reloadInviteCode(t, "ROLLBACK").UsedCount)

		ReleaseInviteCode(ic.Id)
		assert.Equal(t, 0, reloadInviteCode(t, "ROLLBACK").UsedCount)
	})

	t.Run("never goes negative at zero", func(t *testing.T) {
		setupInviteFixture(t)
		ic := seedInviteCode(t, "ZERO", OwnerTypeAgent, 1, 0, 0, 0, InviteCodeStatusEnabled)
		ReleaseInviteCode(ic.Id)
		assert.Equal(t, 0, reloadInviteCode(t, "ZERO").UsedCount)
	})

	t.Run("ignores non-positive id", func(t *testing.T) {
		setupInviteFixture(t)
		ReleaseInviteCode(0)
		ReleaseInviteCode(-1)
		// no panic, no rows touched
	})
}

// TestInviteCodeRegistrationBinding 复现注册钩子的绑定契约（model 层）：
// 代理码 → 解析出 agent_id 且 UsedCount+1；管理员码 → agent_id 保持 0；
// Insert 失败 → 回滚 UsedCount。
func TestInviteCodeRegistrationBinding(t *testing.T) {
	setupInviteFixture(t)
	seedAgent(t, 7, 1, `{"gpt-4o":0.8}`)
	seedInviteCode(t, "AGENTCODE", OwnerTypeAgent, 1, 0, 0, 0, InviteCodeStatusEnabled)
	seedInviteCode(t, "ADMINCODE", OwnerTypeAdmin, 99, 0, 0, 0, InviteCodeStatusEnabled)

	resolveAgentId := func(t *testing.T, code string) int {
		t.Helper()
		ic, err := ConsumeInviteCode(code)
		require.NoError(t, err)
		if ic.OwnerType != OwnerTypeAgent {
			return 0
		}
		agent, err := GetAgentByUserId(ic.OwnerUserId)
		require.NoError(t, err)
		return agent.Id
	}

	t.Run("agent code resolves to agents.id", func(t *testing.T) {
		agentId := resolveAgentId(t, "AGENTCODE")
		assert.Equal(t, 7, agentId, "users.agent_id stores the agents primary key, not user_id")

		u := &User{Id: 100, Username: "invitee", AffCode: "aff-100", Status: common.UserStatusEnabled, Group: DefaultUserGroup, AgentId: agentId}
		require.NoError(t, DB.Create(u).Error)
		assert.Equal(t, 1, reloadInviteCode(t, "AGENTCODE").UsedCount)
	})

	t.Run("admin code binds no agent", func(t *testing.T) {
		assert.Equal(t, 0, resolveAgentId(t, "ADMINCODE"), "admin-owned codes are referral-only")
	})

	t.Run("insert failure rolls back the consumed use", func(t *testing.T) {
		ic, err := ConsumeInviteCode("AGENTCODE")
		require.NoError(t, err)
		require.Equal(t, 2, reloadInviteCode(t, "AGENTCODE").UsedCount)

		// 模拟 cleanUser.Insert 失败 → 补偿回滚
		ReleaseInviteCode(ic.Id)
		assert.Equal(t, 1, reloadInviteCode(t, "AGENTCODE").UsedCount)
	})
}

// TestListAgentMembers 验证成员列表按 agent_id 关联：命中自己的成员、不串到别的代理商，
// 并回填成功充值面值与当前按模型折扣（非成功状态的充值不计入）。
func TestListAgentMembers(t *testing.T) {
	setupInviteFixture(t)
	seedAgent(t, 1, 11, `{"gpt-4o":0.8}`)
	seedAgent(t, 2, 12, `{"claude-3-5-sonnet":0.9}`)

	seedUser := func(id, agentId int, modelDiscounts string) {
		u := &User{
			Id: id, Username: fmt.Sprintf("u-%d", id), AffCode: fmt.Sprintf("aff-%d", id),
			Status: common.UserStatusEnabled, Group: DefaultUserGroup,
			AgentId: agentId, ModelDiscounts: modelDiscounts,
		}
		require.NoError(t, DB.Create(u).Error)
	}
	seedTopUp := func(userId int, amount int64, status string) {
		// TradeNo 有唯一约束，用 userId+status+amount 拼出稳定且互不相同的值，避免空串冲突。
		tradeNo := fmt.Sprintf("trade-%d-%s-%d", userId, status, amount)
		require.NoError(t, DB.Create(&TopUp{UserId: userId, Amount: amount, Status: status, TradeNo: tradeNo}).Error)
	}

	seedUser(201, 1, `{"gpt-4o":0.85}`)
	seedUser(202, 1, "")
	seedUser(203, 2, `{"claude-3-5-sonnet":0.95}`)
	seedUser(204, 0, "") // 无代理归属
	seedTopUp(201, 100, common.TopUpStatusSuccess)
	seedTopUp(201, 50, common.TopUpStatusSuccess)
	seedTopUp(201, 999, common.TopUpStatusPending) // 非成功状态不计入
	seedTopUp(203, 30, common.TopUpStatusSuccess)

	pageInfo := &common.PageInfo{Page: 1, PageSize: 10}

	members, total, err := ListAgentMembers(1, pageInfo)
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	require.Len(t, members, 2)
	byId := map[int]*AgentMember{}
	for _, m := range members {
		byId[m.UserId] = m
	}
	require.Contains(t, byId, 201)
	require.Contains(t, byId, 202)
	assert.Equal(t, int64(150), byId[201].TotalRecharge, "only successful top-ups count")
	assert.InDelta(t, 0.85, byId[201].ModelDiscounts["gpt-4o"], 1e-9)
	assert.NotNil(t, byId[202].ModelDiscounts, "member without discounts gets an empty map, not nil")
	assert.Empty(t, byId[202].ModelDiscounts)

	otherMembers, otherTotal, err := ListAgentMembers(2, pageInfo)
	require.NoError(t, err)
	assert.Equal(t, int64(1), otherTotal, "agents must not see each other's members")
	require.Len(t, otherMembers, 1)
	assert.Equal(t, 203, otherMembers[0].UserId)

	unbound, unboundTotal, err := ListAgentMembers(0, pageInfo)
	require.NoError(t, err)
	assert.Equal(t, int64(0), unboundTotal, "agent_id=0 must not match unbound users")
	assert.Nil(t, unbound)
}

// TestListAgentRechargeRecords 验证充值流水只含自己成员的成功记录。
func TestListAgentRechargeRecords(t *testing.T) {
	setupInviteFixture(t)
	seedAgent(t, 1, 11, `{"gpt-4o":0.8}`)

	seedUser := func(id, agentId int) {
		u := &User{Id: id, Username: fmt.Sprintf("u-%d", id), AffCode: fmt.Sprintf("aff-%d", id), Status: common.UserStatusEnabled, Group: DefaultUserGroup, AgentId: agentId}
		require.NoError(t, DB.Create(u).Error)
	}
	seedUser(301, 1)
	seedUser(302, 0)
	require.NoError(t, DB.Create(&TopUp{UserId: 301, Amount: 100, Money: 100, Status: common.TopUpStatusSuccess, TradeNo: "t-301-ok"}).Error)
	require.NoError(t, DB.Create(&TopUp{UserId: 301, Amount: 20, Money: 20, Status: common.TopUpStatusPending, TradeNo: "t-301-pending"}).Error)
	require.NoError(t, DB.Create(&TopUp{UserId: 302, Amount: 70, Money: 70, Status: common.TopUpStatusSuccess, TradeNo: "t-302-ok"}).Error)

	records, total, err := ListAgentRechargeRecords(1, &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.Equal(t, int64(1), total, "only own members' successful top-ups")
	require.Len(t, records, 1)
	assert.Equal(t, 301, records[0].UserId)
	assert.Equal(t, "u-301", records[0].Username)
	assert.Equal(t, int64(100), records[0].Amount)

	empty, emptyTotal, err := ListAgentRechargeRecords(999, &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.Equal(t, int64(0), emptyTotal)
	assert.Nil(t, empty)
}

// TestGetAgentStats 验证代理商导流概览：成员数与成员成功充值面值总额。
func TestGetAgentStats(t *testing.T) {
	setupInviteFixture(t)
	seedAgent(t, 1, 11, `{"gpt-4o":0.8}`)

	seedUser := func(id, agentId int) {
		u := &User{Id: id, Username: fmt.Sprintf("u-%d", id), AffCode: fmt.Sprintf("aff-%d", id), Status: common.UserStatusEnabled, Group: DefaultUserGroup, AgentId: agentId}
		require.NoError(t, DB.Create(u).Error)
	}
	seedUser(401, 1)
	seedUser(402, 1)
	seedUser(403, 0)
	require.NoError(t, DB.Create(&TopUp{UserId: 401, Amount: 100, Status: common.TopUpStatusSuccess, TradeNo: "s-401"}).Error)
	require.NoError(t, DB.Create(&TopUp{UserId: 402, Amount: 50, Status: common.TopUpStatusSuccess, TradeNo: "s-402"}).Error)
	require.NoError(t, DB.Create(&TopUp{UserId: 402, Amount: 999, Status: common.TopUpStatusPending, TradeNo: "s-402-pending"}).Error)
	require.NoError(t, DB.Create(&TopUp{UserId: 403, Amount: 777, Status: common.TopUpStatusSuccess, TradeNo: "s-403"}).Error)

	stats, err := GetAgentStats(1)
	require.NoError(t, err)
	assert.Equal(t, int64(2), stats.MemberCount)
	assert.Equal(t, int64(150), stats.TotalRecharge, "pending top-ups and non-members excluded")

	empty, err := GetAgentStats(0)
	require.NoError(t, err)
	assert.Equal(t, int64(0), empty.MemberCount)
	assert.Equal(t, int64(0), empty.TotalRecharge)
}

// TestGetAgentInviteSummary 验证概览里的码数与累计使用次数按 owner 聚合，不串到别的代理商。
func TestGetAgentInviteSummary(t *testing.T) {
	setupInviteFixture(t)
	seedInviteCode(t, "MINE1", OwnerTypeAgent, 11, 0, 3, 0, InviteCodeStatusEnabled)
	seedInviteCode(t, "MINE2", OwnerTypeAgent, 11, 0, 1, 0, InviteCodeStatusDisabled)
	seedInviteCode(t, "THEIRS", OwnerTypeAgent, 12, 0, 9, 0, InviteCodeStatusEnabled)
	seedInviteCode(t, "ADMIN1", OwnerTypeAdmin, 11, 0, 5, 0, InviteCodeStatusEnabled)

	codeCount, totalUsed, err := GetAgentInviteSummary(11)
	require.NoError(t, err)
	assert.Equal(t, int64(2), codeCount, "disabled codes still count as mine")
	assert.Equal(t, int64(4), totalUsed, "admin-owned codes excluded")

	zeroCount, zeroUsed, err := GetAgentInviteSummary(0)
	require.NoError(t, err)
	assert.Equal(t, int64(0), zeroCount)
	assert.Equal(t, int64(0), zeroUsed)
}

// TestUpdateInviteCodeFields 验证字段白名单更新与不存在时的错误。
func TestUpdateInviteCodeFields(t *testing.T) {
	setupInviteFixture(t)
	ic := seedInviteCode(t, "UPD1", OwnerTypeAgent, 11, 0, 0, 0, InviteCodeStatusEnabled)

	require.NoError(t, UpdateInviteCodeFields(ic.Id, map[string]interface{}{"status": InviteCodeStatusDisabled, "remark": "paused"}))
	reloaded := reloadInviteCode(t, "UPD1")
	assert.Equal(t, InviteCodeStatusDisabled, reloaded.Status)
	assert.Equal(t, "paused", reloaded.Remark)

	assert.NoError(t, UpdateInviteCodeFields(ic.Id, map[string]interface{}{}), "empty field set is a no-op")
	assert.ErrorIs(t, UpdateInviteCodeFields(999999, map[string]interface{}{"status": InviteCodeStatusEnabled}), ErrInviteCodeNotFound)
	assert.ErrorIs(t, UpdateInviteCodeFields(0, map[string]interface{}{"status": InviteCodeStatusEnabled}), ErrInviteCodeNotFound)
}

// TestAttachAgentOwners 验证用户列表回填所属代理商用户名：多代理解析、
// 同代理去重、已删除代理与无归属用户保持空串。
func TestAttachAgentOwners(t *testing.T) {
	setupInviteFixture(t)

	seedOwner := func(id int, username string) {
		require.NoError(t, DB.Create(&User{Id: id, Username: username, AffCode: fmt.Sprintf("aff-%d", id), Status: common.UserStatusEnabled, Group: DefaultUserGroup}).Error)
	}
	seedOwner(11, "agent_alice")
	seedOwner(12, "agent_bob")
	seedAgent(t, 1, 11, `{"gpt-4o":0.8}`)
	seedAgent(t, 2, 12, `{"gpt-4o":0.9}`)

	seedMember := func(id, agentId int) *User {
		u := &User{Id: id, Username: fmt.Sprintf("u-%d", id), AffCode: fmt.Sprintf("aff-%d", id), Status: common.UserStatusEnabled, Group: DefaultUserGroup, AgentId: agentId}
		require.NoError(t, DB.Create(u).Error)
		return u
	}

	// 两个成员共用 agent 1（去重路径），一个属于 agent 2，一个指向已删除的代理，一个无归属。
	memberA1 := seedMember(101, 1)
	memberA2 := seedMember(102, 1)
	memberB := seedMember(103, 2)
	memberGone := seedMember(104, 999)
	memberNone := seedMember(105, 0)

	users := []*User{memberA1, memberA2, memberB, memberGone, memberNone}
	require.NoError(t, AttachAgentOwners(users))

	assert.Equal(t, "agent_alice", memberA1.AgentUsername)
	assert.Equal(t, "agent_alice", memberA2.AgentUsername)
	assert.Equal(t, "agent_bob", memberB.AgentUsername)
	assert.Empty(t, memberGone.AgentUsername, "deleted agent has no resolvable owner")
	assert.Empty(t, memberNone.AgentUsername, "user without agent has no owner")
}
