package controller

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// 代理商自助接口：均要求 UserAuth + AgentAuth。折扣范围一律以服务端 Agent 记录为准
// （由 AgentAuth 写入 gin.Context），忽略客户端传入范围；建码/改码时强制
// MinDiscount <= discount <= MaxDiscount，越界返回 400。

// GetAgentProfile 我的折扣范围与导流概览统计。
func GetAgentProfile(c *gin.Context) {
	userId := c.GetInt("id")
	minDiscount := c.GetFloat64("agent_min_discount")
	maxDiscount := c.GetFloat64("agent_max_discount")

	codes, err := model.GetDiscountCodesByOwner(userId, model.OwnerTypeAgent)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	codeStrs := make([]string, 0, len(codes))
	for _, dc := range codes {
		codeStrs = append(codeStrs, dc.Code)
	}
	stats, _ := model.GetDiscountCodeStats(codeStrs)
	var invitedUsers, totalRecharge, totalUsed int64
	for _, dc := range codes {
		totalUsed += int64(dc.UsedCount)
		if s, ok := stats[dc.Code]; ok {
			invitedUsers += s.UserCount
			totalRecharge += s.TotalRecharge
		}
	}
	common.ApiSuccess(c, gin.H{
		"min_discount":   minDiscount,
		"max_discount":   maxDiscount,
		"code_count":     len(codes),
		"total_used":     totalUsed,
		"invited_users":  invitedUsers,
		"total_recharge": totalRecharge,
	})
}

// ListAgentCodes 我的折扣码 + 使用与导流统计。
func ListAgentCodes(c *gin.Context) {
	userId := c.GetInt("id")
	pageInfo := common.GetPageQuery(c)
	codes, total, err := model.ListDiscountCodes(pageInfo, userId, model.OwnerTypeAgent)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	attachDiscountCodeStats(codes)
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(codes)
	common.ApiSuccess(c, pageInfo)
}

type createAgentCodeRequest struct {
	Discount  float64 `json:"discount"`
	MaxUses   int     `json:"max_uses"`
	ExpiresAt int64   `json:"expires_at"`
	Remark    string  `json:"remark"`
}

// CreateAgentCode 代理商建码：服务端强制折扣落在其被允许区间内，越界拒绝。
func CreateAgentCode(c *gin.Context) {
	var req createAgentCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	minDiscount := c.GetFloat64("agent_min_discount")
	maxDiscount := c.GetFloat64("agent_max_discount")
	if err := model.ValidateDiscountInRange(req.Discount, minDiscount, maxDiscount); err != nil {
		respondAgentModelError(c, err)
		return
	}
	dc := &model.DiscountInviteCode{
		OwnerType:   model.OwnerTypeAgent,
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

// loadOwnedAgentCode 按路径参数读取折扣码并校验归属当前代理商，失败时已写好响应。
func loadOwnedAgentCode(c *gin.Context) (*model.DiscountInviteCode, bool) {
	id, ok := parseAgentPathId(c)
	if !ok {
		return nil, false
	}
	dc, err := model.GetDiscountCodeById(id)
	if err != nil {
		respondAgentModelError(c, err)
		return nil, false
	}
	if dc.OwnerType != model.OwnerTypeAgent || dc.OwnerUserId != c.GetInt("id") {
		common.ApiErrorI18n(c, i18n.MsgDiscountCodeNotOwned)
		return nil, false
	}
	return dc, true
}

// UpdateAgentCode 代理商改/禁用自有折扣码：重校验折扣范围与归属。
func UpdateAgentCode(c *gin.Context) {
	dc, ok := loadOwnedAgentCode(c)
	if !ok {
		return
	}
	var req updateDiscountCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	minDiscount := c.GetFloat64("agent_min_discount")
	maxDiscount := c.GetFloat64("agent_max_discount")
	fields, err := buildDiscountCodeUpdateFields(&req, minDiscount, maxDiscount)
	if err != nil {
		respondAgentModelError(c, err)
		return
	}
	if len(fields) == 0 {
		common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, nil)
		return
	}
	if err := model.UpdateDiscountCodeFields(dc.Id, fields); err != nil {
		respondAgentModelError(c, err)
		return
	}
	common.ApiSuccessI18n(c, i18n.MsgUpdateSuccess, nil)
}

// DeleteAgentCode 代理商删除自有折扣码（不影响已绑定用户的既有折扣）。
func DeleteAgentCode(c *gin.Context) {
	dc, ok := loadOwnedAgentCode(c)
	if !ok {
		return
	}
	if err := model.DeleteDiscountCode(dc.Id); err != nil {
		respondAgentModelError(c, err)
		return
	}
	common.ApiSuccessI18n(c, i18n.MsgDeleteSuccess, nil)
}
