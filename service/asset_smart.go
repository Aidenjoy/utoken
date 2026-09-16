package service

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// 智能素材引用解析：把 asset://yun-<源素材ID> 转换为「当前模型可用渠道」上
// 的真实上游素材 ID。上传时素材只落自有 TOS（source_assets），不绑定渠道；
// 视频提交（Distribute）或预热（/pg/source-assets/ensure）时按所选模型挑选
// 渠道、确保副本存在，再由中间件把引用改写为上游 ID 并锁定渠道。
// 两条路径共用本文件的解析逻辑，避免两套实现漂移。

// SmartAssetRefPrefix 智能素材引用 ID 前缀（完整引用形如 asset://yun-123）。
// 上游素材 ID 不带该前缀，解析时按前缀分流。
const SmartAssetRefPrefix = "yun-"

// SmartAssetErrorKind 智能素材解析失败类型（middleware/controller 据此翻译用户文案）。
type SmartAssetErrorKind string

const (
	SmartAssetNotFound          SmartAssetErrorKind = "not_found"
	SmartAssetNoModelChannel    SmartAssetErrorKind = "no_model_channel"
	SmartAssetNoProtocolChannel SmartAssetErrorKind = "no_protocol_channel"
	SmartAssetSyncFailed        SmartAssetErrorKind = "sync_failed"
)

// SmartAssetError 带类型的解析失败错误。
type SmartAssetError struct {
	Kind   SmartAssetErrorKind
	Ref    string
	Detail string
}

func (e *SmartAssetError) Error() string {
	return fmt.Sprintf("smart asset resolve failed (%s): ref=%s detail=%s", e.Kind, e.Ref, e.Detail)
}

// SmartAssetResolution 单个智能素材引用的解析结果。
type SmartAssetResolution struct {
	Ref             string `json:"ref"`
	SourceAssetId   int64  `json:"source_asset_id"`
	ChannelId       int    `json:"channel_id"`
	UpstreamAssetId string `json:"upstream_asset_id"`
	Status          string `json:"status"` // active / pending / failed
}

// ResolveSmartAssetRefs 解析全部 yun 引用并收敛到同一渠道
// （asset:// 引用会把整个请求锁定到单一渠道，多引用必须同渠道）。
//
// 渠道挑选优先级（候选集 = 分组下启用该模型的渠道 ∩ 已配置素材协议的渠道）：
//  1. 所有引用都有 active 副本的渠道，直接复用；
//  2. 所有引用都已有副本的渠道（pending/failed 交由提交预检以既有文案拦截，不重复上传）；
//  3. 否则取首个候选渠道，缺副本的引用现场调用 syncToChannel 上传，转为 pending，
//     本次提交随后被预检以「审核中」拦截，轮询转 active 后重试即成功。
func ResolveSmartAssetRefs(userId int, refs []string, modelName string, groups []string) ([]*SmartAssetResolution, int, error) {
	if len(refs) == 0 {
		return nil, 0, nil
	}
	sources := make([]*model.SourceAsset, 0, len(refs))
	for _, ref := range refs {
		source, err := loadOwnedSourceAsset(userId, ref)
		if err != nil {
			return nil, 0, err
		}
		sources = append(sources, source)
	}

	candidates := smartAssetCandidateChannels(modelName, groups)
	if len(candidates) == 0 {
		return nil, 0, &SmartAssetError{Kind: SmartAssetNoModelChannel, Ref: refs[0],
			Detail: fmt.Sprintf("no enabled channel serves model %s in groups %v", modelName, groups)}
	}
	protocolChannels := filterAssetProtocolChannels(candidates)
	if len(protocolChannels) == 0 {
		return nil, 0, &SmartAssetError{Kind: SmartAssetNoProtocolChannel, Ref: refs[0],
			Detail: fmt.Sprintf("none of channels %v enabled the asset upload protocol", candidates)}
	}

	// copies[i][channelId] = 第 i 个源素材在该渠道的副本
	copies := make([]map[int]*model.Asset, len(sources))
	for i, source := range sources {
		copies[i] = map[int]*model.Asset{}
		rows, err := model.GetAssetsBySourceAssetId(source.ID)
		if err != nil {
			rows = nil
		}
		for _, row := range rows {
			copies[i][row.ChannelID] = row
		}
	}

	channelId, needSyncIdx := chooseSmartAssetChannel(protocolChannels, copies)
	resolutions := make([]*SmartAssetResolution, 0, len(sources))
	for i, source := range sources {
		res := &SmartAssetResolution{Ref: refs[i], SourceAssetId: source.ID, ChannelId: channelId}
		if row := copies[i][channelId]; row != nil && !needSyncIdx[i] {
			res.UpstreamAssetId = row.AssetID
			res.Status = row.Status
			resolutions = append(resolutions, res)
			continue
		}
		if AssetProtocolFactoryFunc == nil {
			return nil, 0, &SmartAssetError{Kind: SmartAssetSyncFailed, Ref: refs[i], Detail: "素材协议未初始化"}
		}
		result := syncToChannel(source, channelId)
		switch result.Status {
		case "failed":
			return nil, 0, &SmartAssetError{Kind: SmartAssetSyncFailed, Ref: refs[i], Detail: result.Error}
		case "skipped":
			// 并发同步竞态：他处已建 active 副本
			res.Status = model.AssetStatusActive
		default:
			res.Status = result.Status // pending
		}
		res.UpstreamAssetId = result.AssetID
		resolutions = append(resolutions, res)
	}

	common.SysLog(fmt.Sprintf("[SmartAsset] user=%d model=%s refs=%v candidates=%d chosen_channel=%d",
		userId, modelName, refs, len(candidates), channelId))
	return resolutions, channelId, nil
}

// loadOwnedSourceAsset 按 yun-<id> 引用加载源素材并校验归属。
// 不存在与非本人返回同一错误，避免泄露他人素材的存在性。
func loadOwnedSourceAsset(userId int, ref string) (*model.SourceAsset, error) {
	notFound := &SmartAssetError{Kind: SmartAssetNotFound, Ref: ref, Detail: "source asset missing or not owned"}
	id, err := strconv.ParseInt(strings.TrimPrefix(ref, SmartAssetRefPrefix), 10, 64)
	if err != nil || id <= 0 {
		return nil, notFound
	}
	source, err := model.GetSourceAssetById(id)
	if err != nil || source == nil || source.UserID != userId {
		return nil, notFound
	}
	return source, nil
}

// smartAssetCandidateChannels 枚举候选渠道：各分组下启用该模型的渠道并集（升序去重）。
func smartAssetCandidateChannels(modelName string, groups []string) []int {
	seen := map[int]bool{}
	var ids []int
	for _, g := range groups {
		for _, id := range model.GetEnabledChannelIdsForGroupModel(g, modelName) {
			if !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
	}
	sort.Ints(ids)
	return ids
}

// filterAssetProtocolChannels 只保留启用且已配置素材上传协议的渠道
// （协议配置判断与 SyncSourceAssetToChannels 一致）。
func filterAssetProtocolChannels(channelIds []int) []int {
	var result []int
	for _, id := range channelIds {
		channel, err := model.GetChannelById(id, true)
		if err != nil || channel == nil || channel.Status != common.ChannelStatusEnabled {
			continue
		}
		if channel.GetOtherSettings().AssetUploadProtocol == "" {
			continue
		}
		result = append(result, id)
	}
	return result
}

// chooseSmartAssetChannel 把所有引用收敛到同一渠道：优先全 active，其次全有副本；
// 都没有时取首个候选渠道，返回值中 needSync[i]=true 表示第 i 个引用在该渠道缺副本、需现场同步。
func chooseSmartAssetChannel(candidates []int, copies []map[int]*model.Asset) (int, map[int]bool) {
	for _, ch := range candidates {
		allActive := true
		for _, byChannel := range copies {
			row := byChannel[ch]
			if row == nil || row.Status != model.AssetStatusActive {
				allActive = false
				break
			}
		}
		if allActive {
			return ch, nil
		}
	}
	for _, ch := range candidates {
		allCopied := true
		for _, byChannel := range copies {
			if byChannel[ch] == nil {
				allCopied = false
				break
			}
		}
		if allCopied {
			return ch, nil
		}
	}
	ch := candidates[0]
	needSync := map[int]bool{}
	for i, byChannel := range copies {
		if byChannel[ch] == nil {
			needSync[i] = true
		}
	}
	return ch, needSync
}
