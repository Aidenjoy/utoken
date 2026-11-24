package controller

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

// DesktopUsageLogs returns only the authenticated account's stored model usage.
// Authentication is the unchanged history Cookie/desktop credential chain.
func DesktopUsageLogs(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	// 步骤1：拒绝未支持参数，避免身份参数被误认为有跨账号查询能力。
	allowed := map[string]bool{"p": true, "page_size": true, "ps": true, "size": true, "start_timestamp": true, "end_timestamp": true, "model_name": true}
	values, parseErr := url.ParseQuery(c.Request.URL.RawQuery)
	if parseErr != nil {
		desktopUsageError(c, 400, "invalid_query")
		return
	}
	for key, entries := range values {
		if !allowed[key] || len(entries) != 1 {
			desktopUsageError(c, http.StatusBadRequest, "invalid_query")
			return
		}
	}
	page, limit := 1, 20
	if value, exists := values["p"]; exists {
		parsed, err := strconv.Atoi(value[0])
		if err != nil || parsed < 1 {
			desktopUsageError(c, 400, "invalid_pagination")
			return
		}
		page = parsed
	}
	// Keep existing page-size aliases, but reject ambiguous or invalid values.
	sizeCount := 0
	for _, key := range []string{"page_size", "ps", "size"} {
		if value, exists := values[key]; exists {
			sizeCount++
			parsed, err := strconv.Atoi(value[0])
			if err != nil || parsed < 1 || parsed > 100 {
				desktopUsageError(c, 400, "invalid_pagination")
				return
			}
			limit = parsed
		}
	}
	if sizeCount > 1 || page-1 > model.DesktopUsageLogMaxOffset/limit {
		desktopUsageError(c, 400, "invalid_pagination")
		return
	}
	query := dto.DesktopUsageLogQuery{Offset: (page - 1) * limit, Limit: limit, ModelName: c.Query("model_name")}
	var err error
	if value, exists := values["start_timestamp"]; exists {
		query.StartTimestamp, err = strconv.ParseInt(value[0], 10, 64)
		if err != nil {
			desktopUsageError(c, 400, "invalid_time_range")
			return
		}
	}
	if value, exists := values["end_timestamp"]; exists {
		query.EndTimestamp, err = strconv.ParseInt(value[0], 10, 64)
		if err != nil {
			desktopUsageError(c, 400, "invalid_time_range")
			return
		}
	}
	if query.StartTimestamp < 0 || query.EndTimestamp < 0 || (query.EndTimestamp > 0 && query.StartTimestamp > query.EndTimestamp) {
		desktopUsageError(c, 400, "invalid_time_range")
		return
	}
	// 步骤2：无论管理员还是普通用户，身份只取认证上下文。
	userID := c.GetInt("id")
	if userID <= 0 {
		desktopUsageError(c, 401, "invalid_token")
		return
	}
	items, total, err := model.GetDesktopUsageLogs(c.Request.Context(), userID, query)
	if err != nil {
		if errors.Is(err, model.ErrDesktopUsageQuery) {
			desktopUsageError(c, 400, "invalid_query")
			return
		}
		common.SysError(fmt.Sprintf("desktop usage query failed user=%d request=%q: %v", userID, c.GetString(common.RequestIdKey), err))
		desktopUsageError(c, 500, "usage_logs_unavailable")
		return
	}

	// 步骤3：仅换算展示值，沿用 Web getLogCharges / formatSubscriptionPoints，
	// 原始 quota 和订阅额度不改写，也不重新计算任何历史扣费。
	displayType := operation_setting.GetQuotaDisplayType()
	factor := 1.0
	if displayType != operation_setting.QuotaDisplayTypeTokens {
		if common.QuotaPerUnit <= 0 {
			common.SysError("desktop usage invalid quota_per_unit")
			desktopUsageError(c, 500, "usage_logs_unavailable")
			return
		}
		factor = operation_setting.GetUsdToCurrencyRate(operation_setting.USDExchangeRate) / common.QuotaPerUnit
	}
	for i := range items {
		item := &items[i]
		var metadata struct {
			BillingSource string `json:"billing_source"`
		}
		_ = common.UnmarshalJsonStr(item.Other, &metadata)
		walletQuota, subscriptionQuota := item.Quota, 0
		if item.SubscriptionQuota > 0 || metadata.BillingSource == "subscription" {
			walletQuota = 0
			subscriptionQuota = item.SubscriptionQuota
			if subscriptionQuota == 0 {
				subscriptionQuota = item.Quota
			}
		}
		item.Consumption = dto.DesktopUsageConsumption{
			WalletAmount:       float64(walletQuota) * factor,
			WalletUnit:         displayType,
			WalletSymbol:       operation_setting.GetCurrencySymbol(),
			SubscriptionPoints: float64(subscriptionQuota) * factor,
			SubscriptionUnit:   "points",
		}
		// Only billing_source is interpreted internally. Never expose raw other.
		item.Other = ""
	}

	// 步骤4：使用项目已有分页外壳；不写日志、钱包或订阅状态。
	common.ApiSuccess(c, &common.PageInfo{Page: page, PageSize: limit, Total: int(total), Items: items})
}

// desktopUsageError exposes stable codes without SQL, credentials or log payloads.
func desktopUsageError(c *gin.Context, status int, code string) {
	c.JSON(status, gin.H{"success": false, "message": code})
}
