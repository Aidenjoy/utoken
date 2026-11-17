package model

import (
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// membershipFixture isolates billing state from .env and the application's running database.
func membershipFixture(t *testing.T) (*SubscriptionPlan, *UserSubscription) {
	t.Helper()
	previousDB, previousLog := DB, LOG_DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	DB, LOG_DB = db, db
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { DB, LOG_DB = previousDB, previousLog; _ = sqlDB.Close() })
	require.NoError(t, db.AutoMigrate(&User{}, &Channel{}, &Log{}, &SubscriptionPlan{}, &UserSubscription{}, &SubscriptionOrder{}, &TopUp{}, &SubscriptionChannelQuota{}, &SubscriptionChannelRequest{}, &SubscriptionPreConsumeRecord{}))
	require.NoError(t, db.Create(&User{Id: 701, Username: "membership", AffCode: "membership", Quota: 1000000, Group: "default"}).Error)
	require.NoError(t, db.Create(&Channel{Id: 702, Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, Models: "gpt-4o-mini"}).Error)
	configs, err := common.Marshal([]SubscriptionChannelConfig{{ChannelId: 702, Profile: MembershipTextProfile, Unit: MembershipUnitTokens, Models: []string{"gpt-4o-mini"}, InputLimit: 100, OutputLimit: 80}})
	require.NoError(t, err)
	plan := &SubscriptionPlan{Id: 703, Title: "channel membership", MeterType: SubscriptionMeterChannel, ChannelQuotas: JSONValue(configs), PriceAmount: 1, Enabled: true, DurationUnit: SubscriptionDurationDay, DurationValue: 1}
	require.NoError(t, db.Create(plan).Error)
	require.NoError(t, PurchaseSubscriptionWithBalance(701, plan.Id))
	var sub UserSubscription
	require.NoError(t, db.Where("user_id = ?", 701).First(&sub).Error)
	return plan, &sub
}

func TestMembershipBalanceActivationAndLegacyIsolation(t *testing.T) {
	plan, sub := membershipFixture(t)
	var user User
	require.NoError(t, DB.First(&user, 701).Error)
	assert.Equal(t, 1000000-int(common.QuotaPerUnit), user.Quota)
	assert.False(t, sub.AllowWalletOverflow)
	var grant SubscriptionChannelQuota
	require.NoError(t, DB.Where("user_subscription_id = ?", sub.Id).First(&grant).Error)
	assert.EqualValues(t, 100, grant.InputLimit)
	assert.EqualValues(t, 80, grant.OutputLimit)
	active, err := HasActiveUserSubscription(701)
	require.NoError(t, err)
	assert.False(t, active)
	allow, err := UserActiveSubscriptionsAllowWalletOverflow(701)
	require.NoError(t, err)
	assert.True(t, allow, "membership must not affect ordinary key wallet fallback")
	_, err = PreConsumeUserSubscription("ordinary", 701, "gpt-4o-mini", 0, 1)
	require.Error(t, err)
	_, err = GetMembershipGrant(DB, 999, sub.Id, 702)
	require.Error(t, err)
	_, err = AdminResetUserSubscriptionsByPlan(701, plan.Id, false)
	require.Error(t, err)
	// An invalid grant must roll back the balance debit, subscription and order together.
	before := user.Quota
	require.NoError(t, DB.Model(&Channel{}).Where("id = ?", 702).Update("status", common.ChannelStatusManuallyDisabled).Error)
	require.Error(t, PurchaseSubscriptionWithBalance(701, plan.Id))
	require.NoError(t, DB.First(&user, 701).Error)
	assert.Equal(t, before, user.Quota)
	var count int64
	require.NoError(t, DB.Model(&UserSubscription{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestMembershipReservationConcurrencyAndIdempotentSettlement(t *testing.T) {
	_, sub := membershipFixture(t)
	start := make(chan struct{})
	errors := make(chan error, 2)
	var workers sync.WaitGroup
	for _, id := range []string{"request-a", "request-b"} {
		workers.Add(1)
		go func(id string) {
			defer workers.Done()
			<-start
			errors <- ReserveMembership(&SubscriptionChannelRequest{RequestId: id, UserId: 701, TokenId: 1, UserSubscriptionId: sub.Id, ChannelId: 702, Model: "gpt-4o-mini", InputReserved: 60, OutputReserved: 50})
		}(id)
	}
	close(start)
	workers.Wait()
	close(errors)
	successes := 0
	for err := range errors {
		if err == nil {
			successes++
		}
	}
	assert.Equal(t, 1, successes)
	var record SubscriptionChannelRequest
	require.NoError(t, DB.First(&record).Error)
	require.NoError(t, DispatchMembership(record.RequestId))
	require.Error(t, FinishMembership(record.RequestId, 0, 0, "released", "network failure is not proof of no usage"))
	require.NoError(t, FinishMembership(record.RequestId, 0, 0, "pending", "connection lost"))
	require.NoError(t, FinishMembership(record.RequestId, 30, 20, "settled", "provider receipt"))
	require.NoError(t, FinishMembership(record.RequestId, 30, 20, "settled", "duplicate receipt"))
	require.Error(t, FinishMembership(record.RequestId, 31, 20, "settled", "conflicting receipt"))
	var grant SubscriptionChannelQuota
	require.NoError(t, DB.First(&grant).Error)
	assert.EqualValues(t, 30, grant.InputUsed)
	assert.EqualValues(t, 20, grant.OutputUsed)
	assert.Zero(t, grant.InputReserved)
	assert.Zero(t, grant.OutputReserved)
}

func TestMembershipExpiryAndPreparedRelease(t *testing.T) {
	_, sub := membershipFixture(t)
	record := &SubscriptionChannelRequest{RequestId: "expiry", UserId: 701, UserSubscriptionId: sub.Id, ChannelId: 702, Model: "gpt-4o-mini", InputReserved: 10, OutputReserved: 10}
	require.NoError(t, ReserveMembership(record))
	require.NoError(t, FinishMembership(record.RequestId, 0, 0, "released", "not sent"))
	require.NoError(t, FinishMembership(record.RequestId, 0, 0, "released", "not sent"))
	record = &SubscriptionChannelRequest{RequestId: "accepted", UserId: 701, UserSubscriptionId: sub.Id, ChannelId: 702, Model: "gpt-4o-mini", InputReserved: 10, OutputReserved: 10}
	require.NoError(t, ReserveMembership(record))
	require.NoError(t, DispatchMembership(record.RequestId))
	require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", sub.Id).Update("end_time", GetDBTimestamp()-1).Error)
	require.Error(t, ReserveMembership(&SubscriptionChannelRequest{RequestId: "expired", UserId: 701, UserSubscriptionId: sub.Id, ChannelId: 702, Model: "gpt-4o-mini", InputReserved: 1, OutputReserved: 1}))
	require.NoError(t, FinishMembership(record.RequestId, 5, 6, "settled", "completed after expiry"))
}

func TestMembershipPaymentCallbackUsesSnapshotAndGrantsOnce(t *testing.T) {
	plan, _ := membershipFixture(t)
	snapshot, err := common.Marshal(plan)
	require.NoError(t, err)
	order := &SubscriptionOrder{UserId: 701, PlanId: plan.Id, Money: 1, TradeNo: "membership-test-callback", Status: common.TopUpStatusPending, PaymentMethod: "alipay", PaymentProvider: PaymentProviderEpay, PlanSnapshot: string(snapshot)}
	require.NoError(t, DB.Create(order).Error)
	// The callback must use purchased rights even if the plan has since changed.
	require.NoError(t, DB.Model(plan).Update("channel_quotas", JSONValue(`[]`)).Error)
	require.NoError(t, CompleteSubscriptionOrder(order.TradeNo, "mock receipt", PaymentProviderEpay, "alipay"))
	require.NoError(t, CompleteSubscriptionOrder(order.TradeNo, "duplicate receipt", PaymentProviderEpay, "alipay"))
	var count int64
	require.NoError(t, DB.Model(&UserSubscription{}).Count(&count).Error)
	assert.EqualValues(t, 2, count, "one balance purchase and one paid order")
	require.NoError(t, DB.Model(&SubscriptionChannelQuota{}).Count(&count).Error)
	assert.EqualValues(t, 2, count)
	require.Error(t, CompleteSubscriptionOrder(order.TradeNo, "wrong gateway", "stripe", ""))
}
