package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// MembershipChannelBenefit exposes purchasable access, never internal metering amounts.
// Available is only supplied for an activated grant; the ledger remains unchanged.
type MembershipChannelBenefit struct {
	Id                 int      `json:"id,omitempty"`
	UserSubscriptionId int      `json:"user_subscription_id,omitempty"`
	ChannelId          int      `json:"channel_id"`
	Profile            string   `json:"profile"`
	Unit               string   `json:"unit"`
	Models             []string `json:"models"`
	Available          *bool    `json:"available,omitempty"`
}

// PublicSubscriptionSummary keeps subscription identity and expiry while hiding its allowance ledger.
type PublicSubscriptionSummary struct {
	Subscription  *model.UserSubscription    `json:"subscription"`
	ChannelQuotas []MembershipChannelBenefit `json:"channel_quotas,omitempty"`
}

// publicMembershipPlan projects a response copy; purchased snapshots and admin configuration are untouched.
func publicMembershipPlan(plan model.SubscriptionPlan) (model.SubscriptionPlan, error) {
	plan.InputTokenLimit, plan.OutputTokenLimit = 0, 0
	if plan.MeterType != model.SubscriptionMeterChannel {
		return plan, nil
	}
	var configs []model.SubscriptionChannelConfig
	if err := common.Unmarshal(plan.ChannelQuotas, &configs); err != nil {
		return plan, err
	}
	benefits := make([]MembershipChannelBenefit, 0, len(configs))
	for _, config := range configs {
		benefits = append(benefits, MembershipChannelBenefit{ChannelId: config.ChannelId, Profile: config.Profile, Unit: config.Unit, Models: config.Models})
	}
	data, err := common.Marshal(benefits)
	if err != nil {
		return plan, err
	}
	plan.ChannelQuotas = model.JSONValue(data)
	return plan, nil
}

// publicSubscriptionSummaries exposes only availability for channel memberships.
// Ordinary quota subscriptions retain their existing response fields and billing semantics.
func publicSubscriptionSummaries(records []model.SubscriptionSummary) ([]PublicSubscriptionSummary, error) {
	result := make([]PublicSubscriptionSummary, 0, len(records))
	for _, record := range records {
		view := PublicSubscriptionSummary{Subscription: record.Subscription}
		for _, grant := range record.ChannelQuotas {
			var models []string
			if err := common.Unmarshal(grant.Models, &models); err != nil {
				return nil, err
			}
			available := grant.QuantityLimit > grant.QuantityUsed+grant.QuantityReserved
			if grant.Unit == model.MembershipUnitTokens {
				available = grant.InputLimit > grant.InputUsed+grant.InputReserved && grant.OutputLimit > grant.OutputUsed+grant.OutputReserved
			}
			view.ChannelQuotas = append(view.ChannelQuotas, MembershipChannelBenefit{Id: grant.Id, UserSubscriptionId: grant.UserSubscriptionId, ChannelId: grant.ChannelId, Profile: grant.Profile, Unit: grant.Unit, Models: models, Available: &available})
		}
		result = append(result, view)
	}
	return result, nil
}
