package model

import (
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestMembershipUpgradeUsesFullTargetProration(t *testing.T) {
	const day = int64(86400)
	current := SubscriptionPlan{Id: 1, Currency: "CNY", DurationUnit: SubscriptionDurationDay, DurationValue: 30, PriceAmount: 30, InputTokenLimit: 1000000, OutputTokenLimit: 200000}
	target := current
	target.Id, target.PriceAmount, target.InputTokenLimit, target.OutputTokenLimit = 2, 90, 2500000, 500000
	sub := UserSubscription{Id: 3, PlanId: 1, StartTime: day, EndTime: 31 * day}
	grant := SubscriptionChannelQuota{InputLimit: 1000000, InputUsed: 900000, OutputLimit: 200000, OutputUsed: 200000}
	quote, err := calculateSubscriptionUpgradeQuote(sub, current, target, grant, 26*day)
	require.NoError(t, err)
	require.Equal(t, "15.00", quote.Amount.StringFixed(2))
	require.EqualValues(t, 416666, quote.InputAdded)
	require.EqualValues(t, 83333, quote.OutputAdded)
	require.EqualValues(t, 516666, quote.InputAvailable)
	require.EqualValues(t, 83333, quote.OutputAvailable)
	require.Equal(t, sub.EndTime, quote.EndTime)

	current.QuotaResetPeriod, target.QuotaResetPeriod = SubscriptionResetMonthly, SubscriptionResetMonthly
	sub.EndTime, sub.LastResetTime, sub.NextResetTime = 361*day, 21*day, 31*day
	quote, err = calculateSubscriptionUpgradeQuote(sub, current, target, grant, 26*day)
	require.NoError(t, err)
	require.Equal(t, "83.75", quote.Amount.StringFixed(2))
	require.EqualValues(t, 1250000, quote.InputAdded)
}

func TestMembershipUpgradePaidOrdersAndCycleIsolation(t *testing.T) {
	membershipFixture(t)
	now := GetDBTimestamp()
	current := SubscriptionPlan{Title: "base", MeterType: SubscriptionMeterSharedTokens, Currency: "USD", DurationUnit: SubscriptionDurationDay, DurationValue: 30,
		PriceAmount: 30, InputTokenLimit: 1000, OutputTokenLimit: 500, Enabled: true, QuotaResetPeriod: SubscriptionResetCustom, QuotaResetCustomSeconds: 86400}
	target := current
	target.Title, target.PriceAmount, target.InputTokenLimit, target.OutputTokenLimit = "plus", 90, 2000, 1000
	require.NoError(t, DB.Create(&current).Error)
	require.NoError(t, DB.Create(&target).Error)
	var sub *UserSubscription
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		var err error
		sub, err = CreateUserSubscriptionFromPlanTx(tx, 701, &current, "test")
		return err
	}))
	require.ErrorIs(t, DB.Transaction(func(tx *gorm.DB) error {
		_, err := CreateUserSubscriptionFromPlanTx(tx, 701, &current, "test")
		return err
	}), errSharedPlanAlreadyActive)

	record := &SubscriptionChannelRequest{RequestId: "before-upgrade", UserId: 701, UserSubscriptionId: sub.Id, Model: "test", InputReserved: 10, OutputReserved: 10}
	require.NoError(t, ReserveMembership(record))
	require.NoError(t, DispatchMembership(record.RequestId))
	quote, snapshot, err := QuoteSubscriptionUpgrade(701, sub.Id, target.Id)
	require.NoError(t, err)
	money := quote.Amount.InexactFloat64()
	for _, trade := range []string{"upgrade-first", "upgrade-racing"} {
		order := SubscriptionOrder{UserId: 701, PlanId: target.Id, TradeNo: trade, Money: money,
			PaymentProvider: PaymentProviderEpay, PaymentMethod: "mock", Status: common.TopUpStatusPending,
			UpgradeSnapshot: common.GetJsonString(quote), PlanSnapshot: common.GetJsonString(snapshot)}
		require.NoError(t, order.Insert())
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, trade := range []string{"upgrade-first", "upgrade-racing"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- CompleteEpaySubscriptionOrder(trade, "mock", "mock", quote.Amount.StringFixed(2))
		}()
	}
	wg.Wait()
	close(results)
	for err := range results {
		require.NoError(t, err)
	}
	var success, pending int
	for _, trade := range []string{"upgrade-first", "upgrade-racing"} {
		order := GetSubscriptionOrderByTradeNo(trade)
		require.NotNil(t, order)
		switch order.Status {
		case common.TopUpStatusSuccess:
			success++
		case SubscriptionOrderPaidUnapplied:
			pending++
		}
		require.NoError(t, CompleteEpaySubscriptionOrder(trade, "mock replay", "mock", quote.Amount.StringFixed(2)))
	}
	require.Equal(t, 1, success)
	require.Equal(t, 1, pending)
	var updated UserSubscription
	require.NoError(t, DB.First(&updated, sub.Id).Error)
	require.Equal(t, target.Id, updated.PlanId)
	require.Equal(t, sub.EndTime, updated.EndTime)
	require.Equal(t, sub.NextResetTime, updated.NextResetTime)
	var grant SubscriptionChannelQuota
	require.NoError(t, DB.Where("user_subscription_id = ? AND channel_id = 0", sub.Id).First(&grant).Error)
	require.Equal(t, current.InputTokenLimit+quote.InputAdded, grant.InputLimit)
	require.EqualValues(t, 10, grant.InputReserved)

	higher := target
	higher.Id, higher.Title, higher.PriceAmount, higher.InputTokenLimit, higher.OutputTokenLimit = 0, "highest", 120, 3000, 2000
	require.NoError(t, DB.Create(&higher).Error)
	nextQuote, nextTarget, err := QuoteSubscriptionUpgrade(701, sub.Id, higher.Id)
	require.NoError(t, err)
	require.Equal(t, target.Id, nextQuote.SourcePlanID)
	require.Equal(t, sub.StartTime, updated.StartTime)
	require.Equal(t, sub.EndTime, nextQuote.EndTime)
	nextOrder := SubscriptionOrder{UserId: 701, PlanId: higher.Id, TradeNo: "upgrade-cross-cycle", Money: nextQuote.Amount.InexactFloat64(),
		PaymentProvider: PaymentProviderEpay, PaymentMethod: "mock", Status: common.TopUpStatusPending,
		UpgradeSnapshot: common.GetJsonString(nextQuote), PlanSnapshot: common.GetJsonString(nextTarget)}
	require.NoError(t, nextOrder.Insert())

	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return resetSharedTokenCycleTx(tx, &updated, max(now, sub.NextResetTime)+1)
	}))
	require.NoError(t, CompleteEpaySubscriptionOrder(nextOrder.TradeNo, "mock late payment", "mock", nextQuote.Amount.StringFixed(2)))
	require.Equal(t, SubscriptionOrderPaidUnapplied, GetSubscriptionOrderByTradeNo(nextOrder.TradeNo).Status)
	require.NoError(t, FinishMembership(record.RequestId, 7, 5, "settled", "late mock usage"))
	require.NoError(t, DB.First(&grant, grant.Id).Error)
	require.Equal(t, target.InputTokenLimit, grant.InputLimit)
	require.Equal(t, target.OutputTokenLimit, grant.OutputLimit)
	require.Zero(t, grant.InputUsed)
	require.Zero(t, grant.OutputUsed)
	require.Zero(t, grant.InputReserved)
	require.Zero(t, grant.OutputReserved)
	require.Error(t, CompleteEpaySubscriptionOrder("upgrade-first", "wrong amount", "mock", "1.00"))
}
