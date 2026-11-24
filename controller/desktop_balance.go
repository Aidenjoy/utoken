package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

// DesktopSubscriptionBalance 仅提供已购套餐余额，不暴露后台计费比例。
type DesktopSubscriptionBalance struct {
	SubscriptionID  int     `json:"subscription_id"`
	PlanID          int     `json:"plan_id"`
	TotalPoints     float64 `json:"total_points"`
	UsedPoints      float64 `json:"used_points"`
	RemainingPoints float64 `json:"remaining_points"`
	Unlimited       bool    `json:"unlimited"`
	EndTime         int64   `json:"end_time"`
}

// DesktopBalanceResponse 将钱包金额与订阅点数分开返回，数值沿用站点展示换算。
type DesktopBalanceResponse struct {
	UserID           int                          `json:"user_id"`
	WalletBalance    float64                      `json:"wallet_balance"`
	WalletQuota      int                          `json:"wallet_quota"`
	QuotaDisplayType string                       `json:"quota_display_type"`
	Subscriptions    []DesktopSubscriptionBalance `json:"subscriptions"`
}

// DesktopBalance 接受已鉴权的 Cookie 用户或桌面 Token，只读本人余额且不消费会话。
func DesktopBalance(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	var user *model.User
	if userID := c.GetInt("id"); userID > 0 {
		// Cookie 鉴权复用 UserAuth；余额和账号状态直接读库，避免使用登录时的余额快照。
		var err error
		user, err = model.GetUserById(userID, false)
		if err != nil {
			common.SysError("desktop balance user query failed: " + err.Error())
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "server_error"})
			return
		}
		if user.Status != common.UserStatusEnabled {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "invalid_token"})
			return
		}
	} else {
		user = desktopAuthenticatedUser(c, false)
	}
	if user == nil {
		return
	}
	// 从用户已购实例读取余额，避免后续编辑套餐配置改变客户端余额。
	subscriptions, err := model.GetAllActiveUserSubscriptions(user.Id)
	if err != nil {
		common.SysError("desktop balance subscription query failed: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "server_error"})
		return
	}
	factor := 1.0
	if operation_setting.GetQuotaDisplayType() != operation_setting.QuotaDisplayTypeTokens {
		if common.QuotaPerUnit <= 0 {
			common.SysError("desktop balance invalid quota_per_unit")
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "server_error"})
			return
		}
		factor = operation_setting.GetUsdToCurrencyRate(operation_setting.USDExchangeRate) / common.QuotaPerUnit
	}
	response := DesktopBalanceResponse{
		UserID: user.Id, WalletBalance: float64(user.Quota) * factor, WalletQuota: user.Quota,
		QuotaDisplayType: operation_setting.GetQuotaDisplayType(),
		Subscriptions:    make([]DesktopSubscriptionBalance, 0, len(subscriptions)),
	}
	for _, summary := range subscriptions {
		sub := summary.Subscription
		remaining := sub.AmountTotal - sub.AmountUsed
		if remaining < 0 {
			remaining = 0
		}
		response.Subscriptions = append(response.Subscriptions, DesktopSubscriptionBalance{
			SubscriptionID: sub.Id, PlanID: sub.PlanId, TotalPoints: float64(sub.AmountTotal) * factor,
			UsedPoints: float64(sub.AmountUsed) * factor, RemainingPoints: float64(remaining) * factor,
			Unlimited: sub.AmountTotal == 0, EndTime: sub.EndTime,
		})
	}
	common.ApiSuccess(c, response)
}
