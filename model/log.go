package model

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"

	"gorm.io/gorm"
)

func applyExplicitLogTextFilter(tx *gorm.DB, column string, value string) (*gorm.DB, error) {
	if value == "" {
		return tx, nil
	}
	if strings.Contains(value, "%") {
		condition, pattern, err := buildLogLikeCondition(column, value)
		if err != nil {
			return nil, err
		}
		return tx.Where(condition, pattern), nil
	}
	return tx.Where(column+" = ?", value), nil
}

func buildLogLikeCondition(column string, value string) (string, string, error) {
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		pattern, err := sanitizeClickHouseLikePattern(value)
		if err != nil {
			return "", "", err
		}
		return column + " LIKE ?", pattern, nil
	}

	pattern, err := sanitizeLikePattern(value)
	if err != nil {
		return "", "", err
	}
	return column + " LIKE ? ESCAPE '!'", pattern, nil
}

func sanitizeClickHouseLikePattern(input string) (string, error) {
	input = strings.ReplaceAll(input, `\`, `\\`)
	input = strings.ReplaceAll(input, `_`, `\_`)

	if err := validateLikePattern(input); err != nil {
		return "", err
	}
	return input, nil
}

type Log struct {
	Id                int    `json:"id" gorm:"index:idx_created_at_id,priority:2;index:idx_user_id_id,priority:2"`
	UserId            int    `json:"user_id" gorm:"index;index:idx_user_id_id,priority:1"`
	CreatedAt         int64  `json:"created_at" gorm:"bigint;index:idx_created_at_id,priority:1;index:idx_created_at_type"`
	Type              int    `json:"type" gorm:"index:idx_created_at_type"`
	Content           string `json:"content"`
	Username          string `json:"username" gorm:"index;index:index_username_model_name,priority:2;default:''"`
	TokenName         string `json:"token_name" gorm:"index;default:''"`
	ModelName         string `json:"model_name" gorm:"index;index:index_username_model_name,priority:1;default:''"`
	Quota             int    `json:"quota" gorm:"default:0"`
	PromptTokens      int    `json:"prompt_tokens" gorm:"default:0"`
	CompletionTokens  int    `json:"completion_tokens" gorm:"default:0"`
	UseTime           int    `json:"use_time" gorm:"default:0"`
	IsStream          bool   `json:"is_stream"`
	ChannelId         int    `json:"channel" gorm:"index"`
	ChannelName       string `json:"channel_name" gorm:"->"`
	TokenId           int    `json:"token_id" gorm:"default:0;index"`
	Group             string `json:"group" gorm:"index"`
	Ip                string `json:"ip" gorm:"index;default:''"`
	RequestId         string `json:"request_id,omitempty" gorm:"type:varchar(64);index:idx_logs_request_id;default:''"`
	UpstreamRequestId string `json:"upstream_request_id,omitempty" gorm:"type:varchar(128);index:idx_logs_upstream_request_id;default:''"`
	Other             string `json:"other"`
	// UpstreamPromptTokens/UpstreamCompletionTokens 记录上游真实 token 用量，
	// 供渠道账单中心与上游对账。0 表示未单独记录，真实值回退
	// prompt_tokens/completion_tokens（历史数据与未被费率缩放的链路天然为 0）。
	// 目前唯一与计费 tokens 不一致的链路是 seedance 任务的用户 token 费率缩放。
	UpstreamPromptTokens     int `json:"upstream_prompt_tokens" gorm:"default:0"`
	UpstreamCompletionTokens int `json:"upstream_completion_tokens" gorm:"default:0"`
	// CacheHit 为 true 表示响应缓存回放：不打上游、quota=0，上游对账必须排除。
	// 此前只存于 other JSON，SQL 过滤跨三库不可行（同 quota_data.cache_hits 先例），
	// 故加真列；默认值由写入路径设置，不用 gorm 布尔默认 tag。
	CacheHit bool `json:"cache_hit" gorm:"index"`
	// TaskSettle 标记异步任务的差额结算行（RecalculateTaskQuota 写入）。
	// 结算行记录的是任务全量用量而非差额，任务真实用量以预扣回填行为准；
	// 上游对账（渠道账单中心）只统计 consume 且非 settle 行，排除本行避免双计。
	// 整单退款行（RefundTaskQuota）不带本标记，仅供明细审计展示。
	TaskSettle bool `json:"task_settle" gorm:"index"`
}

// UpstreamTokenUsage 返回上游对账口径的真实 token 用量：
// 任务差额结算行计 0（用量以预扣回填行为准），其余行优先取 upstream 列，
// 为 0 时回退计费 tokens 列（两者在无费率缩放时相等）。
func (log *Log) UpstreamTokenUsage() (prompt, completion int) {
	if log.TaskSettle {
		return 0, 0
	}
	prompt, completion = log.PromptTokens, log.CompletionTokens
	if log.UpstreamPromptTokens > 0 {
		prompt = log.UpstreamPromptTokens
	}
	if log.UpstreamCompletionTokens > 0 {
		completion = log.UpstreamCompletionTokens
	}
	return prompt, completion
}

// don't use iota, avoid change log type value
const (
	LogTypeUnknown = 0
	LogTypeTopup   = 1
	LogTypeConsume = 2
	LogTypeManage  = 3
	LogTypeSystem  = 4
	LogTypeError   = 5
	LogTypeRefund  = 6
	LogTypeLogin   = 7
)

func ensureLogRequestId(log *Log) {
	if log != nil && log.RequestId == "" {
		log.RequestId = common.NewRequestId()
	}
}

func createLog(log *Log) error {
	ensureLogRequestId(log)
	return LOG_DB.Create(log).Error
}

func clickHouseLogOrder(prefix string) string {
	return prefix + "created_at desc, " + prefix + "request_id desc"
}

func assignDisplayLogIds(logs []*Log, startIdx int) {
	for i := range logs {
		logs[i].Id = startIdx + i + 1
	}
}

// StripAdminOnlyLogFields 就地剥离日志中仅供管理员查看的字段：渠道名，以及 Other 内的
// admin_info（调试信息）、audit_info（操作人/路由审计）、stream_status。普通用户的 self
// 视图与代理商范围化视图都以此字段口径为基线。与 formatUserLogs 的区别是不重排展示 id，
// 因此适用于按时间排序、需保持原始 id 的场景（如代理商账单消耗复用 GetBillingConsumption
// 返回的原始日志）。
func StripAdminOnlyLogFields(logs []*Log) {
	for i := range logs {
		logs[i].ChannelName = ""
		var otherMap map[string]interface{}
		otherMap, _ = common.StrToMap(logs[i].Other)
		if otherMap != nil {
			// Remove admin-only debug fields.
			delete(otherMap, "admin_info")
			// Remove operation-audit details (operator/route info), admin-only.
			delete(otherMap, "audit_info")
			// delete(otherMap, "reject_reason")
			delete(otherMap, "stream_status")
		}
		logs[i].Other = common.MapToJsonStr(otherMap)
	}
}

func formatUserLogs(logs []*Log, startIdx int) {
	StripAdminOnlyLogFields(logs)
	assignDisplayLogIds(logs, startIdx)
}

func GetLogByTokenId(tokenId int) (logs []*Log, err error) {
	order := "id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("")
	}
	err = LOG_DB.Model(&Log{}).Where("token_id = ?", tokenId).Order(order).Limit(common.MaxRecentItems).Find(&logs).Error
	formatUserLogs(logs, 0)
	return logs, err
}

// GetLogUserIdByRequestId 按 request_id 查日志行的归属用户，用于 bodies 接口的可见范围鉴权。
// request_id 为空或查不到日志行时返回 (0, false, nil)。
func GetLogUserIdByRequestId(requestId string) (int, bool, error) {
	if requestId == "" {
		return 0, false, nil
	}
	var log Log
	err := LOG_DB.Select("user_id").Where("request_id = ?", requestId).Limit(1).First(&log).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, false, nil
		}
		return 0, false, err
	}
	return log.UserId, true, nil
}

func RecordLog(userId int, logType int, content string) {
	if logType == LogTypeConsume && !common.LogConsumeEnabled {
		return
	}
	username, group := GetUsernameAndGroupById(userId)
	log := &Log{
		UserId:    userId,
		Username:  username,
		Group:     group,
		CreatedAt: common.GetTimestamp(),
		Type:      logType,
		Content:   content,
	}
	err := createLog(log)
	if err != nil {
		common.SysLog("failed to record log: " + err.Error())
	}
}

// RecordLogWithAdminInfo 记录操作日志，并将管理员相关信息存入 Other.admin_info，
func RecordLogWithAdminInfo(userId int, logType int, content string, adminInfo map[string]interface{}) {
	if logType == LogTypeConsume && !common.LogConsumeEnabled {
		return
	}
	username, group := GetUsernameAndGroupById(userId)
	log := &Log{
		UserId:    userId,
		Username:  username,
		Group:     group,
		CreatedAt: common.GetTimestamp(),
		Type:      logType,
		Content:   content,
	}
	if len(adminInfo) > 0 {
		other := map[string]interface{}{
			"admin_info": adminInfo,
		}
		log.Other = common.MapToJsonStr(other)
	}
	if err := createLog(log); err != nil {
		common.SysLog("failed to record log: " + err.Error())
	}
}

// buildOpField 构建语言无关的操作描述（写入 Other.op）。
// 前端依据 action(稳定操作标识) + params(结构化参数) 在渲染期用 i18n 本地化展示，
// 因此不在数据库中存储自然语言句子。
func buildOpField(action string, params map[string]interface{}) map[string]interface{} {
	op := map[string]interface{}{
		"action": action,
	}
	if len(params) > 0 {
		op["params"] = params
	}
	return op
}

// RecordLoginLog 记录用户登录成功的审计日志（type=LogTypeLogin）。
// username 由调用方传入（登录流程已持有用户对象），避免额外的数据库查询。
// content 为英文兜底文本（用于导出/经典前端）；action+params 供前端本地化渲染。
// extra 可携带 login_method、user_agent 等附加信息（普通用户可见）。
func RecordLoginLog(userId int, username string, group string, content string, ip string, action string, params map[string]interface{}, extra map[string]interface{}) {
	other := map[string]interface{}{}
	for k, v := range extra {
		other[k] = v
	}
	other["op"] = buildOpField(action, params)
	log := &Log{
		UserId:    userId,
		Username:  username,
		Group:     group,
		CreatedAt: common.GetTimestamp(),
		Type:      LogTypeLogin,
		Content:   content,
		Ip:        ip,
		Other:     common.MapToJsonStr(other),
	}
	if err := createLog(log); err != nil {
		common.SysLog("failed to record login log: " + err.Error())
	}
}

// RecordOperationAuditLog 记录管理/高危操作审计日志（type=LogTypeManage）。
// logUserId 为日志归属者，管理审计日志应归属实际操作者；目标资源/用户放入
// action params。username 内部按 logUserId 查询。content 为英文兜底文本（导出/经典前端用）。
// action+params 写入 Other.op，供前端本地化渲染（普通用户可见，不含敏感信息）。
// adminInfo 存放操作者身份（写入 Other.admin_info，普通用户查询时剥离）；
// auditInfo 存放路由/方法/结果等中间件兜底信息（写入 Other.audit_info，普通用户查询时剥离）。
func RecordOperationAuditLog(logUserId int, content string, ip string, action string, params map[string]interface{}, adminInfo map[string]interface{}, auditInfo map[string]interface{}) {
	username, group := GetUsernameAndGroupById(logUserId)
	other := map[string]interface{}{
		"op": buildOpField(action, params),
	}
	if len(adminInfo) > 0 {
		other["admin_info"] = adminInfo
	}
	if len(auditInfo) > 0 {
		other["audit_info"] = auditInfo
	}
	log := &Log{
		UserId:    logUserId,
		Username:  username,
		Group:     group,
		CreatedAt: common.GetTimestamp(),
		Type:      LogTypeManage,
		Content:   content,
		Ip:        ip,
		Other:     common.MapToJsonStr(other),
	}
	if err := createLog(log); err != nil {
		common.SysLog("failed to record operation audit log: " + err.Error())
	}
}

func RecordTopupLog(userId int, content string, callerIp string, paymentMethod string, callbackPaymentMethod string) {
	username, group := GetUsernameAndGroupById(userId)
	adminInfo := map[string]interface{}{
		"server_ip":               common.GetIp(),
		"node_name":               common.NodeName,
		"caller_ip":               callerIp,
		"payment_method":          paymentMethod,
		"callback_payment_method": callbackPaymentMethod,
		"version":                 common.Version,
	}
	other := map[string]interface{}{
		"admin_info": adminInfo,
	}
	log := &Log{
		UserId:    userId,
		Username:  username,
		Group:     group,
		CreatedAt: common.GetTimestamp(),
		Type:      LogTypeTopup,
		Content:   content,
		Ip:        callerIp,
		Other:     common.MapToJsonStr(other),
	}
	err := createLog(log)
	if err != nil {
		common.SysLog("failed to record topup log: " + err.Error())
	}
}

func RecordErrorLog(c *gin.Context, userId int, channelId int, modelName string, tokenName string, content string, tokenId int, useTimeSeconds int,
	isStream bool, group string, other map[string]interface{}) {
	logger.LogInfo(c, fmt.Sprintf("record error log: userId=%d, channelId=%d, modelName=%s, tokenName=%s, content=%s", userId, channelId, modelName, tokenName, common.LocalLogPreview(content)))
	username := c.GetString("username")
	requestId := c.GetString(common.RequestIdKey)
	upstreamRequestId := c.GetString(common.UpstreamRequestIdKey)
	otherStr := common.MapToJsonStr(other)
	// 判断是否需要记录 IP
	needRecordIp := false
	if settingMap, err := GetUserSetting(userId, false); err == nil {
		if settingMap.RecordIpLog {
			needRecordIp = true
		}
	}
	log := &Log{
		UserId:           userId,
		Username:         username,
		CreatedAt:        common.GetTimestamp(),
		Type:             LogTypeError,
		Content:          content,
		PromptTokens:     0,
		CompletionTokens: 0,
		TokenName:        tokenName,
		ModelName:        modelName,
		Quota:            0,
		ChannelId:        channelId,
		TokenId:          tokenId,
		UseTime:          useTimeSeconds,
		IsStream:         isStream,
		Group:            group,
		Ip: func() string {
			if needRecordIp {
				return c.ClientIP()
			}
			return ""
		}(),
		RequestId:         requestId,
		UpstreamRequestId: upstreamRequestId,
		Other:             otherStr,
	}
	err := createLog(log)
	if err != nil {
		logger.LogError(c, "failed to record log: "+err.Error())
	}
}

type RecordConsumeLogParams struct {
	ChannelId        int    `json:"channel_id"`
	PromptTokens     int    `json:"prompt_tokens"`
	CompletionTokens int    `json:"completion_tokens"`
	ModelName        string `json:"model_name"`
	TokenName        string `json:"token_name"`
	Quota            int    `json:"quota"`
	Content          string `json:"content"`
	TokenId          int    `json:"token_id"`
	UseTimeSeconds   int    `json:"use_time_seconds"`
	IsStream         bool   `json:"is_stream"`
	Group            string `json:"group"`
	// OrgId 是消费归属的企业（组织），0 表示非企业成员。
	// 留空时由 RecordConsumeLog 从请求上下文回落，因此既有调用点无需逐个改动
	// 即可获得企业维度的用量统计。
	OrgId int `json:"org_id"`
	// CacheHit 为 true 表示本次响应来自响应缓存回放，Quota 必为 0；
	// CacheSavedQuota 记录“如果打上游本应扣多少”，仅用于报表统计节省额度。
	CacheHit        bool `json:"cache_hit,omitempty"`
	CacheSavedQuota int  `json:"cache_saved_quota,omitempty"`
	// UpstreamPromptTokens/UpstreamCompletionTokens 为上游真实 token 用量，
	// 0 表示与计费 tokens 一致（回退口径），见 Log 同名字段注释。
	UpstreamPromptTokens     int                    `json:"upstream_prompt_tokens,omitempty"`
	UpstreamCompletionTokens int                    `json:"upstream_completion_tokens,omitempty"`
	Other                    map[string]interface{} `json:"other"`
}

func RecordConsumeLog(c *gin.Context, userId int, params RecordConsumeLogParams) {
	if !common.LogConsumeEnabled {
		return
	}
	logger.LogInfo(c, fmt.Sprintf("record consume log: userId=%d, params=%s", userId, common.GetJsonString(params)))
	username := c.GetString("username")
	requestId := c.GetString(common.RequestIdKey)
	upstreamRequestId := c.GetString(common.UpstreamRequestIdKey)
	createdAt := common.GetTimestamp()
	// 企业归属：显式传参优先，否则取令牌鉴权写入上下文的企业标识。
	// 这里按"成员归属"而非"谁付费"记账，因此企业池不足回落个人钱包时
	// 用量仍计入企业报表，实际付款方由 other.billing_source 区分。
	orgId := params.OrgId
	if orgId == 0 {
		orgId = common.GetContextKeyInt(c, constant.ContextKeyUserOrgId)
	}
	otherStr := common.MapToJsonStr(params.Other)
	// 判断是否需要记录 IP
	needRecordIp := false
	if settingMap, err := GetUserSetting(userId, false); err == nil {
		if settingMap.RecordIpLog {
			needRecordIp = true
		}
	}
	log := &Log{
		UserId:           userId,
		Username:         username,
		CreatedAt:        createdAt,
		Type:             LogTypeConsume,
		Content:          params.Content,
		PromptTokens:     params.PromptTokens,
		CompletionTokens: params.CompletionTokens,
		TokenName:        params.TokenName,
		ModelName:        params.ModelName,
		Quota:            params.Quota,
		ChannelId:        params.ChannelId,
		TokenId:          params.TokenId,
		UseTime:          params.UseTimeSeconds,
		IsStream:         params.IsStream,
		Group:            params.Group,
		Ip: func() string {
			if needRecordIp {
				return c.ClientIP()
			}
			return ""
		}(),
		RequestId:                requestId,
		UpstreamRequestId:        upstreamRequestId,
		Other:                    otherStr,
		CacheHit:                 params.CacheHit,
		UpstreamPromptTokens:     params.UpstreamPromptTokens,
		UpstreamCompletionTokens: params.UpstreamCompletionTokens,
	}
	err := createLog(log)
	if err != nil {
		logger.LogError(c, "failed to record log: "+err.Error())
	}
	if common.DataExportEnabled {
		LogQuotaData(QuotaDataLogParams{
			UserID:          userId,
			OrgId:           orgId,
			Username:        username,
			ModelName:       params.ModelName,
			Quota:           params.Quota,
			CreatedAt:       createdAt,
			TokenUsed:       params.PromptTokens + params.CompletionTokens,
			UseGroup:        params.Group,
			TokenID:         params.TokenId,
			ChannelID:       params.ChannelId,
			NodeName:        common.NodeName,
			CacheHit:        params.CacheHit,
			CacheSavedQuota: params.CacheSavedQuota,
		})
	}
}

type RecordTaskBillingLogParams struct {
	UserId    int
	LogType   int
	Content   string
	ChannelId int
	ModelName string
	Quota     int
	TokenId   int
	Group     string
	// OrgId 是任务消费归属的企业（组织）。0 时按任务发起人回查企业上下文，
	// 因为异步任务结算时已经没有请求上下文可用。
	OrgId            int
	PromptTokens     int // 结算时上游返回的实际 prompt token 数（无则为 0）
	CompletionTokens int // 结算时上游返回的实际 completion/total token 数（无则为 0）
	// TaskSettle 标记差额结算行（结算/部分退款）：其 tokens 是任务全量用量而非差额，
	// 上游对账（渠道账单中心）只统计 consume 且非 settle 行，本行被排除。
	// 真实用量以预扣回填行为准（成功任务才会回填）；整单退款不标记，
	// 其 tokens 仅供明细审计展示（失败任务预扣行未回填，对账净额自然为 0）。
	TaskSettle bool
	// TokenRateScale 非空表示结算 tokens 已被用户费率缩放，取其原始值写入
	// upstream tokens 列（存正值，供明细/审计追溯缩放前的上游真实用量）。
	TokenRateScale *TaskTokenRateScale
	Other          map[string]interface{}
	NodeName       string // 任务发起节点；为空时回退当前节点
	// QuotaDataCreatedAt 为任务提交时刻（task.SubmitTime）。结算修正落到提交
	// 同一小时桶，避免差额/退款跨桶跨天漂移；为 0 时回退日志时间。
	QuotaDataCreatedAt int64
	// CreatedAt 为日志展示时间。结算/退款是异步事件，实际落库时刻可能远晚于
	// 任务完成时刻（轮询延迟或管理员补录），直接用 now 会让消费记录显示在错误
	// 日期、远离同任务的预扣行。传任务完成时刻（task.FinishTime）让时间回归真实
	// 发生点；为 0 时回退当前时间。仅影响展示与时间筛选，不改动额度，统计桶仍由
	// QuotaDataCreatedAt（提交时刻）决定。
	CreatedAt int64
}

func RecordTaskBillingLog(params RecordTaskBillingLogParams) {
	if params.LogType == LogTypeConsume && !common.LogConsumeEnabled {
		return
	}
	username, _ := GetUsernameById(params.UserId, false)
	tokenName := ""
	if params.TokenId > 0 {
		if token, err := GetTokenById(params.TokenId); err == nil {
			tokenName = token.Name
		}
	}
	createdAt := params.CreatedAt
	if createdAt == 0 {
		createdAt = common.GetTimestamp()
	}
	orgId := params.OrgId
	if orgId == 0 {
		// 异步任务结算是低频路径，回查一次企业归属的开销可忽略。
		if resolvedOrgId, _, err := GetUserOrgContext(params.UserId); err == nil {
			orgId = resolvedOrgId
		}
	}
	// 上游真实 tokens：优先取费率缩放前的原始值，否则用传入的计费 tokens。
	// 存正值：差额结算行（TaskSettle=true）与整单退款行都被上游对账聚合排除，
	// 此处写入仅供明细审计视图展示「缩放前原始用量」。
	upstreamPrompt := int64(params.PromptTokens)
	upstreamCompletion := int64(params.CompletionTokens)
	if scale := params.TokenRateScale; scale != nil {
		upstreamPrompt = scale.OriginalTotalTokens - scale.OriginalCompletionTokens
		if upstreamPrompt < 0 {
			upstreamPrompt = 0
		}
		upstreamCompletion = scale.OriginalCompletionTokens
	}
	log := &Log{
		UserId:           params.UserId,
		Username:         username,
		CreatedAt:        createdAt,
		Type:             params.LogType,
		Content:          params.Content,
		PromptTokens:     params.PromptTokens,
		CompletionTokens: params.CompletionTokens,
		TokenName:        tokenName,
		ModelName:        params.ModelName,
		Quota:            params.Quota,
		ChannelId:        params.ChannelId,
		TokenId:          params.TokenId,
		Group:            params.Group,
		Other:            common.MapToJsonStr(params.Other),
		// 结算行标记见 Log.TaskSettle 注释：上游对账只认预扣回填行，避免双计。
		TaskSettle:               params.TaskSettle,
		UpstreamPromptTokens:     int(upstreamPrompt),
		UpstreamCompletionTokens: int(upstreamCompletion),
	}
	err := createLog(log)
	if err != nil {
		common.SysLog("failed to record task billing log: " + err.Error())
	}
	if common.DataExportEnabled {
		nodeName := params.NodeName
		if nodeName == "" {
			nodeName = common.NodeName
		}
		// 差额结算/退款只修正提交时刻的小时桶：额度按日志类型带符号，不计请求
		// 次数，使报表里一次任务用量始终归并为一条净额记录。
		quotaDataCreatedAt := params.QuotaDataCreatedAt
		if quotaDataCreatedAt == 0 {
			quotaDataCreatedAt = createdAt
		}
		quota := params.Quota
		if params.LogType == LogTypeRefund {
			quota = -quota
		}
		LogQuotaData(QuotaDataLogParams{
			UserID:     params.UserId,
			OrgId:      orgId,
			Username:   username,
			ModelName:  params.ModelName,
			Quota:      quota,
			CreatedAt:  quotaDataCreatedAt,
			TokenUsed:  params.PromptTokens + params.CompletionTokens,
			UseGroup:   params.Group,
			TokenID:    params.TokenId,
			ChannelID:  params.ChannelId,
			NodeName:   nodeName,
			Adjustment: true,
		})
	}
}

// mergeTokenRateScaleIntoOther 把费率缩放快照合并进日志 other 的 admin_info 下，
// 保留 admin_info 既有键（如 quota_saturation）；other 为空或非法时新建对象。
// 合并失败（marshal 错误）时返回原串，绝不阻断回填。
func mergeTokenRateScaleIntoOther(otherStr string, scale *TaskTokenRateScale) string {
	other := map[string]interface{}{}
	if strings.TrimSpace(otherStr) != "" {
		_ = common.UnmarshalJsonStr(otherStr, &other)
	}
	adminInfo, _ := other["admin_info"].(map[string]interface{})
	if adminInfo == nil {
		adminInfo = map[string]interface{}{}
	}
	adminInfo["token_rate_scale"] = scale
	other["admin_info"] = adminInfo
	data, err := common.Marshal(other)
	if err != nil {
		return otherStr
	}
	return string(data)
}

// UpdateTaskConsumeLogUsage 回填任务预扣消费日志的真实 token 用量与耗时。
// 异步任务提交时预扣消费日志 tokens=0，结算差额另起新行，原行永远显示 0；
// 差额为 0（预扣准确）时甚至没有差额行，tokens 完全丢失，用户在对账时看不到
// 真实消耗。此函数按 other.task_id 定位该任务最早一条 consume 日志（即预扣行），
// 仅补展示字段（tokens/耗时），不改动 quota 等资金字段，返回影响行数。
// upstreamPrompt/upstreamCompletion 为费率缩放前的上游真实 tokens（无缩放传 0
// 走回退口径）：预扣回填行是上游对账唯一计入行，必须携带真实值。
// scale 非空时同时把缩放快照合并进该行 other.admin_info.token_rate_scale，使超管
// 在使用日志的消耗行（而非仅结算行）也能看到「原始 tokens / 费率」。
func UpdateTaskConsumeLogUsage(taskID string, promptTokens, completionTokens, useTime, upstreamPrompt, upstreamCompletion int, scale *TaskTokenRateScale) (int64, error) {
	if taskID == "" {
		return 0, nil
	}
	var pre Log
	err := LOG_DB.Where("type = ?", LogTypeConsume).
		Where("other LIKE ?", fmt.Sprintf(`%%"task_id":"%s"%%`, taskID)).
		Order("id ASC").
		First(&pre).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, nil
		}
		return 0, err
	}
	updates := map[string]any{
		"prompt_tokens":              promptTokens,
		"completion_tokens":          completionTokens,
		"use_time":                   useTime,
		"upstream_prompt_tokens":     upstreamPrompt,
		"upstream_completion_tokens": upstreamCompletion,
	}
	if scale != nil {
		updates["other"] = mergeTokenRateScaleIntoOther(pre.Other, scale)
	}
	res := LOG_DB.Model(&Log{}).Where("id = ?", pre.Id).Updates(updates)
	return res.RowsAffected, res.Error
}

func GetAllLogs(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string, startIdx int, num int, channel int, group string, requestId string, upstreamRequestId string, taskID string) (logs []*Log, total int64, err error) {
	var tx *gorm.DB
	if logType == LogTypeUnknown {
		tx = LOG_DB
	} else {
		tx = LOG_DB.Where("logs.type = ?", logType)
	}

	if tx, err = applyExplicitLogTextFilter(tx, "logs.model_name", modelName); err != nil {
		return nil, 0, err
	}
	if tx, err = applyExplicitLogTextFilter(tx, "logs.username", username); err != nil {
		return nil, 0, err
	}
	if tokenName != "" {
		tx = tx.Where("logs.token_name = ?", tokenName)
	}
	if requestId != "" {
		tx = tx.Where("logs.request_id = ?", requestId)
	}
	if upstreamRequestId != "" {
		tx = tx.Where("logs.upstream_request_id = ?", upstreamRequestId)
	}
	if startTimestamp != 0 {
		tx = tx.Where("logs.created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("logs.created_at <= ?", endTimestamp)
	}
	if channel != 0 {
		tx = tx.Where("logs.channel_id = ?", channel)
	}
	if group != "" {
		tx = tx.Where("logs."+logGroupCol+" = ?", group)
	}
	if taskID != "" {
		tx = tx.Where("logs.other LIKE ?", fmt.Sprintf(`%%"task_id":"%s"%%`, taskID))
	}
	err = tx.Model(&Log{}).Count(&total).Error
	if err != nil {
		return nil, 0, err
	}
	order := "logs.created_at desc, logs.id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("logs.")
	}
	err = tx.Order(order).Limit(num).Offset(startIdx).Find(&logs).Error
	if err != nil {
		return nil, 0, err
	}
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		assignDisplayLogIds(logs, startIdx)
	}

	if err := attachLogChannelNames(logs); err != nil {
		return logs, total, err
	}

	return logs, total, err
}

// attachLogChannelNames 批量回填日志的渠道名称（channels.name 不在 logs 表内）。
// 内存缓存开启时走 CacheGetChannel，否则一次性批量查库，避免逐条 N+1。
func attachLogChannelNames(logs []*Log) error {
	channelIds := types.NewSet[int]()
	for _, log := range logs {
		if log.ChannelId != 0 {
			channelIds.Add(log.ChannelId)
		}
	}
	if channelIds.Len() == 0 {
		return nil
	}

	type channelNameRow struct {
		Id   int    `gorm:"column:id"`
		Name string `gorm:"column:name"`
	}
	var channels []channelNameRow
	if common.MemoryCacheEnabled {
		// Cache get channel
		for _, channelId := range channelIds.Items() {
			if cacheChannel, err := CacheGetChannel(channelId); err == nil {
				channels = append(channels, channelNameRow{Id: channelId, Name: cacheChannel.Name})
			}
		}
	} else {
		// Bulk query channels from DB
		if err := DB.Table("channels").Select("id, name").Where("id IN ?", channelIds.Items()).Find(&channels).Error; err != nil {
			return err
		}
	}
	channelMap := make(map[int]string, len(channels))
	for _, channel := range channels {
		channelMap[channel.Id] = channel.Name
	}
	for i := range logs {
		logs[i].ChannelName = channelMap[logs[i].ChannelId]
	}
	return nil
}

const logSearchCountLimit = 10000

func GetUserLogs(userId int, logType int, startTimestamp int64, endTimestamp int64, modelName string, tokenName string, startIdx int, num int, group string, requestId string, upstreamRequestId string, taskID string) (logs []*Log, total int64, err error) {
	var tx *gorm.DB
	if logType == LogTypeUnknown {
		tx = LOG_DB.Where("logs.user_id = ?", userId)
	} else {
		tx = LOG_DB.Where("logs.user_id = ? and logs.type = ?", userId, logType)
	}

	if tx, err = applyExplicitLogTextFilter(tx, "logs.model_name", modelName); err != nil {
		return nil, 0, err
	}
	if tokenName != "" {
		tx = tx.Where("logs.token_name = ?", tokenName)
	}
	if requestId != "" {
		tx = tx.Where("logs.request_id = ?", requestId)
	}
	if upstreamRequestId != "" {
		tx = tx.Where("logs.upstream_request_id = ?", upstreamRequestId)
	}
	if startTimestamp != 0 {
		tx = tx.Where("logs.created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("logs.created_at <= ?", endTimestamp)
	}
	if group != "" {
		tx = tx.Where("logs."+logGroupCol+" = ?", group)
	}
	if taskID != "" {
		tx = tx.Where("logs.other LIKE ?", fmt.Sprintf(`%%"task_id":"%s"%%`, taskID))
	}
	err = tx.Model(&Log{}).Limit(logSearchCountLimit).Count(&total).Error
	if err != nil {
		common.SysError("failed to count user logs: " + err.Error())
		return nil, 0, errors.New("查询日志失败")
	}
	order := "logs.id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("logs.")
	}
	err = tx.Order(order).Limit(num).Offset(startIdx).Find(&logs).Error
	if err != nil {
		common.SysError("failed to search user logs: " + err.Error())
		return nil, 0, errors.New("查询日志失败")
	}

	formatUserLogs(logs, startIdx)
	return logs, total, err
}

// GetAgentScopedLogs 返回限定在一组用户 ID（代理商自己 + 其成员）内的日志。
// 与 GetAllLogs 不同，它不接受 channel/username/upstream_request_id 等管理员维度的
// 自由筛选，范围完全由服务端传入的 userIds 决定；结尾走 formatUserLogs 剥离
// admin_info/audit_info/stream_status 与渠道名（保留 username/user_id 以区分成员），
// 因此代理商拿到的字段口径与普通用户的 self 视图一致（最小权限）。
func GetAgentScopedLogs(userIds []int, logType int, startTimestamp int64, endTimestamp int64, modelName string, tokenName string, startIdx int, num int, group string, requestId string, taskID string) (logs []*Log, total int64, err error) {
	if len(userIds) == 0 {
		return nil, 0, nil
	}
	var tx *gorm.DB
	if logType == LogTypeUnknown {
		tx = LOG_DB.Where("logs.user_id IN ?", userIds)
	} else {
		tx = LOG_DB.Where("logs.user_id IN ? and logs.type = ?", userIds, logType)
	}

	if tx, err = applyExplicitLogTextFilter(tx, "logs.model_name", modelName); err != nil {
		return nil, 0, err
	}
	if tokenName != "" {
		tx = tx.Where("logs.token_name = ?", tokenName)
	}
	if requestId != "" {
		tx = tx.Where("logs.request_id = ?", requestId)
	}
	if startTimestamp != 0 {
		tx = tx.Where("logs.created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("logs.created_at <= ?", endTimestamp)
	}
	if group != "" {
		tx = tx.Where("logs."+logGroupCol+" = ?", group)
	}
	if taskID != "" {
		tx = tx.Where("logs.other LIKE ?", fmt.Sprintf(`%%"task_id":"%s"%%`, taskID))
	}
	err = tx.Model(&Log{}).Limit(logSearchCountLimit).Count(&total).Error
	if err != nil {
		common.SysError("failed to count agent scoped logs: " + err.Error())
		return nil, 0, errors.New("查询日志失败")
	}
	order := "logs.id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("logs.")
	}
	err = tx.Order(order).Limit(num).Offset(startIdx).Find(&logs).Error
	if err != nil {
		common.SysError("failed to search agent scoped logs: " + err.Error())
		return nil, 0, errors.New("查询日志失败")
	}

	formatUserLogs(logs, startIdx)
	return logs, total, err
}

type Stat struct {
	Quota int `json:"quota"`
	Rpm   int `json:"rpm"`
	Tpm   int `json:"tpm"`
}

func SumUsedQuota(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string, channel int, group string) (stat Stat, err error) {
	tx := LOG_DB.Table("logs").Select("COALESCE(sum(quota), 0) quota")

	// 为rpm和tpm创建单独的查询
	rpmTpmQuery := LOG_DB.Table("logs").Select("count(*) rpm, COALESCE(sum(prompt_tokens), 0) + COALESCE(sum(completion_tokens), 0) tpm")

	if tx, err = applyExplicitLogTextFilter(tx, "username", username); err != nil {
		return stat, err
	}
	if rpmTpmQuery, err = applyExplicitLogTextFilter(rpmTpmQuery, "username", username); err != nil {
		return stat, err
	}
	if tokenName != "" {
		tx = tx.Where("token_name = ?", tokenName)
		rpmTpmQuery = rpmTpmQuery.Where("token_name = ?", tokenName)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if tx, err = applyExplicitLogTextFilter(tx, "model_name", modelName); err != nil {
		return stat, err
	}
	if rpmTpmQuery, err = applyExplicitLogTextFilter(rpmTpmQuery, "model_name", modelName); err != nil {
		return stat, err
	}
	if channel != 0 {
		tx = tx.Where("channel_id = ?", channel)
		rpmTpmQuery = rpmTpmQuery.Where("channel_id = ?", channel)
	}
	if group != "" {
		tx = tx.Where(logGroupCol+" = ?", group)
		rpmTpmQuery = rpmTpmQuery.Where(logGroupCol+" = ?", group)
	}

	tx = tx.Where("type = ?", LogTypeConsume)
	rpmTpmQuery = rpmTpmQuery.Where("type = ?", LogTypeConsume)

	// 只统计最近60秒的rpm和tpm
	rpmTpmQuery = rpmTpmQuery.Where("created_at >= ?", time.Now().Add(-60*time.Second).Unix())

	// 执行查询
	if err := tx.Scan(&stat).Error; err != nil {
		common.SysError("failed to query log stat: " + err.Error())
		return stat, errors.New("查询统计数据失败")
	}
	if err := rpmTpmQuery.Scan(&stat).Error; err != nil {
		common.SysError("failed to query rpm/tpm stat: " + err.Error())
		return stat, errors.New("查询统计数据失败")
	}

	return stat, nil
}

// SumUsedQuotaByUserIds 与 SumUsedQuota 同构，但以 user_id IN (?) 取代 username 文本
// 过滤，供代理商范围化 stat 端点使用：范围完全由服务端传入的 userIds 决定，不接受
// channel 等管理员维度筛选。userIds 为空时返回零值 stat（绝不回退为全量）。
func SumUsedQuotaByUserIds(userIds []int, logType int, startTimestamp int64, endTimestamp int64, modelName string, tokenName string, group string) (stat Stat, err error) {
	if len(userIds) == 0 {
		return stat, nil
	}
	tx := LOG_DB.Table("logs").Select("COALESCE(sum(quota), 0) quota").Where("user_id IN ?", userIds)

	// 为rpm和tpm创建单独的查询
	rpmTpmQuery := LOG_DB.Table("logs").Select("count(*) rpm, COALESCE(sum(prompt_tokens), 0) + COALESCE(sum(completion_tokens), 0) tpm").Where("user_id IN ?", userIds)

	if tokenName != "" {
		tx = tx.Where("token_name = ?", tokenName)
		rpmTpmQuery = rpmTpmQuery.Where("token_name = ?", tokenName)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if tx, err = applyExplicitLogTextFilter(tx, "model_name", modelName); err != nil {
		return stat, err
	}
	if rpmTpmQuery, err = applyExplicitLogTextFilter(rpmTpmQuery, "model_name", modelName); err != nil {
		return stat, err
	}
	if group != "" {
		tx = tx.Where(logGroupCol+" = ?", group)
		rpmTpmQuery = rpmTpmQuery.Where(logGroupCol+" = ?", group)
	}

	tx = tx.Where("type = ?", LogTypeConsume)
	rpmTpmQuery = rpmTpmQuery.Where("type = ?", LogTypeConsume)

	// 只统计最近60秒的rpm和tpm
	rpmTpmQuery = rpmTpmQuery.Where("created_at >= ?", time.Now().Add(-60*time.Second).Unix())

	// 执行查询
	if err := tx.Scan(&stat).Error; err != nil {
		common.SysError("failed to query agent scoped log stat: " + err.Error())
		return stat, errors.New("查询统计数据失败")
	}
	if err := rpmTpmQuery.Scan(&stat).Error; err != nil {
		common.SysError("failed to query agent scoped rpm/tpm stat: " + err.Error())
		return stat, errors.New("查询统计数据失败")
	}

	return stat, nil
}

func SumUsedToken(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string) (token int) {
	tx := LOG_DB.Table("logs").Select("COALESCE(sum(prompt_tokens), 0) + COALESCE(sum(completion_tokens), 0)")
	if username != "" {
		tx = tx.Where("username = ?", username)
	}
	if tokenName != "" {
		tx = tx.Where("token_name = ?", tokenName)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if modelName != "" {
		tx = tx.Where("model_name = ?", modelName)
	}
	tx.Where("type = ?", LogTypeConsume).Scan(&token)
	return token
}

func CountOldLog(ctx context.Context, targetTimestamp int64) (int64, error) {
	var total int64
	if err := LOG_DB.WithContext(ctx).Model(&Log{}).Where("created_at < ?", targetTimestamp).Count(&total).Error; err != nil {
		return 0, err
	}
	return total, nil
}

func DeleteOldLogBatch(ctx context.Context, targetTimestamp int64, limit int) (int64, error) {
	if limit <= 0 {
		limit = 100
	}
	if nil != ctx.Err() {
		return 0, ctx.Err()
	}

	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		// ClickHouse DELETE is a heavy mutation that rewrites data parts, so
		// per-batch mutations would be pathologically slow. Remove all matching
		// rows in a single synchronous mutation regardless of limit; the reported
		// count lets the caller's progress loop complete in one pass.
		total, err := CountOldLog(ctx, targetTimestamp)
		if err != nil {
			return 0, err
		}
		if total == 0 {
			return 0, nil
		}
		if err := LOG_DB.WithContext(ctx).Exec(
			"ALTER TABLE logs DELETE WHERE created_at < ? SETTINGS mutations_sync = 1",
			targetTimestamp,
		).Error; err != nil {
			return 0, err
		}
		return total, nil
	}

	result := LOG_DB.WithContext(ctx).Where("created_at < ?", targetTimestamp).Limit(limit).Delete(&Log{})
	if nil != result.Error {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}

func DeleteOldLog(ctx context.Context, targetTimestamp int64, limit int) (int64, error) {
	if limit <= 0 {
		limit = 100
	}

	var total int64 = 0

	for {
		if nil != ctx.Err() {
			return total, ctx.Err()
		}

		rowsAffected, err := DeleteOldLogBatch(ctx, targetTimestamp, limit)
		if nil != err {
			return total, err
		}

		total += rowsAffected

		if rowsAffected < int64(limit) {
			break
		}
	}

	return total, nil
}
