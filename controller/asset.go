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
		// 终端性失败（如帧率/参数不合规）留痕，便于运维定位素材为何不再轮询。
		if res.Status == model.AssetStatusFailed {
			common.SysLog(fmt.Sprintf("[Asset] marked failed (asset=%d, upstream_id=%s): %s", a.ID, a.AssetID, res.ErrorMsg))
		}
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

// AdminListChannelAssets 管理员：跨用户列出某渠道下的素材副本，附带归属用户名。
// 状态由后台轮询维护，此处不主动刷新上游，避免跨用户批量拉取造成的上游压力。
func AdminListChannelAssets(c *gin.Context) {
	channelId, err := strconv.Atoi(c.Param("channelId"))
	if err != nil || channelId <= 0 {
		assetJSONError(c, http.StatusBadRequest, "invalid_request", "无效的渠道 ID")
		return
	}
	assets, err := model.GetAssetsByChannel(channelId, 0, 200)
	if err != nil {
		assetJSONError(c, http.StatusInternalServerError, "query_data_error", err.Error())
		return
	}
	userIds := make([]int, 0, len(assets))
	seen := make(map[int]bool, len(assets))
	for _, a := range assets {
		if a.UserID > 0 && !seen[a.UserID] {
			seen[a.UserID] = true
			userIds = append(userIds, a.UserID)
		}
	}
	names, err := model.GetUserNamesByIds(userIds)
	if err != nil {
		names = map[int]string{}
	}
	list := make([]gin.H, 0, len(assets))
	for _, a := range assets {
		list = append(list, gin.H{
			"id":          a.ID,
			"user_id":     a.UserID,
			"username":    names[a.UserID],
			"channel_id":  a.ChannelID,
			"asset_id":    a.AssetID,
			"name":        a.Name,
			"asset_type":  a.AssetType,
			"status":      a.Status,
			"source_url":  a.SourceURL,
			"preview_url": a.PreviewURL,
			"error_msg":   a.ErrorMsg,
			"created_at":  a.CreatedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"assets": list})
}

type adminChannelSyncRequest struct {
	SourceChannelId int     `json:"source_channel_id"`
	TargetChannelId int     `json:"target_channel_id"`
	AssetIds        []int64 `json:"asset_ids"`
}

// adminChannelSyncMaxAssets 单次同步素材上限，防超大请求。
const adminChannelSyncMaxAssets = 200

// AdminSyncChannelAssets 管理员：把源渠道下勾选的素材批量同步到目标渠道。
func AdminSyncChannelAssets(c *gin.Context) {
	var req adminChannelSyncRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		assetJSONError(c, http.StatusBadRequest, "invalid_request", "请求体无效: "+err.Error())
		return
	}
	if req.SourceChannelId <= 0 || req.TargetChannelId <= 0 {
		assetJSONError(c, http.StatusBadRequest, "invalid_request", "source_channel_id 与 target_channel_id 必填")
		return
	}
	if req.SourceChannelId == req.TargetChannelId {
		assetJSONError(c, http.StatusBadRequest, "invalid_request", "源渠道与目标渠道不能相同")
		return
	}
	if len(req.AssetIds) == 0 {
		assetJSONError(c, http.StatusBadRequest, "invalid_request", "请至少选择一个素材")
		return
	}
	if len(req.AssetIds) > adminChannelSyncMaxAssets {
		assetJSONError(c, http.StatusBadRequest, "invalid_request", fmt.Sprintf("单次最多同步 %d 个素材", adminChannelSyncMaxAssets))
		return
	}
	results := service.SyncAssetsToChannel(req.SourceChannelId, req.TargetChannelId, req.AssetIds)
	c.JSON(http.StatusOK, gin.H{"sync_tasks": results})
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

// assetRegisterResult 素材注册结果：渠道素材（Asset 非 nil，已绑定具体渠道）
// 或智能素材（SourceAsset 非 nil，不绑定渠道，提交/预热时自动路由）二者其一。
type assetRegisterResult struct {
	Asset       *model.Asset
	SourceAsset *model.SourceAsset
}

// registerAssetForUser 素材注册核心流程：校验 →（指定渠道）上游注册 /（未指定渠道）登记智能素材。
func registerAssetForUser(userId int, req assetUploadRequest) (*assetRegisterResult, *assetRegisterError) {
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
	// 未指定渠道（channel_id 与 channel 均为空）→ 登记为智能素材：
	// 不绑定渠道，返回 yun-<id> 稳定引用，视频提交/预热时自动路由到服务该模型的渠道并按需同步。
	if req.ChannelId <= 0 && strings.TrimSpace(req.Channel) == "" {
		source, regErr := registerSourceAssetFromURL(userId, req.URL, req.AssetType, req.Name)
		if regErr != nil {
			return nil, regErr
		}
		return &assetRegisterResult{SourceAsset: source}, nil
	}
	channel, err := resolveAssetProtocolChannel(req.ChannelId, req.Channel)
	if err != nil {
		return nil, &assetRegisterError{http.StatusBadRequest, "invalid_request", err.Error()}
	}
	asset, regErr := registerAssetToChannel(userId, channel, req.URL, req.AssetType, req.Name)
	if regErr != nil {
		return nil, regErr
	}
	return &assetRegisterResult{Asset: asset}, nil
}

// registerSourceAssetFromURL 以远程 URL 登记智能素材（源素材，不绑定渠道）。
// 与文件上传路径不同，这里不写 TOS——SourceURL 直接指向调用方提供的公网地址；
// 渠道副本在视频提交/预热时按需通过该 URL 同步（见 service.syncToChannel）。
// 同一用户重复登记同一 URL 幂等复用，避免产生多份智能素材。
func registerSourceAssetFromURL(userId int, url, assetType, name string) (*model.SourceAsset, *assetRegisterError) {
	if existing, err := model.GetSourceAssetByUserAndURL(userId, url); err == nil && existing.ID > 0 {
		return existing, nil
	}
	asset := &model.SourceAsset{
		UserID:    userId,
		Name:      name,
		AssetType: assetType,
		SourceURL: url,
		Status:    model.AssetStatusActive,
	}
	if err := asset.Insert(); err != nil {
		return nil, &assetRegisterError{http.StatusInternalServerError, "insert_error", err.Error()}
	}
	common.SysLog(fmt.Sprintf("[SourceAsset] user %d registered smart asset %d from URL (type=%s)", userId, asset.ID, assetType))
	return asset, nil
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
	result, regErr := registerAssetForUser(userId, req)
	if regErr != nil {
		assetJSONError(c, regErr.status, regErr.typ, regErr.msg)
		return
	}
	// 管理端入口 channel_id 必填，恒为渠道素材。
	c.JSON(http.StatusOK, result.Asset)
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
	result, regErr := registerAssetForUser(userId, req)
	if regErr != nil {
		relayAssetJSON(c, 1, regErr.msg, nil)
		return
	}
	// 智能素材（未指定渠道）：返回 yun-<id> 稳定引用，视频任务中以 asset://yun-<id> 引用，
	// 提交时自动路由到服务该模型的渠道并按需同步。
	if result.SourceAsset != nil {
		relayAssetJSON(c, 0, "ok", gin.H{
			"Id":    service.SmartAssetRefPrefix + strconv.FormatInt(result.SourceAsset.ID, 10),
			"Name":  result.SourceAsset.Name,
			"Smart": true,
		})
		return
	}
	asset := result.Asset
	relayAssetJSON(c, 0, "ok", gin.H{
		"Id":          asset.AssetID,
		"GroupId":     asset.GroupID,
		"ProjectName": asset.ProjectName,
	})
}

// RelayGetAsset 对外（Bearer token）素材状态查询接口，兼容中转站契约：
// GET {base}/api/assets/{id}；pending 时顺带向上游刷新。仅能查询本人素材。
// id 为 yun-<源素材ID> 时按智能素材查询（返回源素材 + 各渠道副本状态）。
func RelayGetAsset(c *gin.Context) {
	userId := c.GetInt("id")
	assetID := c.Param("id")
	if strings.HasPrefix(assetID, service.SmartAssetRefPrefix) {
		relayGetSmartAsset(c, userId, assetID)
		return
	}
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

// relayGetSmartAsset 处理智能素材（yun-<id>）的状态查询：智能素材渠道无关，
// 就绪与否取决于视频提交时自动路由到的那个渠道，故返回源素材本体 + 各渠道副本。
// 汇总 Status：任一副本 active 即 Active；否则有 pending 或尚无副本为 Pending（首次引用时自动同步）；全 failed 为 Failed。
func relayGetSmartAsset(c *gin.Context, userId int, ref string) {
	idStr := strings.TrimPrefix(ref, service.SmartAssetRefPrefix)
	sourceId, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		relayAssetJSON(c, 1, "asset not found", nil)
		return
	}
	source, err := model.GetSourceAssetById(sourceId)
	if err != nil || source.UserID != userId {
		relayAssetJSON(c, 1, "asset not found", nil)
		return
	}
	copies, _ := model.GetAssetsBySourceAssetId(sourceId)
	refreshPendingAssets(copies)

	anyActive, anyPending := false, false
	for _, cp := range copies {
		switch cp.Status {
		case model.AssetStatusActive:
			anyActive = true
		case model.AssetStatusPending:
			anyPending = true
		}
	}
	status := model.AssetStatusFailed
	switch {
	case anyActive:
		status = model.AssetStatusActive
	case anyPending || len(copies) == 0:
		status = model.AssetStatusPending
	}

	channels := make([]gin.H, 0, len(copies))
	for _, cp := range copies {
		channels = append(channels, gin.H{
			"ChannelId": cp.ChannelID,
			"AssetId":   cp.AssetID,
			"Status":    relayAssetStatus(cp.Status),
		})
	}
	relayAssetJSON(c, 0, "ok", gin.H{
		"Id":         ref,
		"Name":       source.Name,
		"AssetType":  source.AssetType,
		"Status":     relayAssetStatus(status),
		"Smart":      true,
		"URL":        source.SourceURL,
		"CreateTime": relayAssetTime(source.CreatedAt),
		"UpdateTime": relayAssetTime(source.UpdatedAt),
		"Channels":   channels,
	})
}

// RelayDeleteAsset 对外（Bearer token）素材删除接口：DELETE {base}/api/assets/{id}。
// 仅删除本地登记记录（TOS 原件与上游素材保留，上游无删除 API）：
// id 为 yun-<源素材ID> 时级联删除其各渠道副本记录后删除源素材登记；
// 否则按上游素材 ID 删除本人渠道素材记录。仅能删除本人素材。
func RelayDeleteAsset(c *gin.Context) {
	userId := c.GetInt("id")
	assetID := c.Param("id")
	if strings.HasPrefix(assetID, service.SmartAssetRefPrefix) {
		relayDeleteSmartAsset(c, userId, assetID)
		return
	}
	deleted, err := model.DeleteAssetsByUserAndAssetID(userId, assetID)
	if err != nil {
		relayAssetJSON(c, 1, err.Error(), nil)
		return
	}
	if deleted == 0 {
		relayAssetJSON(c, 1, "asset not found", nil)
		return
	}
	relayAssetJSON(c, 0, "ok", gin.H{"Id": assetID, "Deleted": true})
}

// relayDeleteSmartAsset 删除智能素材：先级联删除其各渠道副本记录，再删除源素材登记。
// 删除后 yun-<id> 与 asset://yun-<id> 引用均失效；上游素材保留。
func relayDeleteSmartAsset(c *gin.Context, userId int, ref string) {
	idStr := strings.TrimPrefix(ref, service.SmartAssetRefPrefix)
	sourceId, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		relayAssetJSON(c, 1, "asset not found", nil)
		return
	}
	source, err := model.GetSourceAssetById(sourceId)
	if err != nil || source.UserID != userId {
		relayAssetJSON(c, 1, "asset not found", nil)
		return
	}
	if err := model.DeleteAssetsBySourceAssetId(sourceId); err != nil {
		relayAssetJSON(c, 1, err.Error(), nil)
		return
	}
	if err := model.DeleteSourceAssetById(sourceId, userId); err != nil {
		relayAssetJSON(c, 1, err.Error(), nil)
		return
	}
	relayAssetJSON(c, 0, "ok", gin.H{"Id": ref, "Deleted": true})
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

// AdminDeleteChannelAsset 按 ID 删除渠道下的素材副本（管理员；上游无删除 API，远端素材保留）。
func AdminDeleteChannelAsset(c *gin.Context) {
	channelId, err := strconv.Atoi(c.Param("channelId"))
	if err != nil {
		assetJSONError(c, http.StatusBadRequest, "invalid_request", "invalid channel id")
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		assetJSONError(c, http.StatusBadRequest, "invalid_request", "invalid asset id")
		return
	}
	if err := model.AdminDeleteChannelAssetById(channelId, id); err != nil {
		assetJSONError(c, http.StatusNotFound, "not_found", err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
