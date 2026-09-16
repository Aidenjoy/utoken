package middleware

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// 虚拟人像素材库：asset:// 引用解析与渠道锁定。
// 素材 ID 只在注册它的渠道上游有效，因此请求体中出现 asset:// 引用时，
// 必须强制把请求转发到素材所属渠道（全部引用须归属同一渠道且属于当前用户）。

// assetURIRegexp 匹配 content 中的素材引用，如 "asset://asset-20260716111338-vwmxj"
var assetURIRegexp = regexp.MustCompile(`asset://([\w-]+)`)

// ExtractAssetIDs 从请求体原文中提取全部 asset:// 引用（去重、保持出现顺序）。
func ExtractAssetIDs(body []byte) []string {
	matches := assetURIRegexp.FindAllStringSubmatch(string(body), -1)
	if len(matches) == 0 {
		return nil
	}
	ids := make([]string, 0, len(matches))
	seen := make(map[string]bool, len(matches))
	for _, m := range matches {
		if !seen[m[1]] {
			seen[m[1]] = true
			ids = append(ids, m[1])
		}
	}
	return ids
}

// ValidateUserAssetRefs 校验 asset:// 引用的素材归属：
// 全部素材必须已注册在当前用户名下，且归属同一渠道。返回素材所属渠道 ID；
// body 中无引用时返回 0, nil。
func ValidateUserAssetRefs(userId int, assetIDs []string) (int, error) {
	if len(assetIDs) == 0 {
		return 0, nil
	}
	assets, err := model.GetUserAssetsByAssetIDs(userId, assetIDs)
	if err != nil {
		return 0, err
	}
	found := make(map[string]*model.Asset, len(assets))
	for _, a := range assets {
		found[a.AssetID] = a
	}
	for _, id := range assetIDs {
		if _, ok := found[id]; !ok {
			return 0, &AssetLockError{Kind: AssetLockNotFound, Asset: id}
		}
	}
	channelId := found[assetIDs[0]].ChannelID
	for _, id := range assetIDs {
		if found[id].ChannelID != channelId {
			return 0, &AssetLockError{Kind: AssetLockChannelConflict, Asset: id}
		}
	}
	return channelId, nil
}

// AssetLockErrorKind 素材锁定校验失败类型（Distribute 据此返回 i18n 文案）。
type AssetLockErrorKind string

const (
	AssetLockNotFound        AssetLockErrorKind = "asset_not_found"
	AssetLockChannelConflict AssetLockErrorKind = "asset_channel_conflict"
)

type AssetLockError struct {
	Kind  AssetLockErrorKind
	Asset string
}

func (e *AssetLockError) Error() string {
	return fmt.Sprintf("asset lock failed (%s): %s", e.Kind, e.Asset)
}

// ResolveAssetLockedChannelId 读取原始请求体并解析 asset:// 引用：
// 返回应锁定的渠道 ID；无引用返回 0, nil；校验失败返回已 i18n 的错误。
//
// 引用分两类：
//   - 智能素材（yun- 前缀）：按 modelName × 候选分组解析源素材，挑选渠道、
//     必要时现场同步，并把 body 中的 yun 引用改写为真实上游素材 ID；
//   - 渠道素材（上游 ID）：按既有逻辑校验归属与同渠道收敛。
//
// 两类可混用，但最终必须收敛到同一渠道，否则报渠道冲突。
func ResolveAssetLockedChannelId(c *gin.Context, userId int, modelName string, usingGroup string) (int, error) {
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return 0, err
	}
	body, err := storage.Bytes()
	if err != nil {
		return 0, err
	}
	// 复位 body，保证下游 relay 流程可正常重读
	if _, seekErr := storage.Seek(0, io.SeekStart); seekErr != nil {
		return 0, seekErr
	}
	c.Request.Body = io.NopCloser(storage)

	assetIDs := ExtractAssetIDs(body)
	if len(assetIDs) == 0 {
		return 0, nil
	}

	var smartRefs, upstreamRefs []string
	for _, id := range assetIDs {
		if strings.HasPrefix(id, service.SmartAssetRefPrefix) {
			smartRefs = append(smartRefs, id)
		} else {
			upstreamRefs = append(upstreamRefs, id)
		}
	}

	lockedChannelId := 0
	if len(smartRefs) > 0 {
		resolutions, channelId, resolveErr := service.ResolveSmartAssetRefs(
			userId, smartRefs, modelName, smartAssetCandidateGroups(c, usingGroup))
		if resolveErr != nil {
			return 0, translateSmartAssetError(c, resolveErr, modelName, usingGroup)
		}
		mapping := make(map[string]string, len(resolutions))
		for _, r := range resolutions {
			mapping[r.Ref] = r.UpstreamAssetId
		}
		if newBody := rewriteAssetRefs(body, mapping); !bytes.Equal(newBody, body) {
			if replaceErr := common.ReplaceBodyStorage(c, newBody); replaceErr != nil {
				return 0, replaceErr
			}
		}
		lockedChannelId = channelId
	}

	if len(upstreamRefs) > 0 {
		channelId, validateErr := ValidateUserAssetRefs(userId, upstreamRefs)
		if validateErr != nil {
			if lockErr, ok := validateErr.(*AssetLockError); ok {
				return 0, translateAssetLockError(c, lockErr)
			}
			return 0, validateErr
		}
		if lockedChannelId > 0 && channelId != lockedChannelId {
			return 0, translateAssetLockError(c, &AssetLockError{Kind: AssetLockChannelConflict, Asset: upstreamRefs[0]})
		}
		lockedChannelId = channelId
	}
	return lockedChannelId, nil
}

// rewriteAssetRefs 把 body 中的智能素材引用替换为真实上游素材 ID。
// 走正则整段匹配而非字节替换，避免 yun-1 误命中 yun-12 的前缀。
func rewriteAssetRefs(body []byte, mapping map[string]string) []byte {
	if len(mapping) == 0 {
		return body
	}
	return assetURIRegexp.ReplaceAllFunc(body, func(match []byte) []byte {
		id := string(match[len("asset://"):])
		if upstream, ok := mapping[id]; ok {
			return []byte("asset://" + upstream)
		}
		return match
	})
}

// smartAssetCandidateGroups 展开智能素材解析的候选分组：
// 显式分组直接用；空或 auto 按用户自动分组列表（与 selectAssetLockedChannel 语义一致）。
func smartAssetCandidateGroups(c *gin.Context, usingGroup string) []string {
	if usingGroup != "" && usingGroup != "auto" {
		return []string{usingGroup}
	}
	userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
	return service.GetUserAutoGroup(userGroup)
}

func translateSmartAssetError(c *gin.Context, err error, modelName string, usingGroup string) error {
	var smartErr *service.SmartAssetError
	if !errors.As(err, &smartErr) {
		return err
	}
	switch smartErr.Kind {
	case service.SmartAssetNotFound:
		return fmt.Errorf("%s", i18n.T(c, i18n.MsgDistributorAssetNotFound, map[string]any{"Asset": smartErr.Ref}))
	case service.SmartAssetNoModelChannel:
		return fmt.Errorf("%s", i18n.T(c, i18n.MsgDistributorNoAvailableChannel, map[string]any{"Group": usingGroup, "Model": modelName}))
	case service.SmartAssetNoProtocolChannel:
		return fmt.Errorf("%s", i18n.T(c, i18n.MsgDistributorAssetNoProtocolChannel, map[string]any{"Model": modelName}))
	case service.SmartAssetSyncFailed:
		return fmt.Errorf("%s", i18n.T(c, i18n.MsgDistributorAssetSmartSyncFailed, map[string]any{"Ref": smartErr.Ref, "Error": smartErr.Detail}))
	default:
		return err
	}
}

func translateAssetLockError(c *gin.Context, err *AssetLockError) error {
	switch err.Kind {
	case AssetLockNotFound:
		return fmt.Errorf("%s", i18n.T(c, i18n.MsgDistributorAssetNotFound, map[string]any{"Asset": err.Asset}))
	case AssetLockChannelConflict:
		return fmt.Errorf("%s", i18n.T(c, i18n.MsgDistributorAssetChannelConflict))
	default:
		return err
	}
}

// isVideoSubmitPath 仅视频任务提交路径支持 asset:// 素材引用。
func isVideoSubmitPath(path string) bool {
	return strings.HasPrefix(path, "/pg/video/generations") ||
		strings.HasPrefix(path, "/v1/video/generations") ||
		strings.HasPrefix(path, "/api/v3/contents/generations/tasks")
}

// preflightAssetRefsForChannel 在转发前确认请求体引用的素材在目标渠道已就绪。
//
// 素材在某渠道的上游状态有三种：审核中（pending）、审核通过（active）、
// 审核失败（failed）。只有 active 才能用于生成；pending/failed 若直接提交，
// 上游会在任务执行阶段报错，用户已付费却拿不到结果。因此在这里提前拦截并
// 给出明确原因，让用户能及时换素材或换渠道。
//
// 请求体无 asset:// 引用时直接放行。
func preflightAssetRefsForChannel(c *gin.Context, channelId int) error {
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return nil // 读体失败不阻断转发，交由下游处理
	}
	body, err := storage.Bytes()
	if err != nil {
		return nil
	}
	if _, seekErr := storage.Seek(0, io.SeekStart); seekErr != nil {
		return seekErr
	}
	c.Request.Body = io.NopCloser(storage)

	assetIDs := ExtractAssetIDs(body)
	if len(assetIDs) == 0 {
		return nil
	}

	// 复用 service 层的前置检查：按「渠道 × 上游素材 ID」查副本状态。
	check := service.CheckAssetsByUpstreamIDs(channelId, assetIDs)
	if check.Passed {
		return nil
	}
	if len(check.Issues) == 0 {
		return fmt.Errorf("%s", i18n.T(c, i18n.MsgDistributorAssetNotReady))
	}
	// 只回报首个问题，避免错误信息过长淹没重点
	return fmt.Errorf("%s", check.Issues[0].Detail)
}

// selectAssetLockedChannel 校验锁定渠道在当前分组下可用：
// 渠道启用、支持请求路径，且在当前分组（auto 时逐个候选分组）下启用所请求模型。
func selectAssetLockedChannel(c *gin.Context, channelId int, modelName string, usingGroup string) (*model.Channel, string, error) {
	unavailable := func() error {
		return fmt.Errorf("%s", i18n.T(c, i18n.MsgDistributorAssetChannelUnavailable, map[string]any{
			"Channel": channelId, "Model": modelName,
		}))
	}
	locked, err := model.GetChannelById(channelId, true)
	if err != nil || locked.Status != common.ChannelStatusEnabled || !channelSupportsRequestPath(locked, c.Request.URL.Path) {
		return nil, "", unavailable()
	}
	if usingGroup == "auto" {
		userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
		for _, g := range service.GetUserAutoGroup(userGroup) {
			if model.IsChannelEnabledForGroupModel(g, modelName, locked.Id) {
				common.SetContextKey(c, constant.ContextKeyAutoGroup, g)
				return locked, g, nil
			}
		}
		return nil, "", unavailable()
	}
	if !model.IsChannelEnabledForGroupModel(usingGroup, modelName, locked.Id) {
		return nil, "", unavailable()
	}
	return locked, usingGroup, nil
}
