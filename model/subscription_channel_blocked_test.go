package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestMembershipBlockedArkVideoAndGPTImageStayUnsellable pins the sale ban for
// R01—R12 (Ark/Seedance video, channel type 59) and R16 (gpt-image-2.5 models).
// Official protocols provide no enforceable per-request output bound, so these
// channels/models must never enter a sellable membership configuration and a
// purchase attempt must roll back without touching the wallet or the ledger.
// This is a rejection guard, not a metering contract implementation.
func TestMembershipBlockedArkVideoAndGPTImageStayUnsellable(t *testing.T) {
	_, _ = membershipFixture(t)
	// The Ark channel also lists sora-2 so rejection is attributable to the
	// channel type alone, not to a missing model entry.
	require.NoError(t, DB.Create(&Channel{Id: 706, Type: constant.ChannelTypeArkNative, Status: common.ChannelStatusEnabled, Models: "doubao-seedance-2.0,doubao-seedance-2.0-fast,doubao-seedance-2.0-mini,doubao-seedance-2.5,doubao-seedance-2.0-test,sora-2"}).Error)
	require.NoError(t, DB.Create(&Channel{Id: 707, Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, Models: "gpt-image-2.5-flare,gpt-image-2.5-sunburst"}).Error)

	assert.False(t, MembershipVideoChannelSupported(constant.ChannelTypeArkNative))
	for _, name := range []string{"doubao-seedance-2.0", "doubao-seedance-2.0-fast", "doubao-seedance-2.0-mini", "doubao-seedance-2.5", "doubao-seedance-2.0-test"} {
		assert.False(t, MembershipVideoModelSupported(name), name)
		assert.False(t, MembershipTextModelSupported(name), name)
	}
	for _, name := range []string{"gpt-image-2.5-flare", "gpt-image-2.5-sunburst"} {
		assert.False(t, MembershipImageModelSupported(name), name)
		assert.False(t, MembershipSeedreamImageModelSupported(name), name)
	}

	type profileCase struct {
		profile string
		unit    string
	}
	profiles := []profileCase{
		{MembershipTextProfile, MembershipUnitTokens},
		{MembershipRealtimeProfile, MembershipUnitTokens},
		{MembershipClaudeProfile, MembershipUnitTokens},
		{MembershipGeminiProfile, MembershipUnitTokens},
		{MembershipGeminiImageProfile, MembershipUnitTokens},
		{MembershipImageProfile, MembershipUnitImages},
		{MembershipSeedreamImageProfile, MembershipUnitImages},
		{MembershipVideoProfile, MembershipUnitVideos},
		{MembershipTranscriptionProfile, MembershipUnitAudioMillis},
		{MembershipSpeechProfile, MembershipUnitCharacters},
	}
	newPlan := func(id int, config SubscriptionChannelConfig) *SubscriptionPlan {
		data, err := common.Marshal([]SubscriptionChannelConfig{config})
		require.NoError(t, err)
		return &SubscriptionPlan{Id: id, Title: "blocked", MeterType: SubscriptionMeterChannel, ChannelQuotas: JSONValue(data), PriceAmount: 1, Enabled: true, DurationUnit: SubscriptionDurationDay, DurationValue: 1}
	}
	for i, pc := range profiles {
		config := SubscriptionChannelConfig{ChannelId: 706, Profile: pc.profile, Unit: pc.unit, Models: []string{"doubao-seedance-2.5"}}
		if pc.unit == MembershipUnitTokens {
			config.InputLimit, config.OutputLimit = 100, 80
		} else {
			config.QuantityLimit = 1
		}
		_, err := ValidateSubscriptionChannels(DB, newPlan(7100+i, config))
		require.Error(t, err, "Ark video channel must stay unsellable under profile %s", pc.profile)
	}
	// Even a Sora model entry cannot open the Ark native channel type.
	_, err := ValidateSubscriptionChannels(DB, newPlan(7200, SubscriptionChannelConfig{ChannelId: 706, Profile: MembershipVideoProfile, Unit: MembershipUnitVideos, Models: []string{"sora-2"}, QuantityLimit: 1}))
	require.Error(t, err)
	// GPT Image 2.5 models stay outside the DALL-E count contract on OpenAI channels.
	for _, name := range []string{"gpt-image-2.5-flare", "gpt-image-2.5-sunburst"} {
		_, err := ValidateSubscriptionChannels(DB, newPlan(7201, SubscriptionChannelConfig{ChannelId: 707, Profile: MembershipImageProfile, Unit: MembershipUnitImages, Models: []string{name}, QuantityLimit: 1}))
		require.Error(t, err, name)
	}

	// A purchase attempt with a blocked configuration rolls back atomically.
	var wallet User
	require.NoError(t, DB.First(&wallet, 701).Error)
	before := wallet.Quota
	blocked := newPlan(7300, SubscriptionChannelConfig{ChannelId: 706, Profile: MembershipVideoProfile, Unit: MembershipUnitVideos, Models: []string{"doubao-seedance-2.5"}, QuantityLimit: 1})
	require.NoError(t, DB.Create(blocked).Error)
	require.Error(t, PurchaseSubscriptionWithBalance(701, blocked.Id))
	require.NoError(t, DB.First(&wallet, 701).Error)
	assert.Equal(t, before, wallet.Quota)
	var count int64
	require.NoError(t, DB.Model(&UserSubscription{}).Where("plan_id = ?", blocked.Id).Count(&count).Error)
	assert.Zero(t, count)
	require.NoError(t, DB.Model(&SubscriptionChannelQuota{}).Where("channel_id = ?", 706).Count(&count).Error)
	assert.Zero(t, count)
}
