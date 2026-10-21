package controller

import (
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/system_setting"

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

// ---------------------------------------------------------------------------
// 代理商范围化的使用日志 / 任务日志 / 绘图日志 / 账单中心
//
// 隐私总则：代理商可见的数据一律限定在 allowedIds = 名下成员 ∪ 自己 之内；客户端传入的
// user_ids 只能在此集合内取子集，交集为空则返回空结果，绝不回退为全量。身份（agent_id
// 与自己的 user id）一律取自服务端写入的 gin.Context，忽略客户端越权值。字段口径与普通
// 用户的 self 视图一致（最小权限）：不含 channel、admin_info、操作人、企业归属等内部字段。
// ---------------------------------------------------------------------------

// agentLogScope 返回当前代理商可见的全部用户 ID：名下成员 ∪ 自己。
// 这是服务端强制范围的“全集”，客户端 user_ids 只能在其内取子集。
func agentLogScope(c *gin.Context) ([]int, error) {
	memberIds, err := model.ListAgentMemberIds(c.GetInt("agent_id"))
	if err != nil {
		return nil, err
	}
	allowed := make([]int, 0, len(memberIds)+1)
	seen := make(map[int]bool, len(memberIds)+1)
	for _, id := range memberIds {
		if id > 0 && !seen[id] {
			seen[id] = true
			allowed = append(allowed, id)
		}
	}
	// 并入代理商自己的 user id：代理商本人同样可能产生使用/充值记录。
	if selfId := c.GetInt("id"); selfId > 0 && !seen[selfId] {
		allowed = append(allowed, selfId)
	}
	return allowed, nil
}

// effectiveScopeIds 解析客户端 user_ids 并与 allowedIds 取交集：
//   - 缺省或 "all"：返回全部 allowedIds（整个可见范围）；
//   - 明确的 id 列表：只保留落在 allowedIds 内的 id；
//   - 交集为空（请求了非本人成员的 id）或无合法 id：返回空切片。
//
// 返回空切片时调用方必须直接返回空结果，绝不能落到“无 user_id 过滤 = 全量”的分支。
func effectiveScopeIds(c *gin.Context, allowedIds []int) []int {
	raw := strings.TrimSpace(c.Query("user_ids"))
	if raw == "" || strings.EqualFold(raw, "all") {
		return allowedIds
	}
	requested := parseIntList(raw) // 仅保留 id>0
	if len(requested) == 0 {
		return nil
	}
	allowedSet := make(map[int]bool, len(allowedIds))
	for _, id := range allowedIds {
		allowedSet[id] = true
	}
	effective := make([]int, 0, len(requested))
	for _, id := range requested {
		if allowedSet[id] {
			effective = append(effective, id)
		}
	}
	return effective
}

// agentBillingFilter 构造代理商账单查询的强制过滤器：用户维度限定为 effectiveIds
// （为空则 None → 空结果），企业维度恒为 None（代理商不管理企业，也不应看到企业归属）。
func agentBillingFilter(c *gin.Context, effectiveIds []int) billingFilter {
	userScope := model.BillingScope{Mode: model.BillingScopeNone}
	if len(effectiveIds) > 0 {
		userScope = model.BillingScope{Mode: model.BillingScopeIds, Ids: effectiveIds}
	}
	filter := billingFilter{
		userScope: userScope,
		orgScope:  model.BillingScope{Mode: model.BillingScopeNone},
	}
	filter.start, _ = strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	filter.end, _ = strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	return filter
}

// GetAgentLogs 代理商范围化的通用使用日志（common）。范围由服务端强制，
// 不接受 channel/username/upstream_request_id 等管理员维度筛选。
func GetAgentLogs(c *gin.Context) {
	allowedIds, err := agentLogScope(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	effectiveIds := effectiveScopeIds(c, allowedIds)
	pageInfo := common.GetPageQuery(c)
	if len(effectiveIds) == 0 {
		pageInfo.SetTotal(0)
		pageInfo.SetItems([]*model.Log{})
		common.ApiSuccess(c, pageInfo)
		return
	}
	logType, _ := strconv.Atoi(c.Query("type"))
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	tokenName := c.Query("token_name")
	modelName := c.Query("model_name")
	group := c.Query("group")
	requestId := c.Query("request_id")
	taskID := c.Query("task_id")
	logs, total, err := model.GetAgentScopedLogs(effectiveIds, logType, startTimestamp, endTimestamp, modelName, tokenName, pageInfo.GetStartIdx(), pageInfo.GetPageSize(), group, requestId, taskID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(logs)
	common.ApiSuccess(c, pageInfo)
}

// GetAgentLogsStat 代理商范围化日志的额度/rpm/tpm 统计。
func GetAgentLogsStat(c *gin.Context) {
	allowedIds, err := agentLogScope(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	effectiveIds := effectiveScopeIds(c, allowedIds)
	logType, _ := strconv.Atoi(c.Query("type"))
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	tokenName := c.Query("token_name")
	modelName := c.Query("model_name")
	group := c.Query("group")
	stat, err := model.SumUsedQuotaByUserIds(effectiveIds, logType, startTimestamp, endTimestamp, modelName, tokenName, group)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(200, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"quota": stat.Quota,
			"rpm":   stat.Rpm,
			"tpm":   stat.Tpm,
		},
	})
}

// GetAgentTasks 代理商范围化的任务日志（同步任务）。以 UserIDs 强制范围，用户名回填
// （tasksToDto 第二参 true）以便区分成员；不接受 username/channel 文本筛选。
func GetAgentTasks(c *gin.Context) {
	allowedIds, err := agentLogScope(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	effectiveIds := effectiveScopeIds(c, allowedIds)
	pageInfo := common.GetPageQuery(c)
	if len(effectiveIds) == 0 {
		pageInfo.SetTotal(0)
		pageInfo.SetItems([]*dto.TaskDto{})
		common.ApiSuccess(c, pageInfo)
		return
	}
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	queryParams := model.SyncTaskQueryParams{
		Platform:       constant.TaskPlatform(c.Query("platform")),
		TaskID:         c.Query("task_id"),
		Status:         c.Query("status"),
		Action:         c.Query("action"),
		StartTimestamp: startTimestamp,
		EndTimestamp:   endTimestamp,
		UserIDs:        effectiveIds,
	}
	items := model.TaskGetAllTasks(pageInfo.GetStartIdx(), pageInfo.GetPageSize(), queryParams)
	total := model.TaskCountAllTasks(queryParams)
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(tasksToDto(items, true))
	common.ApiSuccess(c, pageInfo)
}

// GetAgentMidjourney 代理商范围化的绘图日志（Midjourney）。以 UserIDs 强制范围，
// 沿用 MjForwardUrlEnabled 的图片地址重写；不接受 channel_id 筛选。
func GetAgentMidjourney(c *gin.Context) {
	allowedIds, err := agentLogScope(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	effectiveIds := effectiveScopeIds(c, allowedIds)
	pageInfo := common.GetPageQuery(c)
	if len(effectiveIds) == 0 {
		pageInfo.SetTotal(0)
		pageInfo.SetItems([]*model.Midjourney{})
		common.ApiSuccess(c, pageInfo)
		return
	}
	queryParams := model.TaskQueryParams{
		MjID:           c.Query("mj_id"),
		StartTimestamp: c.Query("start_timestamp"),
		EndTimestamp:   c.Query("end_timestamp"),
		UserIDs:        effectiveIds,
	}
	items := model.GetAllTasks(pageInfo.GetStartIdx(), pageInfo.GetPageSize(), queryParams)
	total := model.CountAllTasks(queryParams)
	if setting.MjForwardUrlEnabled {
		for i, midjourney := range items {
			midjourney.ImageUrl = system_setting.ServerAddress + "/mj/image/" + midjourney.MjId
			items[i] = midjourney
		}
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

// GetAgentMemberOptions 返回代理商成员的轻量下拉选项，供前端“按成员筛选”使用。
// 仅供选择器展示，服务端强制范围另走 ListAgentMemberIds 的全量 ID，不受此上限影响。
func GetAgentMemberOptions(c *gin.Context) {
	options, err := model.ListAgentMemberOptions(c.GetInt("agent_id"), 1000)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, options)
}

// GetAgentBillingRecharge 代理商范围化的充值流水。强制 userScope=成员交集、orgScope=None；
// 相比管理员端点清空 operator（操作人）——代理商无权查看调额操作人等内部信息。
func GetAgentBillingRecharge(c *gin.Context) {
	allowedIds, err := agentLogScope(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	filter := agentBillingFilter(c, effectiveScopeIds(c, allowedIds))
	records, stat, err := model.GetBillingRechargeRecords(filter.userScope, filter.orgScope, filter.start, filter.end)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	for _, record := range records {
		record.Operator = ""
	}
	c.JSON(200, gin.H{
		"success": true,
		"message": "",
		"data":    gin.H{"records": records, "stat": stat},
	})
}

// GetAgentBillingConsumption 代理商范围化的消耗明细。强制 userScope=成员交集、orgScope=None；
// 原始日志经 StripAdminOnlyLogFields 降到 self 口径（剥离渠道名与 admin_info 等），并省略
// user_org/org_names——代理商不管理企业，也不应看到成员的企业归属。
func GetAgentBillingConsumption(c *gin.Context) {
	allowedIds, err := agentLogScope(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	filter := agentBillingFilter(c, effectiveScopeIds(c, allowedIds))
	pageInfo := common.GetPageQuery(c)
	logs, total, stat, _, _, err := model.GetBillingConsumption(filter.userScope, filter.orgScope, filter.start, filter.end, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.StripAdminOnlyLogFields(logs)
	c.JSON(200, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items": logs,
			"total": total,
			"stat":  stat,
		},
	})
}

// ExportAgentBillingRecharge 导出代理商范围化充值流水 CSV。相比管理员导出去掉「操作人」列。
func ExportAgentBillingRecharge(c *gin.Context) {
	allowedIds, err := agentLogScope(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	filter := agentBillingFilter(c, effectiveScopeIds(c, allowedIds))
	records, stat, err := model.GetBillingRechargeRecords(filter.userScope, filter.orgScope, filter.start, filter.end)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	header := []string{"时间", "类型", "对象", "金额", "支付金额", "支付方式", "订单号"}
	rows := make([][]string, 0, len(records)+1)
	var totalMoney float64
	for _, record := range records {
		totalMoney += record.Money
		rows = append(rows, []string{
			billingTimestamp(record.CreatedAt),
			rechargeSourceText(record.Source),
			rechargeTargetText(record),
			logger.FormatQuota(record.Quota),
			logger.FormatLocalCurrency(record.Money),
			record.PaymentMethod,
			record.TradeNo,
		})
	}
	rows = append(rows, []string{
		"合计", "", "",
		logger.FormatQuota(stat.TotalQuota),
		logger.FormatLocalCurrency(totalMoney),
		"", "",
	})
	writeBillingCSV(c, "billing-recharge-"+time.Now().Format("20060102-150405")+".csv", header, rows)
}

// ExportAgentBillingConsumption 导出代理商范围化消耗明细 CSV。相比管理员导出去掉「企业」列。
func ExportAgentBillingConsumption(c *gin.Context) {
	allowedIds, err := agentLogScope(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	filter := agentBillingFilter(c, effectiveScopeIds(c, allowedIds))
	logs, _, _, err := model.GetBillingConsumptionAll(filter.userScope, filter.orgScope, filter.start, filter.end)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	header := []string{"时间", "用户", "令牌", "模型", "类型", "金额", "输入tokens", "输出tokens", "请求ID"}
	rows := make([][]string, 0, len(logs))
	for _, log := range logs {
		quota := log.Quota
		typeText := "消耗"
		if log.Type == model.LogTypeRefund {
			quota = -quota
			typeText = "退款"
		}
		rows = append(rows, []string{
			billingTimestamp(log.CreatedAt),
			log.Username,
			log.TokenName,
			log.ModelName,
			typeText,
			logger.FormatQuota(quota),
			strconv.Itoa(log.PromptTokens),
			strconv.Itoa(log.CompletionTokens),
			log.RequestId,
		})
	}
	writeBillingCSV(c, "billing-consumption-"+time.Now().Format("20060102-150405")+".csv", header, rows)
}
