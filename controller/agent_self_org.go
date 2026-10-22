package controller

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// 代理商自助端的企业（组织）发展与个人成员邀请/踢出。
//
// 归属判定一律以服务端写入 gin.Context 的 agent_id 为准（AgentAuth），忽略客户端传入值。
// 代理商只能操作 organizations.agent_id == 自己 的企业；企业折扣只能在自己的授权下限内设置，
// 保存时整表覆盖企业折扣并同步全部成员。个人成员的邀请/踢出复用 users.agent_id 绑定链路，
// 但企业成员的归属随企业，代理商不得单独邀请或踢出企业内用户。

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
	Name          string `json:"name"`
	DisplayName   string `json:"display_name"`
	OwnerUsername string `json:"owner_username"`
}

// CreateAgentOrganization 代理商创建企业：企业名 + 管理员 username，初始池 0，
// 建成后立即绑定到当前代理商（SetOrganizationAgent 同步全部成员归属）。
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
	// 先解析企业管理员再落库：用户名不存在时必须零副作用返回，避免留下无主企业。
	ownerUsername := strings.TrimSpace(req.OwnerUsername)
	if ownerUsername == "" {
		common.ApiErrorI18n(c, i18n.MsgOrgUsernameRequired)
		return
	}
	owner, err := model.GetUserByUsername(ownerUsername)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgOrgUserNotFound)
		return
	}

	org := &model.Organization{
		Name:        name,
		DisplayName: strings.TrimSpace(req.DisplayName),
		Group:       model.DefaultUserGroup,
		OwnerUserId: 0,
	}
	if err := model.CreateOrganizationWithSetup(org, 0, owner.Id); err != nil {
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
	recordManageAuditFor(c, owner.Id, "org.agent_bind", map[string]interface{}{
		"id":     created.Id,
		"name":   orgAuditName(created),
		"agent":  agentId,
		"action": "create",
	})
	common.ApiSuccessI18n(c, i18n.MsgCreateSuccess, created)
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

// ListAgentOrganizationMembers 企业成员只读列表（代理商不管理成员，仅查看）。
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

type inviteAgentMemberRequest struct {
	Username string `json:"username"`
}

// InviteAgentMember 代理商邀请既有个人用户成为自己的成员（按 username）。
// 语义等价邀请码注册：受授权白名单约束。企业成员的归属随企业，代理商不得单独邀请，
// 已绑定其他代理商的用户也不提供抢绑入口。
func InviteAgentMember(c *gin.Context) {
	var req inviteAgentMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	username := strings.TrimSpace(req.Username)
	if username == "" {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	user, err := model.GetUserByUsername(username)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgUserNotExists)
		return
	}
	agentId := c.GetInt("agent_id")
	if user.OrgId > 0 {
		common.ApiErrorI18n(c, i18n.MsgOrgMemberAgentBound)
		return
	}
	if user.AgentId == agentId {
		// 已是本代理商成员，幂等返回成功。
		common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, nil)
		return
	}
	if user.AgentId != 0 {
		common.ApiErrorI18n(c, i18n.MsgAgentMemberBoundOther)
		return
	}
	if err := model.SetUserAgentBinding(user.Id, agentId); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, user.Id, "agent.member_invite", map[string]interface{}{
		"username": user.Username,
		"agent":    agentId,
	})
	common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, nil)
}

// KickAgentMember 代理商踢出个人成员（解绑 users.agent_id 并清零授权清单内折扣）。
// 企业成员的归属随企业，代理商不得单独踢出。
func KickAgentMember(c *gin.Context) {
	user, ok := loadOwnedAgentMember(c)
	if !ok {
		return
	}
	if user.OrgId > 0 {
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
