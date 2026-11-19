package model

import (
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"gorm.io/gorm"
)

const (
	MembershipGeminiImageProfile   = "gemini_native_bounded_image_v1"
	MembershipGeminiProfile        = "gemini_native_plain_text_v1"
	MembershipClaudeProfile        = "anthropic_messages_text_v1"
	MembershipRealtimeProfile      = "openai_realtime_bounded_v1"
	MembershipTranscriptionProfile = "openai_whisper_duration_v1"
	MembershipSpeechProfile        = "openai_tts_characters_v1"
	MembershipUnitAudioMillis      = "audio_milliseconds"
	MembershipUnitCharacters       = "input_characters"
	MembershipVideoProfile         = "sora_completed_video_v1"
	MembershipUnitVideos           = "completed_videos"
	MembershipImageProfile         = "openai_images_count_v1"
	MembershipUnitImages           = "images"
	// MembershipSeedreamImageProfile meters Ark Seedream by the raw usage.generated_images
	// receipt. Official Ark billing is per successfully generated image (output_tokens is a
	// pixel-derived reference quantity and no input_tokens field exists), so the faithful
	// unit is image count, not tokens. See docs/channel-membership-acceptance.md.
	MembershipSeedreamImageProfile       = "ark_seedream_image_count_v1"
	SubscriptionMeterSharedTokens        = "shared_tokens"
	SubscriptionMeterQuota               = "quota"
	SubscriptionMeterChannel             = "channel"
	MembershipTextProfile                = "openai_chat_text_v1"
	MembershipUnitTokens                 = "input_output_tokens"
	MembershipMaxTokens            int64 = 2147483647
)

var ErrMembershipQuota = errors.New("套餐额度不足")

// SubscriptionChannelConfig defines a channel's sellable, versioned metering contract.
// Models are public model names; the text profile additionally checks the final upstream model.
type SubscriptionChannelConfig struct {
	QuantityLimit int64    `json:"quantity_limit,omitempty"`
	ChannelId     int      `json:"channel_id"`
	Profile       string   `json:"profile"`
	Unit          string   `json:"unit"`
	Models        []string `json:"models"`
	InputLimit    int64    `json:"input_limit"`
	OutputLimit   int64    `json:"output_limit"`
}

// SubscriptionChannelQuota is an activation snapshot, shared by all keys for this grant.
type SubscriptionChannelQuota struct {
	CycleStart         int64     `json:"-" gorm:"not null;default:0"`
	QuantityLimit      int64     `json:"quantity_limit" gorm:"not null;default:0"`
	QuantityUsed       int64     `json:"quantity_used" gorm:"not null;default:0"`
	QuantityReserved   int64     `json:"quantity_reserved" gorm:"not null;default:0"`
	Id                 int       `json:"id"`
	UserSubscriptionId int       `json:"user_subscription_id" gorm:"uniqueIndex:uk_subscription_channel_grant"`
	ChannelId          int       `json:"channel_id" gorm:"uniqueIndex:uk_subscription_channel_grant"`
	Profile            string    `json:"profile" gorm:"type:varchar(64)"`
	Unit               string    `json:"unit" gorm:"type:varchar(32)"`
	Models             JSONValue `json:"models" gorm:"type:text"`
	InputLimit         int64     `json:"input_limit"`
	OutputLimit        int64     `json:"output_limit"`
	InputUsed          int64     `json:"input_used"`
	OutputUsed         int64     `json:"output_used"`
	InputReserved      int64     `json:"input_reserved"`
	OutputReserved     int64     `json:"output_reserved"`
	CreatedAt          int64     `json:"created_at"`
	UpdatedAt          int64     `json:"updated_at"`
}

// SubscriptionChannelRequest persists the request state independently of HTTP lifetime.
// prepared -> dispatched -> settled/pending; prepared alone may be released without usage.
type SubscriptionChannelRequest struct {
	CycleStart         int64     `json:"-" gorm:"not null;default:0"`
	Unit               string    `json:"unit" gorm:"type:varchar(32);not null;default:input_output_tokens"`
	QuantityReserved   int64     `json:"quantity_reserved" gorm:"not null;default:0"`
	QuantityUsed       int64     `json:"quantity_used" gorm:"not null;default:0"`
	Id                 int       `json:"id"`
	RequestId          string    `json:"request_id" gorm:"type:varchar(128);uniqueIndex"`
	UserId             int       `json:"user_id"`
	TokenId            int       `json:"token_id"`
	UserSubscriptionId int       `json:"user_subscription_id" gorm:"index"`
	ChannelId          int       `json:"channel_id"`
	Model              string    `json:"model" gorm:"type:varchar(255)"`
	InputReserved      int64     `json:"input_reserved"`
	OutputReserved     int64     `json:"output_reserved"`
	InputUsed          int64     `json:"input_used"`
	OutputUsed         int64     `json:"output_used"`
	Status             string    `json:"status" gorm:"type:varchar(32);index"`
	Reason             string    `json:"reason" gorm:"type:varchar(255)"`
	ProviderUsage      JSONValue `json:"provider_usage,omitempty" gorm:"type:text"`
	CreatedAt          int64     `json:"created_at"`
	UpdatedAt          int64     `json:"updated_at"`
}

// SaveMembershipUsageReceipt stores provider evidence separately from settled accounting counters.
// Pending records can therefore be reconciled without treating estimates as real token usage.
func SaveMembershipUsageReceipt(requestId string, receipt []byte) error {
	result := DB.Model(&SubscriptionChannelRequest{}).Where("request_id = ? AND status IN ?", requestId, []string{"dispatched", "pending"}).Update("provider_usage", JSONValue(receipt))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("membership receipt has no dispatched request")
	}
	return nil
}

// IsQuotaSubscription preserves the empty discriminator of legacy records.
func IsQuotaSubscription(meter string) bool {
	return meter == "" || meter == SubscriptionMeterQuota
}

// ValidateSubscriptionChannels rejects unsupported units and adapters before selling a plan.
func ValidateSubscriptionChannels(tx *gorm.DB, plan *SubscriptionPlan) ([]SubscriptionChannelConfig, error) {
	return validateSubscriptionChannels(tx, plan, true)
}

// validateSubscriptionChannels preserves paid snapshots even if a live channel is later disabled.
func validateSubscriptionChannels(tx *gorm.DB, plan *SubscriptionPlan, requireLiveChannel bool) ([]SubscriptionChannelConfig, error) {
	if plan.MeterType == SubscriptionMeterSharedTokens {
		if plan.InputTokenLimit <= 0 || plan.InputTokenLimit > MembershipMaxTokens || plan.OutputTokenLimit <= 0 || plan.OutputTokenLimit > MembershipMaxTokens {
			return nil, errors.New("input and output token limits must be positive and within bounds")
		}
		if plan.TotalAmount != 0 || plan.UpgradeGroup != "" || plan.DowngradeGroup != "" {
			return nil, errors.New("shared token membership requires no legacy quota or group changes")
		}
		plan.ChannelQuotas = nil
		return []SubscriptionChannelConfig{{Profile: SubscriptionMeterSharedTokens, Unit: MembershipUnitTokens, InputLimit: plan.InputTokenLimit, OutputLimit: plan.OutputTokenLimit}}, nil
	}
	if IsQuotaSubscription(plan.MeterType) {
		if len(plan.ChannelQuotas) > 0 && string(plan.ChannelQuotas) != "null" && string(plan.ChannelQuotas) != "[]" {
			return nil, errors.New("quota plans cannot include channel grants")
		}
		return nil, nil
	}
	if plan.MeterType != SubscriptionMeterChannel {
		return nil, errors.New("unsupported subscription meter type")
	}
	if plan.TotalAmount != 0 || plan.UpgradeGroup != "" || plan.DowngradeGroup != "" || NormalizeResetPeriod(plan.QuotaResetPeriod) != SubscriptionResetNever {
		return nil, errors.New("channel membership requires no legacy quota, resets or group changes")
	}
	var configs []SubscriptionChannelConfig
	if err := common.Unmarshal(plan.ChannelQuotas, &configs); err != nil {
		return nil, errors.New("invalid channel quota configuration")
	}
	if len(configs) == 0 {
		return nil, errors.New("channel quotas required")
	}
	seen := make(map[int]bool)
	for _, cfg := range configs {
		if cfg.ChannelId <= 0 || seen[cfg.ChannelId] || len(cfg.Models) == 0 {
			return nil, errors.New("invalid or duplicate channel quota")
		}
		seen[cfg.ChannelId] = true
		switch cfg.Profile {
		case MembershipTextProfile, MembershipRealtimeProfile, MembershipClaudeProfile, MembershipGeminiProfile, MembershipGeminiImageProfile:
			if cfg.Unit != MembershipUnitTokens || cfg.InputLimit <= 0 || cfg.OutputLimit <= 0 || cfg.InputLimit > MembershipMaxTokens || cfg.OutputLimit > MembershipMaxTokens || cfg.QuantityLimit != 0 {
				return nil, errors.New("invalid text token limits")
			}
		case MembershipImageProfile, MembershipSeedreamImageProfile, MembershipVideoProfile, MembershipTranscriptionProfile, MembershipSpeechProfile:
			unit := MembershipUnitImages
			if cfg.Profile == MembershipVideoProfile {
				unit = MembershipUnitVideos
			}
			if cfg.Profile == MembershipTranscriptionProfile {
				unit = MembershipUnitAudioMillis
			}
			if cfg.Profile == MembershipSpeechProfile {
				unit = MembershipUnitCharacters
			}
			if cfg.Unit != unit || cfg.QuantityLimit <= 0 || cfg.QuantityLimit > MembershipMaxTokens || cfg.InputLimit != 0 || cfg.OutputLimit != 0 {
				return nil, errors.New("invalid image count limit")
			}
		default:
			return nil, errors.New("channel metering profile is not supported for sale")
		}
		if !requireLiveChannel {
			continue
		}
		var channel Channel
		if err := tx.First(&channel, cfg.ChannelId).Error; err != nil {
			return nil, err
		}
		if ((cfg.Profile == MembershipTextProfile && !MembershipTextChannelSupported(channel.Type)) || (cfg.Profile == MembershipRealtimeProfile && channel.Type != constant.ChannelTypeOpenAI) || (cfg.Profile == MembershipClaudeProfile && channel.Type != constant.ChannelTypeAnthropic) || ((cfg.Profile == MembershipGeminiProfile || cfg.Profile == MembershipGeminiImageProfile) && channel.Type != constant.ChannelTypeGemini) || (cfg.Profile == MembershipImageProfile && channel.Type != constant.ChannelTypeOpenAI) || (cfg.Profile == MembershipSeedreamImageProfile && channel.Type != constant.ChannelTypeVolcEngineImage) || (cfg.Profile == MembershipVideoProfile && !MembershipVideoChannelSupported(channel.Type)) || ((cfg.Profile == MembershipTranscriptionProfile || cfg.Profile == MembershipSpeechProfile) && channel.Type != constant.ChannelTypeOpenAI)) || channel.Status != common.ChannelStatusEnabled || channel.GetSetting().PassThroughBodyEnabled {
			return nil, errors.New("channel does not support membership text metering")
		}
		var mapping map[string]string
		if channel.ModelMapping != nil && strings.TrimSpace(*channel.ModelMapping) != "" {
			if err := common.UnmarshalJsonStr(*channel.ModelMapping, &mapping); err != nil {
				return nil, err
			}
		}
		for _, name := range cfg.Models {
			upstream := name
			if mapped := mapping[name]; mapped != "" {
				upstream = mapped
			}
			if !slices.Contains(channel.GetModels(), name) || (cfg.Profile == MembershipTextProfile && !MembershipTextModelSupported(upstream)) || (cfg.Profile == MembershipRealtimeProfile && upstream != "gpt-4o-realtime-preview") || (cfg.Profile == MembershipClaudeProfile && !MembershipClaudeModelSupported(upstream)) || (cfg.Profile == MembershipGeminiProfile && upstream != "gemini-3.8-flash") || (cfg.Profile == MembershipGeminiImageProfile && !MembershipGeminiImageModelSupported(upstream)) || (cfg.Profile == MembershipImageProfile && !MembershipImageModelSupported(upstream)) || (cfg.Profile == MembershipSeedreamImageProfile && !MembershipSeedreamImageModelSupported(upstream)) || (cfg.Profile == MembershipVideoProfile && !MembershipVideoModelSupported(upstream)) || (cfg.Profile == MembershipTranscriptionProfile && upstream != "whisper-1") || (cfg.Profile == MembershipSpeechProfile && upstream != "tts-1" && upstream != "tts-1-hd") {
				return nil, fmt.Errorf("model %s has no supported membership text contract", name)
			}
		}
	}
	return configs, nil
}

// MembershipTextModelSupported limits admission to mock-verified OpenAI chat wire contracts.
// A real channel still requires manual output-limit and raw-usage acceptance.
func MembershipTextModelSupported(name string) bool {
	switch name {
	case "deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4.1-flash", "doubao-seed-2.1-lite", "doubao-seed-2.1-pro", "glm-5.3", "glm-5.3-flash", "kimi-k3", "grok-4.6-latest", "grok-4.7-latest", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-6-astra", "gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol", "kimi-k3.1-pro":
		return true
	case "gpt-4o-mini", "gpt-4o-mini-2024-07-18", "gpt-4o", "gpt-4o-2024-05-13", "gpt-4o-2024-08-06", "gpt-4o-2024-11-20", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4.1-2025-04-14", "gpt-4.1-mini-2025-04-14", "gpt-4.1-nano-2025-04-14":
		return true
	default:
		return false
	}
}

// MembershipImageModelSupported limits image-count metering to bounded non-streaming DALL-E requests.
func MembershipImageModelSupported(name string) bool { return name == "dall-e-2" || name == "dall-e-3" }

// MembershipSeedreamImageModelSupported admits the local catalogue Seedream names and their
// official dated Ark model IDs. The bounded contract is single-image text-to-image only;
// sequential group generation, layer decomposition, reference images and tools are rejected
// before dispatch so the raw usage.generated_images receipt can never exceed the reservation.
func MembershipSeedreamImageModelSupported(name string) bool {
	switch name {
	case "doubao-seedream-5-0", "doubao-seedream-5-0-pro", "doubao-seedream-5-0-260128", "doubao-seedream-5-0-pro-260628":
		return true
	}
	return false
}

// MembershipTextChannelSupported shares the raw OpenAI usage contract across vetted adapters.
func MembershipTextChannelSupported(channelType int) bool {
	return channelType == constant.ChannelTypeOpenAI || channelType == constant.ChannelTypeAzure || channelType == constant.ChannelTypeXai || channelType == constant.ChannelTypeVolcEngine
}

// GetMembershipGrant verifies ownership and lifetime using the database, never an auth cache.
func GetMembershipGrant(tx *gorm.DB, userId, subscriptionId, channelId int) (*SubscriptionChannelQuota, error) {
	var sub UserSubscription
	now := getDBTimestampTx(tx)
	meter := SubscriptionMeterChannel
	if channelId == 0 {
		meter = SubscriptionMeterSharedTokens
	}
	if err := tx.Where("id = ? AND user_id = ? AND meter_type = ? AND status = ? AND start_time <= ? AND end_time > ?", subscriptionId, userId, meter, "active", now, now).First(&sub).Error; err != nil {
		return nil, errors.New("membership unavailable, expired or not owned by user")
	}
	var grant SubscriptionChannelQuota
	if err := tx.Where("user_subscription_id = ? AND channel_id = ?", subscriptionId, channelId).First(&grant).Error; err != nil {
		return nil, errors.New("channel not included in membership")
	}
	return &grant, nil
}

// ReserveMembership atomically reserves both token dimensions, including SQLite's lockless path.
func ReserveMembership(record *SubscriptionChannelRequest) error {
	if record.RequestId == "" || record.InputReserved < 0 || record.OutputReserved < 0 || record.QuantityReserved < 0 || record.InputReserved > MembershipMaxTokens || record.OutputReserved > MembershipMaxTokens || record.QuantityReserved > MembershipMaxTokens {
		return errors.New("invalid membership reservation")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if record.ChannelId == 0 {
			var sub UserSubscription
			if err := lockForUpdate(tx).Where("id = ? AND user_id = ? AND meter_type = ?", record.UserSubscriptionId, record.UserId, SubscriptionMeterSharedTokens).First(&sub).Error; err != nil {
				return err
			}
			if err := resetSharedTokenCycleTx(tx, &sub, getDBTimestampTx(tx)); err != nil {
				return err
			}
		}
		grant, err := GetMembershipGrant(tx, record.UserId, record.UserSubscriptionId, record.ChannelId)
		if err != nil {
			return err
		}
		if (grant.Unit == MembershipUnitTokens && (record.InputReserved <= 0 || record.OutputReserved <= 0 || record.QuantityReserved != 0)) || ((grant.Unit == MembershipUnitImages || grant.Unit == MembershipUnitVideos || grant.Unit == MembershipUnitAudioMillis || grant.Unit == MembershipUnitCharacters) && (record.QuantityReserved <= 0 || record.InputReserved != 0 || record.OutputReserved != 0)) || (grant.Unit != MembershipUnitTokens && grant.Unit != MembershipUnitImages && grant.Unit != MembershipUnitVideos && grant.Unit != MembershipUnitAudioMillis && grant.Unit != MembershipUnitCharacters) {
			return errors.New("reservation does not match membership unit")
		}
		record.Unit = grant.Unit
		record.CycleStart = grant.CycleStart
		var models []string
		if grant.Profile != SubscriptionMeterSharedTokens && (common.Unmarshal(grant.Models, &models) != nil || !slices.Contains(models, record.Model)) {
			return errors.New("model not included in membership")
		}
		// A duplicate request cannot reserve twice, even when its original outcome is unknown.
		var existing SubscriptionChannelRequest
		result := tx.Where("request_id = ?", record.RequestId).Limit(1).Find(&existing)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected > 0 {
			return errors.New("membership request already reserved")
		}
		result = tx.Model(&SubscriptionChannelQuota{}).Where("id = ? AND input_limit - input_used - input_reserved >= ? AND output_limit - output_used - output_reserved >= ? AND quantity_limit - quantity_used - quantity_reserved >= ?", grant.Id, record.InputReserved, record.OutputReserved, record.QuantityReserved).Updates(map[string]interface{}{
			"quantity_reserved": gorm.Expr("quantity_reserved + ?", record.QuantityReserved), "input_reserved": gorm.Expr("input_reserved + ?", record.InputReserved), "output_reserved": gorm.Expr("output_reserved + ?", record.OutputReserved), "updated_at": common.GetTimestamp(),
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrMembershipQuota
		}
		record.Status = "prepared"
		record.CreatedAt = common.GetTimestamp()
		record.UpdatedAt = record.CreatedAt
		return tx.Create(record).Error
	})
}

// DispatchMembership persists the uncertain-outcome boundary before any network write.
func DispatchMembership(requestId string) error {
	result := DB.Model(&SubscriptionChannelRequest{}).Where("request_id = ? AND status = ?", requestId, "prepared").Updates(map[string]interface{}{"status": "dispatched", "updated_at": common.GetTimestamp()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("membership request cannot be dispatched")
	}
	return nil
}

// FinishMembership settles reliable counters or keeps unknown outcomes reserved for reconciliation.
// Expiry is intentionally not checked here: accepted work belongs to its original subscription.
func FinishMembership(requestId string, input, output int64, outcome, reason string) error {
	return finishMembership(requestId, input, output, 0, outcome, reason)
}

// FinishMembershipQuantity settles actual count units without fabricating input/output tokens.
func FinishMembershipQuantity(requestId string, quantity int64, outcome, reason string) error {
	return finishMembership(requestId, 0, 0, quantity, outcome, reason)
}

// finishMembership applies the same atomic state machine to token and count contracts.
func finishMembership(requestId string, input, output, quantity int64, outcome, reason string) error {
	if input < 0 || output < 0 || quantity < 0 || input > MembershipMaxTokens || output > MembershipMaxTokens || quantity > MembershipMaxTokens {
		return errors.New("invalid membership usage")
	}
	if outcome != "settled" && outcome != "released" && outcome != "pending" {
		return errors.New("invalid membership outcome")
	}
	if outcome != "settled" && (input != 0 || output != 0 || quantity != 0) {
		return errors.New("non-settlement carries usage")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		return finishMembershipTx(tx, requestId, input, output, quantity, outcome, reason)
	})
}

// finishMembershipTx shares ledger invariants with asynchronous task terminal transactions.
func finishMembershipTx(tx *gorm.DB, requestId string, input, output, quantity int64, outcome, reason string) error {
	var record SubscriptionChannelRequest
	if err := lockForUpdate(tx).Where("request_id = ?", requestId).First(&record).Error; err != nil {
		return err
	}
	if record.Status == "settled" || record.Status == "released" {
		if record.Status == outcome && record.InputUsed == input && record.OutputUsed == output && record.QuantityUsed == quantity {
			return nil
		}
		return errors.New("membership outcome conflicts with final ledger")
	}
	if outcome == "released" && record.Status != "prepared" {
		return errors.New("dispatched membership requires reconciliation, not automatic release")
	}
	if outcome == "settled" && (record.Status == "prepared" || input > record.InputReserved || output > record.OutputReserved || quantity > record.QuantityReserved) {
		return errors.New("usage violates membership reservation; reconciliation required")
	}
	result := tx.Model(&SubscriptionChannelRequest{}).Where("id = ? AND status = ?", record.Id, record.Status).Updates(map[string]interface{}{"status": outcome, "input_used": input, "output_used": output, "quantity_used": quantity, "reason": reason, "updated_at": common.GetTimestamp()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("membership concurrent settlement")
	}
	if outcome == "pending" {
		return nil
	}
	if record.ChannelId == 0 {
		var grant SubscriptionChannelQuota
		if err := lockForUpdate(tx).Where("user_subscription_id = ? AND channel_id = 0", record.UserSubscriptionId).First(&grant).Error; err != nil {
			return err
		}
		if grant.CycleStart != record.CycleStart {
			return nil
		}
	}
	result = tx.Model(&SubscriptionChannelQuota{}).Where("user_subscription_id = ? AND channel_id = ? AND input_reserved >= ? AND output_reserved >= ? AND quantity_reserved >= ?", record.UserSubscriptionId, record.ChannelId, record.InputReserved, record.OutputReserved, record.QuantityReserved).Updates(map[string]interface{}{
		"quantity_reserved": gorm.Expr("quantity_reserved - ?", record.QuantityReserved), "quantity_used": gorm.Expr("quantity_used + ?", quantity), "input_reserved": gorm.Expr("input_reserved - ?", record.InputReserved), "output_reserved": gorm.Expr("output_reserved - ?", record.OutputReserved),
		"input_used": gorm.Expr("input_used + ?", input), "output_used": gorm.Expr("output_used + ?", output), "updated_at": common.GetTimestamp(),
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("membership grant ledger mismatch")
	}
	return nil
}

// MembershipVideoModelSupported restricts the first video contract to single-output Sora tasks.
func MembershipVideoModelSupported(name string) bool { return name == "sora-2" || name == "sora-2-pro" }

// MembershipVideoChannelSupported identifies adapters implementing the Sora task receipt contract.
func MembershipVideoChannelSupported(kind int) bool {
	return kind == constant.ChannelTypeOpenAI || kind == constant.ChannelTypeSora
}

// MembershipClaudeModelSupported lists the explicit native Messages contracts from the local catalogue.
func MembershipClaudeModelSupported(name string) bool {
	switch name {
	case "claude-fable-5", "claude-fable-5-1", "claude-opus-5", "claude-opus-5-5", "claude-sonnet-5", "claude-sonnet-5-5":
		return true
	}
	return false
}

// MembershipGeminiImageModelSupported admits only the inventory image models.
func MembershipGeminiImageModelSupported(name string) bool {
	return name == "gemini-3-pro-image" || name == "gemini-3.1-flash-image"
}
