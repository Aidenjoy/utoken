package service

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"
)

func formatNotifyType(channelId int, status int) string {
	return fmt.Sprintf("%s_%d_%d", dto.NotifyTypeChannelUpdate, channelId, status)
}

// disable & notify
func DisableChannel(channelError types.ChannelError, reason string) {
	common.SysLog(fmt.Sprintf("通道「%s」（#%d）发生错误，准备禁用，原因：%s", channelError.ChannelName, channelError.ChannelId, common.LocalLogPreview(reason)))

	// 检查是否启用自动禁用功能
	if !channelError.AutoBan {
		common.SysLog(fmt.Sprintf("通道「%s」（#%d）未启用自动禁用功能，跳过禁用操作", channelError.ChannelName, channelError.ChannelId))
		return
	}

	success := model.UpdateChannelStatus(channelError.ChannelId, channelError.UsingKey, common.ChannelStatusAutoDisabled, reason)
	if success {
		subject := fmt.Sprintf("通道「%s」（#%d）已被禁用", channelError.ChannelName, channelError.ChannelId)
		content := fmt.Sprintf("通道「%s」（#%d）已被禁用，原因：%s", channelError.ChannelName, channelError.ChannelId, reason)
		NotifyRootUser(formatNotifyType(channelError.ChannelId, common.ChannelStatusAutoDisabled), subject, content)
	}
}

func EnableChannel(channelId int, usingKey string, channelName string) {
	success := model.UpdateChannelStatus(channelId, usingKey, common.ChannelStatusEnabled, "")
	if success {
		subject := fmt.Sprintf("通道「%s」（#%d）已被启用", channelName, channelId)
		content := fmt.Sprintf("通道「%s」（#%d）已被启用", channelName, channelId)
		NotifyRootUser(formatNotifyType(channelId, common.ChannelStatusEnabled), subject, content)
	}
}

func ShouldDisableChannel(err *types.NewAPIError) bool {
	if !common.AutomaticDisableChannelEnabled {
		return false
	}
	if err == nil {
		return false
	}
	if types.IsChannelError(err) {
		return true
	}
	if types.IsSkipRetryError(err) {
		return false
	}
	if operation_setting.ShouldDisableByStatusCode(err.StatusCode) {
		return true
	}

	return MatchedFailureKeyword(err)
}

// UpstreamKeywordMaskMessage 命中失败关键词时统一返回给下游的提示。这类错误通常意味着
// 上游渠道本身不可用（如渠道欠费），不应把上游原文（含内部额度等细节）透传给客户端。
const UpstreamKeywordMaskMessage = "请稍后重试"

// MatchedFailureKeyword 判断错误信息是否命中任一「失败关键词」（大小写不敏感的子串匹配，
// 与渠道自动禁用共用同一套关键词与 AC 自动机）。
func MatchedFailureKeyword(err *types.NewAPIError) bool {
	if err == nil {
		return false
	}
	lowerMessage := strings.ToLower(err.Error())
	matched, _ := AcSearch(lowerMessage, operation_setting.AutomaticDisableKeywords, true)
	return matched
}

// ShouldMaskUpstreamKeywordError 判断是否要把下游看到的错误信息替换成「请稍后重试」，
// 对应 ShouldDisableChannel 的关键词分支：自动禁用开启、不是 skip-retry 的本地错误、
// 且上游信息命中失败关键词。skip-retry 守卫很关键——用户自己令牌额度不足
// （ErrorCodePreConsumeTokenQuotaFailed）同样带「quota」字样，但那是用户侧错误，必须
// 原样返回，不能被当成上游渠道故障掩盖掉。
func ShouldMaskUpstreamKeywordError(err *types.NewAPIError) bool {
	if !common.AutomaticDisableChannelEnabled {
		return false
	}
	if types.IsSkipRetryError(err) {
		return false
	}
	return MatchedFailureKeyword(err)
}

func ShouldEnableChannel(newAPIError *types.NewAPIError, status int) bool {
	if !common.AutomaticEnableChannelEnabled {
		return false
	}
	if newAPIError != nil {
		return false
	}
	if status != common.ChannelStatusAutoDisabled {
		return false
	}
	return true
}
