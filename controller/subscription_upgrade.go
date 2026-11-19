package controller

import (
	"crypto/hmac"
	"encoding/base64"
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// subscriptionUpgradeOffer binds an approved quote to its account and price snapshot.
type subscriptionUpgradeOffer struct {
	UserID       int                            `json:"user_id"`
	ExpiresAt    int64                          `json:"expires_at"`
	Quote        model.SubscriptionUpgradeQuote `json:"quote"`
	TargetDigest string                         `json:"target_digest"`
	Target       model.SubscriptionPlan         `json:"-"`
}

func SubscriptionRequestUpgradeQuote(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	userID := c.GetInt("id")
	if denyKey := checkOrgPersonalWalletPermission(userID); denyKey != "" {
		common.ApiErrorI18n(c, denyKey)
		return
	}
	var req struct {
		SubscriptionID int `json:"subscription_id"`
		TargetPlanID   int `json:"target_plan_id"`
	}
	if c.ShouldBindJSON(&req) != nil || req.SubscriptionID <= 0 || req.TargetPlanID <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	quote, target, err := model.QuoteSubscriptionUpgrade(userID, req.SubscriptionID, req.TargetPlanID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	targetData, err := common.Marshal(target)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	offer := subscriptionUpgradeOffer{UserID: userID, ExpiresAt: min(model.GetDBTimestamp()+300, quote.CycleEnd), Quote: *quote,
		TargetDigest: common.HmacSha256(string(targetData), common.SessionSecret)}
	data, err := common.Marshal(offer)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	payload := base64.RawURLEncoding.EncodeToString(data)
	common.ApiSuccess(c, gin.H{"quote": quote, "quote_token": payload + "." + common.HmacSha256(payload, common.SessionSecret)})
}

func verifySubscriptionUpgradeOffer(token string, userID, targetID int) (*subscriptionUpgradeOffer, error) {
	invalid := errors.New("升级报价已失效，请重新报价")
	payload, signature, ok := strings.Cut(token, ".")
	if !ok || !hmac.Equal([]byte(signature), []byte(common.HmacSha256(payload, common.SessionSecret))) {
		return nil, invalid
	}
	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return nil, invalid
	}
	var offer subscriptionUpgradeOffer
	if common.Unmarshal(raw, &offer) != nil || offer.UserID != userID || offer.Quote.TargetPlanID != targetID ||
		offer.ExpiresAt <= model.GetDBTimestamp() {
		return nil, invalid
	}
	current, target, err := model.QuoteSubscriptionUpgrade(userID, offer.Quote.SubscriptionID, targetID)
	if err != nil || current.SourcePlanID != offer.Quote.SourcePlanID || current.CycleStart != offer.Quote.CycleStart ||
		current.CycleEnd != offer.Quote.CycleEnd || current.EndTime != offer.Quote.EndTime {
		return nil, invalid
	}
	targetData, err := common.Marshal(target)
	if err != nil || !hmac.Equal([]byte(offer.TargetDigest), []byte(common.HmacSha256(string(targetData), common.SessionSecret))) {
		return nil, invalid
	}
	offer.Target = *target
	return &offer, nil
}
