package controller

import (
	"errors"
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
//   - 系统管理员（AdminAuth）：/api/agent/admin 下提升代理商、设定折扣范围，
//     以及无范围限制地创建/管理折扣码。
//   - 代理商（AgentAuth）：/api/agent 下在被允许的折扣范围内自建/管理折扣码，
//     并查看导流统计（见 controller/agent_self.go）。
//
// 折扣只降低实付金额，额度一律按面值入账；代理商体系无佣金、不改 InviterId。

// respondAgentModelError 统一把代理商/折扣码模型错误映射为 i18n 响应，
// 供管理员与代理商两组 controller 复用。
func respondAgentModelError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, model.ErrAgentNotFound):
		common.ApiErrorI18n(c, i18n.MsgAgentNotFound)
	case errors.Is(err, model.ErrAgentAlreadyExists):
		common.ApiErrorI18n(c, i18n.MsgAgentAlreadyExists)
	case errors.Is(err, model.ErrAgentDiscountRange):
		common.ApiErrorI18n(c, i18n.MsgAgentDiscountRange)
	case errors.Is(err, model.ErrDiscountCodeNotFound):
		common.ApiErrorI18n(c, i18n.MsgDiscountCodeNotFound)
	case errors.Is(err, model.ErrDiscountCodeDisabled):
		common.ApiErrorI18n(c, i18n.MsgDiscountCodeDisabled)
	case errors.Is(err, model.ErrDiscountCodeExpired):
		common.ApiErrorI18n(c, i18n.MsgDiscountCodeExpired)
	case errors.Is(err, model.ErrDiscountCodeExhausted):
		common.ApiErrorI18n(c, i18n.MsgDiscountCodeExhausted)
	case errors.Is(err, model.ErrDiscountInvalid):
		common.ApiErrorI18n(c, i18n.MsgDiscountCodeInvalid)
	case errors.Is(err, model.ErrDiscountOutOfRange):
		common.ApiErrorI18n(c, i18n.MsgAgentDiscountOutOfRang)
	case errors.Is(err, model.ErrDiscountCodeGenerate):
		common.ApiErrorI18n(c, i18n.MsgDiscountCodeGenerateErr)
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

// attachDiscountCodeStats 批量回填折扣码的导流统计（绑定用户数与充值面值总额）。
func attachDiscountCodeStats(codes []*model.DiscountInviteCode) {
	if len(codes) == 0 {
		return
	}
	codeStrs := make([]string, 0, len(codes))
	for _, dc := range codes {
		codeStrs = append(codeStrs, dc.Code)
	}
	stats, err := model.GetDiscountCodeStats(codeStrs)
	if err != nil {
		return
	}
	for _, dc := range codes {
		if s, ok := stats[dc.Code]; ok {
			dc.InvitedUserCount = s.UserCount
			dc.InvitedRecharge = s.TotalRecharge
		}
	}
}

func isValidAgentStatus(status int) bool {
	return status == model.AgentStatusEnabled || status == model.AgentStatusDisabled
}

func isValidDiscountCodeStatus(status int) bool {
	return status == model.DiscountCodeStatusEnabled || status == model.DiscountCodeStatusDisabled
}

// ---- 管理员：代理商 CRUD ----

type adminCreateAgentRequest struct {
	UserId      int     `json:"user_id"`
	MinDiscount float64 `json:"min_discount"`
	MaxDiscount float64 `json:"max_discount"`
	Remark      string  `json:"remark"`
}

// AdminListAgents 代理商列表（含用户名/邮箱与其名下折扣码数量）。
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

// AdminCreateAgent 把已注册用户提升为代理商并设定折扣范围。
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
	if err := model.ValidateAgentDiscountRange(req.MinDiscount, req.MaxDiscount); err != nil {
		respondAgentModelError(c, err)
		return
	}
	agent := &model.Agent{
		UserId:      req.UserId,
		MinDiscount: req.MinDiscount,
		MaxDiscount: req.MaxDiscount,
		Status:      model.AgentStatusEnabled,
		Remark:      strings.TrimSpace(req.Remark),
		CreatedBy:   c.GetInt("id"),
	}
	if err := model.CreateAgent(agent); err != nil {
		respondAgentModelError(c, err)
		return
	}
	common.ApiSuccessI18n(c, i18n.MsgCreateSuccess, agent)
}

type adminUpdateAgentRequest struct {
	MinDiscount *float64 `json:"min_discount"`
	MaxDiscount *float64 `json:"max_discount"`
	Status      *int     `json:"status"`
	Remark      *string  `json:"remark"`
}

// AdminUpdateAgent 修改代理商折扣范围/状态/备注。范围变更按合并后的最终值校验。
func AdminUpdateAgent(c *gin.Context) {
	id, ok := parseAgentPathId(c)
	if !ok {
		return
	}
	agent, err := model.GetAgentById(id)
	if err != nil {
		respondAgentModelError(c, err)
		return
	}
	var req adminUpdateAgentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	fields := make(map[string]interface{})
	newMin, newMax := agent.MinDiscount, agent.MaxDiscount
	if req.MinDiscount != nil {
		newMin = *req.MinDiscount
		fields["min_discount"] = newMin
	}
	if req.MaxDiscount != nil {
		newMax = *req.MaxDiscount
		fields["max_discount"] = newMax
	}
	if req.MinDiscount != nil || req.MaxDiscount != nil {
		if err := model.ValidateAgentDiscountRange(newMin, newMax); err != nil {
			respondAgentModelError(c, err)
			return
		}
	}
	if req.Status != nil {
		if !isValidAgentStatus(*req.Status) {
			common.ApiErrorI18n(c, i18n.MsgInvalidParams)
			return
		}
		fields["status"] = *req.Status
	}
	if req.Remark != nil {
		fields["remark"] = strings.TrimSpace(*req.Remark)
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

// AdminDeleteAgent 删除代理商记录（不影响其历史折扣码与已绑定用户的既有折扣）。
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

// ---- 管理员：折扣码 CRUD（无折扣范围限制） ----

type adminCreateDiscountCodeRequest struct {
	Discount  float64 `json:"discount"`
	MaxUses   int     `json:"max_uses"`
	ExpiresAt int64   `json:"expires_at"`
	Remark    string  `json:"remark"`
}

// AdminListDiscountCodes 全部折扣码，可按 owner_user_id / owner_type 过滤。
func AdminListDiscountCodes(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	ownerUserId, _ := strconv.Atoi(c.Query("owner_user_id"))
	ownerType := strings.TrimSpace(c.Query("owner_type"))
	codes, total, err := model.ListDiscountCodes(pageInfo, ownerUserId, ownerType)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	attachDiscountCodeStats(codes)
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(codes)
	common.ApiSuccess(c, pageInfo)
}

// AdminCreateDiscountCode 管理员建码：仅校验 0 < discount <= 1，无范围限制。
func AdminCreateDiscountCode(c *gin.Context) {
	var req adminCreateDiscountCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if err := model.ValidateDiscountValue(req.Discount); err != nil {
		respondAgentModelError(c, err)
		return
	}
	dc := &model.DiscountInviteCode{
		OwnerType:   model.OwnerTypeAdmin,
		OwnerUserId: c.GetInt("id"),
		Discount:    req.Discount,
		MaxUses:     req.MaxUses,
		ExpiresAt:   req.ExpiresAt,
		Status:      model.DiscountCodeStatusEnabled,
		Remark:      strings.TrimSpace(req.Remark),
	}
	if err := model.CreateDiscountCode(dc); err != nil {
		respondAgentModelError(c, err)
		return
	}
	common.ApiSuccessI18n(c, i18n.MsgCreateSuccess, dc)
}

type updateDiscountCodeRequest struct {
	Discount  *float64 `json:"discount"`
	MaxUses   *int     `json:"max_uses"`
	ExpiresAt *int64   `json:"expires_at"`
	Status    *int     `json:"status"`
	Remark    *string  `json:"remark"`
}

// buildDiscountCodeUpdateFields 从更新请求构造字段白名单，并做通用校验（折扣边界/状态取值）。
// 代理商侧调用时会额外传入其允许区间做范围校验；管理员侧传 (0,0) 表示不限范围。
func buildDiscountCodeUpdateFields(req *updateDiscountCodeRequest, minDiscount, maxDiscount float64) (map[string]interface{}, error) {
	fields := make(map[string]interface{})
	if req.Discount != nil {
		d := *req.Discount
		var err error
		if minDiscount > 0 || maxDiscount > 0 {
			err = model.ValidateDiscountInRange(d, minDiscount, maxDiscount)
		} else {
			err = model.ValidateDiscountValue(d)
		}
		if err != nil {
			return nil, err
		}
		fields["discount"] = d
	}
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
		if !isValidDiscountCodeStatus(*req.Status) {
			return nil, model.ErrDiscountInvalid
		}
		fields["status"] = *req.Status
	}
	if req.Remark != nil {
		fields["remark"] = strings.TrimSpace(*req.Remark)
	}
	return fields, nil
}

// AdminUpdateDiscountCode 管理员改任意折扣码（无范围限制）。
func AdminUpdateDiscountCode(c *gin.Context) {
	id, ok := parseAgentPathId(c)
	if !ok {
		return
	}
	if _, err := model.GetDiscountCodeById(id); err != nil {
		respondAgentModelError(c, err)
		return
	}
	var req updateDiscountCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	fields, err := buildDiscountCodeUpdateFields(&req, 0, 0)
	if err != nil {
		respondAgentModelError(c, err)
		return
	}
	if len(fields) == 0 {
		common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, nil)
		return
	}
	if err := model.UpdateDiscountCodeFields(id, fields); err != nil {
		respondAgentModelError(c, err)
		return
	}
	common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, nil)
}

// AdminDeleteDiscountCode 管理员删除任意折扣码。
func AdminDeleteDiscountCode(c *gin.Context) {
	id, ok := parseAgentPathId(c)
	if !ok {
		return
	}
	if err := model.DeleteDiscountCode(id); err != nil {
		respondAgentModelError(c, err)
		return
	}
	common.ApiSuccessI18n(c, i18n.MsgDeleteSuccess, nil)
}
