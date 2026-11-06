package controller

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	assetrelay "github.com/QuantumNous/new-api/relay/channel/asset"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// 火山方舟官方兼容素材库 API（1:1）：POST /?Action=<Action>&Version=2024-01-01。
// 鉴权走 ArkAssetV4Auth（AK/SK V4 签名），userId 由中间件写入上下文。
//
// 两条铁律：
//  1. 归属隔离——所有 Get/Update/Delete 先按 UserID 查本地记录，未命中或不属于该用户一律
//     返回 NotFound，即使该 ID 在上游存在也不返回，杜绝跨租户读取。
//  2. 列表本地优先——List/Get 只读本站数据库；上游仅用于 Create/Update/Delete 与 pending 刷新。

// 官方状态词表（与上游一致）；本地三态经 arkOfficialStatus 映射到此。
const (
	arkStatusActive     = "Active"
	arkStatusProcessing = "Processing"
	arkStatusFailed     = "Failed"

	arkModerationStrategyDefault = "Default"
)

// 官方 Action 名称。
const (
	arkActionCreateAssetGroup = "CreateAssetGroup"
	arkActionCreateAsset      = "CreateAsset"
	arkActionListAssetGroups  = "ListAssetGroups"
	arkActionListAssets       = "ListAssets"
	arkActionGetAsset         = "GetAsset"
	arkActionGetAssetGroup    = "GetAssetGroup"
	arkActionUpdateAsset      = "UpdateAsset"
	arkActionUpdateAssetGroup = "UpdateAssetGroup"
	arkActionDeleteAsset      = "DeleteAsset"
	arkActionDeleteAssetGroup = "DeleteAssetGroup"
)

// ---- 请求 DTO（可选标量用指针 + omitempty，保留显式零值语义）----

type arkAssetFilter struct {
	GroupIds  []string `json:"GroupIds,omitempty"`
	GroupType *string  `json:"GroupType,omitempty"`
	Statuses  []string `json:"Statuses,omitempty"`
	Name      *string  `json:"Name,omitempty"`
}

type arkListReq struct {
	Filter     *arkAssetFilter `json:"Filter,omitempty"`
	MaxResults *int            `json:"MaxResults,omitempty"`
	SortBy     *string         `json:"SortBy,omitempty"`
	SortOrder  *string         `json:"SortOrder,omitempty"`
	NextToken  *string         `json:"NextToken,omitempty"`
	PageNumber *int            `json:"PageNumber,omitempty"`
	PageSize   *int            `json:"PageSize,omitempty"`
}

type arkCreateAssetGroupReq struct {
	Name        *string `json:"Name,omitempty"`
	Description *string `json:"Description,omitempty"`
	GroupType   *string `json:"GroupType,omitempty"`
	ProjectName *string `json:"ProjectName,omitempty"`
}

type arkCreateAssetReq struct {
	GroupId     *string `json:"GroupId,omitempty"`
	URL         *string `json:"URL,omitempty"`
	AssetType   *string `json:"AssetType,omitempty"`
	Name        *string `json:"Name,omitempty"`
	ProjectName *string `json:"ProjectName,omitempty"`
}

// arkIdReq 覆盖 Get/Update/Delete 六个 Action：均以 Id 定位，Update 附带可选改名/描述字段。
type arkIdReq struct {
	Id          *string `json:"Id,omitempty"`
	Name        *string `json:"Name,omitempty"`
	Description *string `json:"Description,omitempty"`
	ProjectName *string `json:"ProjectName,omitempty"`
}

// ---- 响应体（Result 内的素材/组条目，字段严格按官方）----

type arkModeration struct {
	Strategy string `json:"Strategy"`
}

type arkAssetItem struct {
	Id          string        `json:"Id"`
	Name        string        `json:"Name"`
	AssetType   string        `json:"AssetType"`
	CreateTime  string        `json:"CreateTime"`
	UpdateTime  string        `json:"UpdateTime"`
	ProjectName string        `json:"ProjectName"`
	URL         string        `json:"URL"`
	GroupId     string        `json:"GroupId"`
	Status      string        `json:"Status"`
	Moderation  arkModeration `json:"Moderation"`
}

type arkAssetGroupItem struct {
	Id          string `json:"Id"`
	Name        string `json:"Name"`
	Description string `json:"Description"`
	GroupType   string `json:"GroupType"`
	ProjectName string `json:"ProjectName"`
	CreateTime  string `json:"CreateTime"`
	UpdateTime  string `json:"UpdateTime"`
}

// ---- 信封与工具 ----

func arkOK(c *gin.Context, action, region string, result any) {
	c.JSON(http.StatusOK, assetrelay.OfficialSuccessEnvelope(action, region, result))
}

// arkErr 以官方错误信封响应；CodeN 用 HTTP 状态码填充（本站无官方完整 CodeN 映射，
// 下游 SDK 依据 Code 字符串判定错误类型）。
func arkErr(c *gin.Context, action, region string, httpStatus int, code, msg string) {
	c.JSON(httpStatus, assetrelay.OfficialErrorEnvelope(action, region, httpStatus, code, msg))
}

func arkDeref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func arkDerefInt(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}

// arkOfficialStatus 本地三态 → 官方词表（active→Active、pending→Processing、failed→Failed）。
func arkOfficialStatus(status string) string {
	switch status {
	case model.AssetStatusActive:
		return arkStatusActive
	case model.AssetStatusFailed:
		return arkStatusFailed
	default:
		return arkStatusProcessing
	}
}

// arkLocalStatuses 官方词表 → 本地态，供 ListAssets 的 Statuses 过滤入参转换。
func arkLocalStatuses(official []string) []string {
	if len(official) == 0 {
		return nil
	}
	local := make([]string, 0, len(official))
	for _, s := range official {
		switch strings.ToLower(strings.TrimSpace(s)) {
		case "active":
			local = append(local, model.AssetStatusActive)
		case "failed":
			local = append(local, model.AssetStatusFailed)
		case "processing", "pending":
			local = append(local, model.AssetStatusPending)
		}
	}
	return local
}

// arkAssetURL 素材可访问地址：优先上游返回（可能已转存 TOS）的 PreviewURL，缺失时回落用户注册 URL。
func arkAssetURL(a *model.Asset) string {
	if a.PreviewURL != "" {
		return a.PreviewURL
	}
	return a.SourceURL
}

func newArkAssetItem(a *model.Asset) arkAssetItem {
	return arkAssetItem{
		Id:          a.AssetID,
		Name:        a.Name,
		AssetType:   a.AssetType,
		CreateTime:  relayAssetTime(a.CreatedAt),
		UpdateTime:  relayAssetTime(a.UpdatedAt),
		ProjectName: a.ProjectName,
		URL:         arkAssetURL(a),
		GroupId:     a.GroupID,
		Status:      arkOfficialStatus(a.Status),
		Moderation:  arkModeration{Strategy: arkModerationStrategyDefault},
	}
}

func newArkAssetGroupItem(g *model.AssetGroup) arkAssetGroupItem {
	return arkAssetGroupItem{
		Id:          g.GroupID,
		Name:        g.Name,
		Description: g.Description,
		GroupType:   g.GroupType,
		ProjectName: g.ProjectName,
		CreateTime:  relayAssetTime(g.CreatedAt),
		UpdateTime:  relayAssetTime(g.UpdatedAt),
	}
}

// arkDeriveAssetName 未显式传 Name 时，从 URL 末段推导素材名（与快速接口一致），仍为空则用时间戳兜底。
func arkDeriveAssetName(rawURL string) string {
	name := ""
	if i := strings.LastIndex(rawURL, "/"); i+1 < len(rawURL) {
		name = rawURL[i+1:]
	}
	if q := strings.IndexByte(name, '?'); q >= 0 {
		name = name[:q]
	}
	if name == "" {
		name = fmt.Sprintf("asset-%d", time.Now().Unix())
	}
	return name
}

// ---- 上游渠道解析 ----

// assetManagementForChannel 由渠道构造协议适配器并断言 AssetManagement 能力。
// 不支持完整官方管理的协议返回明确错误。
func assetManagementForChannel(channel *model.Channel) (assetrelay.AssetManagement, error) {
	proto, err := assetrelay.NewProtocol(buildAssetChannelConfig(channel))
	if err != nil {
		return nil, err
	}
	mgmt, ok := proto.(assetrelay.AssetManagement)
	if !ok {
		return nil, fmt.Errorf("channel %q protocol does not support the official asset management API", channel.Name)
	}
	return mgmt, nil
}

// assetManagementByChannelID 按已记录的 ChannelID 取渠道并断言管理能力，
// 保证 CreateAsset/Update/Delete 与建组时命中同一上游账号。
func assetManagementByChannelID(channelID int) (*model.Channel, assetrelay.AssetManagement, error) {
	channel, err := model.GetChannelById(channelID, true)
	if err != nil {
		return nil, nil, err
	}
	if channel.Status != common.ChannelStatusEnabled {
		return nil, nil, fmt.Errorf("channel %d is not enabled", channelID)
	}
	mgmt, err := assetManagementForChannel(channel)
	if err != nil {
		return nil, nil, err
	}
	return channel, mgmt, nil
}

// bestEffortDeleteUpstreamAsset 删除联动上游：best-effort 调上游 DeleteAsset，
// 渠道不支持/上游故障仅记日志，不阻断本地删除（避免上游故障导致用户无法清理）。
func bestEffortDeleteUpstreamAsset(a *model.Asset) {
	channel, err := model.GetChannelById(a.ChannelID, true)
	if err != nil {
		common.SysLog(fmt.Sprintf("[ArkAsset] skip upstream delete (asset=%d, channel=%d): %v", a.ID, a.ChannelID, err))
		return
	}
	if channel.Status != common.ChannelStatusEnabled {
		common.SysLog(fmt.Sprintf("[ArkAsset] skip upstream delete on disabled channel (asset=%d, channel=%d)", a.ID, a.ChannelID))
		return
	}
	proto, err := assetrelay.NewProtocol(buildAssetChannelConfig(channel))
	if err != nil {
		common.SysLog(fmt.Sprintf("[ArkAsset] skip upstream delete (asset=%d, channel=%d): %v", a.ID, a.ChannelID, err))
		return
	}
	deleter, ok := proto.(assetrelay.AssetDeleter)
	if !ok {
		common.SysLog(fmt.Sprintf("[ArkAsset] protocol has no upstream delete (asset=%d, channel=%d)", a.ID, a.ChannelID))
		return
	}
	if derr := deleter.DeleteAsset(a.AssetID, a.ProjectName); derr != nil {
		common.SysError(fmt.Sprintf("[ArkAsset] upstream DeleteAsset failed (asset=%d, upstream_id=%s): %v", a.ID, a.AssetID, derr))
	}
}

// ---- 分发器 ----

// RelayArkAssetAction 官方兼容素材库 API 的统一入口：按 ?Action= 分发到 10 个处理函数。
func RelayArkAssetAction(c *gin.Context) {
	action := c.Query("Action")
	region := c.GetString(middleware.ArkRegionKey)
	if region == "" {
		region = middleware.ArkDefaultRegion
	}
	if keyErr := videoAssetKeyError(c); keyErr != "" {
		arkErr(c, action, region, http.StatusForbidden, "AccessDenied", keyErr)
		return
	}
	userId := c.GetInt("id")
	raw, _ := c.Get(middleware.ArkRawBodyKey)
	body, _ := raw.([]byte)

	switch action {
	case arkActionCreateAssetGroup:
		arkCreateAssetGroup(c, action, region, userId, body)
	case arkActionCreateAsset:
		arkCreateAsset(c, action, region, userId, body)
	case arkActionListAssetGroups:
		arkListAssetGroups(c, action, region, userId, body)
	case arkActionListAssets:
		arkListAssets(c, action, region, userId, body)
	case arkActionGetAsset:
		arkGetAsset(c, action, region, userId, body)
	case arkActionGetAssetGroup:
		arkGetAssetGroup(c, action, region, userId, body)
	case arkActionUpdateAsset:
		arkUpdateAsset(c, action, region, userId, body)
	case arkActionUpdateAssetGroup:
		arkUpdateAssetGroup(c, action, region, userId, body)
	case arkActionDeleteAsset:
		arkDeleteAsset(c, action, region, userId, body)
	case arkActionDeleteAssetGroup:
		arkDeleteAssetGroup(c, action, region, userId, body)
	default:
		arkErr(c, action, region, http.StatusBadRequest, "InvalidAction", fmt.Sprintf("the action %q is not supported", action))
	}
}

// arkCursorErr 把游标/查询错误映射为官方错误响应，返回是否已处理。
func arkCursorErr(c *gin.Context, action, region string, err error) bool {
	if errors.Is(err, model.ErrInvalidCursor) {
		arkErr(c, action, region, http.StatusBadRequest, "InvalidParameter", "invalid NextToken")
		return true
	}
	return false
}

// ---- 10 个处理函数 ----

func arkCreateAssetGroup(c *gin.Context, action, region string, userId int, body []byte) {
	var req arkCreateAssetGroupReq
	if err := common.Unmarshal(body, &req); err != nil {
		arkErr(c, action, region, http.StatusBadRequest, "InvalidRequest", "invalid request body: "+err.Error())
		return
	}
	name := strings.TrimSpace(arkDeref(req.Name))
	if name == "" {
		arkErr(c, action, region, http.StatusBadRequest, "InvalidParameter", "Name is required")
		return
	}
	groupType := strings.TrimSpace(arkDeref(req.GroupType))
	if groupType == "" {
		groupType = model.AssetGroupTypeDefault
	}
	projectName := strings.TrimSpace(arkDeref(req.ProjectName))
	if projectName == "" {
		projectName = model.AssetProjectNameDefault
	}
	description := arkDeref(req.Description)

	// B端 Key：按绑定渠道建组（可控路由），未绑定直接报错。
	channel, err := service.ResolveTokenBoundChannel(c.GetInt("token_channel_id"))
	if err != nil {
		arkErr(c, action, region, http.StatusBadRequest, "ChannelBindingRequired", err.Error())
		return
	}
	mgmt, err := assetManagementForChannel(channel)
	if err != nil {
		arkErr(c, action, region, http.StatusBadRequest, "ChannelUnavailable", err.Error())
		return
	}
	groupID, err := mgmt.CreateAssetGroup(name, description, groupType, projectName)
	if err != nil {
		common.SysError(fmt.Sprintf("[ArkAsset] CreateAssetGroup upstream failed (user=%d, channel=%d): %v", userId, channel.Id, err))
		arkErr(c, action, region, http.StatusBadGateway, "UpstreamError", err.Error())
		return
	}
	group := &model.AssetGroup{
		UserID:      userId,
		ChannelID:   channel.Id,
		GroupID:     groupID,
		Name:        name,
		Description: description,
		GroupType:   groupType,
		ProjectName: projectName,
	}
	if err := group.Insert(); err != nil {
		common.SysError(fmt.Sprintf("[ArkAsset] CreateAssetGroup persist failed (user=%d, group=%s): %v", userId, groupID, err))
		arkErr(c, action, region, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	arkOK(c, action, region, gin.H{"Id": groupID})
}

func arkCreateAsset(c *gin.Context, action, region string, userId int, body []byte) {
	var req arkCreateAssetReq
	if err := common.Unmarshal(body, &req); err != nil {
		arkErr(c, action, region, http.StatusBadRequest, "InvalidRequest", "invalid request body: "+err.Error())
		return
	}
	groupID := strings.TrimSpace(arkDeref(req.GroupId))
	if groupID == "" {
		arkErr(c, action, region, http.StatusBadRequest, "InvalidParameter", "GroupId is required")
		return
	}
	assetURL := strings.TrimSpace(arkDeref(req.URL))
	if !strings.HasPrefix(assetURL, "http://") && !strings.HasPrefix(assetURL, "https://") {
		arkErr(c, action, region, http.StatusBadRequest, "InvalidParameter", "URL must be a public http(s) URL")
		return
	}
	assetType := strings.TrimSpace(arkDeref(req.AssetType))
	if !model.IsValidAssetType(assetType) {
		arkErr(c, action, region, http.StatusBadRequest, "InvalidParameter", "AssetType must be one of Image/Video/Audio")
		return
	}
	name := strings.TrimSpace(arkDeref(req.Name))
	if name == "" {
		name = arkDeriveAssetName(assetURL)
	}

	// 归属校验：组必须属于该用户；命中后锁定到建组时的同一渠道。
	group, err := model.GetAssetGroupByUserAndGroupID(userId, groupID)
	if err != nil {
		arkErr(c, action, region, http.StatusNotFound, "NotFound", "asset group not found")
		return
	}
	projectName := strings.TrimSpace(arkDeref(req.ProjectName))
	if projectName == "" {
		projectName = group.ProjectName
	}

	channel, mgmt, err := assetManagementByChannelID(group.ChannelID)
	if err != nil {
		arkErr(c, action, region, http.StatusInternalServerError, "NoAvailableChannel", err.Error())
		return
	}
	res, err := mgmt.CreateAssetInGroup(groupID, assetURL, assetType, name, projectName)
	if err != nil {
		common.SysError(fmt.Sprintf("[ArkAsset] CreateAsset upstream failed (user=%d, channel=%d, group=%s): %v", userId, channel.Id, groupID, err))
		arkErr(c, action, region, http.StatusBadGateway, "UpstreamError", err.Error())
		return
	}
	a := &model.Asset{
		UserID:      userId,
		ChannelID:   channel.Id,
		AssetID:     res.AssetID,
		GroupID:     groupID,
		Name:        name,
		AssetType:   assetType,
		Status:      model.AssetStatusPending,
		SourceURL:   assetURL,
		ProjectName: projectName,
	}
	if err := a.Insert(); err != nil {
		common.SysError(fmt.Sprintf("[ArkAsset] CreateAsset persist failed (user=%d, upstream_id=%s): %v", userId, res.AssetID, err))
		arkErr(c, action, region, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	arkOK(c, action, region, gin.H{"Id": res.AssetID})
}

func arkListAssetGroups(c *gin.Context, action, region string, userId int, body []byte) {
	var req arkListReq
	if len(body) > 0 {
		if err := common.Unmarshal(body, &req); err != nil {
			arkErr(c, action, region, http.StatusBadRequest, "InvalidRequest", "invalid request body: "+err.Error())
			return
		}
	}
	var groupIDs []string
	var nameFuzzy string
	if req.Filter != nil {
		groupIDs = req.Filter.GroupIds
		nameFuzzy = arkDeref(req.Filter.Name)
	}
	groups, next, err := model.GetUserAssetGroups(userId, groupIDs, nameFuzzy, arkDerefInt(req.MaxResults), arkDeref(req.NextToken))
	if err != nil {
		if arkCursorErr(c, action, region, err) {
			return
		}
		arkErr(c, action, region, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	items := make([]arkAssetGroupItem, 0, len(groups))
	for _, g := range groups {
		items = append(items, newArkAssetGroupItem(g))
	}
	result := gin.H{"Items": items}
	if next != "" {
		result["NextToken"] = next
	}
	arkOK(c, action, region, result)
}

func arkListAssets(c *gin.Context, action, region string, userId int, body []byte) {
	var req arkListReq
	if len(body) > 0 {
		if err := common.Unmarshal(body, &req); err != nil {
			arkErr(c, action, region, http.StatusBadRequest, "InvalidRequest", "invalid request body: "+err.Error())
			return
		}
	}
	var groupIDs, statuses []string
	var nameFuzzy string
	if req.Filter != nil {
		groupIDs = req.Filter.GroupIds
		statuses = arkLocalStatuses(req.Filter.Statuses)
		nameFuzzy = arkDeref(req.Filter.Name)
	}
	assets, next, err := model.GetUserAssetsFiltered(userId, groupIDs, statuses, nameFuzzy, arkDerefInt(req.MaxResults), arkDeref(req.NextToken))
	if err != nil {
		if arkCursorErr(c, action, region, err) {
			return
		}
		arkErr(c, action, region, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	// 本地优先：仅对结果中的 pending 项向上游刷新状态（防抖 10s，见 refreshPendingAssets）。
	refreshPendingAssets(assets)
	items := make([]arkAssetItem, 0, len(assets))
	for _, a := range assets {
		items = append(items, newArkAssetItem(a))
	}
	result := gin.H{"Items": items}
	if next != "" {
		result["NextToken"] = next
	}
	arkOK(c, action, region, result)
}

func arkGetAsset(c *gin.Context, action, region string, userId int, body []byte) {
	var req arkIdReq
	if err := common.Unmarshal(body, &req); err != nil {
		arkErr(c, action, region, http.StatusBadRequest, "InvalidRequest", "invalid request body: "+err.Error())
		return
	}
	id := strings.TrimSpace(arkDeref(req.Id))
	if id == "" {
		arkErr(c, action, region, http.StatusBadRequest, "InvalidParameter", "Id is required")
		return
	}
	assets, err := model.GetUserAssetsByAssetIDs(userId, []string{id})
	if err != nil {
		arkErr(c, action, region, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	if len(assets) == 0 {
		arkErr(c, action, region, http.StatusNotFound, "NotFound", "asset not found")
		return
	}
	a := assets[0]
	refreshPendingAssets([]*model.Asset{a})
	arkOK(c, action, region, newArkAssetItem(a))
}

func arkGetAssetGroup(c *gin.Context, action, region string, userId int, body []byte) {
	var req arkIdReq
	if err := common.Unmarshal(body, &req); err != nil {
		arkErr(c, action, region, http.StatusBadRequest, "InvalidRequest", "invalid request body: "+err.Error())
		return
	}
	id := strings.TrimSpace(arkDeref(req.Id))
	if id == "" {
		arkErr(c, action, region, http.StatusBadRequest, "InvalidParameter", "Id is required")
		return
	}
	group, err := model.GetAssetGroupByUserAndGroupID(userId, id)
	if err != nil {
		arkErr(c, action, region, http.StatusNotFound, "NotFound", "asset group not found")
		return
	}
	arkOK(c, action, region, newArkAssetGroupItem(group))
}

func arkUpdateAsset(c *gin.Context, action, region string, userId int, body []byte) {
	var req arkIdReq
	if err := common.Unmarshal(body, &req); err != nil {
		arkErr(c, action, region, http.StatusBadRequest, "InvalidRequest", "invalid request body: "+err.Error())
		return
	}
	id := strings.TrimSpace(arkDeref(req.Id))
	if id == "" {
		arkErr(c, action, region, http.StatusBadRequest, "InvalidParameter", "Id is required")
		return
	}
	assets, err := model.GetUserAssetsByAssetIDs(userId, []string{id})
	if err != nil {
		arkErr(c, action, region, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	if len(assets) == 0 {
		arkErr(c, action, region, http.StatusNotFound, "NotFound", "asset not found")
		return
	}
	a := assets[0]
	name := strings.TrimSpace(arkDeref(req.Name))
	projectName := strings.TrimSpace(arkDeref(req.ProjectName))
	if projectName == "" {
		projectName = a.ProjectName
	}
	_, mgmt, err := assetManagementByChannelID(a.ChannelID)
	if err != nil {
		arkErr(c, action, region, http.StatusInternalServerError, "NoAvailableChannel", err.Error())
		return
	}
	if err := mgmt.UpdateAsset(id, name, projectName); err != nil {
		common.SysError(fmt.Sprintf("[ArkAsset] UpdateAsset upstream failed (user=%d, upstream_id=%s): %v", userId, id, err))
		arkErr(c, action, region, http.StatusBadGateway, "UpstreamError", err.Error())
		return
	}
	if err := model.UpdateAssetName(a.ID, userId, name); err != nil {
		common.SysError(fmt.Sprintf("[ArkAsset] UpdateAsset persist failed (asset=%d): %v", a.ID, err))
	}
	arkOK(c, action, region, gin.H{})
}

func arkUpdateAssetGroup(c *gin.Context, action, region string, userId int, body []byte) {
	var req arkIdReq
	if err := common.Unmarshal(body, &req); err != nil {
		arkErr(c, action, region, http.StatusBadRequest, "InvalidRequest", "invalid request body: "+err.Error())
		return
	}
	id := strings.TrimSpace(arkDeref(req.Id))
	if id == "" {
		arkErr(c, action, region, http.StatusBadRequest, "InvalidParameter", "Id is required")
		return
	}
	group, err := model.GetAssetGroupByUserAndGroupID(userId, id)
	if err != nil {
		arkErr(c, action, region, http.StatusNotFound, "NotFound", "asset group not found")
		return
	}
	name := strings.TrimSpace(arkDeref(req.Name))
	description := arkDeref(req.Description)
	projectName := strings.TrimSpace(arkDeref(req.ProjectName))
	if projectName == "" {
		projectName = group.ProjectName
	}
	_, mgmt, err := assetManagementByChannelID(group.ChannelID)
	if err != nil {
		arkErr(c, action, region, http.StatusInternalServerError, "NoAvailableChannel", err.Error())
		return
	}
	if err := mgmt.UpdateAssetGroup(id, name, description, projectName); err != nil {
		common.SysError(fmt.Sprintf("[ArkAsset] UpdateAssetGroup upstream failed (user=%d, group=%s): %v", userId, id, err))
		arkErr(c, action, region, http.StatusBadGateway, "UpstreamError", err.Error())
		return
	}
	// 本地更新：未提供的字段保留原值（空 Name 不改名，空 Description 不清空）。
	newName := group.Name
	if name != "" {
		newName = name
	}
	newDescription := group.Description
	if description != "" {
		newDescription = description
	}
	if err := model.UpdateAssetGroupFields(userId, id, newName, newDescription); err != nil {
		common.SysError(fmt.Sprintf("[ArkAsset] UpdateAssetGroup persist failed (user=%d, group=%s): %v", userId, id, err))
	}
	arkOK(c, action, region, gin.H{})
}

func arkDeleteAsset(c *gin.Context, action, region string, userId int, body []byte) {
	var req arkIdReq
	if err := common.Unmarshal(body, &req); err != nil {
		arkErr(c, action, region, http.StatusBadRequest, "InvalidRequest", "invalid request body: "+err.Error())
		return
	}
	id := strings.TrimSpace(arkDeref(req.Id))
	if id == "" {
		arkErr(c, action, region, http.StatusBadRequest, "InvalidParameter", "Id is required")
		return
	}
	assets, err := model.GetUserAssetsByAssetIDs(userId, []string{id})
	if err != nil {
		arkErr(c, action, region, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	if len(assets) == 0 {
		arkErr(c, action, region, http.StatusNotFound, "NotFound", "asset not found")
		return
	}
	// 删除联动上游：对每个匹配副本 best-effort 删除，再删本地记录。
	for _, a := range assets {
		bestEffortDeleteUpstreamAsset(a)
	}
	deleted, err := model.DeleteAssetsByUserAndAssetID(userId, id)
	if err != nil {
		arkErr(c, action, region, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	if deleted == 0 {
		arkErr(c, action, region, http.StatusNotFound, "NotFound", "asset not found")
		return
	}
	arkOK(c, action, region, gin.H{})
}

func arkDeleteAssetGroup(c *gin.Context, action, region string, userId int, body []byte) {
	var req arkIdReq
	if err := common.Unmarshal(body, &req); err != nil {
		arkErr(c, action, region, http.StatusBadRequest, "InvalidRequest", "invalid request body: "+err.Error())
		return
	}
	id := strings.TrimSpace(arkDeref(req.Id))
	if id == "" {
		arkErr(c, action, region, http.StatusBadRequest, "InvalidParameter", "Id is required")
		return
	}
	group, err := model.GetAssetGroupByUserAndGroupID(userId, id)
	if err != nil {
		arkErr(c, action, region, http.StatusNotFound, "NotFound", "asset group not found")
		return
	}
	// 组内素材 best-effort 上游删除 → 组 best-effort 上游删除 → 删本地素材 → 删本地组。
	if assets, aerr := model.GetUserAssetsByGroupID(userId, id); aerr == nil {
		for _, a := range assets {
			bestEffortDeleteUpstreamAsset(a)
		}
	} else {
		common.SysError(fmt.Sprintf("[ArkAsset] DeleteAssetGroup list assets failed (user=%d, group=%s): %v", userId, id, aerr))
	}
	if _, mgmt, merr := assetManagementByChannelID(group.ChannelID); merr == nil {
		if derr := mgmt.DeleteAssetGroup(id, group.ProjectName); derr != nil {
			common.SysError(fmt.Sprintf("[ArkAsset] upstream DeleteAssetGroup failed (group=%s): %v", id, derr))
		}
	} else {
		common.SysLog(fmt.Sprintf("[ArkAsset] skip upstream group delete (group=%s, channel=%d): %v", id, group.ChannelID, merr))
	}
	if _, derr := model.DeleteAssetsByUserAndGroupID(userId, id); derr != nil {
		common.SysError(fmt.Sprintf("[ArkAsset] DeleteAssetGroup cascade local assets failed (user=%d, group=%s): %v", userId, id, derr))
	}
	deleted, err := model.DeleteAssetGroupByUserAndGroupID(userId, id)
	if err != nil {
		arkErr(c, action, region, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	if deleted == 0 {
		arkErr(c, action, region, http.StatusNotFound, "NotFound", "asset group not found")
		return
	}
	arkOK(c, action, region, gin.H{})
}
