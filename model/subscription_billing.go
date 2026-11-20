package model

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// SubscriptionBillingFilter selects read-only points, usage, or purchase records.
// Monetary orders and point balances are intentionally separate dimensions.
type SubscriptionBillingFilter struct {
	Kind                   string
	UserScope              BillingScope
	OrgScope               BillingScope
	Start, End             int64
	PlanId, SubscriptionId int
	Status                 string
}

// SubscriptionBillingRow is the administrator-only ledger DTO, including purchased pricing snapshots.
type SubscriptionBillingRow struct {
	Id                 int      `json:"id"`
	CreatedAt          int64    `json:"created_at"`
	UserId             int      `json:"user_id"`
	Username           string   `json:"username"`
	PlanId             int      `json:"plan_id"`
	PlanTitle          string   `json:"plan_title"`
	SubscriptionId     int      `json:"subscription_id"`
	Status             string   `json:"status"`
	Source             string   `json:"source"`
	Total              int64    `json:"total"`
	Used               int64    `json:"used"`
	Remaining          int64    `json:"remaining"`
	Unlimited          bool     `json:"unlimited"`
	EndTime            int64    `json:"end_time"`
	Points             int64    `json:"points"`
	Type               int      `json:"type"`
	ModelName          string   `json:"model_name"`
	RequestId          string   `json:"request_id"`
	Money              float64  `json:"money"`
	PaymentMethod      string   `json:"payment_method"`
	TradeNo            string   `json:"trade_no"`
	PointsRatio        *float64 `json:"points_ratio,omitempty"`
	GrossProfitPercent *float64 `json:"gross_profit_percent,omitempty"`
	BaseQuota          *int     `json:"base_quota,omitempty"`
}

// SubscriptionBillingStat keeps spending/refunds scoped to the selected time range.
// CurrentRemaining is a current balance and is not a historical closing balance.
type SubscriptionBillingStat struct {
	RequestCount     int64   `json:"request_count"`
	Consumed         int64   `json:"consumed"`
	Refunded         int64   `json:"refunded"`
	CurrentRemaining int64   `json:"current_remaining"`
	UnlimitedCount   int64   `json:"unlimited_count"`
	PaidMoney        float64 `json:"paid_money"`
}

// GetSubscriptionBilling reads existing sources without changing any wallet or points counters.
// Main/log databases are queried separately; associations are resolved in bounded batches.
func GetSubscriptionBilling(f SubscriptionBillingFilter, page *common.PageInfo) ([]SubscriptionBillingRow, int64, SubscriptionBillingStat, error) {
	rows := make([]SubscriptionBillingRow, 0)
	stat := SubscriptionBillingStat{}
	constrained, ids, err := billingConsumptionUserIds(f.UserScope, f.OrgScope)
	if err != nil {
		return rows, 0, stat, err
	}
	if constrained && len(ids) == 0 {
		return rows, 0, stat, nil
	}
	var total int64
	var tx *gorm.DB
	switch f.Kind {
	case "usage":
		tx = LOG_DB.Model(&Log{}).Where("type IN ?", []int{LogTypeConsume, LogTypeRefund}).Where("subscription_quota <> 0 OR replace(COALESCE(other, ''), ' ', '') LIKE ?", `%"billing_source":"subscription"%`)
		if constrained {
			tx = tx.Where("user_id IN ?", ids)
		}
		if f.Start > 0 {
			tx = tx.Where("created_at >= ?", f.Start)
		}
		if f.End > 0 {
			tx = tx.Where("created_at <= ?", f.End)
		}
		// Match JSON integer boundaries without database-specific JSON operators.
		for _, field := range []struct {
			key   string
			value int
		}{{"subscription_plan_id", f.PlanId}, {"subscription_id", f.SubscriptionId}} {
			if field.value > 0 {
				prefix := fmt.Sprintf(`%%"%s":%d`, field.key, field.value)
				tx = tx.Where("replace(COALESCE(other, ''), ' ', '') LIKE ? OR replace(COALESCE(other, ''), ' ', '') LIKE ?", prefix+",%", prefix+"}%")
			}
		}
		charge := "CASE WHEN subscription_quota <> 0 THEN subscription_quota ELSE quota END"
		if err = tx.Session(&gorm.Session{}).Select("COALESCE(SUM(CASE WHEN type = ? AND task_settle = ? THEN 1 ELSE 0 END), 0) request_count, COALESCE(SUM(CASE WHEN type = ? THEN "+charge+" ELSE 0 END), 0) consumed, COALESCE(SUM(CASE WHEN type = ? THEN "+charge+" ELSE 0 END), 0) refunded", LogTypeConsume, false, LogTypeConsume, LogTypeRefund).Scan(&stat).Error; err != nil {
			return rows, 0, stat, err
		}
		if err = tx.Count(&total).Error; err != nil {
			return rows, 0, stat, err
		}
		var logs []Log
		order := "created_at desc, id desc"
		if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
			order = clickHouseLogOrder("")
		}
		if err = tx.Order(order).Limit(page.GetPageSize()).Offset(page.GetStartIdx()).Find(&logs).Error; err != nil {
			return rows, 0, stat, err
		}
		for _, l := range logs {
			var other struct {
				PlanId         int    `json:"subscription_plan_id"`
				PlanTitle      string `json:"subscription_plan_title"`
				SubscriptionId int    `json:"subscription_id"`
				AdminInfo      struct {
					BaseQuota          *int     `json:"subscription_base_quota"`
					PointsRatio        *float64 `json:"subscription_points_ratio"`
					GrossProfitPercent *float64 `json:"subscription_gross_profit_percent"`
				} `json:"admin_info"`
			}
			_ = common.UnmarshalJsonStr(l.Other, &other)
			points := l.SubscriptionQuota
			if points == 0 {
				points = l.Quota
			}
			rows = append(rows, SubscriptionBillingRow{Id: l.Id, CreatedAt: l.CreatedAt, UserId: l.UserId, Username: l.Username, PlanId: other.PlanId, PlanTitle: other.PlanTitle, SubscriptionId: other.SubscriptionId, Points: int64(points), Type: l.Type, ModelName: l.ModelName, RequestId: l.RequestId, BaseQuota: other.AdminInfo.BaseQuota, PointsRatio: other.AdminInfo.PointsRatio, GrossProfitPercent: other.AdminInfo.GrossProfitPercent})
		}
	case "orders":
		tx = DB.Model(&SubscriptionOrder{})
		if constrained {
			tx = tx.Where("user_id IN ?", ids)
		}
		if f.PlanId > 0 {
			tx = tx.Where("plan_id = ?", f.PlanId)
		}
		if f.Status != "" {
			tx = tx.Where("status = ?", f.Status)
		}
		if f.Start > 0 {
			tx = tx.Where("create_time >= ?", f.Start)
		}
		if f.End > 0 {
			tx = tx.Where("create_time <= ?", f.End)
		}
		if err = tx.Session(&gorm.Session{}).Select("COALESCE(SUM(CASE WHEN status = ? THEN money ELSE 0 END), 0) paid_money", common.TopUpStatusSuccess).Scan(&stat).Error; err != nil {
			return rows, 0, stat, err
		}
		if err = tx.Count(&total).Error; err != nil {
			return rows, 0, stat, err
		}
		var orders []SubscriptionOrder
		if err = tx.Order("create_time desc, id desc").Limit(page.GetPageSize()).Offset(page.GetStartIdx()).Find(&orders).Error; err != nil {
			return rows, 0, stat, err
		}
		for _, o := range orders {
			rows = append(rows, SubscriptionBillingRow{Id: o.Id, CreatedAt: o.CreateTime, UserId: o.UserId, PlanId: o.PlanId, Money: o.Money, PaymentMethod: o.PaymentMethod, TradeNo: o.TradeNo, Status: o.Status})
		}
	case "instances":
		tx = DB.Model(&UserSubscription{})
		if constrained {
			tx = tx.Where("user_id IN ?", ids)
		}
		if f.PlanId > 0 {
			tx = tx.Where("plan_id = ?", f.PlanId)
		}
		if f.SubscriptionId > 0 {
			tx = tx.Where("id = ?", f.SubscriptionId)
		}
		// Compute the current active balance before applying the issuance-date range.
		balance := tx.Session(&gorm.Session{}).Where("status = ? AND end_time > ?", "active", common.GetTimestamp())
		if err = balance.Select("COALESCE(SUM(CASE WHEN amount_total > amount_used THEN amount_total - amount_used ELSE 0 END), 0) current_remaining, COALESCE(SUM(CASE WHEN amount_total = 0 THEN 1 ELSE 0 END), 0) unlimited_count").Scan(&stat).Error; err != nil {
			return rows, 0, stat, err
		}
		if f.Status == "expired" {
			tx = tx.Where("status = ? OR (status = ? AND end_time <= ?)", "expired", "active", common.GetTimestamp())
		} else if f.Status == "active" {
			tx = tx.Where("status = ? AND end_time > ?", "active", common.GetTimestamp())
		} else if f.Status != "" {
			tx = tx.Where("status = ?", f.Status)
		}
		if f.Start > 0 {
			tx = tx.Where("created_at >= ?", f.Start)
		}
		if f.End > 0 {
			tx = tx.Where("created_at <= ?", f.End)
		}
		if err = tx.Count(&total).Error; err != nil {
			return rows, 0, stat, err
		}
		var subs []UserSubscription
		if err = tx.Order("created_at desc, id desc").Limit(page.GetPageSize()).Offset(page.GetStartIdx()).Find(&subs).Error; err != nil {
			return rows, 0, stat, err
		}
		now := common.GetTimestamp()
		for _, sub := range subs {
			status := sub.Status
			if status == "active" && sub.EndTime <= now {
				status = "expired"
			}
			remaining := sub.AmountTotal - sub.AmountUsed
			if remaining < 0 {
				remaining = 0
			}
			rows = append(rows, SubscriptionBillingRow{Id: sub.Id, SubscriptionId: sub.Id, CreatedAt: sub.CreatedAt, UserId: sub.UserId, PlanId: sub.PlanId, Status: status, Source: sub.Source, Total: sub.AmountTotal, Used: sub.AmountUsed, Remaining: remaining, Unlimited: sub.AmountTotal == 0, EndTime: sub.EndTime})
		}
	default:
		return rows, 0, stat, fmt.Errorf("invalid subscription billing kind")
	}
	// Resolve associations with main DB queries, never a cross-database join or per-row query.
	userIds := make([]int, 0, len(rows))
	planIds := make([]int, 0, len(rows))
	for _, row := range rows {
		userIds = append(userIds, row.UserId)
		if row.PlanId > 0 {
			planIds = append(planIds, row.PlanId)
		}
	}
	if len(rows) == 0 {
		return rows, total, stat, nil
	}
	// Resolve billing parameters from purchased subscription snapshots, never today's plan configuration.
	subscriptionIds := []int{}
	for _, row := range rows {
		if row.SubscriptionId > 0 {
			subscriptionIds = append(subscriptionIds, row.SubscriptionId)
		}
	}
	snapshots := map[int]UserSubscription{}
	if len(subscriptionIds) > 0 {
		var subs []UserSubscription
		if err = DB.Select("id, user_id, points_ratio, gross_profit_percent").Where("id IN ?", subscriptionIds).Find(&subs).Error; err != nil {
			return rows, 0, stat, err
		}
		for _, sub := range subs {
			snapshots[sub.Id] = sub
		}
	}
	for i := range rows {
		if sub, ok := snapshots[rows[i].SubscriptionId]; ok && sub.UserId == rows[i].UserId {
			ratio, profit := sub.PointsRatio, sub.GrossProfitPercent
			if rows[i].PointsRatio == nil {
				rows[i].PointsRatio = &ratio
			}
			if rows[i].GrossProfitPercent == nil {
				rows[i].GrossProfitPercent = &profit
			}
		}
	}
	var users []User
	var plans []SubscriptionPlan
	if err = DB.Select("id, username").Where("id IN ?", userIds).Find(&users).Error; err != nil {
		return rows, 0, stat, err
	}
	if len(planIds) > 0 {
		if err = DB.Select("id, title").Where("id IN ?", planIds).Find(&plans).Error; err != nil {
			return rows, 0, stat, err
		}
	}
	names := map[int]string{}
	titles := map[int]string{}
	for _, u := range users {
		names[u.Id] = u.Username
	}
	for _, p := range plans {
		titles[p.Id] = p.Title
	}
	for i := range rows {
		if rows[i].Username == "" {
			rows[i].Username = names[rows[i].UserId]
		}
		if strings.TrimSpace(rows[i].PlanTitle) == "" {
			rows[i].PlanTitle = titles[rows[i].PlanId]
		}
	}
	return rows, total, stat, nil
}
