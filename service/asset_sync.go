package service

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
)

// AssetProtocolAdapter 素材上传/查询协议适配器接口。
// 由 controller 层注入实现（避免 service → relay/channel/asset 循环引用）。
type AssetProtocolAdapter interface {
	Upload(url string, assetType string, name string) (assetID string, groupID string, projectName string, err error)
	Query(assetID string) (status string, previewURL string, errMsg string, err error)
}

// AssetProtocolFactoryFunc 创建指定渠道的协议适配器。
// 在 main 或 controller 初始化时注入。
var AssetProtocolFactoryFunc func(channel *model.Channel) (AssetProtocolAdapter, error)

// SyncResult 同步结果。
type SyncResult struct {
	ChannelID   int    `json:"channel_id"`
	ChannelName string `json:"channel_name"`
	Status      string `json:"status"` // active / pending / failed / skipped
	AssetID     string `json:"asset_id,omitempty"`
	Error       string `json:"error,omitempty"`
}

// SyncSourceAssetToChannels 将源素材同步到指定渠道。
// channelIds 为空时同步到所有启用素材协议的渠道。
func SyncSourceAssetToChannels(sourceAssetId int64, channelIds []int) []SyncResult {
	source, err := model.GetSourceAssetById(sourceAssetId)
	if err != nil || source == nil {
		return []SyncResult{{Status: "failed", Error: "源素材不存在"}}
	}
	if AssetProtocolFactoryFunc == nil {
		return []SyncResult{{Status: "failed", Error: "素材协议未初始化"}}
	}

	if len(channelIds) == 0 {
		channels, err := model.GetEnabledChannels()
		if err != nil {
			return []SyncResult{{Status: "failed", Error: "查询渠道失败: " + err.Error()}}
		}
		for _, ch := range channels {
			if ch.GetOtherSettings().AssetUploadProtocol != "" {
				channelIds = append(channelIds, ch.Id)
			}
		}
	}

	var results []SyncResult
	for _, chId := range channelIds {
		result := syncToChannel(source, chId)
		results = append(results, result)
	}
	return results
}

func syncToChannel(source *model.SourceAsset, channelId int) SyncResult {
	existing, _ := model.GetAssetBySourceAndChannel(source.ID, channelId)
	if existing != nil && existing.Status == model.AssetStatusActive {
		return SyncResult{ChannelID: channelId, Status: "skipped", AssetID: existing.AssetID}
	}

	channel, err := model.GetChannelById(channelId, true)
	if err != nil || channel == nil {
		return SyncResult{ChannelID: channelId, Status: "failed", Error: "渠道不存在"}
	}
	if channel.Status != common.ChannelStatusEnabled {
		return SyncResult{ChannelID: channelId, Status: "failed", Error: "渠道已禁用"}
	}

	protocol, err := AssetProtocolFactoryFunc(channel)
	if err != nil {
		return SyncResult{ChannelID: channelId, Status: "failed", Error: "协议创建失败: " + err.Error()}
	}

	assetID, groupID, projectName, err := protocol.Upload(source.SourceURL, source.AssetType, source.Name)
	if err != nil {
		common.SysError(fmt.Sprintf("[AssetSync] upload failed (source=%d, channel=%d): %v", source.ID, channelId, err))
		return SyncResult{ChannelID: channelId, ChannelName: channel.Name, Status: "failed", Error: err.Error()}
	}

	sourceIdCopy := source.ID
	if existing != nil {
		_ = model.UpdateAssetStatus(existing.ID, model.AssetStatusPending, "", "")
		return SyncResult{ChannelID: channelId, ChannelName: channel.Name, Status: "pending", AssetID: existing.AssetID}
	}

	asset := &model.Asset{
		UserID:        source.UserID,
		ChannelID:     channelId,
		AssetID:       assetID,
		SourceAssetId: &sourceIdCopy,
		Name:          source.Name,
		AssetType:     source.AssetType,
		Status:        model.AssetStatusPending,
		SourceURL:     source.SourceURL,
		GroupID:       groupID,
		ProjectName:   projectName,
	}
	// 幂等写入：并发同步时由 (source_asset_id, channel_id) 唯一索引兜底
	if err := model.UpsertChannelAsset(asset); err != nil {
		return SyncResult{ChannelID: channelId, Status: "failed", Error: "DB 写入失败: " + err.Error()}
	}

	common.SysLog(fmt.Sprintf("[AssetSync] synced source %d to channel %d (asset_id=%s)", source.ID, channelId, assetID))
	return SyncResult{ChannelID: channelId, ChannelName: channel.Name, Status: "pending", AssetID: assetID}
}

// EnsureAssetForChannel 确保源素材在目标渠道有可用副本（返回 asset_id）。
func EnsureAssetForChannel(sourceAssetId int64, channelId int) (string, error) {
	existing, _ := model.GetAssetBySourceAndChannel(sourceAssetId, channelId)
	if existing != nil && existing.Status == model.AssetStatusActive {
		return existing.AssetID, nil
	}
	source, err := model.GetSourceAssetById(sourceAssetId)
	if err != nil || source == nil {
		return "", fmt.Errorf("源素材不存在: %d", sourceAssetId)
	}
	result := syncToChannel(source, channelId)
	if result.Status == "failed" {
		return "", fmt.Errorf("素材同步到渠道 %d 失败: %s", channelId, result.Error)
	}
	return result.AssetID, nil
}

// PreflightCheck 视频生成前置检查结果。
type PreflightCheck struct {
	Passed bool
	Issues []AssetIssue
}

type AssetIssue struct {
	SourceAssetId int64  `json:"source_asset_id,omitempty"`
	ChannelId     int    `json:"channel_id"`
	IssueType     string `json:"issue_type"`
	Detail        string `json:"detail"`
}

// CheckAssetsReadyForVideoGeneration 检查视频任务所需素材的就绪状态。
func CheckAssetsReadyForVideoGeneration(
	userId int,
	channelId int,
	assetRefs []string,
) *PreflightCheck {
	check := &PreflightCheck{Passed: true}
	for _, refURI := range assetRefs {
		existing, _ := model.GetAssetByChannelAndAssetID(channelId, refURI)
		if existing != nil && existing.Status == model.AssetStatusActive {
			continue
		}
		if existing != nil && existing.Status == model.AssetStatusPending {
			check.Passed = false
			check.Issues = append(check.Issues, AssetIssue{
				ChannelId: channelId,
				IssueType: "pending_review",
				Detail:    fmt.Sprintf("素材 %s 在渠道 %d 审核中", refURI, channelId),
			})
			continue
		}
		if existing != nil && existing.Status == model.AssetStatusFailed {
			check.Passed = false
			check.Issues = append(check.Issues, AssetIssue{
				ChannelId: channelId,
				IssueType: "review_failed",
				Detail:    fmt.Sprintf("素材 %s 审核失败: %s", refURI, existing.ErrorMsg),
			})
			continue
		}
		check.Passed = false
		check.Issues = append(check.Issues, AssetIssue{
			ChannelId: channelId,
			IssueType: "not_found",
			Detail:    fmt.Sprintf("素材 %s 在渠道 %d 不存在", refURI, channelId),
		})
	}
	return check
}

// CheckAssetsByUpstreamIDs 按「渠道 × 上游素材 ID」校验素材就绪状态。
// 供 Distribute 中间件在转发前调用：只有 active 的素材才能用于生成，
// pending（审核中）与 failed（审核失败）都应提前拦截。
func CheckAssetsByUpstreamIDs(channelId int, upstreamAssetIDs []string) *PreflightCheck {
	check := &PreflightCheck{Passed: true}
	for _, assetID := range upstreamAssetIDs {
		existing, err := model.GetAssetByChannelAndAssetID(channelId, assetID)
		if err != nil || existing == nil {
			check.Passed = false
			check.Issues = append(check.Issues, AssetIssue{
				ChannelId: channelId,
				IssueType: "not_found",
				Detail:    fmt.Sprintf("素材 %s 在渠道 %d 不存在，请先同步到该渠道", assetID, channelId),
			})
			continue
		}
		switch existing.Status {
		case model.AssetStatusActive:
			// 就绪
		case model.AssetStatusPending:
			check.Passed = false
			check.Issues = append(check.Issues, AssetIssue{
				ChannelId: channelId,
				IssueType: "pending_review",
				Detail:    fmt.Sprintf("素材 %s 在渠道 %d 审核中，请稍后重试", assetID, channelId),
			})
		case model.AssetStatusFailed:
			check.Passed = false
			check.Issues = append(check.Issues, AssetIssue{
				ChannelId: channelId,
				IssueType: "review_failed",
				Detail:    fmt.Sprintf("素材 %s 在渠道 %d 审核失败：%s", assetID, channelId, existing.ErrorMsg),
			})
		}
	}
	return check
}

// PollAssetStatuses 定期轮询 pending 素材状态。
func PollAssetStatuses() {
	assets, _ := model.GetAssetsByStatus(model.AssetStatusPending, 100)
	for _, a := range assets {
		if time.Now().Unix()-a.UpdatedAt < 30 {
			continue
		}
		channel, err := model.GetChannelById(a.ChannelID, true)
		if err != nil || channel == nil {
			continue
		}
		if AssetProtocolFactoryFunc == nil {
			continue
		}
		protocol, err := AssetProtocolFactoryFunc(channel)
		if err != nil {
			continue
		}
		status, previewURL, errMsg, err := protocol.Query(a.AssetID)
		if err != nil {
			continue
		}
		if status != model.AssetStatusPending {
			_ = model.UpdateAssetStatus(a.ID, status, previewURL, errMsg)
			logger.LogInfo(nil, fmt.Sprintf("[AssetPoll] asset %d (upstream=%s) status changed to %s", a.ID, a.AssetID, status))
		}
	}
}
