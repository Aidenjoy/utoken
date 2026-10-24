package controller

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// 代理商自助端的企业（组织）发展、企业成员管理与个人成员新建/踢出。
//
// 归属判定一律以服务端写入 gin.Context 的 agent_id 为准（AgentAuth），忽略客户端传入值。
// 代理商只能操作 organizations.agent_id == 自己 的企业；企业折扣只能在自己的授权下限内设置，
// 保存时整表覆盖企业折扣并同步全部成员。代理商对名下企业拥有与企业管理员/系统管理员同等的
// 成员管理能力（新建/调额改角色/移出，见 CreateAgentOrganizationMember 等），复用
// controller/organization.go 的成员业务实现，归属校验由 loadOwnedAgentOrganization 兜底。
//
// 成员一律只能新建账号，代理商没有认领既有用户的入口（企业侧与个人侧都没有）：
// org_members 与 users.agent_id 都是权限归属，代理商若能自行认领既有用户，就能把别人
// 发展的客户连同其折扣划到自己名下。既有用户的绑定只由系统管理员在用户侧完成。
// 企业内用户的归属随企业，只能经上述企业成员入口管理，不走个人成员新建/踢出。

// loadOwnedAgentOrganization 按路径参数读取企业并校验其确实归属当前代理商，失败时已写好响应。
// 归属判定以 organizations.agent_id == 我的 agents.id 为准。
func loadOwnedAgentOrganization(c *gin.Context) (*model.Organization, bool) {
	id, ok := parseAgentPathId(c)
	if !ok {
		return nil, false
	}
	org, err := model.GetOrganizationById(id)
	if err != nil {
		if errors.Is(err, model.ErrOrgNotFound) {
			common.ApiErrorI18n(c, i18n.MsgOrgNotFound)
		} else {
			common.ApiError(c, err)
		}
		return nil, false
	}
	if org.AgentId != c.GetInt("agent_id") {
		common.ApiErrorI18n(c, i18n.MsgOrgNotOwnedByAgent)
		return nil, false
	}
	return org, true
}

// ListAgentOrganizations 我的企业列表（organizations.agent_id = 我）。
func ListAgentOrganizations(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	keyword := strings.TrimSpace(c.Query("keyword"))
	orgs, total, err := model.GetAllOrganizations(keyword, c.GetInt("agent_id"), pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(orgs)
	common.ApiSuccess(c, pageInfo)
}

type createAgentOrganizationRequest struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
}

// CreateAgentOrganization 代理商创建企业：只填企业标识（展示名可选），初始池 0，
// 建成后立即绑定到当前代理商（SetOrganizationAgent 同步全部成员归属）。
//
// 不在建企业时指定管理员：企业刚建出来一个成员都没有，管理员只能从成员里产生，
// 由后续的成员管理指派（超管侧建企业的管理员用户名同样是选填，此处口径对齐）。
// 建表时收一个用户名，等于诱导代理商把某个既有用户直接拉进来当管理员——而那个人
// 可能已经在别的企业里，或本身就是代理商，两种都会让企业折扣和代理商折扣互相覆盖。
func CreateAgentOrganization(c *gin.Context) {
	var req createAgentOrganizationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	name := model.NormalizeOrgName(req.Name)
	if !model.IsValidOrgName(name) {
		common.ApiErrorI18n(c, i18n.MsgOrgNameInvalid)
		return
	}

	org := &model.Organization{
		Name:        name,
		DisplayName: strings.TrimSpace(req.DisplayName),
		Group:       model.DefaultUserGroup,
	}
	// ownerUserId 传 0：不任命管理员，也就没有用户名解析失败留下无主企业的问题，
	// 唯一可预期的业务失败是标识重名。
	if err := model.CreateOrganizationWithSetup(org, 0, 0); err != nil {
		if errors.Is(err, model.ErrOrgNameTaken) {
			common.ApiErrorI18n(c, i18n.MsgOrgNameTaken)
			return
		}
		common.ApiError(c, err)
		return
	}

	agentId := c.GetInt("agent_id")
	// 绑定代理商：写 organizations.agent_id 并同步全部成员 users.agent_id（企业归属优先）。
	if err := model.SetOrganizationAgent(org.Id, agentId); err != nil {
		common.ApiError(c, err)
		return
	}

	created, err := model.GetOrganizationById(org.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "org.agent_bind", map[string]interface{}{
		"id":     created.Id,
		"name":   orgAuditName(created),
		"agent":  agentId,
		"action": "create",
	})
	common.ApiSuccessI18n(c, i18n.MsgCreateSuccess, created)
}

type updateAgentOrganizationRequest struct {
	Name        *string `json:"name"`
	DisplayName *string `json:"display_name"`
}

// UpdateAgentOrganization 代理商编辑名下企业：只开放唯一标识与显示名两个字段。
// 分组、额度池、企业折扣、钱包管控都另有专门入口或只归超管——它们保存时会整表
// 覆盖全部成员的计费字段，不能混在一个「编辑」表单里被顺手改掉。
func UpdateAgentOrganization(c *gin.Context) {
	org, ok := loadOwnedAgentOrganization(c)
	if !ok {
		return
	}
	var req updateAgentOrganizationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if req.Name != nil {
		name := model.NormalizeOrgName(*req.Name)
		if !model.IsValidOrgName(name) {
			common.ApiErrorI18n(c, i18n.MsgOrgNameInvalid)
			return
		}
		if name != org.Name {
			if err := model.RenameOrganization(org.Id, name); err != nil {
				if errors.Is(err, model.ErrOrgNameTaken) {
					common.ApiErrorI18n(c, i18n.MsgOrgNameTaken)
					return
				}
				common.ApiError(c, err)
				return
			}
		}
	}
	if req.DisplayName != nil {
		fields := map[string]interface{}{"display_name": strings.TrimSpace(*req.DisplayName)}
		if err := model.UpdateOrganizationFields(org.Id, fields); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	updated, err := model.GetOrganizationById(org.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "org.agent_update", map[string]interface{}{
		"id":    org.Id,
		"name":  orgAuditName(updated),
		"agent": c.GetInt("agent_id"),
	})
	common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, updated)
}

// UpdateAgentOrganizationStatus 代理商启用/禁用名下企业，口径与超管侧一致。
func UpdateAgentOrganizationStatus(c *gin.Context) {
	org, ok := loadOwnedAgentOrganization(c)
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
	recordManageAudit(c, "org.status_update", map[string]interface{}{
		"id":     org.Id,
		"name":   orgAuditName(org),
		"agent":  c.GetInt("agent_id"),
		"status": req.Status,
	})
	common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, nil)
}

// DeleteAgentOrganization 代理商删除名下企业；与超管同口径，仅允许已清空成员的企业，
// 成员必须先逐个移出，避免批量解绑用户并重置其归属。
func DeleteAgentOrganization(c *gin.Context) {
	org, ok := loadOwnedAgentOrganization(c)
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
		"id":    org.Id,
		"name":  orgAuditName(org),
		"agent": c.GetInt("agent_id"),
	})
	common.ApiSuccessI18n(c, i18n.MsgDeleteSuccess, nil)
}

// GetAgentOrganizationModelDiscounts 读取某企业当前的按模型折扣，并附带我的授权下限。
func GetAgentOrganizationModelDiscounts(c *gin.Context) {
	org, ok := loadOwnedAgentOrganization(c)
	if !ok {
		return
	}
	discounts := common.ParseModelDiscounts(org.ModelDiscounts)
	if discounts == nil {
		discounts = map[string]float64{}
	}
	common.ApiSuccess(c, gin.H{
		"discounts": discounts,
		"floors":    agentFloorsFromContext(c),
	})
}

// UpdateAgentOrganizationModelDiscounts 为企业设置按模型折扣：授权范围内整表替换，
// 每个提交的模型都必须已授权且折扣 >= 该模型的下限，保存时覆盖全部成员。
func UpdateAgentOrganizationModelDiscounts(c *gin.Context) {
	org, ok := loadOwnedAgentOrganization(c)
	if !ok {
		return
	}
	var req struct {
		Discounts map[string]float64 `json:"discounts"`
	}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	normalized, err := common.NormalizeModelDiscounts(req.Discounts)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgOrgDiscountInvalid)
		return
	}

	floors := agentFloorsFromContext(c)
	// 越界的两条消息带 {{.Model}} 占位，需要把出错的模型名传进去。
	if badModel, err := common.ValidateModelDiscountsWithinFloors(normalized, floors); err != nil {
		switch {
		case errors.Is(err, common.ErrAgentModelNotAuthorized):
			common.ApiErrorI18n(c, i18n.MsgAgentModelNotAuthorized, map[string]any{"Model": badModel})
		case errors.Is(err, common.ErrAgentDiscountBelowFloor):
			common.ApiErrorI18n(c, i18n.MsgOrgDiscountBelowFloor, map[string]any{"Model": badModel})
		default:
			common.ApiErrorMsg(c, err.Error())
		}
		return
	}

	// 空配置落库为空串而不是 "{}"，与"无折扣"的历史数据表示一致。
	discountsJSON := ""
	if len(normalized) > 0 {
		payload, err := common.Marshal(normalized)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		discountsJSON = string(payload)
	}
	// SetOrganizationModelDiscounts 内部覆盖全部成员并同步刷新其折扣缓存字段。
	if err := model.SetOrganizationModelDiscounts(org.Id, discountsJSON); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, gin.H{"discounts": normalized})
}

// ListAgentOrganizationMembers 企业成员列表（分页 + keyword），代理商据此在其名下企业管理成员。
func ListAgentOrganizationMembers(c *gin.Context) {
	org, ok := loadOwnedAgentOrganization(c)
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

// CreateAgentOrganizationMember 代理商在自己名下企业内新建成员账号，能力等同企业管理员建号；
// 新账号由 model 层自动继承企业的分组、费率、按模型折扣与代理商归属。
//
// 这是代理商往企业里加人的唯一入口：把既有用户拉进企业会整体覆盖其归属与折扣，
// 属于权限变更，只由系统管理员/企业管理员在企业侧操作。
func CreateAgentOrganizationMember(c *gin.Context) {
	org, ok := loadOwnedAgentOrganization(c)
	if !ok {
		return
	}
	createOrgMember(c, org)
}

// UpdateAgentOrganizationMember 代理商调整名下企业某成员的企业角色/子额度/启用状态。
func UpdateAgentOrganizationMember(c *gin.Context) {
	org, ok := loadOwnedAgentOrganization(c)
	if !ok {
		return
	}
	member, ok := loadScopedOrgMember(c, org.Id, "memberId")
	if !ok {
		return
	}
	updateOrgMember(c, org, member)
}

// RemoveAgentOrganizationMember 代理商把成员移出名下企业：只解绑不删账号，密钥与历史保留。
// 与系统管理员代管一致，代理商是其名下企业的兜底管理渠道，故跳过自移除与最后管理员保护。
func RemoveAgentOrganizationMember(c *gin.Context) {
	org, ok := loadOwnedAgentOrganization(c)
	if !ok {
		return
	}
	member, ok := loadScopedOrgMember(c, org.Id, "memberId")
	if !ok {
		return
	}
	removeOrgMember(c, org, member, true)
}

type createAgentMemberRequest struct {
	Username    string `json:"username"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
}

// CreateAgentMember 代理商新建个人成员账号：账号出生即绑定到当前代理商（受其模型白名单
// 约束，按模型折扣由代理商之后单独设置），余额 0 起步、不发注册赠送。
//
// 只提供新建，不提供「绑定既有用户」：users.agent_id 是权限归属，代理商若能自行认领
// 既有用户，就能把别人（或平台直营）发展的客户连同其折扣划到自己名下。既有用户的绑定
// 只由系统管理员在用户侧完成（AdminBindUserAgent）。
func CreateAgentMember(c *gin.Context) {
	var req createAgentMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" {
		// 复用企业建号的两条文案：内容与企业无关，只讲用户名/密码本身。
		common.ApiErrorI18n(c, i18n.MsgOrgUsernameRequired)
		return
	}
	// 与 User.Password 的 validate:"min=8,max=20" 对齐，先给出可读提示
	if len(req.Password) < 8 || len(req.Password) > 20 {
		common.ApiErrorI18n(c, i18n.MsgOrgPasswordInvalid)
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
	agentId := c.GetInt("agent_id")
	if err := model.CreateAgentMemberUser(user, agentId); err != nil {
		switch {
		case errors.Is(err, model.ErrEmailAlreadyTaken):
			common.ApiErrorI18n(c, i18n.MsgUserEmailAlreadyTaken)
		case errors.Is(err, model.ErrAgentNotFound):
			common.ApiErrorI18n(c, i18n.MsgAgentNotFound)
		case errors.Is(err, model.ErrAgentDisabled):
			common.ApiErrorI18n(c, i18n.MsgAgentDisabled)
		default:
			common.ApiError(c, err)
		}
		return
	}
	recordManageAuditFor(c, user.Id, "agent.member_create", map[string]interface{}{
		"username": user.Username,
		"agent":    agentId,
	})
	common.ApiSuccessI18n(c, i18n.MsgCreateSuccess, gin.H{
		"user_id":  user.Id,
		"username": user.Username,
	})
}

// KickAgentMember 代理商踢出个人成员（解绑 users.agent_id 并清零授权清单内折扣）。
// 企业成员的归属随企业，代理商不得单独踢出。
func KickAgentMember(c *gin.Context) {
	user, ok := loadOwnedAgentMember(c)
	if !ok {
		return
	}
	// 同样以 org_members 为事实源，不读 users.org_id 快照。
	inOrg, err := model.IsUserInAnyOrg(user.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if inOrg {
		common.ApiErrorI18n(c, i18n.MsgOrgMemberAgentBound)
		return
	}
	agentId := c.GetInt("agent_id")
	if err := model.KickAgentMember(user.Id, agentId); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, user.Id, "agent.member_kick", map[string]interface{}{
		"username": user.Username,
		"agent":    agentId,
	})
	common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, nil)
}
