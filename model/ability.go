package model

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"

	"github.com/samber/lo"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Ability struct {
	Group     string  `json:"group" gorm:"type:varchar(64);primaryKey;autoIncrement:false"`
	Model     string  `json:"model" gorm:"type:varchar(255);primaryKey;autoIncrement:false"`
	ChannelId int     `json:"channel_id" gorm:"primaryKey;autoIncrement:false;index"`
	Enabled   bool    `json:"enabled"`
	Priority  *int64  `json:"priority" gorm:"bigint;default:0;index"`
	Weight    uint    `json:"weight" gorm:"default:0;index"`
	Tag       *string `json:"tag" gorm:"index"`
}

type AbilityWithChannel struct {
	Ability
	ChannelType int `json:"channel_type"`
}

func GetAllEnableAbilityWithChannels() ([]AbilityWithChannel, error) {
	var abilities []AbilityWithChannel
	err := DB.Table("abilities").
		Select("abilities.*, channels.type as channel_type").
		Joins("left join channels on abilities.channel_id = channels.id").
		Where("abilities.enabled = ?", true).
		Scan(&abilities).Error
	return abilities, err
}

func GetGroupEnabledModels(group string) []string {
	var models []string
	// Find distinct models
	DB.Table("abilities").Where(commonGroupCol+" = ? and enabled = ?", group, true).Distinct("model").Pluck("model", &models)
	return models
}

func GetEnabledModels() []string {
	var models []string
	// Find distinct models
	DB.Table("abilities").Where("enabled = ?", true).Distinct("model").Pluck("model", &models)
	return models
}

func GetAllEnableAbilities() []Ability {
	var abilities []Ability
	DB.Find(&abilities, "enabled = ?", true)
	return abilities
}

// abilityPriority 空值安全读取 abilities.priority：列虽有 default:0，但早于该
// 默认值写入的历史行仍可能是 NULL。
func abilityPriority(ability Ability) int64 {
	if ability.Priority == nil {
		return 0
	}
	return *ability.Priority
}

// filterAbilitiesByPriorityTier 只保留目标优先级层的候选：retry=0 取最高层，
// retry=N 取降序排列后的第 N 层，超出层数时落到最低层，与内存缓存选路
// （GetRandomSatisfiedChannel）的分层语义一致。
//
// 分层必须发生在请求路径/分辨率过滤之后：若先按未过滤的候选取 MAX(priority)，
// 「最高优先级渠道做不了该分辨率」会让候选集直接变空，低优先级但可用的渠道
// 永远选不到，请求以「无可用渠道」失败而不是落到能做的渠道上。
func filterAbilitiesByPriorityTier(abilities []Ability, retry int) []Ability {
	if len(abilities) == 0 {
		return abilities
	}
	unique := make(map[int64]bool, len(abilities))
	for _, ability := range abilities {
		unique[abilityPriority(ability)] = true
	}
	tiers := make([]int64, 0, len(unique))
	for priority := range unique {
		tiers = append(tiers, priority)
	}
	sort.Slice(tiers, func(i, j int) bool { return tiers[i] > tiers[j] })

	if retry >= len(tiers) {
		retry = len(tiers) - 1
	}
	if retry < 0 {
		retry = 0
	}
	target := tiers[retry]
	filtered := make([]Ability, 0, len(abilities))
	for _, ability := range abilities {
		if abilityPriority(ability) == target {
			filtered = append(filtered, ability)
		}
	}
	return filtered
}

func GetChannel(group string, model string, retry int, requestPath string, requiredResolution string) (*Channel, error) {
	var abilities []Ability
	err := DB.Where(commonGroupCol+" = ? and model = ? and enabled = ?", group, model, true).
		Order("weight DESC").Find(&abilities).Error
	if err != nil {
		return nil, err
	}
	abilities = filterAbilitiesByRequestPath(abilities, requestPath)
	abilities = filterAbilitiesByResolution(abilities, model, requiredResolution)
	abilities = filterAbilitiesByPriorityTier(abilities, retry)
	if len(abilities) == 0 {
		return nil, nil
	}

	// 同层内按权重加权随机，+10 保底使权重为 0 的渠道仍可被选中。
	weightSum := uint(0)
	for _, ability := range abilities {
		weightSum += ability.Weight + 10
	}
	weight := common.GetRandomInt(int(weightSum))
	channel := Channel{}
	for _, ability := range abilities {
		weight -= int(ability.Weight) + 10
		if weight <= 0 {
			channel.Id = ability.ChannelId
			break
		}
	}
	err = DB.First(&channel, "id = ?", channel.Id).Error
	return &channel, err
}

// filterAbilitiesByRequestPath restricts candidates by request path for the DB
// (non-memory-cache) selection path. Only Advanced Custom (type 58) channels are
// path-checked: kept only when one of their routes matches requestPath; all other
// channel types always pass. When requestPath is empty, filtering is skipped.
func filterAbilitiesByRequestPath(abilities []Ability, requestPath string) []Ability {
	if requestPath == "" || len(abilities) == 0 {
		return abilities
	}

	channelIds := make([]int, 0, len(abilities))
	seen := make(map[int]struct{}, len(abilities))
	for _, ability := range abilities {
		if _, ok := seen[ability.ChannelId]; ok {
			continue
		}
		seen[ability.ChannelId] = struct{}{}
		channelIds = append(channelIds, ability.ChannelId)
	}

	var channels []*Channel
	if err := DB.Where("id IN ?", channelIds).Find(&channels).Error; err != nil {
		// On error, fall back to unfiltered candidates to avoid blocking selection
		return abilities
	}

	advancedConfigs := make(map[int]*dto.AdvancedCustomConfig)
	for _, channel := range channels {
		if channel.Type == constant.ChannelTypeAdvancedCustom {
			advancedConfigs[channel.Id] = channel.GetOtherSettings().AdvancedCustom
		}
	}

	filtered := make([]Ability, 0, len(abilities))
	for _, ability := range abilities {
		config, isAdvancedCustom := advancedConfigs[ability.ChannelId]
		if !isAdvancedCustom {
			filtered = append(filtered, ability)
			continue
		}
		if config != nil && config.SupportsPath(requestPath) {
			filtered = append(filtered, ability)
		}
	}
	return filtered
}

// filterAbilitiesByResolution 是 filterChannelsByResolution 的 DB（非内存缓存）
// 选路路径版本：按 (渠道 × 模型 × 分辨率) 三维能力剔除对 requiredResolution
// 不支持的渠道。requiredResolution 为空时不过滤；未配置黑名单的渠道视为支持
// 全部分辨率（向后兼容）。加载渠道失败时回退未过滤候选，避免阻断选路。
func filterAbilitiesByResolution(abilities []Ability, model string, requiredResolution string) []Ability {
	res := strings.ToLower(strings.TrimSpace(requiredResolution))
	if res == "" || len(abilities) == 0 {
		return abilities
	}

	channelIds := make([]int, 0, len(abilities))
	seen := make(map[int]struct{}, len(abilities))
	for _, ability := range abilities {
		if _, ok := seen[ability.ChannelId]; ok {
			continue
		}
		seen[ability.ChannelId] = struct{}{}
		channelIds = append(channelIds, ability.ChannelId)
	}

	var channels []*Channel
	if err := DB.Where("id IN ?", channelIds).Find(&channels).Error; err != nil {
		return abilities
	}

	blacklists := make(map[int]map[string][]string, len(channels))
	for _, channel := range channels {
		if blacklist := channel.GetSetting().ResolutionBlacklist; len(blacklist) > 0 {
			blacklists[channel.Id] = blacklist
		}
	}

	filtered := make([]Ability, 0, len(abilities))
	for _, ability := range abilities {
		if dto.ResolutionSupported(blacklists[ability.ChannelId], model, res) {
			filtered = append(filtered, ability)
		}
	}
	return filtered
}

func (channel *Channel) AddAbilities(tx *gorm.DB) error {
	models_ := strings.Split(channel.Models, ",")
	groups_ := strings.Split(channel.Group, ",")
	abilitySet := make(map[string]struct{})
	abilities := make([]Ability, 0, len(models_))
	for _, model := range models_ {
		for _, group := range groups_ {
			key := group + "|" + model
			if _, exists := abilitySet[key]; exists {
				continue
			}
			abilitySet[key] = struct{}{}
			ability := Ability{
				Group:     group,
				Model:     model,
				ChannelId: channel.Id,
				Enabled:   channel.Status == common.ChannelStatusEnabled,
				Priority:  channel.Priority,
				Weight:    uint(channel.GetWeight()),
				Tag:       channel.Tag,
			}
			abilities = append(abilities, ability)
		}
	}
	if len(abilities) == 0 {
		return nil
	}
	// choose DB or provided tx
	useDB := DB
	if tx != nil {
		useDB = tx
	}
	for _, chunk := range lo.Chunk(abilities, 50) {
		err := useDB.Clauses(clause.OnConflict{DoNothing: true}).Create(&chunk).Error
		if err != nil {
			return err
		}
	}
	return nil
}

func (channel *Channel) DeleteAbilities() error {
	return DB.Where("channel_id = ?", channel.Id).Delete(&Ability{}).Error
}

// UpdateAbilities updates abilities of this channel.
// Make sure the channel is completed before calling this function.
func (channel *Channel) UpdateAbilities(tx *gorm.DB) error {
	isNewTx := false
	// 如果没有传入事务，创建新的事务
	if tx == nil {
		tx = DB.Begin()
		if tx.Error != nil {
			return tx.Error
		}
		isNewTx = true
		defer func() {
			if r := recover(); r != nil {
				tx.Rollback()
			}
		}()
	}

	// First delete all abilities of this channel
	err := tx.Where("channel_id = ?", channel.Id).Delete(&Ability{}).Error
	if err != nil {
		if isNewTx {
			tx.Rollback()
		}
		return err
	}

	// Then add new abilities
	models_ := strings.Split(channel.Models, ",")
	groups_ := strings.Split(channel.Group, ",")
	abilitySet := make(map[string]struct{})
	abilities := make([]Ability, 0, len(models_))
	for _, model := range models_ {
		for _, group := range groups_ {
			key := group + "|" + model
			if _, exists := abilitySet[key]; exists {
				continue
			}
			abilitySet[key] = struct{}{}
			ability := Ability{
				Group:     group,
				Model:     model,
				ChannelId: channel.Id,
				Enabled:   channel.Status == common.ChannelStatusEnabled,
				Priority:  channel.Priority,
				Weight:    uint(channel.GetWeight()),
				Tag:       channel.Tag,
			}
			abilities = append(abilities, ability)
		}
	}

	if len(abilities) > 0 {
		for _, chunk := range lo.Chunk(abilities, 50) {
			err = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&chunk).Error
			if err != nil {
				if isNewTx {
					tx.Rollback()
				}
				return err
			}
		}
	}

	// 如果是新创建的事务，需要提交
	if isNewTx {
		return tx.Commit().Error
	}

	return nil
}

func UpdateAbilityStatus(channelId int, status bool) error {
	return DB.Model(&Ability{}).Where("channel_id = ?", channelId).Select("enabled").Update("enabled", status).Error
}

func UpdateAbilityStatusByTag(tag string, status bool) error {
	return DB.Model(&Ability{}).Where("tag = ?", tag).Select("enabled").Update("enabled", status).Error
}

func UpdateAbilityByTag(tag string, newTag *string, priority *int64, weight *uint) error {
	ability := Ability{}
	if newTag != nil {
		ability.Tag = newTag
	}
	if priority != nil {
		ability.Priority = priority
	}
	if weight != nil {
		ability.Weight = *weight
	}
	return DB.Model(&Ability{}).Where("tag = ?", tag).Updates(ability).Error
}

var fixLock = sync.Mutex{}

func FixAbility() (int, int, error) {
	lock := fixLock.TryLock()
	if !lock {
		return 0, 0, errors.New("已经有一个修复任务在运行中，请稍后再试")
	}
	defer fixLock.Unlock()

	// truncate abilities table
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		err := DB.Exec("DELETE FROM abilities").Error
		if err != nil {
			common.SysLog(fmt.Sprintf("Delete abilities failed: %s", err.Error()))
			return 0, 0, err
		}
	} else {
		err := DB.Exec("TRUNCATE TABLE abilities").Error
		if err != nil {
			common.SysLog(fmt.Sprintf("Truncate abilities failed: %s", err.Error()))
			return 0, 0, err
		}
	}
	var channels []*Channel
	// Find all channels
	err := DB.Model(&Channel{}).Find(&channels).Error
	if err != nil {
		return 0, 0, err
	}
	if len(channels) == 0 {
		return 0, 0, nil
	}
	successCount := 0
	failCount := 0
	for _, chunk := range lo.Chunk(channels, 50) {
		ids := lo.Map(chunk, func(c *Channel, _ int) int { return c.Id })
		// Delete all abilities of this channel
		err = DB.Where("channel_id IN ?", ids).Delete(&Ability{}).Error
		if err != nil {
			common.SysLog(fmt.Sprintf("Delete abilities failed: %s", err.Error()))
			failCount += len(chunk)
			continue
		}
		// Then add new abilities
		for _, channel := range chunk {
			err = channel.AddAbilities(nil)
			if err != nil {
				common.SysLog(fmt.Sprintf("Add abilities for channel %d failed: %s", channel.Id, err.Error()))
				failCount++
			} else {
				successCount++
			}
		}
	}
	InitChannelCache()
	return successCount, failCount, nil
}
