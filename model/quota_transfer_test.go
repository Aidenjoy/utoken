package model

import (
	"fmt"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// setupTransferFixture 在企业 fixture 之上迁移转移台账与充值订单表，
// 并清理账单口径测试会写入的三类数据源（台账、订单、管理审计日志）。
func setupTransferFixture(t *testing.T) {
	t.Helper()
	setupOrgFixture(t)
	require.NoError(t, DB.AutoMigrate(&QuotaTransfer{}, &TopUp{}))
	cleanup := func() {
		DB.Exec("DELETE FROM quota_transfers")
		DB.Exec("DELETE FROM top_ups")
		DB.Exec("DELETE FROM logs")
	}
	cleanup()
	t.Cleanup(cleanup)
}

func seedWalletUser(t *testing.T, id int, quota int) *User {
	t.Helper()
	user := &User{
		Id:       id,
		Username: fmt.Sprintf("wallet-%d", id),
		AffCode:  fmt.Sprintf("aff-wallet-%d", id),
		Status:   common.UserStatusEnabled,
		Group:    DefaultUserGroup,
		Quota:    quota,
	}
	require.NoError(t, DB.Create(user).Error)
	return user
}

func reloadUserQuota(t *testing.T, id int) int {
	t.Helper()
	var user User
	require.NoError(t, DB.Select("quota").Where("id = ?", id).First(&user).Error)
	return user.Quota
}

func countTransfers(t *testing.T) int64 {
	t.Helper()
	var count int64
	require.NoError(t, DB.Model(&QuotaTransfer{}).Count(&count).Error)
	return count
}

// TestTransferUserQuotaToOrgGuards 锁定钱包→企业池转移的原子契约：
// 成功时个人钱包扣减、池增加、台账恰好落一行，并返回事务内的新池余额；
// 任一失败分支都不得留下半截账（钱包扣了池没加、或台账多出无主记录）。
func TestTransferUserQuotaToOrgGuards(t *testing.T) {
	tests := []struct {
		name         string
		walletQuota  int
		orgQuota     int
		orgStatus    int
		missingOrg   bool
		amount       int
		wantErr      error
		wantWallet   int
		wantPool     int
		wantReturned int
		wantLedger   int64
	}{
		{
			name:         "partial transfer moves balance and records one ledger row",
			walletQuota:  500,
			orgQuota:     1000,
			orgStatus:    OrgStatusEnabled,
			amount:       300,
			wantWallet:   200,
			wantPool:     1300,
			wantReturned: 1300,
			wantLedger:   1,
		},
		{
			name:         "transferring the entire wallet is allowed",
			walletQuota:  500,
			orgQuota:     0,
			orgStatus:    OrgStatusEnabled,
			amount:       500,
			wantWallet:   0,
			wantPool:     500,
			wantReturned: 500,
			wantLedger:   1,
		},
		{
			name:        "amount above wallet balance rolls back",
			walletQuota: 100,
			orgQuota:    1000,
			orgStatus:   OrgStatusEnabled,
			amount:      101,
			wantErr:     ErrInsufficientUserQuota,
			wantWallet:  100,
			wantPool:    1000,
		},
		{
			name:        "disabled organization is rejected before touching the wallet",
			walletQuota: 500,
			orgQuota:    1000,
			orgStatus:   OrgStatusDisabled,
			amount:      100,
			wantErr:     ErrOrgDisabled,
			wantWallet:  500,
			wantPool:    1000,
		},
		{
			name:        "missing organization is rejected",
			walletQuota: 500,
			orgQuota:    1000,
			orgStatus:   OrgStatusEnabled,
			missingOrg:  true,
			amount:      100,
			wantErr:     ErrOrgNotFound,
			wantWallet:  500,
			wantPool:    1000,
		},
		{
			name:        "zero amount is rejected",
			walletQuota: 500,
			orgQuota:    1000,
			orgStatus:   OrgStatusEnabled,
			amount:      0,
			wantErr:     ErrQuotaTransferInvalid,
			wantWallet:  500,
			wantPool:    1000,
		},
		{
			name:        "negative amount is rejected",
			walletQuota: 500,
			orgQuota:    1000,
			orgStatus:   OrgStatusEnabled,
			amount:      -100,
			wantErr:     ErrQuotaTransferInvalid,
			wantWallet:  500,
			wantPool:    1000,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setupTransferFixture(t)
			user := seedWalletUser(t, 501, tt.walletQuota)
			org := seedOrg(t, 1, tt.orgQuota, tt.orgStatus)

			targetOrgId := org.Id
			if tt.missingOrg {
				targetOrgId = 9999
			}
			returned, err := TransferUserQuotaToOrg(user.Id, targetOrgId, tt.amount)
			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
				assert.Zero(t, returned, "rejected transfer must not report a pool balance")
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.wantReturned, returned, "returned pool balance")
			}

			assert.Equal(t, tt.wantWallet, reloadUserQuota(t, user.Id), "personal wallet")
			assert.Equal(t, tt.wantPool, reloadOrg(t, org.Id).Quota, "organization pool")
			assert.Equal(t, tt.wantLedger, countTransfers(t), "ledger rows")
		})
	}
}

// TestTransferUserQuotaToOrgConcurrentNeverOverdraws 守护并发转移不会把钱包透支：
// 钱包 500，10 个并发各转 100，恰好 5 个成功，钱包归零而非变负，
// 台账行数与成功次数一致（不会出现扣了钱没记账、或记了账没扣钱）。
func TestTransferUserQuotaToOrgConcurrentNeverOverdraws(t *testing.T) {
	setupTransferFixture(t)
	user := seedWalletUser(t, 501, 500)
	org := seedOrg(t, 1, 0, OrgStatusEnabled)

	const goroutines = 10
	const each = 100
	var wg sync.WaitGroup
	results := make([]error, goroutines)
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func(idx int) {
			defer wg.Done()
			_, results[idx] = TransferUserQuotaToOrg(user.Id, org.Id, each)
		}(i)
	}
	wg.Wait()

	success := 0
	for _, err := range results {
		if err == nil {
			success++
		} else {
			assert.ErrorIs(t, err, ErrInsufficientUserQuota)
		}
	}
	assert.Equal(t, 5, success, "exactly wallet/amount transfers should succeed")
	assert.Equal(t, 0, reloadUserQuota(t, user.Id), "wallet must be drained to zero, never negative")
	assert.Equal(t, success*each, reloadOrg(t, org.Id).Quota, "pool only grows by what actually left the wallet")
	assert.EqualValues(t, success, countTransfers(t), "one ledger row per committed transfer")
}

// seedOnlineTopup 模拟一笔已完成的自助在线充值：既写订单台账，也把额度记到用户钱包，
// 与真实支付回调的账务效果一致。Creem 渠道按 Amount 原值入账，便于断言精确额度。
func seedOnlineTopup(t *testing.T, userId int, quota int, createdAt int64) {
	t.Helper()
	topUp := &TopUp{
		UserId:          userId,
		Amount:          int64(quota),
		Money:           1,
		TradeNo:         fmt.Sprintf("topup-%d-%d", userId, createdAt),
		PaymentMethod:   PaymentMethodCreem,
		PaymentProvider: PaymentProviderCreem,
		CreateTime:      createdAt,
		CompleteTime:    createdAt,
		Status:          common.TopUpStatusSuccess,
	}
	require.NoError(t, DB.Create(topUp).Error)
	require.NoError(t, IncreaseUserQuota(userId, quota, true))
}

// seedAdjustAudit 模拟管理员后台调额留下的管理审计日志。线下调额没有独立台账表，
// 账单中心只能从审计参数还原，所以参数结构必须与 recordManageAudit 写入的完全一致。
func seedAdjustAudit(t *testing.T, operatorId int, action string, params map[string]interface{}) {
	t.Helper()
	RecordOperationAuditLog(operatorId, action, "127.0.0.1", action, params, nil, nil)
}

// TestGetBillingRechargeRecordsSeparatesFundingOrigins 锁定账单中心的对账口径。
//
// 场景是客户真实资金流：先自助线上刷卡 100，管理员再按线下打款给个人钱包加 50、
// 给企业池加 200，最后用户把钱包里的 100 自助转进企业池。此时必须满足：
//   - 线上/线下/内部三分互不重叠，"总充值"只认真金白银的入口金额，
//     内部转移不会让同一笔钱被重复计入流入；
//   - 一行台账展开成「钱包 −100」与「池 +100」两条明细，共用同一订单号便于配对；
//   - 两个筛选维度各自独立生效，净增加额恒等于所选对象的余额变化。
func TestGetBillingRechargeRecordsSeparatesFundingOrigins(t *testing.T) {
	setupTransferFixture(t)
	org := seedOrg(t, 1, 0, OrgStatusEnabled)
	seedOrg(t, 2, 0, OrgStatusEnabled)
	user := seedWalletUser(t, 501, 0)
	admin := seedWalletUser(t, 900, 0)

	now := common.GetTimestamp()
	seedOnlineTopup(t, user.Id, 100, now-300)
	seedAdjustAudit(t, admin.Id, "user.quota_add", map[string]interface{}{
		"target_user_id": user.Id,
		"quota_value":    50,
	})
	require.NoError(t, IncreaseUserQuota(user.Id, 50, true))
	seedAdjustAudit(t, admin.Id, "org.quota_adjust", map[string]interface{}{
		"id":    org.Id,
		"delta": 200,
		"name":  org.DisplayName,
	})
	require.NoError(t, IncreaseOrgQuota(org.Id, 200))

	poolAfterTransfer, err := TransferUserQuotaToOrg(user.Id, org.Id, 100)
	require.NoError(t, err)
	assert.Equal(t, 300, poolAfterTransfer)
	assert.Equal(t, 50, reloadUserQuota(t, user.Id), "wallet: +100 online, +50 offline, -100 transferred")

	tests := []struct {
		name      string
		userScope BillingScope
		orgScope  BillingScope
		wantCount int
		wantStat  BillingRechargeStat
	}{
		{
			name:      "both dimensions: internal transfer nets to zero and stays out of inflow",
			userScope: BillingScope{Mode: BillingScopeAll},
			orgScope:  BillingScope{Mode: BillingScopeAll},
			wantCount: 5,
			wantStat: BillingRechargeStat{
				Count:              5,
				TotalQuota:         350,
				InflowQuota:        350,
				OutflowQuota:       0,
				OnlineInflowQuota:  100,
				OfflineInflowQuota: 250,
				TransferInQuota:    100,
				TransferOutQuota:   -100,
				BalanceQuota:       350,
			},
		},
		{
			name:      "organization dimension only sees the pool side of the transfer",
			userScope: BillingScope{Mode: BillingScopeNone},
			orgScope:  BillingScope{Mode: BillingScopeAll},
			wantCount: 2,
			wantStat: BillingRechargeStat{
				Count:              2,
				TotalQuota:         300,
				InflowQuota:        200,
				OutflowQuota:       0,
				OnlineInflowQuota:  0,
				OfflineInflowQuota: 200,
				TransferInQuota:    100,
				TransferOutQuota:   0,
				BalanceQuota:       300,
			},
		},
		{
			name:      "user dimension only sees the wallet side of the transfer",
			userScope: BillingScope{Mode: BillingScopeAll},
			orgScope:  BillingScope{Mode: BillingScopeNone},
			wantCount: 3,
			wantStat: BillingRechargeStat{
				Count:              3,
				TotalQuota:         50,
				InflowQuota:        150,
				OutflowQuota:       0,
				OnlineInflowQuota:  100,
				OfflineInflowQuota: 50,
				TransferInQuota:    0,
				TransferOutQuota:   -100,
				BalanceQuota:       50,
			},
		},
		{
			name:      "unrelated organization filter drops the pool side but keeps the wallet side",
			userScope: BillingScope{Mode: BillingScopeIds, Ids: []int{user.Id}},
			orgScope:  BillingScope{Mode: BillingScopeIds, Ids: []int{2}},
			wantCount: 3,
			wantStat: BillingRechargeStat{
				Count:              3,
				TotalQuota:         50,
				InflowQuota:        150,
				OutflowQuota:       0,
				OnlineInflowQuota:  100,
				OfflineInflowQuota: 50,
				TransferInQuota:    0,
				TransferOutQuota:   -100,
				BalanceQuota:       50,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			records, stat, err := GetBillingRechargeRecords(tt.userScope, tt.orgScope, 0, 0)
			require.NoError(t, err)
			assert.Len(t, records, tt.wantCount)
			assert.Equal(t, tt.wantStat, stat)
			// 净增加额必须等于所选对象当前的余额总和，否则账对不平
			assert.Equal(t, stat.BalanceQuota, stat.TotalQuota, "net increase must equal the balance of the selected scope")
		})
	}

	t.Run("transfer pair shares one trade number and is attributed to the user", func(t *testing.T) {
		records, _, err := GetBillingRechargeRecords(
			BillingScope{Mode: BillingScopeAll}, BillingScope{Mode: BillingScopeAll}, 0, 0)
		require.NoError(t, err)

		bySource := make(map[string]*BillingRechargeRecord, len(records))
		for _, record := range records {
			bySource[record.Source] = record
		}
		out := bySource[BillingSourceWalletTransferOut]
		in := bySource[BillingSourceWalletTransferIn]
		require.NotNil(t, out, "wallet side of the transfer")
		require.NotNil(t, in, "pool side of the transfer")

		assert.Equal(t, -100, out.Quota)
		assert.Equal(t, 100, in.Quota)
		assert.NotEmpty(t, out.TradeNo, "transfer records must be pairable in the ledger and the CSV export")
		assert.Equal(t, out.TradeNo, in.TradeNo, "both sides of one transfer share a trade number")
		assert.Equal(t, user.Id, out.UserId)
		assert.Equal(t, org.Id, in.OrgId)

		for _, record := range []*BillingRechargeRecord{out, in} {
			assert.Equal(t, user.Username, record.Username)
			assert.Equal(t, user.Username, record.Operator, "a self-service transfer has no admin, the mover is the operator")
			assert.Zero(t, record.Money, "no new money enters on an internal transfer")
		}
		assert.Equal(t, org.DisplayName, in.OrgName, "organization name backfilled for the pool side")
		assert.Equal(t, admin.Username, bySource[BillingSourceUserAdjust].Operator, "admin adjustments keep the admin as operator")
	})
}
