package controller

import (
	"errors"
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// 代理商（Reseller）后台接口。
//
// 分两层，与系统角色解耦：
//   - 系统管理员（AdminAuth）：/api/agent/admin 下提升代理商、配置其授权模型清单与
//     每个模型的折扣下限，以及创建/管理邀请码。
//   - 代理商（AgentAuth）：/api/agent 下自建/管理邀请码、查看导流统计，并在授权下限
//     之上为自己的成员单独设置按模型折扣（见 controller/agent_self.go）。
//
// 折扣只作用于钱包扣费，额度一律按面值入账；代理商体系无佣金、不改 InviterId。

// respondAgentModelError 统一把代理商/邀请码模型错误映射为 i18n 响应，
// 供管理员与代理商两组 controller 复用。
//
// 成员折扣越界（未授权模型 / 低于下限）不走这里：那两条消息带 {{.Model}} 占位，
// 需要调用方把出错的模型名传进去，故在 agent_self.go 内联处理。
func respondAgentModelError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, model.ErrAgentNotFound):
		common.ApiErrorI18n(c, i18n.MsgAgentNotFound)
	case errors.Is(err, model.ErrAgentAlreadyExists):
		common.ApiErrorI18n(c, i18n.MsgAgentAlreadyExists)
	case errors.Is(err, common.ErrAgentModelsEmpty):
		common.ApiErrorI18n(c, i18n.MsgAgentModelDiscountsEmpty)
	case errors.Is(err, model.ErrAgentModelDiscountsInvalid):
		common.ApiErrorI18n(c, i18n.MsgAgentModelDiscountInvalid)
	case errors.Is(err, model.ErrInviteCodeNotFound):
		common.ApiErrorI18n(c, i18n.MsgInviteCodeNotFound)
	case errors.Is(err, model.ErrInviteCodeDisabled):
		common.ApiErrorI18n(c, i18n.MsgInviteCodeDisabled)
	case errors.Is(err, model.ErrInviteCodeExpired):
		common.ApiErrorI18n(c, i18n.MsgInviteCodeExpired)
	case errors.Is(err, model.ErrInviteCodeExhausted):
		common.ApiErrorI18n(c, i18n.MsgInviteCodeExhausted)
	case errors.Is(err, model.ErrInviteCodeStatus):
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
	case errors.Is(err, model.ErrInviteCodeGenerate):
		common.ApiErrorI18n(c, i18n.MsgInviteCodeGenerateErr)
	default:
		common.ApiError(c, err)
	}
}

// parseAgentPathId 解析路径参数 :id，非法时已写好响应。
func parseAgentPathId(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidId)
		return 0, false
	}
	return id, true
}

// normalizeAgentModelDiscounts 校验管理员提交的授权配置并序列化成落库 JSON。
// 空配置在这里就被拦下：授权清单为空等于「成员一个模型都调不通」，是个陷井。
func normalizeAgentModelDiscounts(discounts map[string]float64) (string, error) {
	normalized, err := common.NormalizeAgentModelFloors(discounts)
	if err != nil {
		return "", err
	}
	payload, err := common.Marshal(normalized)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

func isValidAgentStatus(status int) bool {
	return status == model.AgentStatusEnabled || status == model.AgentStatusDisabled
}

func isValidInviteCodeStatus(status int) bool {
	return status == model.InviteCodeStatusEnabled || status == model.InviteCodeStatusDisabled
}

// ---- 管理员：代理商 CRUD ----

type adminCreateAgentRequest struct {
	UserId         int                `json:"user_id"`
	ModelDiscounts map[string]float64 `json:"model_discounts"`
	Remark         string             `json:"remark"`
	// MenuVisibility 是该代理商可见的功能菜单键集合，缺省（nil/空）表示全部隐藏。
	MenuVisibility []string `json:"menu_visibility"`
}

// AdminListAgents 代理商列表（含用户名/邮箱与其名下邀请码数量）。
func AdminListAgents(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	agents, total, err := model.ListAgents(pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(agents)
	common.ApiSuccess(c, pageInfo)
}

// AdminListServableModels 返回当前全平台可服务的模型名，供提升代理商时的授权模型
// 下拉选择。这里取 abilities 的启用模型全集而不是 /api/pricing：pricing 会按调用者
// 的可用分组过滤，管理员也会漏掉仅在其他分组启用的模型，下拉就会缺项。
func AdminListServableModels(c *gin.Context) {
	models := model.GetEnabledModels()
	sort.Strings(models)
	common.ApiSuccess(c, models)
}

// AdminCreateAgent 把已注册用户提升为代理商并配置授权模型清单与折扣下限。
func AdminCreateAgent(c *gin.Context) {
	var req adminCreateAgentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if req.UserId <= 0 {
		common.ApiErrorI18n(c, i18n.MsgAgentUserNotFound)
		return
	}
	if _, err := model.GetUserById(req.UserId, false); err != nil {
		common.ApiErrorI18n(c, i18n.MsgAgentUserNotFound)
		return
	}
	modelDiscounts, err := normalizeAgentModelDiscounts(req.ModelDiscounts)
	if err != nil {
		respondAgentModelError(c, err)
		return
	}
	menuVisibility, err := model.NormalizeAgentMenuVisibility(req.MenuVisibility)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	agent := &model.Agent{
		UserId:         req.UserId,
		ModelDiscounts: modelDiscounts,
		MenuVisibility: menuVisibility,
		Status:         model.AgentStatusEnabled,
		Remark:         strings.TrimSpace(req.Remark),
		CreatedBy:      c.GetInt("id"),
	}
	if err := model.CreateAgent(agent); err != nil {
		respondAgentModelError(c, err)
		return
	}
	common.ApiSuccessI18n(c, i18n.MsgCreateSuccess, agent)
}

type adminUpdateAgentRequest struct {
	ModelDiscounts *map[string]float64 `json:"model_discounts"`
	Status         *int                `json:"status"`
	Remark         *string             `json:"remark"`
	// MenuVisibility 为 nil 表示本次不改动可见菜单；传空数组表示清空（全部隐藏）。
	MenuVisibility *[]string `json:"menu_visibility"`
}

// AdminUpdateAgent 修改代理商授权配置/状态/备注。
// 授权配置整体替换而非合并：前端编辑器提交的就是完整清单，
// 按模型逐个 merge 会让「删掉一个模型」无法表达。
func AdminUpdateAgent(c *gin.Context) {
	id, ok := parseAgentPathId(c)
	if !ok {
		return
	}
	if _, err := model.GetAgentById(id); err != nil {
		respondAgentModelError(c, err)
		return
	}
	var req adminUpdateAgentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	fields := make(map[string]interface{})
	if req.ModelDiscounts != nil {
		modelDiscounts, err := normalizeAgentModelDiscounts(*req.ModelDiscounts)
		if err != nil {
			respondAgentModelError(c, err)
			return
		}
		fields["model_discounts"] = modelDiscounts
	}
	if req.Status != nil {
		if !isValidAgentStatus(*req.Status) {
			common.ApiErrorI18n(c, i18n.MsgInvalidParams)
			return
		}
		// 状态只冻结代理商自己的控制台（AgentAuth 会拒绝 Disabled），
		// 不影响其成员的模型访问——成员是付过费的终端用户，不应因代理被禁用而断服。
		fields["status"] = *req.Status
	}
	if req.Remark != nil {
		fields["remark"] = strings.TrimSpace(*req.Remark)
	}
	if req.MenuVisibility != nil {
		menuVisibility, err := model.NormalizeAgentMenuVisibility(*req.MenuVisibility)
		if err != nil {
			common.ApiErrorI18n(c, i18n.MsgInvalidParams)
			return
		}
		fields["menu_visibility"] = menuVisibility
	}
	if len(fields) == 0 {
		common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, nil)
		return
	}
	if err := model.UpdateAgentFields(id, fields); err != nil {
		respondAgentModelError(c, err)
		return
	}
	common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, nil)
}

// AdminDeleteAgent 删除代理商记录。其成员的 agent_id 会被解绑（置 0），
// 成员随即恢复全模型访问；已设置的按模型折扣保留不动，历史邀请码也保留。
func AdminDeleteAgent(c *gin.Context) {
	id, ok := parseAgentPathId(c)
	if !ok {
		return
	}
	if err := model.DeleteAgent(id); err != nil {
		respondAgentModelError(c, err)
		return
	}
	common.ApiSuccessI18n(c, i18n.MsgDeleteSuccess, nil)
}

// ---- 管理员：邀请码 CRUD ----

type adminCreateInviteCodeRequest struct {
	MaxUses   int    `json:"max_uses"`
	ExpiresAt int64  `json:"expires_at"`
	Remark    string `json:"remark"`
}

// AdminListInviteCodes 全部邀请码，可按 owner_user_id / owner_type 过滤。
func AdminListInviteCodes(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	ownerUserId, _ := strconv.Atoi(c.Query("owner_user_id"))
	ownerType := strings.TrimSpace(c.Query("owner_type"))
	codes, total, err := model.ListInviteCodes(pageInfo, ownerUserId, ownerType)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(codes)
	common.ApiSuccess(c, pageInfo)
}

// AdminCreateInviteCode 管理员建码。码归属管理员，注册后只记录引流、不绑定代理商，
// 因此被邀请用户不受任何模型白名单限制。
func AdminCreateInviteCode(c *gin.Context) {
	var req adminCreateInviteCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	ic := &model.InviteCode{
		OwnerType:   model.OwnerTypeAdmin,
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

// updateInviteCodeRequest 邀请码更新请求。邀请码不携带折扣，可改的只有
// 次数/有效期/状态/备注四项。
type updateInviteCodeRequest struct {
	MaxUses   *int    `json:"max_uses"`
	ExpiresAt *int64  `json:"expires_at"`
	Status    *int    `json:"status"`
	Remark    *string `json:"remark"`
}

// buildInviteCodeUpdateFields 从更新请求构造字段白名单并做通用校验。
func buildInviteCodeUpdateFields(req *updateInviteCodeRequest) (map[string]interface{}, error) {
	fields := make(map[string]interface{})
	if req.MaxUses != nil {
		maxUses := *req.MaxUses
		if maxUses < 0 {
			maxUses = 0
		}
		fields["max_uses"] = maxUses
	}
	if req.ExpiresAt != nil {
		expiresAt := *req.ExpiresAt
		if expiresAt < 0 {
			expiresAt = 0
		}
		fields["expires_at"] = expiresAt
	}
	if req.Status != nil {
		if !isValidInviteCodeStatus(*req.Status) {
			return nil, model.ErrInviteCodeStatus
		}
		fields["status"] = *req.Status
	}
	if req.Remark != nil {
		fields["remark"] = strings.TrimSpace(*req.Remark)
	}
	return fields, nil
}

// AdminUpdateInviteCode 管理员改任意邀请码（不限归属）。
func AdminUpdateInviteCode(c *gin.Context) {
	id, ok := parseAgentPathId(c)
	if !ok {
		return
	}
	if _, err := model.GetInviteCodeById(id); err != nil {
		respondAgentModelError(c, err)
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
	if err := model.UpdateInviteCodeFields(id, fields); err != nil {
		respondAgentModelError(c, err)
		return
	}
	common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, nil)
}
