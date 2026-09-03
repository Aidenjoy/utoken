package controller

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
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

// assetProtocolFor 按渠道缓存协议适配器，渠道不可用或构造失败时记入 channelErrs 避免重试。
func assetProtocolFor(channelID int, protocols map[int]assetrelay.Protocol, channelErrs map[int]bool) assetrelay.Protocol {
	if proto, ok := protocols[channelID]; ok {
		return proto
	}
	if channelErrs[channelID] {
		return nil
	}
	channel, err := model.GetChannelById(channelID, true)
	if err != nil || channel.Status != common.ChannelStatusEnabled {
		channelErrs[channelID] = true
		return nil
	}
	proto, err := assetrelay.NewProtocol(buildAssetChannelConfig(channel))
	if err != nil {
		channelErrs[channelID] = true
		return nil
	}
	protocols[channelID] = proto
	return proto
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
		proto := assetProtocolFor(a.ChannelID, protocols, channelErrs)
		if proto == nil {
			continue
		}
		res, err := proto.Query(a.AssetID)
		if err != nil {
			common.SysLog(fmt.Sprintf("[Asset] refresh failed (asset=%d, upstream_id=%s): %v", a.ID, a.AssetID, err))
			continue
		}
		// 上游预览链接带签名时效，落库前转存自有 TOS 换永久地址
		preview := mirrorAssetPreviewToTOS(a, res.PreviewURL)
		_ = model.UpdateAssetStatus(a.ID, res.Status, preview, res.ErrorMsg)
		a.Status = res.Status
		if preview != "" {
			a.PreviewURL = preview
		}
		a.ErrorMsg = res.ErrorMsg
	}
}

// remirrorExternalPreviews 修复历史素材：active 但预览地址仍是上游临时链接（会过期）时，
// 重新向上游取新鲜链接并转存自有 TOS，把永久地址回写预览字段。
// TOS 未配置时跳过（临时链接已是唯一可用地址）。
func remirrorExternalPreviews(assets []*model.Asset) {
	if _, ok := common.GetTOSUploadConfig(); !ok {
		return
	}
	protocols := map[int]assetrelay.Protocol{}
	channelErrs := map[int]bool{}
	for _, a := range assets {
		if a.Status != model.AssetStatusActive || a.PreviewURL == "" || isOwnTOSURL(a.PreviewURL) {
			continue
		}
		if !shouldRefreshAsset(a.ID) {
			continue
		}
		proto := assetProtocolFor(a.ChannelID, protocols, channelErrs)
		if proto == nil {
			continue
		}
		res, err := proto.Query(a.AssetID)
		if err != nil || res.PreviewURL == "" {
			common.SysLog(fmt.Sprintf("[Asset] remirror query failed (asset=%d, upstream_id=%s): %v", a.ID, a.AssetID, err))
			continue
		}
		mirrored := mirrorAssetPreviewToTOS(a, res.PreviewURL)
		if mirrored == res.PreviewURL {
			continue
		}
		if err := model.UpdateAssetStatus(a.ID, a.Status, mirrored, a.ErrorMsg); err != nil {
			common.SysLog(fmt.Sprintf("[Asset] remirror persist failed (asset=%d): %v", a.ID, err))
			continue
		}
		a.PreviewURL = mirrored
	}
}

// isOwnTOSURL 判断地址是否已落在自有 TOS 桶上（避免重复转存）。
func isOwnTOSURL(rawURL string) bool {
	cfg, ok := common.GetTOSUploadConfig()
	if !ok {
		return false
	}
	endpointHost := strings.TrimPrefix(cfg.Endpoint, "https://")
	endpointHost = strings.TrimPrefix(endpointHost, "http://")
	return strings.HasPrefix(rawURL, fmt.Sprintf("https://%s.%s/", cfg.Bucket, endpointHost))
}

// mirrorAssetPreviewToTOS 把上游返回的临时预览链接转存到自有 TOS，返回永久可访问地址；
// 已是自有地址、TOS 未配置或转存失败时原样返回上游链接。
func mirrorAssetPreviewToTOS(a *model.Asset, remoteURL string) string {
	if remoteURL == "" || isOwnTOSURL(remoteURL) {
		return remoteURL
	}
	if _, ok := common.GetTOSUploadConfig(); !ok {
		return remoteURL
	}
	client := &http.Client{Timeout: 300 * time.Second}
	resp, err := client.Get(remoteURL)
	if err != nil {
		common.SysLog(fmt.Sprintf("[Asset] mirror download failed (asset=%d): %v", a.ID, err))
		return remoteURL
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		common.SysLog(fmt.Sprintf("[Asset] mirror download failed (asset=%d): HTTP %d", a.ID, resp.StatusCode))
		return remoteURL
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 512<<20))
	if err != nil {
		common.SysLog(fmt.Sprintf("[Asset] mirror read failed (asset=%d): %v", a.ID, err))
		return remoteURL
	}
	filename := fmt.Sprintf("asset%d_%d%s", a.ID, time.Now().Unix(), assetPreviewExt(a, remoteURL))
	ownURL, _, err := common.UploadBytesToTOS(data, filename, a.UserID, "assets")
	if err != nil {
		common.SysLog(fmt.Sprintf("[Asset] mirror upload failed (asset=%d): %v", a.ID, err))
		return remoteURL
	}
	return ownURL
}

// assetPreviewExt 转存文件名扩展名：优先取上游链接路径后缀，缺失时按素材类型兜底
func assetPreviewExt(a *model.Asset, remoteURL string) string {
	if u, err := url.Parse(remoteURL); err == nil {
		if ext := path.Ext(u.Path); ext != "" && len(ext) <= 8 {
			return ext
		}
	}
	switch a.AssetType {
	case model.AssetTypeVideo:
		return ".mp4"
	case model.AssetTypeAudio:
		return ".mp3"
	default:
		return ".png"
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

// resolveAssetProtocolChannelForModel 在开启了素材协议的启用渠道中，选出在指定分组下
// 可服务该模型的渠道（优先级高者优先）。云导演按「模型设置」的视频模型定位素材渠道时使用。
func resolveAssetProtocolChannelForModel(group, modelName string) (*model.Channel, error) {
	channels, err := model.GetEnabledChannels()
	if err != nil {
		return nil, err
	}
	var picked *model.Channel
	availableNames := make([]string, 0, len(channels))
	for _, channel := range channels {
		if channel.GetOtherSettings().AssetUploadProtocol == "" {
			continue
		}
		availableNames = append(availableNames, channel.Name)
		if !model.IsChannelEnabledForGroupModel(group, modelName, channel.Id) {
			continue
		}
		if picked == nil || channel.GetPriority() > picked.GetPriority() {
			picked = channel
		}
	}
	if picked == nil {
		if len(availableNames) == 0 {
			return nil, fmt.Errorf("no available channel enables an asset upload protocol")
		}
		return nil, fmt.Errorf("no asset channel can serve model %q in group %q (asset channels: %s)", modelName, group, strings.Join(availableNames, ", "))
	}
	return picked, nil
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
	// 上游要求素材名称非空：未传时取 URL 末段作为默认名，仍为空则用时间戳兜底
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		if i := strings.LastIndex(req.URL, "/"); i+1 < len(req.URL) {
			req.Name = req.URL[i+1:]
		}
		if q := strings.IndexByte(req.Name, '?'); q >= 0 {
			req.Name = req.Name[:q]
		}
	}
	if req.Name == "" {
		req.Name = fmt.Sprintf("asset-%d", time.Now().Unix())
	}
	channel, err := resolveAssetProtocolChannel(req.ChannelId, req.Channel)
	if err != nil {
		return nil, &assetRegisterError{http.StatusBadRequest, "invalid_request", err.Error()}
	}
	return registerAssetToChannel(userId, channel, req.URL, req.AssetType, req.Name)
}

// registerAssetToChannel 向指定渠道注册素材：上游注册 → 组 ID 回写 → 复用/落库。
// 调用方需已完成 URL/类型/名称校验与渠道选择。
func registerAssetToChannel(userId int, channel *model.Channel, url, assetType, name string) (*model.Asset, *assetRegisterError) {
	proto, err := assetrelay.NewProtocol(buildAssetChannelConfig(channel))
	if err != nil {
		return nil, &assetRegisterError{http.StatusBadRequest, "invalid_request", err.Error()}
	}

	res, err := proto.Upload(assetrelay.UploadRequest{
		URL:       url,
		AssetType: assetType,
		Name:      name,
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
		Name:        name,
		AssetType:   assetType,
		Status:      model.AssetStatusPending,
		SourceURL:   url,
		GroupID:     res.GroupID,
		ProjectName: res.ProjectName,
	}
	if err := asset.Insert(); err != nil {
		return nil, &assetRegisterError{http.StatusInternalServerError, "insert_error", err.Error()}
	}
	common.SysLog(fmt.Sprintf("[Asset] user %d registered asset %s (channel=%d, type=%s)", userId, res.AssetID, channel.Id, assetType))
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
	remirrorExternalPreviews([]*model.Asset{asset})
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
	remirrorExternalPreviews(assets)

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
	remirrorExternalPreviews([]*model.Asset{asset})
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
