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
	AssetDBID   int64  `json:"asset_db_id,omitempty"` // 源素材在 assets 表的主键，供逐条反馈定位
	Name        string `json:"name,omitempty"`        // 源素材名称，供前端展示
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

// SyncAssetToChannel 把「源渠道已有的素材副本」再上传到目标渠道。
// 用于管理员按渠道批量迁移素材：以 src.SourceURL 通过目标渠道协议重新登记，
// 新副本保留原 user_id，状态 pending，由 PollAssetStatuses 后续刷新。
func SyncAssetToChannel(src *model.Asset, targetChannelId int) SyncResult {
	result := SyncResult{ChannelID: targetChannelId, AssetDBID: src.ID, Name: src.Name}
	if src.ChannelID == targetChannelId {
		result.Status = "skipped"
		result.Error = "源渠道与目标渠道相同"
		return result
	}
	if src.SourceURL == "" {
		result.Status = "failed"
		result.Error = "素材缺少源地址，无法同步"
		return result
	}
	if AssetProtocolFactoryFunc == nil {
		result.Status = "failed"
		result.Error = "素材协议未初始化"
		return result
	}

	channel, err := model.GetChannelById(targetChannelId, true)
	if err != nil || channel == nil {
		result.Status = "failed"
		result.Error = "目标渠道不存在"
		return result
	}
	result.ChannelName = channel.Name
	if channel.Status != common.ChannelStatusEnabled {
		result.Status = "failed"
		result.Error = "目标渠道已禁用"
		return result
	}
	if channel.GetOtherSettings().AssetUploadProtocol == "" {
		result.Status = "failed"
		result.Error = "目标渠道未开启素材上传协议"
		return result
	}

	// 幂等预检：目标渠道已有 active 副本则跳过，避免重复上传。
	var existing *model.Asset
	if src.SourceAssetId != nil {
		existing, _ = model.GetAssetBySourceAndChannel(*src.SourceAssetId, targetChannelId)
	} else {
		existing, _ = model.GetAssetByChannelAndSourceURL(targetChannelId, src.SourceURL)
	}
	if existing != nil && existing.Status == model.AssetStatusActive {
		result.Status = "skipped"
		result.AssetID = existing.AssetID
		return result
	}

	protocol, err := AssetProtocolFactoryFunc(channel)
	if err != nil {
		result.Status = "failed"
		result.Error = "协议创建失败: " + err.Error()
		return result
	}

	assetID, groupID, projectName, err := protocol.Upload(src.SourceURL, src.AssetType, src.Name)
	if err != nil {
		common.SysError(fmt.Sprintf("[AssetSync] cross-channel upload failed (asset=%d, target=%d): %v", src.ID, targetChannelId, err))
		result.Status = "failed"
		result.Error = err.Error()
		return result
	}

	target := &model.Asset{
		UserID:        src.UserID,
		ChannelID:     targetChannelId,
		AssetID:       assetID,
		SourceAssetId: src.SourceAssetId,
		Name:          src.Name,
		AssetType:     src.AssetType,
		Status:        model.AssetStatusPending,
		SourceURL:     src.SourceURL,
		GroupID:       groupID,
		ProjectName:   projectName,
	}
	if src.SourceAssetId != nil {
		err = model.UpsertChannelAsset(target)
	} else {
		err = model.UpsertChannelAssetBySourceURL(target)
	}
	if err != nil {
		result.Status = "failed"
		result.Error = "DB 写入失败: " + err.Error()
		return result
	}

	common.SysLog(fmt.Sprintf("[AssetSync] synced asset %d to channel %d (asset_id=%s)", src.ID, targetChannelId, assetID))
	result.Status = "pending"
	result.AssetID = assetID
	return result
}

// SyncAssetsToChannel 批量把源渠道下的素材同步到目标渠道，逐个返回结果。
// 仅处理确属 sourceChannelId 的素材，越权 ID 直接判失败。
func SyncAssetsToChannel(sourceChannelId int, targetChannelId int, assetIds []int64) []SyncResult {
	results := make([]SyncResult, 0, len(assetIds))
	for _, id := range assetIds {
		asset, err := model.GetAssetById(id)
		if err != nil || asset == nil {
			results = append(results, SyncResult{ChannelID: targetChannelId, AssetDBID: id, Status: "failed", Error: "素材不存在"})
			continue
		}
		if asset.ChannelID != sourceChannelId {
			results = append(results, SyncResult{ChannelID: targetChannelId, AssetDBID: id, Name: asset.Name, Status: "failed", Error: "素材不属于所选源渠道"})
			continue
		}
		results = append(results, SyncAssetToChannel(asset, targetChannelId))
	}
	return results
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
