package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	assetrelay "github.com/QuantumNous/new-api/relay/channel/asset"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// 虚拟人像素材库用户 API（/pg/assets/*，UserAuth）。
// 素材与「用户 × 渠道」绑定：asset://<上游ID> 只在注册它的渠道上游有效。

const assetRefreshDebounceSeconds = 10

var (
	assetRefreshMu     sync.Mutex
	assetLastRefreshAt = map[int64]int64{}
)

func assetJSONError(c *gin.Context, status int, typ string, msg string) {
	c.JSON(status, gin.H{
		"error": gin.H{
			"message": msg,
			"type":    typ,
		},
	})
}

// buildAssetChannelConfig 从渠道记录构造协议适配器所需的配置。
func buildAssetChannelConfig(channel *model.Channel) assetrelay.ChannelConfig {
	return assetrelay.ChannelConfig{
		BaseURL:  channel.GetBaseURL(),
		ApiKey:   channel.Key,
		Proxy:    channel.GetSetting().Proxy,
		Settings: channel.GetOtherSettings(),
	}
}

// shouldRefreshAsset 进程内防抖：同一素材 10s 内只向上游查询一次。
func shouldRefreshAsset(id int64) bool {
	assetRefreshMu.Lock()
	defer assetRefreshMu.Unlock()
	now := time.Now().Unix()
	if last, ok := assetLastRefreshAt[id]; ok && now-last < assetRefreshDebounceSeconds {
		return false
	}
	assetLastRefreshAt[id] = now
	return true
}

// refreshPendingAssets 对非终态（pending）素材向上游刷新状态，按渠道缓存协议适配器。
func refreshPendingAssets(assets []*model.Asset) {
	protocols := map[int]assetrelay.Protocol{}
	channelErrs := map[int]bool{}
	for _, a := range assets {
		if a.Status != model.AssetStatusPending {
			continue
		}
		if !shouldRefreshAsset(a.ID) {
			continue
		}
		proto, ok := protocols[a.ChannelID]
		if !ok && !channelErrs[a.ChannelID] {
			channel, err := model.GetChannelById(a.ChannelID, true)
			if err != nil || channel.Status != common.ChannelStatusEnabled {
				channelErrs[a.ChannelID] = true
				continue
			}
			proto, err = assetrelay.NewProtocol(buildAssetChannelConfig(channel))
			if err != nil {
				channelErrs[a.ChannelID] = true
				continue
			}
			protocols[a.ChannelID] = proto
		}
		if proto == nil {
			continue
		}
		res, err := proto.Query(a.AssetID)
		if err != nil {
			common.SysLog(fmt.Sprintf("[Asset] refresh failed (asset=%d, upstream_id=%s): %v", a.ID, a.AssetID, err))
			continue
		}
		_ = model.UpdateAssetStatus(a.ID, res.Status, res.PreviewURL, res.ErrorMsg)
		a.Status = res.Status
		if res.PreviewURL != "" {
			a.PreviewURL = res.PreviewURL
		}
		a.ErrorMsg = res.ErrorMsg
	}
}

// GetAssetProviders 返回开启了素材协议的启用渠道（仅 id/name/protocol，不暴露 key）。
func GetAssetProviders(c *gin.Context) {
	channels, err := model.GetEnabledChannels()
	if err != nil {
		assetJSONError(c, http.StatusInternalServerError, "query_data_error", err.Error())
		return
	}
	providers := make([]gin.H, 0)
	for _, channel := range channels {
		protocol := channel.GetOtherSettings().AssetUploadProtocol
		if protocol == "" {
			continue
		}
		providers = append(providers, gin.H{
			"id":       channel.Id,
			"name":     channel.Name,
			"protocol": protocol,
		})
	}
	c.JSON(http.StatusOK, gin.H{"providers": providers})
}

type assetUploadRequest struct {
	ChannelId int    `json:"channel_id"`
	Channel   string `json:"channel"` // 渠道名称（对外 API 用名称代替数字 ID，便于记忆）
	URL       string `json:"url"`
	AssetType string `json:"asset_type"`
	Name      string `json:"name"`
}

// assetRegisterError 承载注册失败信息，管理端 API 与对外 API 各自映射响应格式。
type assetRegisterError struct {
	status int
	typ    string
	msg    string
}

// resolveAssetProtocolChannel 按 channel_id 或渠道名称（均可选）解析开启了素材协议的启用渠道；
// 均未传时仅当唯一可用渠道时自动选择，否则报错并列出可用渠道名称。
func resolveAssetProtocolChannel(channelId int, channelName string) (*model.Channel, error) {
	channels, err := model.GetEnabledChannels()
	if err != nil {
		return nil, err
	}
	available := make([]*model.Channel, 0, len(channels))
	for _, channel := range channels {
		if channel.GetOtherSettings().AssetUploadProtocol != "" {
			available = append(available, channel)
		}
	}
	availableNames := make([]string, 0, len(available))
	for _, channel := range available {
		availableNames = append(availableNames, channel.Name)
	}

	if channelId > 0 {
		for _, channel := range available {
			if channel.Id == channelId {
				return channel, nil
			}
		}
		return nil, fmt.Errorf("channel %d not found or does not enable any asset upload protocol (available: %s)", channelId, strings.Join(availableNames, ", "))
	}
	if channelName != "" {
		var picked *model.Channel
		for _, channel := range available {
			if channel.Name != channelName {
				continue
			}
			if picked != nil {
				return nil, fmt.Errorf("multiple asset channels named %q, please rename one (available: %s)", channelName, strings.Join(availableNames, ", "))
			}
			picked = channel
		}
		if picked == nil {
			return nil, fmt.Errorf("no asset channel named %q (available: %s)", channelName, strings.Join(availableNames, ", "))
		}
		return picked, nil
	}
	if len(available) == 0 {
		return nil, fmt.Errorf("no available channel enables an asset upload protocol")
	}
	if len(available) > 1 {
		return nil, fmt.Errorf("multiple asset channels are available, please specify channel name (available: %s)", strings.Join(availableNames, ", "))
	}
	return available[0], nil
}

// registerAssetForUser 素材注册核心流程：校验 → 上游注册 → 组 ID 回写 → 复用/落库。
func registerAssetForUser(userId int, req assetUploadRequest) (*model.Asset, *assetRegisterError) {
	req.URL = strings.TrimSpace(req.URL)
	if !model.IsValidAssetType(req.AssetType) {
		return nil, &assetRegisterError{http.StatusBadRequest, "invalid_request", "asset_type must be one of Image/Video/Audio"}
	}
	if !strings.HasPrefix(req.URL, "http://") && !strings.HasPrefix(req.URL, "https://") {
		return nil, &assetRegisterError{http.StatusBadRequest, "invalid_request", "url must be a public http(s) URL"}
	}
	channel, err := resolveAssetProtocolChannel(req.ChannelId, req.Channel)
	if err != nil {
		return nil, &assetRegisterError{http.StatusBadRequest, "invalid_request", err.Error()}
	}
	proto, err := assetrelay.NewProtocol(buildAssetChannelConfig(channel))
	if err != nil {
		return nil, &assetRegisterError{http.StatusBadRequest, "invalid_request", err.Error()}
	}

	res, err := proto.Upload(assetrelay.UploadRequest{
		URL:       req.URL,
		AssetType: req.AssetType,
		Name:      req.Name,
	})
	if err != nil {
		common.SysError(fmt.Sprintf("[Asset] upload failed (user=%d, channel=%d): %v", userId, channel.Id, err))
		return nil, &assetRegisterError{http.StatusBadGateway, "upstream_error", err.Error()}
	}

	// 渠道未配置素材组时适配器会自动创建默认组，这里把组 ID 回写渠道配置以便后续复用
	if res.CreatedGroupID != "" {
		if err := persistAssetGroupID(channel, res.CreatedGroupID); err != nil {
			common.SysError(fmt.Sprintf("[Asset] persist auto-created asset group failed (channel=%d, group=%s): %v", channel.Id, res.CreatedGroupID, err))
		}
	}

	// 同一渠道的上游 ID 全局唯一：重复注册直接复用已有记录
	if existing, err := model.GetAssetByChannelAndAssetID(channel.Id, res.AssetID); err == nil && existing.ID > 0 {
		if existing.UserID != userId {
			return nil, &assetRegisterError{http.StatusConflict, "conflict", "this asset is already registered by another user"}
		}
		return existing, nil
	}

	asset := &model.Asset{
		UserID:      userId,
		ChannelID:   channel.Id,
		AssetID:     res.AssetID,
		Name:        req.Name,
		AssetType:   req.AssetType,
		Status:      model.AssetStatusPending,
		SourceURL:   req.URL,
		GroupID:     res.GroupID,
		ProjectName: res.ProjectName,
	}
	if err := asset.Insert(); err != nil {
		return nil, &assetRegisterError{http.StatusInternalServerError, "insert_error", err.Error()}
	}
	common.SysLog(fmt.Sprintf("[Asset] user %d registered asset %s (channel=%d, type=%s)", userId, res.AssetID, channel.Id, req.AssetType))
	return asset, nil
}

// UploadAsset 管理端（会话鉴权）注册素材入口，channel_id 必填。
func UploadAsset(c *gin.Context) {
	userId := c.GetInt("id")
	var req assetUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		assetJSONError(c, http.StatusBadRequest, "invalid_request", "invalid request body: "+err.Error())
		return
	}
	if req.ChannelId <= 0 {
		assetJSONError(c, http.StatusBadRequest, "invalid_request", "channel_id is required")
		return
	}
	asset, regErr := registerAssetForUser(userId, req)
	if regErr != nil {
		assetJSONError(c, regErr.status, regErr.typ, regErr.msg)
		return
	}
	c.JSON(http.StatusOK, asset)
}

// relayAssetJSON 中转站风格对外信封：{"code":0,"message":"ok","data":...}，code 非 0 即失败。
func relayAssetJSON(c *gin.Context, code int, msg string, data gin.H) {
	body := gin.H{"code": code, "message": msg}
	if data != nil {
		body["data"] = data
	}
	c.JSON(http.StatusOK, body)
}

// relayAssetStatus 本地三态映射为中转站风格状态文案（首字母大写，与 ctaigw 一致）。
func relayAssetStatus(status string) string {
	switch status {
	case model.AssetStatusActive:
		return "Active"
	case model.AssetStatusFailed:
		return "Failed"
	default:
		return "Pending"
	}
}

func relayAssetTime(ts int64) string {
	return time.Unix(ts, 0).UTC().Format("2006-01-02T15:04:05Z")
}

// RelayUploadAsset 对外（Bearer token）素材注册接口，兼容中转站契约：
// POST {base}/api/assets/upload，body {url, asset_type, name[, channel_id]}。
// 挂载路径与 ctaigw 一致，使本站可作为下级网关的素材协议中转上游。
func RelayUploadAsset(c *gin.Context) {
	userId := c.GetInt("id")
	var req assetUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		relayAssetJSON(c, 1, "invalid request body: "+err.Error(), nil)
		return
	}
	asset, regErr := registerAssetForUser(userId, req)
	if regErr != nil {
		relayAssetJSON(c, 1, regErr.msg, nil)
		return
	}
	relayAssetJSON(c, 0, "ok", gin.H{
		"Id":          asset.AssetID,
		"GroupId":     asset.GroupID,
		"ProjectName": asset.ProjectName,
	})
}

// RelayGetAsset 对外（Bearer token）素材状态查询接口，兼容中转站契约：
// GET {base}/api/assets/{id}；pending 时顺带向上游刷新。仅能查询本人素材。
func RelayGetAsset(c *gin.Context) {
	userId := c.GetInt("id")
	assetID := c.Param("id")
	assets, err := model.GetUserAssetsByAssetIDs(userId, []string{assetID})
	if err != nil || len(assets) == 0 {
		relayAssetJSON(c, 1, "asset not found", nil)
		return
	}
	asset := assets[0]
	refreshPendingAssets([]*model.Asset{asset})
	relayAssetJSON(c, 0, "ok", gin.H{
		"Id":          asset.AssetID,
		"Name":        asset.Name,
		"GroupId":     asset.GroupID,
		"ProjectName": asset.ProjectName,
		"AssetType":   asset.AssetType,
		"Status":      relayAssetStatus(asset.Status),
		"URL":         asset.PreviewURL,
		"CreateTime":  relayAssetTime(asset.CreatedAt),
		"UpdateTime":  relayAssetTime(asset.UpdatedAt),
	})
}

// persistAssetGroupID 将自动创建的默认素材组 ID 回写到渠道 other settings。
func persistAssetGroupID(channel *model.Channel, groupID string) error {
	settings := channel.GetOtherSettings()
	settings.AssetGroupID = groupID
	channel.SetOtherSettings(settings)
	return model.DB.Model(&model.Channel{}).Where("id = ?", channel.Id).
		Updates(map[string]interface{}{"settings": channel.OtherSettings}).Error
}

// ListAssets 列出本人素材（?channel_id= 过滤），pending 素材顺带向上游刷新状态。
// ?model=（可选 ?group=）进一步过滤：素材只在注册它的渠道上游有效，
// 因此仅返回渠道在当前分组（或用户可用分组）下支持该模型的素材。
func ListAssets(c *gin.Context) {
	userId := c.GetInt("id")
	channelId, _ := strconv.Atoi(c.Query("channel_id"))
	assets, err := model.GetUserAssets(userId, channelId, 0, 100)
	if err != nil {
		assetJSONError(c, http.StatusInternalServerError, "query_data_error", err.Error())
		return
	}
	refreshPendingAssets(assets)

	if modelName := c.Query("model"); modelName != "" {
		groups := []string{}
		if group := c.Query("group"); group != "" {
			groups = append(groups, group)
		} else {
			userGroup, _ := model.GetUserGroup(userId, false)
			for g := range service.GetUserUsableGroups(userGroup) {
				groups = append(groups, g)
			}
		}
		filtered := make([]*model.Asset, 0, len(assets))
		for _, a := range assets {
			if model.IsChannelEnabledForAnyGroupModel(groups, modelName, a.ChannelID) {
				filtered = append(filtered, a)
			}
		}
		assets = filtered
	}

	c.JSON(http.StatusOK, gin.H{"assets": assets})
}

// GetAsset 获取单个素材详情（校验归属），pending 时顺带刷新。
func GetAsset(c *gin.Context) {
	userId := c.GetInt("id")
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		assetJSONError(c, http.StatusBadRequest, "invalid_request", "invalid asset id")
		return
	}
	asset, err := model.GetAssetById(id)
	if err != nil || asset.UserID != userId {
		assetJSONError(c, http.StatusNotFound, "not_found", "asset not found")
		return
	}
	refreshPendingAssets([]*model.Asset{asset})
	c.JSON(http.StatusOK, asset)
}

// DeleteAsset 删除本地素材记录（上游无删除 API，远端素材保留）。
func DeleteAsset(c *gin.Context) {
	userId := c.GetInt("id")
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		assetJSONError(c, http.StatusBadRequest, "invalid_request", "invalid asset id")
		return
	}
	if _, err := model.DeleteAssetById(id, userId); err != nil {
		assetJSONError(c, http.StatusNotFound, "not_found", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
