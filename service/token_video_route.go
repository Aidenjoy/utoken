package service

import (
	"errors"
	"fmt"
	"sort"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
)

var ErrNoVideoKeyChannel = errors.New("当前模型和分辨率暂无可用渠道，请联系管理员")

// VideoKeyOption 只暴露用户创建视频 Key 所需的模型能力，不包含渠道或折扣。
type VideoKeyOption struct {
	Model      string `json:"model"`
	Supports4K bool   `json:"supports_4k"`
}

type videoRouteContext struct {
	user    *model.UserBase
	groups  []string
	allowed model.AllowedModels
}

func newVideoRouteContext(userId int, tokenGroup string) (*videoRouteContext, error) {
	user, err := model.GetUserCache(userId)
	if err != nil {
		return nil, err
	}
	if tokenGroup == "" {
		tokenGroup = user.Group
	}
	var groups []string
	if tokenGroup == "auto" {
		groups = GetUserAutoGroup(user.Group)
	} else {
		if !GroupInUserUsableGroups(user.Group, tokenGroup) {
			return nil, fmt.Errorf("无权访问 %s 分组", tokenGroup)
		}
		groups = []string{tokenGroup}
	}
	if len(groups) == 0 {
		return nil, ErrNoVideoKeyChannel
	}
	return &videoRouteContext{
		user:    user,
		groups:  groups,
		allowed: model.ResolveAllowedModels(user.AgentId, user.AllowedModels),
	}, nil
}

func (ctx *videoRouteContext) allowsModel(modelName string) bool {
	return len(ctx.allowed) == 0 || ctx.allowed.Allows(modelName)
}

// videoRouteConfig 只接受模型映射行对应的路由配置，防止残留配置参与匹配。
func videoRouteConfig(channel *model.Channel, modelName string) (dto.ChannelModelRouteConfig, bool) {
	var mapping map[string]string
	if channel.GetModelMapping() == "" || common.UnmarshalJsonStr(channel.GetModelMapping(), &mapping) != nil {
		return dto.ChannelModelRouteConfig{}, false
	}
	if _, ok := mapping[modelName]; !ok {
		return dto.ChannelModelRouteConfig{}, false
	}
	config, ok := channel.GetSetting().ModelRouteConfigs[modelName]
	if !ok || config.Validate(modelName) != nil {
		return dto.ChannelModelRouteConfig{}, false
	}
	return config, true
}

func (ctx *videoRouteContext) matchChannel(modelName string, video4K bool) *model.Channel {
	if modelName == "" || !ctx.allowsModel(modelName) {
		return nil
	}
	type candidate struct {
		channel  *model.Channel
		discount float64
	}
	seen := make(map[int]bool)
	candidates := make([]candidate, 0)
	for _, group := range ctx.groups {
		for _, channelId := range model.GetEnabledChannelIdsForGroupModel(group, modelName) {
			if seen[channelId] {
				continue
			}
			seen[channelId] = true
			channel, err := model.GetChannelById(channelId, true)
			if err != nil || channel.Status != common.ChannelStatusEnabled || channel.GetOtherSettings().AssetUploadProtocol == "" {
				continue
			}
			config, ok := videoRouteConfig(channel, modelName)
			if !ok || config.Discount == nil || (video4K && !config.Supports4K) {
				continue
			}
			candidates = append(candidates, candidate{channel: channel, discount: *config.Discount})
		}
	}
	if len(candidates) == 0 {
		return nil
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].discount != candidates[j].discount {
			return candidates[i].discount < candidates[j].discount
		}
		return candidates[i].channel.Id < candidates[j].channel.Id
	})
	return candidates[0].channel
}

// MatchVideoKeyChannel 在创建视频 Key 时计算一次渠道快照，运行时不得重复调用。
func MatchVideoKeyChannel(userId int, tokenGroup, modelName string, video4K bool) (*model.Channel, error) {
	ctx, err := newVideoRouteContext(userId, tokenGroup)
	if err != nil {
		return nil, err
	}
	channel := ctx.matchChannel(modelName, video4K)
	if channel == nil {
		return nil, ErrNoVideoKeyChannel
	}
	return channel, nil
}

// ListVideoKeyOptions 枚举当前用户至少有一个可匹配渠道的视频模型。
func ListVideoKeyOptions(userId int, tokenGroup string) ([]VideoKeyOption, error) {
	ctx, err := newVideoRouteContext(userId, tokenGroup)
	if err != nil {
		return nil, err
	}
	modelSet := make(map[string]bool)
	for _, group := range ctx.groups {
		for _, modelName := range model.GetGroupEnabledModels(group) {
			if model.IsVideoModelName(modelName) && ctx.allowsModel(modelName) {
				modelSet[modelName] = true
			}
		}
	}
	modelNames := make([]string, 0, len(modelSet))
	for modelName := range modelSet {
		modelNames = append(modelNames, modelName)
	}
	sort.Strings(modelNames)
	options := make([]VideoKeyOption, 0, len(modelNames))
	for _, modelName := range modelNames {
		if ctx.matchChannel(modelName, false) == nil {
			continue
		}
		options = append(options, VideoKeyOption{
			Model:      modelName,
			Supports4K: ctx.matchChannel(modelName, true) != nil,
		})
	}
	return options, nil
}

// ValidateVideoTokenChannel 校验超管手动改派，折扣不参与手动改派判断。
func ValidateVideoTokenChannel(token *model.Token, channelID int) error {
	if token == nil || token.KeyType != model.TokenKeyTypeVideo || channelID <= 0 {
		return ValidateTokenBindChannel(channelID)
	}
	channel, err := resolveBoundAssetChannel(channelID)
	if err != nil {
		return err
	}
	ctx, err := newVideoRouteContext(token.UserId, token.Group)
	if err != nil {
		return err
	}
	if !ctx.allowsModel(token.VideoModel) {
		return fmt.Errorf("渠道 %d 不在目标用户的模型授权范围内", channelID)
	}
	enabled := false
	for _, group := range ctx.groups {
		if model.IsChannelEnabledForGroupModel(group, token.VideoModel, channelID) {
			enabled = true
			break
		}
	}
	if !enabled {
		return fmt.Errorf("渠道 %d 不支持密钥分组和模型 %s", channelID, token.VideoModel)
	}
	config, ok := videoRouteConfig(channel, token.VideoModel)
	if !ok || (token.Video4K && !config.Supports4K) {
		return fmt.Errorf("渠道 %d 不支持密钥模型 %s 或所需分辨率", channelID, token.VideoModel)
	}
	return nil
}
