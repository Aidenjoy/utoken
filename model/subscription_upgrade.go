package model

import (
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

const SubscriptionOrderPaidUnapplied = "paid_unapplied"

var errSubscriptionUpgradeStale = errors.New("subscription upgrade is no longer applicable")
var errSharedPlanAlreadyActive = errors.New("该套餐仍在生效期内")

// SubscriptionUpgradeQuote records the amount and current-cycle grants for an in-place upgrade.
type SubscriptionUpgradeQuote struct {
	SubscriptionID  int             `json:"subscription_id"`
	SourcePlanID    int             `json:"source_plan_id"`
	TargetPlanID    int             `json:"target_plan_id"`
	TargetTitle     string          `json:"target_title"`
	Amount          decimal.Decimal `json:"amount"`
	Currency        string          `json:"currency"`
	InputAdded      int64           `json:"input_added"`
	OutputAdded     int64           `json:"output_added"`
	InputAvailable  int64           `json:"input_available"`
	OutputAvailable int64           `json:"output_available"`
	EndTime         int64           `json:"end_time"`
	CycleStart      int64           `json:"cycle_start"`
	CycleEnd        int64           `json:"cycle_end"`
}

func QuoteSubscriptionUpgrade(userID, subID, targetID int) (*SubscriptionUpgradeQuote, *SubscriptionPlan, error) {
	var quote *SubscriptionUpgradeQuote
	var target SubscriptionPlan
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id").First(&user, userID).Error; err != nil {
			return err
		}
		var sub UserSubscription
		if err := lockForUpdate(tx).Where("id = ? AND user_id = ? AND meter_type = ?", subID, userID, SubscriptionMeterSharedTokens).First(&sub).Error; err != nil {
			return err
		}
		if err := tx.First(&target, targetID).Error; err != nil {
			return err
		}
		if !target.Enabled || target.MeterType != SubscriptionMeterSharedTokens {
			return errors.New("目标套餐不可升级")
		}
		if _, err := validateSubscriptionChannels(tx, &target, true); err != nil {
			return err
		}
		var current SubscriptionPlan
		if sub.EffectivePlanSnapshot == "" || common.UnmarshalJsonStr(sub.EffectivePlanSnapshot, &current) != nil {
			return errors.New("当前订阅缺少可信的原始档位快照")
		}
		now := getDBTimestampTx(tx)
		if sub.Status != "active" || now < sub.StartTime || now >= sub.EndTime {
			return errSubscriptionUpgradeStale
		}
		if err := resetSharedTokenCycleTx(tx, &sub, now); err != nil {
			return err
		}
		var grant SubscriptionChannelQuota
		if err := lockForUpdate(tx).Where("user_subscription_id = ? AND channel_id = 0", sub.Id).First(&grant).Error; err != nil {
			return err
		}
		if err := checkActiveSharedPlan(tx, userID, target.Id, now); err != nil {
			return err
		}
		var err error
		quote, err = calculateSubscriptionUpgradeQuote(sub, current, target, grant, now)
		return err
	})
	return quote, &target, err
}

func calculateSubscriptionUpgradeQuote(sub UserSubscription, current, target SubscriptionPlan, grant SubscriptionChannelQuota, now int64) (*SubscriptionUpgradeQuote, error) {
	if current.Id != sub.PlanId || target.Id == current.Id || current.Currency != target.Currency ||
		current.DurationUnit != target.DurationUnit || current.DurationValue != target.DurationValue ||
		current.CustomSeconds != target.CustomSeconds ||
		NormalizeResetPeriod(current.QuotaResetPeriod) != NormalizeResetPeriod(target.QuotaResetPeriod) ||
		current.QuotaResetCustomSeconds != target.QuotaResetCustomSeconds ||
		target.PriceAmount <= current.PriceAmount || target.InputTokenLimit < current.InputTokenLimit ||
		target.OutputTokenLimit < current.OutputTokenLimit ||
		(target.InputTokenLimit == current.InputTokenLimit && target.OutputTokenLimit == current.OutputTokenLimit) {
		return nil, errors.New("请选择币种和周期一致的更高档双 Token 套餐")
	}
	start, end := max(sub.StartTime, sub.LastResetTime), sub.EndTime
	if sub.NextResetTime > 0 {
		end = min(end, sub.NextResetTime)
	}
	if !(sub.StartTime <= now && start <= now && now < end && end <= sub.EndTime) {
		return nil, errSubscriptionUpgradeStale
	}
	amount := decimal.NewFromFloat(target.PriceAmount).Mul(decimal.NewFromInt(sub.EndTime-now)).
		DivRound(decimal.NewFromInt(sub.EndTime-sub.StartTime), 2)
	if !amount.IsPositive() {
		return nil, errors.New("升级金额低于支付最小单位")
	}
	prorate := func(limit int64) int64 {
		n, _ := decimal.NewFromInt(limit).Mul(decimal.NewFromInt(end-now)).
			QuoRem(decimal.NewFromInt(end-start), 0)
		return n.IntPart()
	}
	input, output := prorate(target.InputTokenLimit), prorate(target.OutputTokenLimit)
	if input == 0 && output == 0 {
		return nil, errors.New("当前周期剩余时间不足以补发额度")
	}
	if grant.InputLimit+input > MembershipMaxTokens || grant.OutputLimit+output > MembershipMaxTokens {
		return nil, errors.New("升级后的额度超过支持范围")
	}
	return &SubscriptionUpgradeQuote{
		SubscriptionID: sub.Id, SourcePlanID: current.Id, TargetPlanID: target.Id, TargetTitle: target.Title,
		Amount: amount, Currency: target.Currency, InputAdded: input, OutputAdded: output,
		InputAvailable:  grant.InputLimit - grant.InputUsed - grant.InputReserved + input,
		OutputAvailable: grant.OutputLimit - grant.OutputUsed - grant.OutputReserved + output,
		EndTime:         sub.EndTime, CycleStart: start, CycleEnd: end,
	}, nil
}

func checkActiveSharedPlan(tx *gorm.DB, userID, planID int, now int64) error {
	var sub UserSubscription
	err := lockForUpdate(tx).Select("id").Where("user_id = ? AND plan_id = ? AND meter_type = ? AND status = ? AND end_time > ?",
		userID, planID, SubscriptionMeterSharedTokens, "active", now).First(&sub).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return nil
	case err != nil:
		return err
	default:
		return errSharedPlanAlreadyActive
	}
}

func applySubscriptionUpgradeTx(tx *gorm.DB, order *SubscriptionOrder, target *SubscriptionPlan, now int64) error {
	var quote SubscriptionUpgradeQuote
	if err := common.UnmarshalJsonStr(order.UpgradeSnapshot, &quote); err != nil {
		return err
	}
	var user User
	if err := lockForUpdate(tx).Select("id").First(&user, order.UserId).Error; err != nil {
		return err
	}
	var sub UserSubscription
	if err := lockForUpdate(tx).Where("id = ? AND user_id = ? AND meter_type = ?", quote.SubscriptionID, order.UserId, SubscriptionMeterSharedTokens).First(&sub).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errSubscriptionUpgradeStale
		}
		return err
	}
	if sub.Status != "active" || sub.PlanId != quote.SourcePlanID || target.Id != quote.TargetPlanID ||
		sub.EndTime != quote.EndTime || now >= quote.CycleEnd || now >= sub.EndTime ||
		max(sub.StartTime, sub.LastResetTime) != quote.CycleStart {
		return errSubscriptionUpgradeStale
	}
	if err := checkActiveSharedPlan(tx, order.UserId, target.Id, now); err != nil {
		return err
	}
	result := tx.Model(&SubscriptionChannelQuota{}).
		Where("user_subscription_id = ? AND channel_id = 0 AND input_limit <= ? AND output_limit <= ?", sub.Id,
			MembershipMaxTokens-quote.InputAdded, MembershipMaxTokens-quote.OutputAdded).
		Updates(map[string]any{"input_limit": gorm.Expr("input_limit + ?", quote.InputAdded), "output_limit": gorm.Expr("output_limit + ?", quote.OutputAdded)})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errSubscriptionUpgradeStale
	}
	result = tx.Model(&UserSubscription{}).Where("id = ? AND plan_id = ? AND status = ?", sub.Id, quote.SourcePlanID, "active").
		Updates(map[string]any{"plan_id": target.Id, "effective_plan_snapshot": order.PlanSnapshot})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("subscription upgrade state changed during settlement")
	}
	return nil
}

// resetSharedTokenCycleTx requires a locked subscription. Each reservation keeps
// its original cycle so late settlement never decrements the refreshed grant.
func resetSharedTokenCycleTx(tx *gorm.DB, sub *UserSubscription, now int64) error {
	if sub.MeterType != SubscriptionMeterSharedTokens || sub.NextResetTime == 0 || now < sub.NextResetTime || now >= sub.EndTime {
		return nil
	}
	var plan SubscriptionPlan
	if err := common.UnmarshalJsonStr(sub.EffectivePlanSnapshot, &plan); err != nil {
		return err
	}
	last := sub.NextResetTime
	next := calcNextResetTime(time.Unix(last, 0), &plan, sub.EndTime)
	if NormalizeResetPeriod(plan.QuotaResetPeriod) == SubscriptionResetCustom && next > 0 && next <= now {
		steps := (now - last) / plan.QuotaResetCustomSeconds
		last += steps * plan.QuotaResetCustomSeconds
		next = calcNextResetTime(time.Unix(last, 0), &plan, sub.EndTime)
	}
	for next > 0 && next <= now {
		last = next
		next = calcNextResetTime(time.Unix(last, 0), &plan, sub.EndTime)
	}
	result := tx.Model(&SubscriptionChannelQuota{}).Where("user_subscription_id = ? AND channel_id = 0", sub.Id).
		Updates(map[string]any{"input_limit": plan.InputTokenLimit, "output_limit": plan.OutputTokenLimit, "input_used": 0, "output_used": 0,
			"input_reserved": 0, "output_reserved": 0, "cycle_start": last})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("missing shared token grant")
	}
	if err := tx.Model(sub).Updates(map[string]any{"last_reset_time": last, "next_reset_time": next}).Error; err != nil {
		return err
	}
	sub.LastResetTime, sub.NextResetTime = last, next
	return nil
}
