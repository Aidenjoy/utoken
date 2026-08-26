package middleware

import (
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
func ResolveAssetLockedChannelId(c *gin.Context, userId int) (int, error) {
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
	channelId, err := ValidateUserAssetRefs(userId, assetIDs)
	if err != nil {
		if lockErr, ok := err.(*AssetLockError); ok {
			return 0, translateAssetLockError(c, lockErr)
		}
		return 0, err
	}
	return channelId, nil
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
