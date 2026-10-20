package controller

import (
	"errors"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// 代理商自助接口：均要求 UserAuth + AgentAuth。授权配置一律以服务端 Agent 记录为准
// （由 AgentAuth 写入 gin.Context），忽略客户端传入值；给成员设折扣时强制
// 「模型必须在授权清单内」且「折扣不得低于该模型的下限」，越界返回 400。

// agentFloorsFromContext 取出当前代理商的授权配置 {模型名: 折扣下限}。
// 永不返回 nil：调用方直接把它当 map 遍历/查键，省去逐处判空。
func agentFloorsFromContext(c *gin.Context) map[string]float64 {
	floors := common.ParseModelDiscounts(c.GetString("agent_model_discounts"))
	if floors == nil {
		floors = map[string]float64{}
	}
	return floors
}

// GetAgentProfile 我的授权配置与导流概览统计。
func GetAgentProfile(c *gin.Context) {
	agentId := c.GetInt("agent_id")
	userId := c.GetInt("id")

	codeCount, totalUsed, err := model.GetAgentInviteSummary(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	stats, err := model.GetAgentStats(agentId)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	floors := agentFloorsFromContext(c)
	// allowed_models 与 floors 的键集合相同，单独下发是为了让前端不必自己从 map 抽键，
	// 同时保证顺序稳定——否则模型下拉每次刷新都换序。
	allowed := make([]string, 0, len(floors))
	for name := range floors {
		allowed = append(allowed, name)
	}
	sort.Strings(allowed)

	common.ApiSuccess(c, gin.H{
		"model_discounts": floors,
		"allowed_models":  allowed,
		"code_count":      codeCount,
		"total_used":      totalUsed,
		"member_count":    stats.MemberCount,
		"total_recharge":  stats.TotalRecharge,
	})
}

// ListAgentInviteCodes 我的邀请码分页列表。UsedCount 即通过该码注册成功的用户数。
func ListAgentInviteCodes(c *gin.Context) {
	userId := c.GetInt("id")
	pageInfo := common.GetPageQuery(c)
	codes, total, err := model.ListInviteCodes(pageInfo, userId, model.OwnerTypeAgent)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(codes)
	common.ApiSuccess(c, pageInfo)
}

// ListAgentMembers 我的成员（注册时用我邀请码绑定过来的用户）分页列表。
func ListAgentMembers(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	members, total, err := model.ListAgentMembers(c.GetInt("agent_id"), pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(members)
	common.ApiSuccess(c, pageInfo)
}

// ListAgentRecharge 我的成员的成功充值流水分页列表。
func ListAgentRecharge(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	records, total, err := model.ListAgentRechargeRecords(c.GetInt("agent_id"), pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(records)
	common.ApiSuccess(c, pageInfo)
}

type createAgentInviteCodeRequest struct {
	MaxUses   int    `json:"max_uses"`
	ExpiresAt int64  `json:"expires_at"`
	Remark    string `json:"remark"`
}

// CreateAgentInviteCode 代理商建码。码不携带折扣，因此没有范围需要校验；
// 用它注册的用户会绑定到本代理商，只能调用授权清单内的模型。
func CreateAgentInviteCode(c *gin.Context) {
	var req createAgentInviteCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	ic := &model.InviteCode{
		OwnerType:   model.OwnerTypeAgent,
		OwnerUserId: c.GetInt("id"),
		MaxUses:     req.MaxUses,
		ExpiresAt:   req.ExpiresAt,
		Status:      model.InviteCodeStatusEnabled,
		Remark:      strings.TrimSpace(req.Remark),
	}
	if err := model.CreateInviteCode(ic); err != nil {
		respondAgentModelError(c, err)
		return
	}
	common.ApiSuccessI18n(c, i18n.MsgCreateSuccess, ic)
}

// loadOwnedAgentInviteCode 按路径参数读取邀请码并校验归属当前代理商，失败时已写好响应。
func loadOwnedAgentInviteCode(c *gin.Context) (*model.InviteCode, bool) {
	id, ok := parseAgentPathId(c)
	if !ok {
		return nil, false
	}
	ic, err := model.GetInviteCodeById(id)
	if err != nil {
		respondAgentModelError(c, err)
		return nil, false
	}
	if ic.OwnerType != model.OwnerTypeAgent || ic.OwnerUserId != c.GetInt("id") {
		common.ApiErrorI18n(c, i18n.MsgInviteCodeNotOwned)
		return nil, false
	}
	return ic, true
}

// UpdateAgentInviteCode 代理商改/禁用自有邀请码：重校验归属。
func UpdateAgentInviteCode(c *gin.Context) {
	ic, ok := loadOwnedAgentInviteCode(c)
	if !ok {
		return
	}
	var req updateInviteCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	fields, err := buildInviteCodeUpdateFields(&req)
	if err != nil {
		respondAgentModelError(c, err)
		return
	}
	if len(fields) == 0 {
		common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, nil)
		return
	}
	if err := model.UpdateInviteCodeFields(ic.Id, fields); err != nil {
		respondAgentModelError(c, err)
		return
	}
	common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, nil)
}

// loadOwnedAgentMember 按路径参数读取成员并校验其确实归属当前代理商，失败时已写好响应。
// 归属判定以 users.agent_id == 我的 agents.id 为准，而不是靠邀请码反查：
// 后者在换码、删代理商之后会留下悬空引用，且 users 上已不再冗余存码。
func loadOwnedAgentMember(c *gin.Context) (*model.User, bool) {
	id, ok := parseAgentPathId(c)
	if !ok {
		return nil, false
	}
	user, err := model.GetUserById(id, false)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgUserNotExists)
		return nil, false
	}
	if user.AgentId != c.GetInt("agent_id") {
		common.ApiErrorI18n(c, i18n.MsgAgentMemberNotOwned)
		return nil, false
	}
	return user, true
}

// GetAgentMemberModelDiscounts 读取某成员当前的按模型折扣，并附带我的授权下限。
// 一并下发 floors 是为了让前端能约束百分比输入框的 min，而不是等提交后才被 400 挡回。
func GetAgentMemberModelDiscounts(c *gin.Context) {
	user, ok := loadOwnedAgentMember(c)
	if !ok {
		return
	}
	discounts := common.ParseModelDiscounts(user.ModelDiscounts)
	if discounts == nil {
		discounts = map[string]float64{}
	}
	common.ApiSuccess(c, gin.H{
		"discounts": discounts,
		"floors":    agentFloorsFromContext(c),
	})
}

// UpdateAgentMemberModelDiscounts 为某成员设置按模型折扣。
// 提交的是「授权范围内」的完整折扣表：清单内未提交的模型视为取消折扣（恢复原价），
// 每个提交的模型都必须已授权且折扣 >= 该模型的下限。
func UpdateAgentMemberModelDiscounts(c *gin.Context) {
	user, ok := loadOwnedAgentMember(c)
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
		common.ApiErrorMsg(c, err.Error())
		return
	}

	floors := agentFloorsFromContext(c)
	// 越界的两条消息带 {{.Model}} 占位，需要把出错的模型名传进去，
	// 因此不走 respondAgentModelError（它拿不到模型名）。
	if badModel, err := common.ValidateModelDiscountsWithinFloors(normalized, floors); err != nil {
		switch {
		case errors.Is(err, common.ErrAgentModelNotAuthorized):
			common.ApiErrorI18n(c, i18n.MsgAgentModelNotAuthorized, map[string]any{"Model": badModel})
		case errors.Is(err, common.ErrAgentDiscountBelowFloor):
			common.ApiErrorI18n(c, i18n.MsgAgentDiscountBelowFloor, map[string]any{"Model": badModel})
		default:
			common.ApiErrorMsg(c, err.Error())
		}
		return
	}

	// 合并而不是整体替换：成员可能还带有管理员为其配置的、超出本代理授权范围的折扣。
	// 代理商只能改自己授权清单内的模型，清单外的条目原样保留——否则代理商一次提交
	// 就会静默清掉管理员的配置，直到删除代理商、成员恢复全模型访问时才发现折扣丢了。
	merged := common.ParseModelDiscounts(user.ModelDiscounts)
	if merged == nil {
		merged = map[string]float64{}
	}

	// 价格只能上调：提交值低于成员已存折扣即拒，UI 的输入框 min 只是第一道闸。
	if badModel, err := common.ValidateModelDiscountsNotLowered(normalized, merged); err != nil {
		common.ApiErrorI18n(c, i18n.MsgAgentDiscountLowered, map[string]any{"Model": badModel})
		return
	}

	for modelName := range merged {
		if _, authorized := floors[modelName]; authorized {
			delete(merged, modelName)
		}
	}
	for modelName, ratio := range normalized {
		merged[modelName] = ratio
	}

	// 空配置落库为空串而不是 "{}"，保持“无折扣”与历史数据表示一致。
	discountsJSON := ""
	if len(merged) > 0 {
		payload, err := common.Marshal(merged)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		discountsJSON = string(payload)
	}
	// UpdateUserModelDiscounts 内部会同步刷新用户缓存里的 model_discounts 字段，
	// 计费读的正是这份缓存，因此无需额外失效。
	if err := model.UpdateUserModelDiscounts(user.Id, discountsJSON); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, gin.H{"discounts": merged})
}
