package service

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// ErrTokenChannelBindingRequired 是 B 端密钥未绑定渠道时，视频生成与素材上传统一返回的错误。
// 产品约定：B 端 Key 必须锁定一个渠道（可控路由），未绑定的 Key 直接报错而非回落平台默认路由。
var ErrTokenChannelBindingRequired = errors.New("当前密钥未绑定渠道，请联系管理员绑定渠道后再使用")

// ValidateTokenBindChannel 在超管为密钥绑定/解绑渠道时校验目标渠道是否可用。
// channelID<=0 表示解绑（未绑定），恒合法。
func ValidateTokenBindChannel(channelID int) error {
	if channelID <= 0 {
		return nil
	}
	_, err := resolveBoundAssetChannel(channelID)
	return err
}

// ResolveTokenBoundChannel 在运行时解析密钥绑定的渠道。
// 未绑定（channelID<=0）返回 ErrTokenChannelBindingRequired；绑定但渠道不可用返回具体原因。
func ResolveTokenBoundChannel(channelID int) (*model.Channel, error) {
	if channelID <= 0 {
		return nil, ErrTokenChannelBindingRequired
	}
	return resolveBoundAssetChannel(channelID)
}

// resolveBoundAssetChannel 取绑定渠道并校验其存在、启用且开启了素材上传协议。
func resolveBoundAssetChannel(channelID int) (*model.Channel, error) {
	channel, err := model.GetChannelById(channelID, true)
	if err != nil {
		return nil, fmt.Errorf("绑定的渠道 %d 不存在", channelID)
	}
	if channel.Status != common.ChannelStatusEnabled {
		return nil, fmt.Errorf("绑定的渠道 %d 已被禁用，请联系管理员", channelID)
	}
	if channel.GetOtherSettings().AssetUploadProtocol == "" {
		return nil, fmt.Errorf("绑定的渠道 %d 未开启素材上传协议，请联系管理员", channelID)
	}
	return channel, nil
}
