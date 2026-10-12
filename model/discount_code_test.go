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

// setupDiscountFixture 迁移折扣相关表并注册清理。
// model 包的 TestMain 只迁移核心表，DiscountInviteCode 在此按需迁移。
func setupDiscountFixture(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&DiscountInviteCode{}, &User{}, &TopUp{}))
	cleanup := func() {
		DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&DiscountInviteCode{})
		DB.Exec("DELETE FROM users")
		DB.Exec("DELETE FROM top_ups")
	}
	cleanup()
	t.Cleanup(cleanup)
}

// seedDiscountCode 直接写入一条折扣码，字段显式给定，用于构造禁用/过期/用尽等状态。
func seedDiscountCode(t *testing.T, code string, discount float64, maxUses, usedCount int, expiresAt int64, status int) *DiscountInviteCode {
	t.Helper()
	dc := &DiscountInviteCode{
		Code:        code,
		OwnerType:   OwnerTypeAgent,
		OwnerUserId: 1,
		Discount:    discount,
		MaxUses:     maxUses,
		UsedCount:   usedCount,
		ExpiresAt:   expiresAt,
		Status:      status,
	}
	require.NoError(t, DB.Create(dc).Error)
	return dc
}

func reloadDiscountCode(t *testing.T, code string) *DiscountInviteCode {
	t.Helper()
	dc, err := GetDiscountCodeByCode(code)
	require.NoError(t, err)
	return dc
}

func TestValidateDiscountValue(t *testing.T) {
	tests := []struct {
		name     string
		discount float64
		wantErr  error
	}{
		{name: "six tenths valid", discount: 0.6, wantErr: nil},
		{name: "full price valid", discount: 1.0, wantErr: nil},
		{name: "tiny positive valid", discount: 0.0001, wantErr: nil},
		{name: "zero rejected", discount: 0, wantErr: ErrDiscountInvalid},
		{name: "negative rejected", discount: -0.5, wantErr: ErrDiscountInvalid},
		{name: "above one rejected", discount: 1.0001, wantErr: ErrDiscountInvalid},
		{name: "far above one rejected", discount: 2, wantErr: ErrDiscountInvalid},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateDiscountValue(tc.discount)
			if tc.wantErr == nil {
				assert.NoError(t, err)
			} else {
				assert.ErrorIs(t, err, tc.wantErr)
			}
		})
	}
}

// TestValidateDiscountInRange 覆盖代理商建码范围校验：等于 min/max 通过，越界拒绝。
// 其中 0.5 落在 [0.6,1.0] 之外对应"代理商建码越界 → 400"（controller 映射 ErrDiscountOutOfRange）。
func TestValidateDiscountInRange(t *testing.T) {
	tests := []struct {
		name     string
		discount float64
		min      float64
		max      float64
		wantErr  error
	}{
		{name: "equal min passes", discount: 0.6, min: 0.6, max: 1.0, wantErr: nil},
		{name: "equal max passes", discount: 1.0, min: 0.6, max: 1.0, wantErr: nil},
		{name: "mid range passes", discount: 0.8, min: 0.6, max: 1.0, wantErr: nil},
		{name: "below min rejected", discount: 0.5, min: 0.6, max: 1.0, wantErr: ErrDiscountOutOfRange},
		{name: "just below min rejected", discount: 0.59, min: 0.6, max: 1.0, wantErr: ErrDiscountOutOfRange},
		{name: "zero caught by absolute bound first", discount: 0, min: 0.6, max: 1.0, wantErr: ErrDiscountInvalid},
		{name: "above one caught by absolute bound first", discount: 1.5, min: 0.6, max: 2.0, wantErr: ErrDiscountInvalid},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateDiscountInRange(tc.discount, tc.min, tc.max)
			if tc.wantErr == nil {
				assert.NoError(t, err)
			} else {
				assert.ErrorIs(t, err, tc.wantErr)
			}
		})
	}
}

func TestDiscountInviteCode_CheckUsable(t *testing.T) {
	now := common.GetTimestamp()
	tests := []struct {
		name    string
		code    DiscountInviteCode
		wantErr error
	}{
		{
			name:    "enabled unlimited never expires",
			code:    DiscountInviteCode{Status: DiscountCodeStatusEnabled, MaxUses: 0, UsedCount: 99, ExpiresAt: 0},
			wantErr: nil,
		},
		{
			name:    "disabled rejected",
			code:    DiscountInviteCode{Status: DiscountCodeStatusDisabled},
			wantErr: ErrDiscountCodeDisabled,
		},
		{
			name:    "expired rejected",
			code:    DiscountInviteCode{Status: DiscountCodeStatusEnabled, ExpiresAt: now - 10},
			wantErr: ErrDiscountCodeExpired,
		},
		{
			name:    "future expiry passes",
			code:    DiscountInviteCode{Status: DiscountCodeStatusEnabled, ExpiresAt: now + 3600},
			wantErr: nil,
		},
		{
			name:    "exhausted rejected",
			code:    DiscountInviteCode{Status: DiscountCodeStatusEnabled, MaxUses: 2, UsedCount: 2},
			wantErr: ErrDiscountCodeExhausted,
		},
		{
			name:    "one use remaining passes",
			code:    DiscountInviteCode{Status: DiscountCodeStatusEnabled, MaxUses: 2, UsedCount: 1},
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

func TestGenerateUniqueDiscountCode(t *testing.T) {
	setupDiscountFixture(t)
	seen := make(map[string]struct{}, 200)
	for i := 0; i < 200; i++ {
		code, err := generateUniqueDiscountCode()
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

func TestCreateDiscountCode(t *testing.T) {
	setupDiscountFixture(t)

	t.Run("auto generates code and applies defaults", func(t *testing.T) {
		dc := &DiscountInviteCode{OwnerType: OwnerTypeAdmin, OwnerUserId: 1, Discount: 0.75, MaxUses: -5, ExpiresAt: -1}
		require.NoError(t, CreateDiscountCode(dc))
		assert.NotEmpty(t, dc.Code)
		assert.Len(t, dc.Code, 8)
		assert.Equal(t, DiscountCodeStatusEnabled, dc.Status)
		assert.Equal(t, 0, dc.MaxUses, "negative max uses normalized to unlimited")
		assert.Equal(t, int64(0), dc.ExpiresAt, "negative expiry normalized to never")
	})

	t.Run("rejects invalid discount", func(t *testing.T) {
		err := CreateDiscountCode(&DiscountInviteCode{OwnerType: OwnerTypeAdmin, Discount: 0})
		assert.ErrorIs(t, err, ErrDiscountInvalid)
	})

	t.Run("rejects nil", func(t *testing.T) {
		assert.ErrorIs(t, CreateDiscountCode(nil), ErrDiscountCodeNotFound)
	})
}

func TestConsumeDiscountInviteCode(t *testing.T) {
	now := common.GetTimestamp()

	t.Run("normal unlimited consume increments used count", func(t *testing.T) {
		setupDiscountFixture(t)
		seedDiscountCode(t, "UNLIMITED", 0.6, 0, 0, 0, DiscountCodeStatusEnabled)

		dc, err := ConsumeDiscountInviteCode("UNLIMITED")
		require.NoError(t, err)
		assert.InDelta(t, 0.6, dc.Discount, 1e-9)
		assert.Equal(t, 1, dc.UsedCount, "returned copy reflects increment")

		reloaded := reloadDiscountCode(t, "UNLIMITED")
		assert.Equal(t, 1, reloaded.UsedCount, "db row incremented")
	})

	t.Run("not found does not consume", func(t *testing.T) {
		setupDiscountFixture(t)
		_, err := ConsumeDiscountInviteCode("MISSING")
		assert.ErrorIs(t, err, ErrDiscountCodeNotFound)
	})

	t.Run("disabled rejected", func(t *testing.T) {
		setupDiscountFixture(t)
		seedDiscountCode(t, "DISABLED", 0.6, 0, 0, 0, DiscountCodeStatusDisabled)
		_, err := ConsumeDiscountInviteCode("DISABLED")
		assert.ErrorIs(t, err, ErrDiscountCodeDisabled)
		assert.Equal(t, 0, reloadDiscountCode(t, "DISABLED").UsedCount)
	})

	t.Run("expired rejected", func(t *testing.T) {
		setupDiscountFixture(t)
		seedDiscountCode(t, "EXPIRED", 0.6, 0, 0, now-10, DiscountCodeStatusEnabled)
		_, err := ConsumeDiscountInviteCode("EXPIRED")
		assert.ErrorIs(t, err, ErrDiscountCodeExpired)
		assert.Equal(t, 0, reloadDiscountCode(t, "EXPIRED").UsedCount)
	})

	t.Run("exhausted rejected", func(t *testing.T) {
		setupDiscountFixture(t)
		seedDiscountCode(t, "EXHAUSTED", 0.6, 1, 1, 0, DiscountCodeStatusEnabled)
		_, err := ConsumeDiscountInviteCode("EXHAUSTED")
		assert.ErrorIs(t, err, ErrDiscountCodeExhausted)
		assert.Equal(t, 1, reloadDiscountCode(t, "EXHAUSTED").UsedCount, "no oversell")
	})

	t.Run("respects max uses across sequential consumes", func(t *testing.T) {
		setupDiscountFixture(t)
		seedDiscountCode(t, "MAX2", 0.9, 2, 0, 0, DiscountCodeStatusEnabled)

		_, err := ConsumeDiscountInviteCode("MAX2")
		require.NoError(t, err)
		_, err = ConsumeDiscountInviteCode("MAX2")
		require.NoError(t, err)
		_, err = ConsumeDiscountInviteCode("MAX2")
		assert.ErrorIs(t, err, ErrDiscountCodeExhausted)
		assert.Equal(t, 2, reloadDiscountCode(t, "MAX2").UsedCount)
	})
}

// TestConsumeDiscountInviteCode_ConcurrentNoOversell 验证并发消费不超发：
// MaxUses=5 时 30 个并发消费只允许 5 个成功，最终 UsedCount 恰好为 5。
func TestConsumeDiscountInviteCode_ConcurrentNoOversell(t *testing.T) {
	setupDiscountFixture(t)
	seedDiscountCode(t, "RACE", 0.8, 5, 0, 0, DiscountCodeStatusEnabled)

	const goroutines = 30
	var wg sync.WaitGroup
	var mu sync.Mutex
	success := 0

	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			_, err := ConsumeDiscountInviteCode("RACE")
			if err == nil {
				mu.Lock()
				success++
				mu.Unlock()
				return
			}
			assert.ErrorIs(t, err, ErrDiscountCodeExhausted)
		}()
	}
	wg.Wait()

	assert.Equal(t, 5, success, "exactly MaxUses consumes succeed")
	assert.Equal(t, 5, reloadDiscountCode(t, "RACE").UsedCount, "no oversell in db")
}

func TestReleaseDiscountInviteCode(t *testing.T) {
	t.Run("rolls back a consumed use", func(t *testing.T) {
		setupDiscountFixture(t)
		dc := seedDiscountCode(t, "ROLLBACK", 0.6, 0, 0, 0, DiscountCodeStatusEnabled)
		_, err := ConsumeDiscountInviteCode("ROLLBACK")
		require.NoError(t, err)
		require.Equal(t, 1, reloadDiscountCode(t, "ROLLBACK").UsedCount)

		ReleaseDiscountInviteCode(dc.Id)
		assert.Equal(t, 0, reloadDiscountCode(t, "ROLLBACK").UsedCount)
	})

	t.Run("never goes negative at zero", func(t *testing.T) {
		setupDiscountFixture(t)
		dc := seedDiscountCode(t, "ZERO", 0.6, 0, 0, 0, DiscountCodeStatusEnabled)
		ReleaseDiscountInviteCode(dc.Id)
		assert.Equal(t, 0, reloadDiscountCode(t, "ZERO").UsedCount)
	})

	t.Run("ignores non-positive id", func(t *testing.T) {
		setupDiscountFixture(t)
		ReleaseDiscountInviteCode(0)
		ReleaseDiscountInviteCode(-1)
		// no panic, no rows touched
	})
}

// TestGetUserRechargeDiscount 验证唯一折扣解析入口：非法/未设置一律回退 1.0。
func TestGetUserRechargeDiscount(t *testing.T) {
	setupDiscountFixture(t)

	seedUserWithDiscount := func(id int, discount float64) {
		u := &User{Id: id, Username: fmt.Sprintf("u-%d", id), AffCode: fmt.Sprintf("aff-%d", id), Status: common.UserStatusEnabled, Group: DefaultUserGroup, RechargeDiscount: discount}
		require.NoError(t, DB.Create(u).Error)
	}

	tests := []struct {
		name     string
		userId   int
		seed     float64
		doSeed   bool
		expected float64
	}{
		{name: "unset zero treated as no discount", userId: 1, seed: 0, doSeed: true, expected: 1.0},
		{name: "six tenths returned as-is", userId: 2, seed: 0.6, doSeed: true, expected: 0.6},
		{name: "full price returned as-is", userId: 3, seed: 1.0, doSeed: true, expected: 1.0},
		{name: "above one falls back", userId: 4, seed: 1.5, doSeed: true, expected: 1.0},
		{name: "negative falls back", userId: 5, seed: -1, doSeed: true, expected: 1.0},
		{name: "missing user falls back", userId: 999, doSeed: false, expected: 1.0},
		{name: "non-positive id falls back", userId: 0, doSeed: false, expected: 1.0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if tc.doSeed {
				seedUserWithDiscount(tc.userId, tc.seed)
			}
			assert.InDelta(t, tc.expected, GetUserRechargeDiscount(tc.userId), 1e-9)
		})
	}
}

// TestDiscountCodeRegistrationBinding 复现注册钩子的绑定契约（model 层）：
// 有效码 → 绑定折扣且 UsedCount+1；无效码 → 拒绝且不消耗；Insert 失败 → 回滚 UsedCount。
func TestDiscountCodeRegistrationBinding(t *testing.T) {
	setupDiscountFixture(t)
	seedDiscountCode(t, "BIND70", 0.7, 0, 0, 0, DiscountCodeStatusEnabled)
	seedDiscountCode(t, "BINDUSED", 0.5, 1, 1, 0, DiscountCodeStatusEnabled)

	t.Run("valid code binds discount and increments use", func(t *testing.T) {
		dc, err := ConsumeDiscountInviteCode("BIND70")
		require.NoError(t, err)

		// 模拟 cleanUser 绑定后 Insert 成功
		u := &User{Id: 100, Username: "invitee", AffCode: "aff-100", Status: common.UserStatusEnabled, Group: DefaultUserGroup, RechargeDiscount: dc.Discount, RechargeDiscountCode: dc.Code}
		require.NoError(t, DB.Create(u).Error)

		assert.InDelta(t, 0.7, GetUserRechargeDiscount(100), 1e-9)
		assert.Equal(t, 1, reloadDiscountCode(t, "BIND70").UsedCount)
	})

	t.Run("invalid code rejected without consumption", func(t *testing.T) {
		_, err := ConsumeDiscountInviteCode("NOPE")
		assert.ErrorIs(t, err, ErrDiscountCodeNotFound)
	})

	t.Run("exhausted code rejected without consumption", func(t *testing.T) {
		_, err := ConsumeDiscountInviteCode("BINDUSED")
		assert.ErrorIs(t, err, ErrDiscountCodeExhausted)
		assert.Equal(t, 1, reloadDiscountCode(t, "BINDUSED").UsedCount)
	})

	t.Run("insert failure rolls back the consumed use", func(t *testing.T) {
		dc, err := ConsumeDiscountInviteCode("BIND70")
		require.NoError(t, err)
		require.Equal(t, 2, reloadDiscountCode(t, "BIND70").UsedCount)

		// 模拟 cleanUser.Insert 失败 → 补偿回滚
		ReleaseDiscountInviteCode(dc.Id)
		assert.Equal(t, 1, reloadDiscountCode(t, "BIND70").UsedCount)
	})
}

// TestGetDiscountCodeStats 验证导流统计：绑定用户数与其成功充值面值总额（按码聚合）。
func TestGetDiscountCodeStats(t *testing.T) {
	setupDiscountFixture(t)

	seedUser := func(id int, code string) {
		u := &User{Id: id, Username: fmt.Sprintf("u-%d", id), AffCode: fmt.Sprintf("aff-%d", id), Status: common.UserStatusEnabled, Group: DefaultUserGroup, RechargeDiscount: 0.7, RechargeDiscountCode: code}
		require.NoError(t, DB.Create(u).Error)
	}
	seedTopUp := func(userId int, amount int64, status string) {
		// TradeNo 有唯一约束，用 userId+status+amount 拼出稳定且互不相同的值，避免空串冲突。
		tradeNo := fmt.Sprintf("trade-%d-%s-%d", userId, status, amount)
		require.NoError(t, DB.Create(&TopUp{UserId: userId, Amount: amount, Status: status, TradeNo: tradeNo}).Error)
	}

	seedUser(201, "STAT1")
	seedUser(202, "STAT1")
	seedUser(203, "STAT2")
	seedTopUp(201, 100, common.TopUpStatusSuccess)
	seedTopUp(202, 50, common.TopUpStatusSuccess)
	seedTopUp(202, 999, common.TopUpStatusPending) // 非成功状态不计入
	seedTopUp(203, 30, common.TopUpStatusSuccess)

	stats, err := GetDiscountCodeStats([]string{"STAT1", "STAT2", "STAT3"})
	require.NoError(t, err)

	assert.Equal(t, int64(2), stats["STAT1"].UserCount)
	assert.Equal(t, int64(150), stats["STAT1"].TotalRecharge)
	assert.Equal(t, int64(1), stats["STAT2"].UserCount)
	assert.Equal(t, int64(30), stats["STAT2"].TotalRecharge)
	_, hasStat3 := stats["STAT3"]
	assert.False(t, hasStat3, "code without bound users has no stat entry")
}

// TestAttachDiscountCodeOwners 验证用户列表回填码归属用户名：多归属解析、
// 共享码去重、已删除码与无码用户保持空串。
func TestAttachDiscountCodeOwners(t *testing.T) {
	setupDiscountFixture(t)

	seedOwner := func(id int, username string) {
		require.NoError(t, DB.Create(&User{Id: id, Username: username, AffCode: fmt.Sprintf("aff-%d", id), Status: common.UserStatusEnabled, Group: DefaultUserGroup}).Error)
	}
	seedCodeWithOwner := func(code string, ownerId int) {
		require.NoError(t, DB.Create(&DiscountInviteCode{Code: code, OwnerType: OwnerTypeAgent, OwnerUserId: ownerId, Discount: 0.7, Status: DiscountCodeStatusEnabled}).Error)
	}
	seedBoundUser := func(id int, code string) *User {
		u := &User{Id: id, Username: fmt.Sprintf("u-%d", id), AffCode: fmt.Sprintf("aff-%d", id), Status: common.UserStatusEnabled, Group: DefaultUserGroup, RechargeDiscount: 0.7, RechargeDiscountCode: code}
		require.NoError(t, DB.Create(u).Error)
		return u
	}

	seedOwner(1, "agent_alice")
	seedOwner(2, "admin_bob")
	seedCodeWithOwner("CODE_A", 1)
	seedCodeWithOwner("CODE_B", 2)

	// 两个用户共用 CODE_A（去重路径），一个 CODE_B，一个已删除码，一个无码。
	boundA1 := seedBoundUser(101, "CODE_A")
	boundA2 := seedBoundUser(102, "CODE_A")
	boundB := seedBoundUser(103, "CODE_B")
	boundGone := seedBoundUser(104, "GONE")
	boundNone := seedBoundUser(105, "")

	users := []*User{boundA1, boundA2, boundB, boundGone, boundNone}
	require.NoError(t, AttachDiscountCodeOwners(users))

	assert.Equal(t, "agent_alice", boundA1.RechargeDiscountOwner)
	assert.Equal(t, "agent_alice", boundA2.RechargeDiscountOwner)
	assert.Equal(t, "admin_bob", boundB.RechargeDiscountOwner)
	assert.Empty(t, boundGone.RechargeDiscountOwner, "deleted code has no resolvable owner")
	assert.Empty(t, boundNone.RechargeDiscountOwner, "user without code has no owner")
}
