package controller

import (
	"fmt"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

// GetSubscriptionBilling exposes a read-only, paginated ledger under subscription management permissions.
// The export uses the same filter/query and never writes any wallet or point balances.
func GetSubscriptionBilling(c *gin.Context) {
	f := parseBillingFilter(c)
	filter := model.SubscriptionBillingFilter{Kind: c.DefaultQuery("kind", "usage"), UserScope: f.userScope, OrgScope: f.orgScope, Start: f.start, End: f.end, Status: c.Query("status")}
	var err error
	for _, field := range []struct {
		key    string
		target *int
	}{{"plan_id", &filter.PlanId}, {"subscription_id", &filter.SubscriptionId}} {
		if raw := c.Query(field.key); raw != "" {
			*field.target, err = strconv.Atoi(raw)
			if err != nil || *field.target <= 0 {
				common.ApiErrorMsg(c, "invalid "+field.key)
				return
			}
		}
	}
	if filter.Kind != "instances" && filter.Kind != "usage" && filter.Kind != "orders" {
		common.ApiErrorMsg(c, "invalid kind")
		return
	}
	// Orders do not carry a reliable subscription-instance association; never silently ignore it.
	if filter.Kind == "orders" && filter.SubscriptionId > 0 {
		common.ApiErrorMsg(c, "subscription_id is unavailable for purchase orders")
		return
	}
	if filter.Kind == "usage" && filter.Status != "" {
		common.ApiErrorMsg(c, "status is unavailable for usage records")
		return
	}
	if filter.Start < 0 || filter.End < 0 || (filter.Start > 0 && filter.End > 0 && filter.Start > filter.End) {
		common.ApiErrorMsg(c, "invalid time range")
		return
	}
	page := common.GetPageQuery(c)
	exporting := c.Query("export") == "csv"
	if exporting {
		page.Page = 1
		page.PageSize = 20000
	}
	rows, total, stat, err := model.GetSubscriptionBilling(filter, page)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !exporting {
		common.ApiSuccess(c, gin.H{"items": rows, "total": total, "stat": stat})
		return
	}
	if total > int64(page.PageSize) {
		common.ApiErrorMsg(c, "too many records; narrow the filters before exporting")
		return
	}
	header := []string{"时间", "用户ID", "用户", "套餐ID", "套餐", "订阅ID", "状态", "来源", "总点数", "已用点数", "剩余点数", "点数变动数量", "类型", "模型", "请求ID", "实付金额", "支付方式", "订单号", "到期时间", "点数比例", "预计毛利润（%）"}
	data := make([][]string, 0, len(rows))
	for _, r := range rows {
		data = append(data, []string{billingTimestamp(r.CreatedAt), strconv.Itoa(r.UserId), r.Username, strconv.Itoa(r.PlanId), r.PlanTitle, strconv.Itoa(r.SubscriptionId), r.Status, r.Source, subscriptionBillingPoints(r.Total), subscriptionBillingPoints(r.Used), subscriptionBillingPoints(r.Remaining), subscriptionBillingPoints(r.Points), strconv.Itoa(r.Type), r.ModelName, r.RequestId, fmt.Sprintf("%.2f", r.Money), r.PaymentMethod, r.TradeNo, billingTimestamp(r.EndTime), subscriptionBillingOptionalNumber(r.PointsRatio), subscriptionBillingOptionalNumber(r.GrossProfitPercent)})
	}
	writeBillingCSV(c, "subscription-billing-"+time.Now().Format("20060102-150405")+".csv", header, data)
}

// subscriptionBillingPoints follows the existing point display conversion, without a currency symbol.
func subscriptionBillingPoints(quota int64) string {
	value := float64(quota)
	if operation_setting.GetQuotaDisplayType() != operation_setting.QuotaDisplayTypeTokens {
		if common.QuotaPerUnit <= 0 {
			return "unavailable"
		}
		value = value / common.QuotaPerUnit * operation_setting.GetUsdToCurrencyRate(operation_setting.USDExchangeRate)
	}
	return strconv.FormatFloat(value, 'f', 6, 64)
}

// subscriptionBillingOptionalNumber preserves missing historical parameters instead of inventing zero.
func subscriptionBillingOptionalNumber(value *float64) string {
	if value == nil {
		return ""
	}
	return strconv.FormatFloat(*value, 'f', -1, 64)
}
