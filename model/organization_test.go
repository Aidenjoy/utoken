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

// setupOrgFixture 迁移企业相关表并注册清理。
// model 包的 TestMain 只迁移核心表，Organization/OrgMember 在此按需迁移。
func setupOrgFixture(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&Organization{}, &OrgMember{}, &User{}, &QuotaData{}))
	cleanup := func() {
		DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&OrgMember{})
		DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Organization{})
		DB.Exec("DELETE FROM users")
		DB.Exec("DELETE FROM quota_data")
	}
	cleanup()
	t.Cleanup(cleanup)
}

// seedOrg 直接写入一条企业记录，字段全部显式给定，避免 gorm default 归一化干扰断言。
func seedOrg(t *testing.T, id int, quota int, status int) *Organization {
	t.Helper()
	org := &Organization{
		Id:          id,
		Name:        fmt.Sprintf("org-%d-%d", id, common.GetTimestamp()),
		DisplayName: fmt.Sprintf("Org %d", id),
		Group:       "vip",
		Status:      status,
		Quota:       quota,
	}
	require.NoError(t, DB.Create(org).Error)
	return org
}

// seedOrgMember 写入成员记录并同步 User.OrgId/Group，模拟已加入企业的用户。
func seedOrgMember(t *testing.T, org *Organization, userId int, role string, quotaLimit int, status int) *OrgMember {
	t.Helper()
	user := &User{Id: userId, Username: fmt.Sprintf("user-%d", userId), AffCode: fmt.Sprintf("aff-%d", userId), Status: common.UserStatusEnabled, Group: DefaultUserGroup}
	require.NoError(t, DB.Create(user).Error)
	member := &OrgMember{
		OrgId:      org.Id,
		UserId:     userId,
		OrgRole:    role,
		QuotaLimit: quotaLimit,
		Status:     status,
		JoinedAt:   common.GetTimestamp(),
	}
	require.NoError(t, DB.Create(member).Error)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", userId).
		Updates(map[string]interface{}{"org_id": org.Id, "group": org.Group}).Error)
	return member
}

func reloadOrg(t *testing.T, id int) *Organization {
	t.Helper()
	org, err := GetOrganizationById(id)
	require.NoError(t, err)
	return org
}

func reloadMember(t *testing.T, id int) *OrgMember {
	t.Helper()
	member, err := GetOrgMemberById(id)
	require.NoError(t, err)
	return member
}

// TestConsumeOrgQuotaGuards 覆盖企业池扣费的双条件校验：
// 企业池余额充足 且 成员子额度未超限，任一不满足都整体回滚且池/成员用量不变。
func TestConsumeOrgQuotaGuards(t *testing.T) {
	tests := []struct {
		name         string
		orgQuota     int
		orgStatus    int
		memberLimit  int
		memberStatus int
		consume      int
		wantErr      error
		wantPoolLeft int
		wantUsed     int
	}{
		{
			name:         "unlimited member consumes from pool",
			orgQuota:     1000,
			orgStatus:    OrgStatusEnabled,
			memberLimit:  0,
			memberStatus: OrgMemberStatusEnabled,
			consume:      300,
			wantPoolLeft: 700,
			wantUsed:     300,
		},
		{
			name:         "consume exactly up to member limit is allowed",
			orgQuota:     1000,
			orgStatus:    OrgStatusEnabled,
			memberLimit:  300,
			memberStatus: OrgMemberStatusEnabled,
			consume:      300,
			wantPoolLeft: 700,
			wantUsed:     300,
		},
		{
			name:         "member sub-quota exceeded rolls back",
			orgQuota:     1000,
			orgStatus:    OrgStatusEnabled,
			memberLimit:  200,
			memberStatus: OrgMemberStatusEnabled,
			consume:      300,
			wantErr:      ErrOrgMemberQuotaExceeded,
			wantPoolLeft: 1000,
			wantUsed:     0,
		},
		{
			name:         "pool insufficient rolls back",
			orgQuota:     100,
			orgStatus:    OrgStatusEnabled,
			memberLimit:  0,
			memberStatus: OrgMemberStatusEnabled,
			consume:      300,
			wantErr:      ErrOrgQuotaInsufficient,
			wantPoolLeft: 100,
			wantUsed:     0,
		},
		{
			name:         "disabled member rejected",
			orgQuota:     1000,
			orgStatus:    OrgStatusEnabled,
			memberLimit:  0,
			memberStatus: OrgMemberStatusDisabled,
			consume:      300,
			wantErr:      ErrOrgMemberDisabled,
			wantPoolLeft: 1000,
			wantUsed:     0,
		},
		{
			name:         "disabled organization rejected",
			orgQuota:     1000,
			orgStatus:    OrgStatusDisabled,
			memberLimit:  0,
			memberStatus: OrgMemberStatusEnabled,
			consume:      300,
			wantErr:      ErrOrgDisabled,
			wantPoolLeft: 1000,
			wantUsed:     0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setupOrgFixture(t)
			org := seedOrg(t, 1, tt.orgQuota, tt.orgStatus)
			member := seedOrgMember(t, org, 101, OrgRoleMember, tt.memberLimit, tt.memberStatus)

			err := ConsumeOrgQuota(org.Id, member.UserId, tt.consume)
			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
			} else {
				require.NoError(t, err)
			}

			after := reloadOrg(t, org.Id)
			assert.Equal(t, tt.wantPoolLeft, after.Quota, "pool balance")
			assert.Equal(t, tt.wantUsed, after.UsedQuota, "pool used")
			assert.Equal(t, tt.wantUsed, reloadMember(t, member.Id).QuotaUsed, "member sub-quota used")
		})
	}
}

// TestConsumeOrgQuotaConcurrentNeverOverdraws 守护并发扣费不会把企业池扣成负数：
// 池 500，10 个并发各扣 100，恰好 5 个成功，池归零而非透支。
func TestConsumeOrgQuotaConcurrentNeverOverdraws(t *testing.T) {
	setupOrgFixture(t)
	org := seedOrg(t, 1, 500, OrgStatusEnabled)
	member := seedOrgMember(t, org, 101, OrgRoleMember, 0, OrgMemberStatusEnabled)

	const goroutines = 10
	const each = 100
	var wg sync.WaitGroup
	results := make([]error, goroutines)
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func(idx int) {
			defer wg.Done()
			results[idx] = ConsumeOrgQuota(org.Id, member.UserId, each)
		}(i)
	}
	wg.Wait()

	success := 0
	for _, err := range results {
		if err == nil {
			success++
		} else {
			assert.ErrorIs(t, err, ErrOrgQuotaInsufficient)
		}
	}
	assert.Equal(t, 5, success, "exactly pool/each consumes should succeed")

	after := reloadOrg(t, org.Id)
	assert.Equal(t, 0, after.Quota, "pool must be drained to zero, never negative")
	assert.Equal(t, 500, after.UsedQuota)
	assert.Equal(t, 500, reloadMember(t, member.Id).QuotaUsed)
}

// TestRefundOrgQuotaReturnsToPool 校验退款把额度退回池并回滚成员用量，且用量不会变成负数。
func TestRefundOrgQuotaReturnsToPool(t *testing.T) {
	setupOrgFixture(t)
	org := seedOrg(t, 1, 1000, OrgStatusEnabled)
	member := seedOrgMember(t, org, 101, OrgRoleMember, 0, OrgMemberStatusEnabled)

	require.NoError(t, ConsumeOrgQuota(org.Id, member.UserId, 400))
	require.NoError(t, RefundOrgQuota(org.Id, member.UserId, 150))

	after := reloadOrg(t, org.Id)
	assert.Equal(t, 750, after.Quota, "1000-400+150")
	assert.Equal(t, 250, after.UsedQuota, "used 400 then rolled back 150")
	assert.Equal(t, 250, reloadMember(t, member.Id).QuotaUsed)

	// 退款超过已用量时，成员用量与池 used_quota 收敛到 0，不允许为负
	require.NoError(t, RefundOrgQuota(org.Id, member.UserId, 9999))
	after = reloadOrg(t, org.Id)
	assert.GreaterOrEqual(t, after.UsedQuota, 0, "used_quota must never go negative")
	assert.GreaterOrEqual(t, reloadMember(t, member.Id).QuotaUsed, 0, "member used must never go negative")
}

// TestIncreaseOrgQuotaAdjustsPool 校验管理员调额（正负）与不允许把池调成负数。
func TestIncreaseOrgQuotaAdjustsPool(t *testing.T) {
	setupOrgFixture(t)
	org := seedOrg(t, 1, 500, OrgStatusEnabled)

	require.NoError(t, IncreaseOrgQuota(org.Id, 300))
	assert.Equal(t, 800, reloadOrg(t, org.Id).Quota)

	require.NoError(t, IncreaseOrgQuota(org.Id, -200))
	assert.Equal(t, 600, reloadOrg(t, org.Id).Quota)

	// 扣减超过余额必须被拒绝，池保持不变
	require.ErrorIs(t, IncreaseOrgQuota(org.Id, -1000), ErrOrgQuotaInsufficient)
	assert.Equal(t, 600, reloadOrg(t, org.Id).Quota)

	// delta=0 是 no-op
	require.NoError(t, IncreaseOrgQuota(org.Id, 0))
	assert.Equal(t, 600, reloadOrg(t, org.Id).Quota)
}

// TestAddRemoveOrgMemberGroupLinkage 守护成员加入/移出时 User.OrgId 与 Group 的联动，
// 以及“一个用户最多属于一个企业”的约束。
func TestAddRemoveOrgMemberGroupLinkage(t *testing.T) {
	setupOrgFixture(t)
	org := seedOrg(t, 1, 1000, OrgStatusEnabled)
	require.Equal(t, "vip", org.Group)

	user := &User{Id: 201, Username: "joiner", AffCode: "aff-201", Status: common.UserStatusEnabled, Group: DefaultUserGroup}
	require.NoError(t, DB.Create(user).Error)

	// 加入企业：org_id 与 group 同步为企业配置
	require.NoError(t, AddOrgMember(&OrgMember{OrgId: org.Id, UserId: user.Id, OrgRole: OrgRoleMember, Status: OrgMemberStatusEnabled}))
	var joined User
	require.NoError(t, DB.First(&joined, "id = ?", user.Id).Error)
	assert.Equal(t, org.Id, joined.OrgId)
	assert.Equal(t, org.Group, joined.Group)

	// 已属于企业的用户再次加入任意企业都被拒绝
	other := seedOrg(t, 2, 500, OrgStatusEnabled)
	err := AddOrgMember(&OrgMember{OrgId: other.Id, UserId: user.Id, OrgRole: OrgRoleMember, Status: OrgMemberStatusEnabled})
	require.ErrorIs(t, err, ErrOrgUserAlreadyInOrg)

	// 移出企业：解绑但不删账号，group 回落系统默认组
	require.NoError(t, RemoveOrgMember(org.Id, user.Id))
	var removed User
	require.NoError(t, DB.First(&removed, "id = ?", user.Id).Error)
	assert.Equal(t, 0, removed.OrgId)
	assert.Equal(t, DefaultUserGroup, removed.Group)
	_, err = GetOrgMemberByUserId(user.Id)
	require.ErrorIs(t, err, ErrOrgMemberNotFound)
}

// TestGetOrgUsageAggregatesByOrgDimension 校验企业用量报表按 org_id 隔离，
// 并按日/成员/模型正确聚合，缓存命中次数与节省额度独立成列。
func TestGetOrgUsageAggregatesByOrgDimension(t *testing.T) {
	setupOrgFixture(t)
	org := seedOrg(t, 1, 1000, OrgStatusEnabled)
	other := seedOrg(t, 2, 1000, OrgStatusEnabled)
	admin := seedOrgMember(t, org, 301, OrgRoleAdmin, 0, OrgMemberStatusEnabled)
	member := seedOrgMember(t, org, 302, OrgRoleMember, 500, OrgMemberStatusEnabled)
	seedOrgMember(t, other, 303, OrgRoleMember, 0, OrgMemberStatusEnabled)

	now := common.GetTimestamp()
	today := OrgDayStart(now)
	twoDaysAgo := OrgDayStart(now - 2*86400)

	rows := []*QuotaData{
		// 本企业今日：admin 用 modelA（含一次缓存命中）
		{UserID: admin.UserId, OrgId: org.Id, Username: "user-301", ModelName: "modelA", CreatedAt: today + 3600, Count: 2, Quota: 200, TokenUsed: 1000, CacheHits: 1, CacheSavedQuota: 80},
		// 本企业今日：member 用 modelB
		{UserID: member.UserId, OrgId: org.Id, Username: "user-302", ModelName: "modelB", CreatedAt: today + 7200, Count: 1, Quota: 50, TokenUsed: 300},
		// 本企业两天前：admin 用 modelA（验证按日分桶）
		{UserID: admin.UserId, OrgId: org.Id, Username: "user-301", ModelName: "modelA", CreatedAt: twoDaysAgo + 3600, Count: 1, Quota: 100, TokenUsed: 500},
		// 另一企业：必须被隔离，不计入本企业报表
		{UserID: 303, OrgId: other.Id, Username: "user-303", ModelName: "modelA", CreatedAt: today + 3600, Count: 9, Quota: 9999, TokenUsed: 9999},
	}
	require.NoError(t, DB.Create(&rows).Error)

	// 总量：只汇总本企业（200+50+100），排除 other 的 9999
	total, err := GetOrgQuotaTotal(org.Id, twoDaysAgo, now)
	require.NoError(t, err)
	assert.Equal(t, 350, total.Quota)
	assert.Equal(t, 4, total.Count)
	assert.Equal(t, 1800, total.TokenUsed)
	assert.Equal(t, 1, total.CacheHits)
	assert.Equal(t, 80, total.CacheSavedQuota)

	// 当日用量：只算今日（200+50），排除两天前的 100
	daily, err := GetOrgDailyQuota(org.Id, now)
	require.NoError(t, err)
	assert.Equal(t, 250, daily)

	// 报表：按日应有两个自然日分桶
	report, err := GetOrgUsage(org.Id, twoDaysAgo, now)
	require.NoError(t, err)
	assert.Len(t, report.ByDay, 2, "today and two-days-ago buckets")
	assert.Equal(t, 350, report.Total.Quota)

	// 按模型聚合：modelA=300（200+100，隔离 other）、modelB=50
	byModel := map[string]int{}
	for _, m := range report.ByModel {
		byModel[m.ModelName] = m.Quota
	}
	assert.Equal(t, 300, byModel["modelA"])
	assert.Equal(t, 50, byModel["modelB"])

	// 按成员聚合：带出角色与子额度
	byMember := map[int]*OrgUsageByMember{}
	for _, m := range report.ByMember {
		byMember[m.UserId] = m
	}
	require.Contains(t, byMember, admin.UserId)
	require.Contains(t, byMember, member.UserId)
	assert.Equal(t, OrgRoleAdmin, byMember[admin.UserId].OrgRole)
	assert.Equal(t, 300, byMember[admin.UserId].Quota)
	assert.Equal(t, OrgRoleMember, byMember[member.UserId].OrgRole)
	assert.Equal(t, 500, byMember[member.UserId].QuotaLimit, "member sub-quota limit surfaced for the ranking table")
	assert.NotContains(t, byMember, 303, "other org member must not leak into this report")
}

// TestCreateOrganizationWithSetupAtomicity 锁定管理员建企业的原子性契约：
// 管理员用户名不存在或已属于其他企业时不得留下已创建的企业（否则重试即报
// 标识被占用、列表多出无主企业）；成功时企业、初始额度池与首位管理员一并落库。
func TestCreateOrganizationWithSetupAtomicity(t *testing.T) {
	setupOrgFixture(t)

	t.Run("missing owner leaves no organization behind", func(t *testing.T) {
		org := &Organization{Name: "atomic-missing", Group: "default", Status: OrgStatusEnabled}
		err := CreateOrganizationWithSetup(org, 500, 999999)
		require.ErrorIs(t, err, ErrOrgUserNotFound)
		_, getErr := GetOrganizationByName("atomic-missing")
		assert.ErrorIs(t, getErr, ErrOrgNotFound, "failed create must not commit the organization row")
	})

	t.Run("owner already in another org rolls back", func(t *testing.T) {
		first := seedOrg(t, 9001, 0, OrgStatusEnabled)
		seedOrgMember(t, first, 9001, OrgRoleAdmin, 0, OrgMemberStatusEnabled)
		org := &Organization{Name: "atomic-taken-member", Group: "default", Status: OrgStatusEnabled}
		err := CreateOrganizationWithSetup(org, 500, 9001)
		require.ErrorIs(t, err, ErrOrgUserAlreadyInOrg)
		_, getErr := GetOrganizationByName("atomic-taken-member")
		assert.ErrorIs(t, getErr, ErrOrgNotFound, "failed create must not commit the organization row")
	})

	t.Run("success funds pool and appoints first admin", func(t *testing.T) {
		user := &User{Id: 9101, Username: "atomic-owner", AffCode: "aff-9101", Status: common.UserStatusEnabled, Group: DefaultUserGroup}
		require.NoError(t, DB.Create(user).Error)
		org := &Organization{Name: "atomic-ok", Group: "vip", Status: OrgStatusEnabled}
		require.NoError(t, CreateOrganizationWithSetup(org, 500, 9101))

		created, err := GetOrganizationByName("atomic-ok")
		require.NoError(t, err)
		assert.Equal(t, 500, created.Quota, "initial pool quota persisted on create")
		assert.Equal(t, 9101, created.OwnerUserId)

		member, err := GetOrgMemberByUserId(9101)
		require.NoError(t, err)
		assert.Equal(t, created.Id, member.OrgId)
		assert.Equal(t, OrgRoleAdmin, member.OrgRole)

		var refreshed User
		require.NoError(t, DB.Where("id = ?", 9101).First(&refreshed).Error)
		assert.Equal(t, created.Id, refreshed.OrgId, "owner account linked to the new organization")
		assert.Equal(t, "vip", refreshed.Group, "owner inherits the organization billing group")
	})
}
