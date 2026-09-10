package controller

import (
	"errors"
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

// 企业（组织）接口。
//
// 权限分三层，与系统角色完全解耦：
//   - 成员：只看自己企业内与自己相关的信息
//   - 企业管理员（OrgAdminAuth）：管理本企业的设置、成员、报表与消费明细
//   - 系统管理员（AdminAuth）：/api/org/admin 下的企业 CRUD、充值调额与禁用
//
// 企业管理员不是系统角色：其权限严格限定在本企业内，与 RoleAdminUser 无任何交集。
// 跨企业访问一律按"企业不存在"响应，不泄露他人企业的存在性。

// orgUsageDefaultRangeDays 是用量报表与消费明细未显式传时间窗时的默认回溯天数
const orgUsageDefaultRangeDays = 30

// orgNotifyTypes 是企业可复用的通知方式，与个人额度预警共用同一套发送器；
// 空值表示不单独通知（回落到发给全部企业管理员）。
var orgNotifyTypes = map[string]bool{
	"":                    true,
	dto.NotifyTypeEmail:   true,
	dto.NotifyTypeWebhook: true,
	dto.NotifyTypeBark:    true,
	dto.NotifyTypeGotify:  true,
}

// loadScopedOrganization 解析本次请求的企业：企业管理员取自己所属企业，
// 系统管理员代管时用 org_id 查询参数显式指定。失败时已写好响应，调用方直接 return。
func loadScopedOrganization(c *gin.Context) (*model.Organization, bool) {
	orgId := middleware.OrgScopeId(c)
	if orgId <= 0 {
		common.ApiErrorI18n(c, i18n.MsgOrgNotFound)
		return nil, false
	}
	return loadOrganization(c, orgId)
}

// loadOrganizationByIdParam 系统管理员按路径参数读取企业，失败时已写好响应
func loadOrganizationByIdParam(c *gin.Context) (*model.Organization, bool) {
	orgId, err := strconv.Atoi(c.Param("id"))
	if err != nil || orgId <= 0 {
		common.ApiErrorI18n(c, i18n.MsgOrgNotFound)
		return nil, false
	}
	return loadOrganization(c, orgId)
}

func loadOrganization(c *gin.Context, orgId int) (*model.Organization, bool) {
	org, err := model.GetOrganizationById(orgId)
	if err != nil {
		if errors.Is(err, model.ErrOrgNotFound) {
			common.ApiErrorI18n(c, i18n.MsgOrgNotFound)
		} else {
			common.ApiError(c, err)
		}
		return nil, false
	}
	return org, true
}

// loadScopedOrgMember 按成员主键读取，并校验其确实属于本次请求的企业。
// 不属于时同样按"成员不存在"响应，跨企业探测拿不到任何可区分的信息。
func loadScopedOrgMember(c *gin.Context, orgId int) (*model.OrgMember, bool) {
	memberId, err := strconv.Atoi(c.Param("id"))
	if err != nil || memberId <= 0 {
		common.ApiErrorI18n(c, i18n.MsgOrgMemberNotFound)
		return nil, false
	}
	member, err := model.GetOrgMemberById(memberId)
	if err != nil || member.OrgId != orgId {
		common.ApiErrorI18n(c, i18n.MsgOrgMemberNotFound)
		return nil, false
	}
	return member, true
}

// orgAuditName 审计文案里展示的企业名，优先显示名
func orgAuditName(org *model.Organization) string {
	if org == nil {
		return ""
	}
	if org.DisplayName != "" {
		return org.DisplayName
	}
	return org.Name
}

// orgFieldNames 返回被修改字段名的有序列表，供审计文案概要使用
func orgFieldNames(fields map[string]interface{}) string {
	names := make([]string, 0, len(fields))
	for name := range fields {
		names = append(names, name)
	}
	sort.Strings(names)
	return strings.Join(names, ",")
}

// parseOrgTimeRange 解析用量与明细的时间窗，缺省回溯 orgUsageDefaultRangeDays 天
func parseOrgTimeRange(c *gin.Context) (int64, int64) {
	now := common.GetTimestamp()
	start, err := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	if err != nil || start <= 0 {
		start = now - orgUsageDefaultRangeDays*86400
	}
	end, err := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	if err != nil || end <= 0 {
		end = now
	}
	if end < start {
		start, end = end, start
	}
	return start, end
}

// normalizeOrgRoleParam 归一化并校验成员角色入参，空值按普通成员处理
func normalizeOrgRoleParam(c *gin.Context, raw string) (string, bool) {
	role := strings.TrimSpace(raw)
	if role == "" {
		return model.OrgRoleMember, true
	}
	if !model.IsValidOrgRole(role) {
		common.ApiErrorI18n(c, i18n.MsgOrgRoleInvalid)
		return "", false
	}
	return role, true
}

// ---------------------------------------------------------------------------
// 成员视角
// ---------------------------------------------------------------------------

// orgSummaryResponse 成员视角的企业概览
type orgSummaryResponse struct {
	OrgId         int    `json:"org_id"`
	Name          string `json:"name"`
	DisplayName   string `json:"display_name"`
	Group         string `json:"group"`
	OrgRole       string `json:"org_role"`
	MemberStatus  int    `json:"member_status"`
	QuotaLimit    int    `json:"quota_limit"`
	QuotaUsed     int    `json:"quota_used"`
	QuotaRemain   int    `json:"quota_remain"`
	PoolQuota     int    `json:"pool_quota"`
	PoolUsedQuota int    `json:"pool_used_quota"`
	PoolHidden    bool   `json:"pool_quota_hidden"`
	MemberCount   int64  `json:"member_count"`
	CacheEnabled  bool   `json:"cache_enabled"`
}

// GetOrgSummary 我的企业概览：企业名、我的子额度与已用量，
// 额度池余额按企业设置决定是否展示。
//
// 本接口只要求登录（UserAuth），不挂 OrgMemberAuth：无企业是正常状态而非错误，
// 前端据 org_id=0 渲染空态引导页。
func GetOrgSummary(c *gin.Context) {
	org, member, err := model.GetActiveOrganizationForUser(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if org == nil || member == nil {
		common.ApiSuccess(c, gin.H{"org_id": 0})
		return
	}
	resp := orgSummaryResponse{
		OrgId:        org.Id,
		Name:         org.Name,
		DisplayName:  org.DisplayName,
		Group:        org.Group,
		OrgRole:      member.OrgRole,
		MemberStatus: member.Status,
		QuotaLimit:   member.QuotaLimit,
		QuotaUsed:    member.QuotaUsed,
		QuotaRemain:  member.RemainQuota(),
		CacheEnabled: org.CacheEnabled,
	}
	// 池余额可见性由 HidePoolQuota 控制（零值 false 即默认可见）；
	// 企业管理员与系统管理员始终可见，便于核对余额
	if !org.HidePoolQuota || member.IsAdmin() || middleware.IsSystemAdmin(c) {
		resp.PoolQuota = org.Quota
		resp.PoolUsedQuota = org.UsedQuota
	} else {
		resp.PoolHidden = true
	}
	if count, countErr := model.CountOrgMembers(org.Id); countErr == nil {
		resp.MemberCount = count
	}
	common.ApiSuccess(c, resp)
}

// ---------------------------------------------------------------------------
// 企业管理员
// ---------------------------------------------------------------------------

// GetOrganization 企业信息与设置。cache_supported 告知前端 Redis 是否可用，
// 未启用时缓存开关在 UI 上禁用并提示。
func GetOrganization(c *gin.Context) {
	org, ok := loadScopedOrganization(c)
	if !ok {
		return
	}
	memberCount, _ := model.CountOrgMembers(org.Id)
	common.ApiSuccess(c, gin.H{
		"organization":    org,
		"member_count":    memberCount,
		"cache_supported": common.RedisEnabled,
	})
}

// updateOrganizationRequest 企业管理员可改的设置项。
//
// 字段全用指针以区分"未提交"与"提交零值"。分组、额度池余额、启用状态与企业标识
// 属于系统管理员权限——分组决定计费倍率，企业管理员自行改组等于自选倍率，
// 因此这些字段不在本结构内。
type updateOrganizationRequest struct {
	DisplayName         *string `json:"display_name"`
	WarningThreshold    *int    `json:"warning_threshold"`
	NotifyType          *string `json:"notify_type"`
	NotifyTarget        *string `json:"notify_target"`
	DailyUsageAlert     *int    `json:"daily_usage_alert"`
	CacheEnabled        *bool   `json:"cache_enabled"`
	CacheTTL            *int    `json:"cache_ttl"`
	AllowWalletFallback *bool   `json:"allow_wallet_fallback"`
	HidePoolQuota       *bool   `json:"hide_pool_quota"`
}

// UpdateOrganization 更新企业设置（显示名、预警阈值与通知方式、日用量告警、
// 缓存开关与 TTL、池余额是否对成员可见、池不足是否回落个人钱包）。
func UpdateOrganization(c *gin.Context) {
	org, ok := loadScopedOrganization(c)
	if !ok {
		return
	}
	var req updateOrganizationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	fields := map[string]interface{}{}
	cacheTouched := false
	alertTouched := false

	if req.DisplayName != nil {
		displayName := strings.TrimSpace(*req.DisplayName)
		if displayName == "" {
			common.ApiErrorI18n(c, i18n.MsgOrgDisplayNameEmpty)
			return
		}
		fields["display_name"] = displayName
	}
	if req.WarningThreshold != nil {
		if *req.WarningThreshold < 0 {
			common.ApiErrorI18n(c, i18n.MsgOrgThresholdInvalid)
			return
		}
		fields["warning_threshold"] = *req.WarningThreshold
		alertTouched = true
	}
	if req.DailyUsageAlert != nil {
		if *req.DailyUsageAlert < 0 {
			common.ApiErrorI18n(c, i18n.MsgOrgThresholdInvalid)
			return
		}
		fields["daily_usage_alert"] = *req.DailyUsageAlert
		alertTouched = true
	}
	if req.NotifyType != nil {
		notifyType := strings.TrimSpace(*req.NotifyType)
		if !orgNotifyTypes[notifyType] {
			common.ApiErrorI18n(c, i18n.MsgOrgNotifyTypeInvalid)
			return
		}
		fields["notify_type"] = notifyType
		alertTouched = true
	}
	if req.NotifyTarget != nil {
		fields["notify_target"] = strings.TrimSpace(*req.NotifyTarget)
		alertTouched = true
	}
	if req.CacheEnabled != nil {
		// Redis 未启用时缓存能力整体关闭，直接拒绝开启避免设置与行为不一致
		if *req.CacheEnabled && !common.RedisEnabled {
			common.ApiErrorI18n(c, i18n.MsgOrgCacheFeatureDisabled)
			return
		}
		fields["cache_enabled"] = *req.CacheEnabled
		cacheTouched = true
	}
	if req.CacheTTL != nil {
		if *req.CacheTTL < 1 || *req.CacheTTL > model.OrgCacheTTLMax {
			common.ApiErrorI18n(c, i18n.MsgOrgCacheTTLInvalid, map[string]any{"Max": model.OrgCacheTTLMax})
			return
		}
		fields["cache_ttl"] = *req.CacheTTL
		cacheTouched = true
	}
	if req.AllowWalletFallback != nil {
		fields["allow_wallet_fallback"] = *req.AllowWalletFallback
	}
	if req.HidePoolQuota != nil {
		fields["hide_pool_quota"] = *req.HidePoolQuota
	}
	if len(fields) == 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}

	if err := model.UpdateOrganizationFields(org.Id, fields); err != nil {
		common.ApiError(c, err)
		return
	}
	// 重新读取，使专项审计记录的是生效后的值而非本次是否提交
	updated, ok := loadOrganization(c, org.Id)
	if !ok {
		return
	}
	name := orgAuditName(updated)
	recordManageAudit(c, "org.update", map[string]interface{}{
		"id":     updated.Id,
		"name":   name,
		"fields": orgFieldNames(fields),
	})
	if cacheTouched {
		recordManageAudit(c, "org.cache_config", map[string]interface{}{
			"id":      updated.Id,
			"name":    name,
			"enabled": updated.CacheEnabled,
			"ttl":     updated.CacheTTL,
		})
	}
	if alertTouched {
		recordManageAudit(c, "org.alert_config", map[string]interface{}{
			"id":        updated.Id,
			"name":      name,
			"threshold": updated.WarningThreshold,
			"daily":     updated.DailyUsageAlert,
			"notify":    updated.NotifyType,
		})
	}
	common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, nil)
}

// GetOrgMembers 分页查询企业成员，keyword 匹配用户名与显示名
func GetOrgMembers(c *gin.Context) {
	org, ok := loadScopedOrganization(c)
	if !ok {
		return
	}
	pageInfo := common.GetPageQuery(c)
	keyword := strings.TrimSpace(c.Query("keyword"))
	members, total, err := model.GetOrgMembers(org.Id, keyword, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(members)
	common.ApiSuccess(c, pageInfo)
}

// createOrgMemberRequest 在企业内新建成员账号
type createOrgMemberRequest struct {
	Username    string `json:"username"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	OrgRole     string `json:"org_role"`
	QuotaLimit  int    `json:"quota_limit"`
}

// CreateOrgMember 建成员账号：系统角色固定为普通用户（role=1），
// org_id 与 group 取企业配置，并写入初始子额度。
func CreateOrgMember(c *gin.Context) {
	org, ok := loadScopedOrganization(c)
	if !ok {
		return
	}
	if org.Status != model.OrgStatusEnabled {
		common.ApiErrorI18n(c, i18n.MsgOrgDisabled)
		return
	}
	var req createOrgMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" {
		common.ApiErrorI18n(c, i18n.MsgOrgUsernameRequired)
		return
	}
	// 与 User.Password 的 validate:"min=8,max=20" 对齐，先给出可读的企业侧提示
	if len(req.Password) < 8 || len(req.Password) > 20 {
		common.ApiErrorI18n(c, i18n.MsgOrgPasswordInvalid)
		return
	}
	if req.QuotaLimit < 0 {
		common.ApiErrorI18n(c, i18n.MsgOrgMemberQuotaInvalid)
		return
	}
	orgRole, ok := normalizeOrgRoleParam(c, req.OrgRole)
	if !ok {
		return
	}
	displayName := strings.TrimSpace(req.DisplayName)
	if displayName == "" {
		displayName = req.Username
	}
	user := &model.User{
		Username:    req.Username,
		Password:    req.Password,
		DisplayName: displayName,
		Email:       strings.TrimSpace(req.Email),
	}
	if err := common.Validate.Struct(user); err != nil {
		common.ApiErrorI18n(c, i18n.MsgUserInputInvalid, map[string]any{"Error": err.Error()})
		return
	}
	exist, err := model.CheckUserExistOrDeleted(user.Username, user.Email)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if exist {
		common.ApiErrorI18n(c, i18n.MsgUserExists)
		return
	}
	member := &model.OrgMember{
		OrgId:      org.Id,
		OrgRole:    orgRole,
		QuotaLimit: req.QuotaLimit,
	}
	if err := model.CreateOrgMemberUser(user, member); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, user.Id, "org.member.create", map[string]interface{}{
		"id":          org.Id,
		"name":        orgAuditName(org),
		"username":    user.Username,
		"role":        member.OrgRole,
		"quota_limit": member.QuotaLimit,
	})
	common.ApiSuccessI18n(c, i18n.MsgCreateSuccess, gin.H{
		"id":       member.Id,
		"user_id":  user.Id,
		"username": user.Username,
	})
}

// inviteOrgMemberRequest 按用户名邀请既有用户直接加入企业
type inviteOrgMemberRequest struct {
	Username   string `json:"username"`
	OrgRole    string `json:"org_role"`
	QuotaLimit int    `json:"quota_limit"`
}

// InviteOrgMember 邀请既有用户加入企业：写入成员记录并同步其 org_id 与分组。
// 一个用户最多属于一个企业，已在任何企业内的用户会被拒绝。
func InviteOrgMember(c *gin.Context) {
	org, ok := loadScopedOrganization(c)
	if !ok {
		return
	}
	if org.Status != model.OrgStatusEnabled {
		common.ApiErrorI18n(c, i18n.MsgOrgDisabled)
		return
	}
	var req inviteOrgMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	username := strings.TrimSpace(req.Username)
	if username == "" {
		common.ApiErrorI18n(c, i18n.MsgOrgUsernameRequired)
		return
	}
	if req.QuotaLimit < 0 {
		common.ApiErrorI18n(c, i18n.MsgOrgMemberQuotaInvalid)
		return
	}
	orgRole, ok := normalizeOrgRoleParam(c, req.OrgRole)
	if !ok {
		return
	}
	if username == c.GetString("username") {
		common.ApiErrorI18n(c, i18n.MsgOrgInviteSelf)
		return
	}
	user, err := model.GetUserByUsername(username)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgOrgUserNotFound)
		return
	}
	member := &model.OrgMember{
		OrgId:      org.Id,
		UserId:     user.Id,
		OrgRole:    orgRole,
		QuotaLimit: req.QuotaLimit,
	}
	if err := model.AddOrgMember(member); err != nil {
		if errors.Is(err, model.ErrOrgUserAlreadyInOrg) {
			common.ApiErrorI18n(c, i18n.MsgOrgUserAlreadyInOrg)
			return
		}
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, user.Id, "org.member.invite", map[string]interface{}{
		"id":          org.Id,
		"name":        orgAuditName(org),
		"username":    user.Username,
		"role":        member.OrgRole,
		"quota_limit": member.QuotaLimit,
	})
	common.ApiSuccessI18n(c, i18n.MsgOperationSuccess, gin.H{
		"id":       member.Id,
		"user_id":  user.Id,
		"username": user.Username,
	})
}

// updateOrgMemberRequest 调整成员子额度 / 企业角色 / 启用状态
type updateOrgMemberRequest struct {
	OrgRole    *string `json:"org_role"`
	QuotaLimit *int    `json:"quota_limit"`
	Status     *int    `json:"status"`
}

// UpdateOrgMember 更新成员设置。降级或停用最后一个管理员会被拒绝，
// 否则企业将无人可管（系统管理员代管除外，其入口在 /api/org/admin 下）。
func UpdateOrgMember(c *gin.Context) {
	org, ok := loadScopedOrganization(c)
	if !ok {
		return
	}
	member, ok := loadScopedOrgMember(c, org.Id)
	if !ok {
		return
	}
	var req updateOrgMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	fields := map[string]interface{}{}
	losingAdmin := false

	if req.OrgRole != nil {
		orgRole, valid := normalizeOrgRoleParam(c, *req.OrgRole)
		if !valid {
			return
		}
		if orgRole != member.OrgRole {
			fields["org_role"] = orgRole
			if member.IsAdmin() && orgRole != model.OrgRoleAdmin {
				losingAdmin = true
			}
		}
	}
	if req.QuotaLimit != nil {
		// 允许把上限调到已用量之下：此后该成员无法再消费，但不追溯既有用量
		if *req.QuotaLimit < 0 {
			common.ApiErrorI18n(c, i18n.MsgOrgMemberQuotaInvalid)
			return
		}
		if *req.QuotaLimit != member.QuotaLimit {
			fields["quota_limit"] = *req.QuotaLimit
		}
	}
	if req.Status != nil {
		status := *req.Status
		if status != model.OrgMemberStatusEnabled && status != model.OrgMemberStatusDisabled {
			common.ApiErrorI18n(c, i18n.MsgOrgMemberStatusInvalid)
			return
		}
		if status != member.Status {
			fields["status"] = status
			if member.IsAdmin() && status == model.OrgMemberStatusDisabled {
				losingAdmin = true
			}
		}
	}
	if len(fields) == 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if losingAdmin {
		adminIds, err := model.GetOrgAdminUserIds(org.Id)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if len(adminIds) <= 1 {
			common.ApiErrorI18n(c, i18n.MsgOrgLastAdmin)
			return
		}
	}
	if err := model.UpdateOrgMemberFields(member.Id, fields); err != nil {
		common.ApiError(c, err)
		return
	}
	username, _ := model.GetUsernameById(member.UserId, false)
	recordManageAuditFor(c, member.UserId, "org.member.update", map[string]interface{}{
		"id":          org.Id,
		"name":        orgAuditName(org),
		"member_id":   member.Id,
		"username":    username,
		"role":        valueOrFallback(fields["org_role"], member.OrgRole),
		"quota_limit": valueOrFallback(fields["quota_limit"], member.QuotaLimit),
		"status":      valueOrFallback(fields["status"], member.Status),
	})
	common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, nil)
}

// valueOrFallback 审计取值：本次提交了就用新值，否则回落到变更前的值，
// 使每条审计都是完整快照而不是一堆空洞占位符。
func valueOrFallback(value interface{}, fallback interface{}) interface{} {
	if value == nil {
		return fallback
	}
	return value
}

// RemoveOrgMember 把成员移出企业：只解绑不删账号，用户的密钥与历史日志保留，
// 其分组回落系统默认组。
func RemoveOrgMember(c *gin.Context) {
	org, ok := loadScopedOrganization(c)
	if !ok {
		return
	}
	member, ok := loadScopedOrgMember(c, org.Id)
	if !ok {
		return
	}
	if member.UserId == c.GetInt("id") && !middleware.IsSystemAdmin(c) {
		common.ApiErrorI18n(c, i18n.MsgOrgRemoveSelf)
		return
	}
	if member.IsAdmin() {
		adminIds, err := model.GetOrgAdminUserIds(org.Id)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if len(adminIds) <= 1 {
			common.ApiErrorI18n(c, i18n.MsgOrgLastAdmin)
			return
		}
	}
	username, _ := model.GetUsernameById(member.UserId, false)
	if err := model.RemoveOrgMember(org.Id, member.UserId); err != nil {
		if errors.Is(err, model.ErrOrgMemberNotFound) {
			common.ApiErrorI18n(c, i18n.MsgOrgMemberNotFound)
			return
		}
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, member.UserId, "org.member.remove", map[string]interface{}{
		"id":       org.Id,
		"name":     orgAuditName(org),
		"username": username,
	})
	common.ApiSuccessI18n(c, i18n.MsgDeleteSuccess, nil)
}

// GetOrgUsage 企业用量报表：总量 + 按日 + 按成员 + 按模型（读 quota_data 的 org 维度）
func GetOrgUsage(c *gin.Context) {
	org, ok := loadScopedOrganization(c)
	if !ok {
		return
	}
	startTime, endTime := parseOrgTimeRange(c)
	report, err := model.GetOrgUsage(org.Id, startTime, endTime)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"start_timestamp": startTime,
		"end_timestamp":   endTime,
		"report":          report,
	})
}

// GetOrgLogs 企业消费明细。logs 表没有 org_id 列，按成员 user_id 集合过滤，
// 成员归属以 org_members 为准。
func GetOrgLogs(c *gin.Context) {
	org, ok := loadScopedOrganization(c)
	if !ok {
		return
	}
	userIds, err := model.GetOrgMemberUserIds(org.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// user_id 收窄参数必须是本企业成员，否则等价于无结果（不泄露他人日志）
	scopeUserId, _ := strconv.Atoi(c.Query("user_id"))
	if scopeUserId > 0 && !intInList(scopeUserId, userIds) {
		scopeUserId = -1
	}
	logType, _ := strconv.Atoi(c.Query("type"))
	startTime, endTime := parseOrgTimeRange(c)
	pageInfo := common.GetPageQuery(c)
	logs, total, err := model.GetOrgLogs(userIds, logType, startTime, endTime,
		strings.TrimSpace(c.Query("model_name")), scopeUserId, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(logs)
	common.ApiSuccess(c, pageInfo)
}

func intInList(target int, list []int) bool {
	for _, item := range list {
		if item == target {
			return true
		}
	}
	return false
}

// GetOrgTokens 企业成员密钥列表。密钥仍归属成员个人（relay 鉴权不变），
// 这里只做只读展示，明文 key 一律脱敏。
func GetOrgTokens(c *gin.Context) {
	org, ok := loadScopedOrganization(c)
	if !ok {
		return
	}
	userIds, err := model.GetOrgMemberUserIds(org.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	scopeUserId, _ := strconv.Atoi(c.Query("user_id"))
	if scopeUserId > 0 && !intInList(scopeUserId, userIds) {
		scopeUserId = -1
	}
	pageInfo := common.GetPageQuery(c)
	tokens, total, err := model.GetOrgTokens(userIds, scopeUserId,
		strings.TrimSpace(c.Query("keyword")), pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(buildOrgTokenResponses(tokens))
	common.ApiSuccess(c, pageInfo)
}

// buildOrgTokenResponses 脱敏并按归属用户名标注企业成员的密钥
func buildOrgTokenResponses(tokens []*model.Token) []*tokenOwnerResponse {
	ids := make([]int, 0, len(tokens))
	seen := make(map[int]bool, len(tokens))
	for _, token := range tokens {
		if !seen[token.UserId] {
			seen[token.UserId] = true
			ids = append(ids, token.UserId)
		}
	}
	names := map[int]string{}
	if fetched, err := model.GetUserNamesByIds(ids); err != nil {
		common.SysLog("failed to load org token owner names: " + err.Error())
	} else {
		names = fetched
	}
	items := make([]*tokenOwnerResponse, 0, len(tokens))
	for _, token := range tokens {
		items = append(items, &tokenOwnerResponse{
			Token:    buildMaskedTokenResponse(token),
			Username: names[token.UserId],
		})
	}
	return items
}

// ---------------------------------------------------------------------------
// 系统管理员：企业 CRUD、充值调额、禁用与成员查看
// ---------------------------------------------------------------------------

// adminCreateOrganizationRequest 系统管理员创建企业
type adminCreateOrganizationRequest struct {
	Name                string `json:"name"`
	DisplayName         string `json:"display_name"`
	Group               string `json:"group"`
	Quota               int    `json:"quota"`
	OwnerUsername       string `json:"owner_username"`
	WarningThreshold    int    `json:"warning_threshold"`
	NotifyType          string `json:"notify_type"`
	NotifyTarget        string `json:"notify_target"`
	DailyUsageAlert     int    `json:"daily_usage_alert"`
	CacheEnabled        bool   `json:"cache_enabled"`
	CacheTTL            int    `json:"cache_ttl"`
	AllowWalletFallback bool   `json:"allow_wallet_fallback"`
	HidePoolQuota       bool   `json:"hide_pool_quota"`
}

// AdminGetAllOrganizations 企业列表（分页 + 关键字）
func AdminGetAllOrganizations(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	keyword := strings.TrimSpace(c.Query("keyword"))
	orgs, total, err := model.GetAllOrganizations(keyword, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(orgs)
	common.ApiSuccess(c, pageInfo)
}

// AdminGetOrganization 企业详情（系统管理员按路径参数）
func AdminGetOrganization(c *gin.Context) {
	org, ok := loadOrganizationByIdParam(c)
	if !ok {
		return
	}
	memberCount, _ := model.CountOrgMembers(org.Id)
	common.ApiSuccess(c, gin.H{
		"organization":    org,
		"member_count":    memberCount,
		"cache_supported": common.RedisEnabled,
	})
}

// AdminCreateOrganization 创建企业，可同时指定一位既有用户作为企业管理员，
// 并写入初始额度池。
func AdminCreateOrganization(c *gin.Context) {
	var req adminCreateOrganizationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	name := model.NormalizeOrgName(req.Name)
	if !model.IsValidOrgName(name) {
		common.ApiErrorI18n(c, i18n.MsgOrgNameInvalid)
		return
	}
	group := strings.TrimSpace(req.Group)
	if group == "" {
		group = model.DefaultUserGroup
	}
	if !ratio_setting.ContainsGroupRatio(group) {
		common.ApiErrorI18n(c, i18n.MsgOrgGroupInvalid)
		return
	}
	if req.WarningThreshold < 0 || req.DailyUsageAlert < 0 {
		common.ApiErrorI18n(c, i18n.MsgOrgThresholdInvalid)
		return
	}
	notifyType := strings.TrimSpace(req.NotifyType)
	if !orgNotifyTypes[notifyType] {
		common.ApiErrorI18n(c, i18n.MsgOrgNotifyTypeInvalid)
		return
	}
	cacheTTL := req.CacheTTL
	if cacheTTL <= 0 {
		cacheTTL = model.OrgCacheTTLDefault
	}
	if cacheTTL > model.OrgCacheTTLMax {
		common.ApiErrorI18n(c, i18n.MsgOrgCacheTTLInvalid, map[string]any{"Max": model.OrgCacheTTLMax})
		return
	}
	// Redis 未启用时缓存能力整体关闭，强制落库为关闭避免设置与实际行为不一致
	cacheEnabled := req.CacheEnabled && common.RedisEnabled

	// 先解析企业管理员再落库：用户名不存在时必须零副作用返回，
	// 否则企业已提交而管理员缺失，重试即报标识被占用并留下无主企业
	ownerUserId := 0
	ownerUsername := strings.TrimSpace(req.OwnerUsername)
	if ownerUsername != "" {
		owner, err := model.GetUserByUsername(ownerUsername)
		if err != nil {
			common.ApiErrorI18n(c, i18n.MsgOrgUserNotFound)
			return
		}
		ownerUserId = owner.Id
	}

	org := &model.Organization{
		Name:                name,
		DisplayName:         strings.TrimSpace(req.DisplayName),
		Group:               group,
		OwnerUserId:         0,
		WarningThreshold:    req.WarningThreshold,
		NotifyType:          notifyType,
		NotifyTarget:        strings.TrimSpace(req.NotifyTarget),
		DailyUsageAlert:     req.DailyUsageAlert,
		CacheEnabled:        cacheEnabled,
		CacheTTL:            cacheTTL,
		AllowWalletFallback: req.AllowWalletFallback,
		HidePoolQuota:       req.HidePoolQuota,
	}
	// 建企业、初始额度池与首位管理员在同一事务内完成，任一步失败整体回滚
	if err := model.CreateOrganizationWithSetup(org, req.Quota, ownerUserId); err != nil {
		switch {
		case errors.Is(err, model.ErrOrgNameTaken):
			common.ApiErrorI18n(c, i18n.MsgOrgNameTaken)
		case errors.Is(err, model.ErrOrgUserNotFound):
			common.ApiErrorI18n(c, i18n.MsgOrgUserNotFound)
		case errors.Is(err, model.ErrOrgUserAlreadyInOrg):
			common.ApiErrorI18n(c, i18n.MsgOrgUserAlreadyInOrg)
		default:
			common.ApiError(c, err)
		}
		return
	}

	recordManageAudit(c, "org.create", map[string]interface{}{
		"id":     org.Id,
		"name":   orgAuditName(org),
		"group":  org.Group,
		"quota":  req.Quota,
		"owner":  ownerUsername,
		"status": org.Status,
	})
	common.ApiSuccessI18n(c, i18n.MsgCreateSuccess, org)
}

// adminUpdateOrganizationRequest 系统管理员可改的全部企业字段（含分组与标识以外的计费相关项）
type adminUpdateOrganizationRequest struct {
	DisplayName         *string `json:"display_name"`
	Group               *string `json:"group"`
	WarningThreshold    *int    `json:"warning_threshold"`
	NotifyType          *string `json:"notify_type"`
	NotifyTarget        *string `json:"notify_target"`
	DailyUsageAlert     *int    `json:"daily_usage_alert"`
	CacheEnabled        *bool   `json:"cache_enabled"`
	CacheTTL            *int    `json:"cache_ttl"`
	AllowWalletFallback *bool   `json:"allow_wallet_fallback"`
	HidePoolQuota       *bool   `json:"hide_pool_quota"`
}

// AdminUpdateOrganization 更新企业设置。分组变更会连带同步全部成员账号的分组，
// 否则新老成员计费倍率不一致。企业标识 name 是唯一稳定键，创建后不可改。
func AdminUpdateOrganization(c *gin.Context) {
	org, ok := loadOrganizationByIdParam(c)
	if !ok {
		return
	}
	var req adminUpdateOrganizationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	fields := map[string]interface{}{}
	cacheTouched := false
	alertTouched := false

	if req.DisplayName != nil {
		displayName := strings.TrimSpace(*req.DisplayName)
		if displayName == "" {
			common.ApiErrorI18n(c, i18n.MsgOrgDisplayNameEmpty)
			return
		}
		fields["display_name"] = displayName
	}
	if req.WarningThreshold != nil {
		if *req.WarningThreshold < 0 {
			common.ApiErrorI18n(c, i18n.MsgOrgThresholdInvalid)
			return
		}
		fields["warning_threshold"] = *req.WarningThreshold
		alertTouched = true
	}
	if req.DailyUsageAlert != nil {
		if *req.DailyUsageAlert < 0 {
			common.ApiErrorI18n(c, i18n.MsgOrgThresholdInvalid)
			return
		}
		fields["daily_usage_alert"] = *req.DailyUsageAlert
		alertTouched = true
	}
	if req.NotifyType != nil {
		notifyType := strings.TrimSpace(*req.NotifyType)
		if !orgNotifyTypes[notifyType] {
			common.ApiErrorI18n(c, i18n.MsgOrgNotifyTypeInvalid)
			return
		}
		fields["notify_type"] = notifyType
		alertTouched = true
	}
	if req.NotifyTarget != nil {
		fields["notify_target"] = strings.TrimSpace(*req.NotifyTarget)
		alertTouched = true
	}
	if req.CacheEnabled != nil {
		if *req.CacheEnabled && !common.RedisEnabled {
			common.ApiErrorI18n(c, i18n.MsgOrgCacheFeatureDisabled)
			return
		}
		fields["cache_enabled"] = *req.CacheEnabled
		cacheTouched = true
	}
	if req.CacheTTL != nil {
		if *req.CacheTTL < 1 || *req.CacheTTL > model.OrgCacheTTLMax {
			common.ApiErrorI18n(c, i18n.MsgOrgCacheTTLInvalid, map[string]any{"Max": model.OrgCacheTTLMax})
			return
		}
		fields["cache_ttl"] = *req.CacheTTL
		cacheTouched = true
	}
	if req.AllowWalletFallback != nil {
		fields["allow_wallet_fallback"] = *req.AllowWalletFallback
	}
	if req.HidePoolQuota != nil {
		fields["hide_pool_quota"] = *req.HidePoolQuota
	}

	// 分组单独走一条同步路径：需要连带更新成员账号的 group
	newGroup := ""
	if req.Group != nil {
		newGroup = strings.TrimSpace(*req.Group)
		if newGroup == "" {
			newGroup = model.DefaultUserGroup
		}
		if !ratio_setting.ContainsGroupRatio(newGroup) {
			common.ApiErrorI18n(c, i18n.MsgOrgGroupInvalid)
			return
		}
	}
	if len(fields) == 0 && newGroup == "" {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if len(fields) > 0 {
		if err := model.UpdateOrganizationFields(org.Id, fields); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if newGroup != "" && newGroup != org.Group {
		if err := model.UpdateOrganizationGroup(org.Id, newGroup); err != nil {
			common.ApiError(c, err)
			return
		}
	}

	updated, ok := loadOrganization(c, org.Id)
	if !ok {
		return
	}
	name := orgAuditName(updated)
	recordManageAudit(c, "org.update", map[string]interface{}{
		"id":     updated.Id,
		"name":   name,
		"fields": orgFieldNames(fields),
		"group":  updated.Group,
	})
	if cacheTouched {
		recordManageAudit(c, "org.cache_config", map[string]interface{}{
			"id":      updated.Id,
			"name":    name,
			"enabled": updated.CacheEnabled,
			"ttl":     updated.CacheTTL,
		})
	}
	if alertTouched {
		recordManageAudit(c, "org.alert_config", map[string]interface{}{
			"id":        updated.Id,
			"name":      name,
			"threshold": updated.WarningThreshold,
			"daily":     updated.DailyUsageAlert,
			"notify":    updated.NotifyType,
		})
	}
	common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, updated)
}

// AdminAdjustOrgQuota 企业额度池充值/调额，delta 可为负（负值不得使余额为负）
func AdminAdjustOrgQuota(c *gin.Context) {
	org, ok := loadOrganizationByIdParam(c)
	if !ok {
		return
	}
	var req struct {
		Quota int `json:"quota"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if req.Quota == 0 {
		common.ApiErrorI18n(c, i18n.MsgOrgQuotaInvalid)
		return
	}
	if err := model.IncreaseOrgQuota(org.Id, req.Quota); err != nil {
		if errors.Is(err, model.ErrOrgQuotaInsufficient) {
			common.ApiErrorI18n(c, i18n.MsgOrgQuotaInsufficient)
			return
		}
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "org.quota_adjust", map[string]interface{}{
		"id":     org.Id,
		"name":   orgAuditName(org),
		"delta":  req.Quota,
		"before": org.Quota,
		"after":  org.Quota + req.Quota,
	})
	common.ApiSuccessI18n(c, i18n.MsgOperationSuccess, gin.H{"quota": org.Quota + req.Quota})
}

// AdminUpdateOrgStatus 启用/禁用企业。禁用后成员请求不再走企业池。
func AdminUpdateOrgStatus(c *gin.Context) {
	org, ok := loadOrganizationByIdParam(c)
	if !ok {
		return
	}
	var req struct {
		Status int `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if req.Status != model.OrgStatusEnabled && req.Status != model.OrgStatusDisabled {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if err := model.UpdateOrganizationStatus(org.Id, req.Status); err != nil {
		common.ApiError(c, err)
		return
	}
	statusText := "enabled"
	if req.Status == model.OrgStatusDisabled {
		statusText = "disabled"
	}
	recordManageAudit(c, "org.status_update", map[string]interface{}{
		"id":     org.Id,
		"name":   orgAuditName(org),
		"status": statusText,
	})
	common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, nil)
}

// AdminDeleteOrganization 删除企业。仅允许删除已清空成员的企业，
// 避免一次误操作批量解绑用户并重置其分组。
func AdminDeleteOrganization(c *gin.Context) {
	org, ok := loadOrganizationByIdParam(c)
	if !ok {
		return
	}
	if err := model.DeleteOrganization(org.Id); err != nil {
		switch {
		case errors.Is(err, model.ErrOrgNotEmpty):
			common.ApiErrorI18n(c, i18n.MsgOrgNotEmpty)
		case errors.Is(err, model.ErrOrgNotFound):
			common.ApiErrorI18n(c, i18n.MsgOrgNotFound)
		default:
			common.ApiError(c, err)
		}
		return
	}
	recordManageAudit(c, "org.delete", map[string]interface{}{
		"id":   org.Id,
		"name": orgAuditName(org),
	})
	common.ApiSuccessI18n(c, i18n.MsgDeleteSuccess, nil)
}

// AdminGetOrgMembers 查看企业成员（系统管理员按路径参数指定企业）
func AdminGetOrgMembers(c *gin.Context) {
	org, ok := loadOrganizationByIdParam(c)
	if !ok {
		return
	}
	pageInfo := common.GetPageQuery(c)
	keyword := strings.TrimSpace(c.Query("keyword"))
	members, total, err := model.GetOrgMembers(org.Id, keyword, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(members)
	common.ApiSuccess(c, pageInfo)
}
