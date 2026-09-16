package model

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

func IsChannelEnabledForGroupModel(group string, modelName string, channelID int) bool {
	if group == "" || modelName == "" || channelID <= 0 {
		return false
	}
	if !common.MemoryCacheEnabled {
		return isChannelEnabledForGroupModelDB(group, modelName, channelID)
	}

	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()

	if group2model2channels == nil {
		return false
	}

	if isChannelIDInList(group2model2channels[group][modelName], channelID) {
		return true
	}
	normalized := ratio_setting.FormatMatchingModelName(modelName)
	if normalized != "" && normalized != modelName {
		return isChannelIDInList(group2model2channels[group][normalized], channelID)
	}
	return false
}

// GetEnabledChannelIdsForGroupModel 返回指定分组下支持 modelName 的启用渠道 ID 列表。
// 内存缓存开启时走缓存（含归一化模型名回退），否则查 abilities 表。
// 智能素材（asset://yun-x）挑选同步渠道时用于枚举候选集；无结果返回 nil。
func GetEnabledChannelIdsForGroupModel(group, modelName string) []int {
	if group == "" || modelName == "" {
		return nil
	}
	if !common.MemoryCacheEnabled {
		return getEnabledChannelIdsForGroupModelDB(group, modelName)
	}

	channelSyncLock.RLock()
	defer channelSyncLock.RUnlock()

	if group2model2channels == nil {
		return nil
	}
	if ids := group2model2channels[group][modelName]; len(ids) > 0 {
		return append([]int(nil), ids...)
	}
	normalized := ratio_setting.FormatMatchingModelName(modelName)
	if normalized != "" && normalized != modelName {
		if ids := group2model2channels[group][normalized]; len(ids) > 0 {
			return append([]int(nil), ids...)
		}
	}
	return nil
}

func getEnabledChannelIdsForGroupModelDB(group, modelName string) []int {
	ids := pluckAbilityChannelIds(group, modelName)
	if len(ids) > 0 {
		return ids
	}
	normalized := ratio_setting.FormatMatchingModelName(modelName)
	if normalized == "" || normalized == modelName {
		return nil
	}
	return pluckAbilityChannelIds(group, normalized)
}

func pluckAbilityChannelIds(group, modelName string) []int {
	var ids []int
	err := DB.Model(&Ability{}).
		Distinct().
		Where(commonGroupCol+" = ? and model = ? and enabled = ?", group, modelName, true).
		Pluck("channel_id", &ids).Error
	if err != nil {
		return nil
	}
	return ids
}

func IsChannelEnabledForAnyGroupModel(groups []string, modelName string, channelID int) bool {
	if len(groups) == 0 {
		return false
	}
	for _, g := range groups {
		if IsChannelEnabledForGroupModel(g, modelName, channelID) {
			return true
		}
	}
	return false
}

func isChannelEnabledForGroupModelDB(group string, modelName string, channelID int) bool {
	var count int64
	err := DB.Model(&Ability{}).
		Where(commonGroupCol+" = ? and model = ? and channel_id = ? and enabled = ?", group, modelName, channelID, true).
		Count(&count).Error
	if err == nil && count > 0 {
		return true
	}
	normalized := ratio_setting.FormatMatchingModelName(modelName)
	if normalized == "" || normalized == modelName {
		return false
	}
	count = 0
	err = DB.Model(&Ability{}).
		Where(commonGroupCol+" = ? and model = ? and channel_id = ? and enabled = ?", group, normalized, channelID, true).
		Count(&count).Error
	return err == nil && count > 0
}

func isChannelIDInList(list []int, channelID int) bool {
	for _, id := range list {
		if id == channelID {
			return true
		}
	}
	return false
}
