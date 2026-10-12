package model

import (
	"math"
	"regexp"
	"sort"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"gorm.io/gorm"
)

// 账单中心：充值/加额流水与消耗明细的查询模型。
// 充值流水由三类来源合并：在线支付(top_ups)、管理员对用户手动调额、
// 管理员对企业额度池调额（后两者只有管理审计日志，无独立台账表）。

const (
	BillingSourceOnlineTopup = "online_topup"
	BillingSourceUserAdjust  = "user_adjust"
	BillingSourceOrgAdjust   = "org_adjust"
)

// billingRechargeCap 单次查询每个来源最多返回的记录数，
// 防止无界扫描审计日志/充值表拖垮数据库。
const billingRechargeCap = 20000

type BillingRechargeRecord struct {
	Source        string  `json:"source"`
	CreatedAt     int64   `json:"created_at"`
	UserId        int     `json:"user_id"`
	Username      string  `json:"username"`
	OrgId         int     `json:"org_id"`
	OrgName       string  `json:"org_name"`
	Quota         int     `json:"quota"`
	Money         float64 `json:"money"`
	PaymentMethod string  `json:"payment_method"`
	TradeNo       string  `json:"trade_no"`
	Operator      string  `json:"operator"`
	Action        string  `json:"action"`
}

type BillingRechargeStat struct {
	Count           int `json:"count"`
	TotalQuota      int `json:"total_quota"`
	OnlineQuota     int `json:"online_quota"`
	UserAdjustQuota int `json:"user_adjust_quota"`
	OrgAdjustQuota  int `json:"org_adjust_quota"`
}

type BillingConsumptionStat struct {
	RequestCount int64 `json:"request_count"`
	ConsumeQuota int64 `json:"consume_quota"`
	RefundQuota  int64 `json:"refund_quota"`
	TotalTokens  int64 `json:"total_tokens"`
}

func containsInt(ids []int, target int) bool {
	for _, id := range ids {
		if id == target {
			return true
		}
	}
	return false
}

// topUpGrantedQuota 按支付渠道还原订单实际到账额度，规则与补单逻辑保持一致。
func topUpGrantedQuota(topUp *TopUp) int {
	switch topUp.PaymentProvider {
	case PaymentProviderStripe:
		return int(math.Round(topUp.Money * common.QuotaPerUnit))
	case PaymentProviderCreem:
		return int(topUp.Amount)
	default:
		return int(math.Round(float64(topUp.Amount) * common.QuotaPerUnit))
	}
}

var quotaDisplayNumberRe = regexp.MustCompile(`[0-9]+(?:\.[0-9]+)?`)

// quotaFromDisplayValue 把审计日志中展示态金额（如 "＄12.000000 额度"）的数字部分
// 还原为 quota 整数。仅用于历史数据兜底：新写入的审计参数已带数值字段。
func quotaFromDisplayValue(value float64) int {
	switch operation_setting.GetQuotaDisplayType() {
	case operation_setting.QuotaDisplayTypeCNY:
		rate := operation_setting.USDExchangeRate
		if rate <= 0 {
			rate = 1
		}
		return int(math.Round(value / rate * common.QuotaPerUnit))
	case operation_setting.QuotaDisplayTypeCustom:
		rate := operation_setting.GetGeneralSetting().CustomCurrencyExchangeRate
		if rate <= 0 {
			rate = 1
		}
		return int(math.Round(value / rate * common.QuotaPerUnit))
	case operation_setting.QuotaDisplayTypeTokens:
		return int(math.Round(value))
	default:
		return int(math.Round(value * common.QuotaPerUnit))
	}
}

func parseQuotaDisplay(text string) (int, bool) {
	match := quotaDisplayNumberRe.FindString(text)
	if match == "" {
		return 0, false
	}
	value, err := strconv.ParseFloat(match, 64)
	if err != nil {
		return 0, false
	}
	return quotaFromDisplayValue(value), true
}

func paramInt(params map[string]interface{}, key string) (int, bool) {
	raw, ok := params[key]
	if !ok {
		return 0, false
	}
	switch v := raw.(type) {
	case float64:
		return int(v), true
	case int:
		return v, true
	case int64:
		return int(v), true
	}
	return 0, false
}

func paramString(params map[string]interface{}, key string) string {
	if raw, ok := params[key].(string); ok {
		return raw
	}
	return ""
}

// adjustQuotaFromParams 从调额审计参数还原带符号的额度变化：
// 优先数值字段（新数据），回退解析展示态字符串（历史数据）。
func adjustQuotaFromParams(action string, params map[string]interface{}) (int, bool) {
	switch action {
	case "user.quota_add":
		if v, ok := paramInt(params, "quota_value"); ok {
			return v, true
		}
		v, ok := parseQuotaDisplay(paramString(params, "quota"))
		return v, ok
	case "user.quota_subtract":
		if v, ok := paramInt(params, "quota_value"); ok {
			return -v, true
		}
		v, ok := parseQuotaDisplay(paramString(params, "quota"))
		return -v, ok
	case "user.quota_override":
		from, fromOk := paramInt(params, "from_value")
		to, toOk := paramInt(params, "to_value")
		if !fromOk || !toOk {
			fromParsed, fromParseOk := parseQuotaDisplay(paramString(params, "from"))
			toParsed, toParseOk := parseQuotaDisplay(paramString(params, "to"))
			if !fromParseOk || !toParseOk {
				return 0, false
			}
			from, to = fromParsed, toParsed
		}
		return to - from, true
	case "org.quota_adjust":
		return paramInt(params, "delta")
	}
	return 0, false
}

func collectOnlineTopupRecords(userIds []int, startTimestamp, endTimestamp int64) ([]*BillingRechargeRecord, error) {
	tx := DB.Model(&TopUp{}).Where("status = ?", common.TopUpStatusSuccess)
	if len(userIds) > 0 {
		tx = tx.Where("user_id IN ?", userIds)
	}
	if startTimestamp != 0 {
		tx = tx.Where("create_time >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("create_time <= ?", endTimestamp)
	}
	var topups []*TopUp
	if err := tx.Order("id desc").Limit(billingRechargeCap).Find(&topups).Error; err != nil {
		return nil, err
	}
	records := make([]*BillingRechargeRecord, 0, len(topups))
	for _, topUp := range topups {
		records = append(records, &BillingRechargeRecord{
			Source:        BillingSourceOnlineTopup,
			CreatedAt:     topUp.CompleteTime,
			UserId:        topUp.UserId,
			Quota:         topUpGrantedQuota(topUp),
			Money:         topUp.Money,
			PaymentMethod: topUp.PaymentMethod,
			TradeNo:       topUp.TradeNo,
			Action:        topUp.PaymentProvider,
		})
	}
	return records, nil
}

type manageAuditRow struct {
	CreatedAt int64  `gorm:"column:created_at"`
	Username  string `gorm:"column:username"`
	Other     string `gorm:"column:other"`
}

func collectAdjustRecords(userIds, orgIds []int, startTimestamp, endTimestamp int64) ([]*BillingRechargeRecord, error) {
	actions := []string{"user.quota_add", "user.quota_subtract", "user.quota_override", "org.quota_adjust"}
	condition := ""
	args := make([]interface{}, 0, len(actions))
	for i, action := range actions {
		if i > 0 {
			condition += " OR "
		}
		condition += "other LIKE ?"
		args = append(args, "%\"action\":\""+action+"\"%")
	}
	tx := LOG_DB.Model(&Log{}).
		Select("created_at, username, other").
		Where("type = ?", LogTypeManage).
		Where("("+condition+")", args...)
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	var rows []manageAuditRow
	if err := tx.Order("created_at desc").Limit(billingRechargeCap).Find(&rows).Error; err != nil {
		return nil, err
	}

	records := make([]*BillingRechargeRecord, 0, len(rows))
	for _, row := range rows {
		otherMap, _ := common.StrToMap(row.Other)
		op, _ := otherMap["op"].(map[string]interface{})
		if op == nil {
			continue
		}
		action := paramString(op, "action")
		params, _ := op["params"].(map[string]interface{})
		if params == nil {
			continue
		}
		quota, ok := adjustQuotaFromParams(action, params)
		if !ok {
			continue
		}
		record := &BillingRechargeRecord{
			Source:    BillingSourceUserAdjust,
			CreatedAt: row.CreatedAt,
			Operator:  row.Username,
			Action:    action,
			Quota:     quota,
		}
		if action == "org.quota_adjust" {
			orgId, orgOk := paramInt(params, "id")
			if !orgOk || (len(orgIds) > 0 && !containsInt(orgIds, orgId)) {
				continue
			}
			record.Source = BillingSourceOrgAdjust
			record.OrgId = orgId
			record.OrgName = paramString(params, "name")
		} else {
			targetUserId, _ := paramInt(params, "target_user_id")
			if len(userIds) > 0 && !containsInt(userIds, targetUserId) {
				continue
			}
			record.UserId = targetUserId
		}
		records = append(records, record)
	}
	return records, nil
}

func attachBillingUsernames(records []*BillingRechargeRecord) error {
	ids := make([]int, 0, len(records))
	seen := make(map[int]bool)
	for _, record := range records {
		if record.UserId != 0 && !seen[record.UserId] {
			seen[record.UserId] = true
			ids = append(ids, record.UserId)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	type userRow struct {
		Id       int    `gorm:"column:id"`
		Username string `gorm:"column:username"`
	}
	var users []userRow
	if err := DB.Table("users").Select("id, username").Where("id IN ?", ids).Find(&users).Error; err != nil {
		return err
	}
	nameById := make(map[int]string, len(users))
	for _, user := range users {
		nameById[user.Id] = user.Username
	}
	for _, record := range records {
		record.Username = nameById[record.UserId]
	}
	return nil
}

// GetBillingRechargeRecords 合并三类充值/加额来源，按时间倒序返回并汇总统计。
// userIds/orgIds 为空表示不限定对象（全平台流水）。
func GetBillingRechargeRecords(userIds, orgIds []int, startTimestamp, endTimestamp int64) (records []*BillingRechargeRecord, stat BillingRechargeStat, err error) {
	online, err := collectOnlineTopupRecords(userIds, startTimestamp, endTimestamp)
	if err != nil {
		return nil, stat, err
	}
	adjusts, err := collectAdjustRecords(userIds, orgIds, startTimestamp, endTimestamp)
	if err != nil {
		return nil, stat, err
	}
	records = append(online, adjusts...)
	if err := attachBillingUsernames(records); err != nil {
		return nil, stat, err
	}
	sort.SliceStable(records, func(i, j int) bool {
		return records[i].CreatedAt > records[j].CreatedAt
	})
	for _, record := range records {
		stat.Count++
		stat.TotalQuota += record.Quota
		switch record.Source {
		case BillingSourceOnlineTopup:
			stat.OnlineQuota += record.Quota
		case BillingSourceUserAdjust:
			stat.UserAdjustQuota += record.Quota
		case BillingSourceOrgAdjust:
			stat.OrgAdjustQuota += record.Quota
		}
	}
	return records, stat, nil
}

// GetBillingConsumption 按用户/企业维度分页查询消耗与退款明细。
// 企业维度通过成员关系展开为用户集合参与筛选；userOrg/orgNames 则按返回行
// 的用户当前归属回填，供前端展示企业列。
func GetBillingConsumption(userIds, orgIds []int, startTimestamp, endTimestamp int64, pageInfo *common.PageInfo) (logs []*Log, total int64, stat BillingConsumptionStat, userOrg map[int]int, orgNames map[int]string, err error) {
	userOrg = make(map[int]int)
	orgNames = make(map[int]string)
	mergedIds := append([]int{}, userIds...)
	for _, orgId := range orgIds {
		memberIds, memberErr := GetOrgMemberUserIds(orgId)
		if memberErr != nil {
			return nil, 0, stat, nil, nil, memberErr
		}
		for _, memberId := range memberIds {
			if !containsInt(mergedIds, memberId) {
				mergedIds = append(mergedIds, memberId)
			}
		}
	}

	tx := LOG_DB.Model(&Log{}).Where("type IN ?", []int{LogTypeConsume, LogTypeRefund})
	if len(mergedIds) > 0 {
		tx = tx.Where("user_id IN ?", mergedIds)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}

	statRow := struct {
		RequestCount int64 `gorm:"column:request_count"`
		ConsumeQuota int64 `gorm:"column:consume_quota"`
		RefundQuota  int64 `gorm:"column:refund_quota"`
		TotalTokens  int64 `gorm:"column:total_tokens"`
	}{}
	if err = tx.Session(&gorm.Session{}).Select(
		"COALESCE(SUM(CASE WHEN type = ? THEN 1 ELSE 0 END), 0) request_count, "+
			"COALESCE(SUM(CASE WHEN type = ? THEN quota ELSE 0 END), 0) consume_quota, "+
			"COALESCE(SUM(CASE WHEN type = ? THEN quota ELSE 0 END), 0) refund_quota, "+
			"COALESCE(SUM(CASE WHEN type = ? THEN prompt_tokens + completion_tokens ELSE 0 END), 0) total_tokens",
		LogTypeConsume, LogTypeConsume, LogTypeRefund, LogTypeConsume,
	).Scan(&statRow).Error; err != nil {
		return nil, 0, stat, nil, nil, err
	}
	stat = BillingConsumptionStat{
		RequestCount: statRow.RequestCount,
		ConsumeQuota: statRow.ConsumeQuota,
		RefundQuota:  statRow.RefundQuota,
		TotalTokens:  statRow.TotalTokens,
	}

	if err = tx.Count(&total).Error; err != nil {
		return nil, 0, stat, nil, nil, err
	}
	order := "created_at desc, id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("")
	}
	if err = tx.Order(order).Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&logs).Error; err != nil {
		return nil, 0, stat, nil, nil, err
	}

	// 归属列以用户当前所属企业为准，所以不论按用户还是按企业筛选，
	// 都按返回行的 user_id 回填一次映射（展示名优先 display_name）。
	if len(logs) > 0 {
		rowUserIds := make([]int, 0, len(logs))
		seenUser := make(map[int]bool, len(logs))
		for _, log := range logs {
			if log.UserId > 0 && !seenUser[log.UserId] {
				seenUser[log.UserId] = true
				rowUserIds = append(rowUserIds, log.UserId)
			}
		}
		var rowUsers []*User
		if err = DB.Select("id, org_id").Where("id IN ?", rowUserIds).Find(&rowUsers).Error; err != nil {
			return nil, 0, stat, nil, nil, err
		}
		if err = AttachOrgNames(rowUsers); err != nil {
			return nil, 0, stat, nil, nil, err
		}
		for _, rowUser := range rowUsers {
			if rowUser.OrgId <= 0 {
				continue
			}
			userOrg[rowUser.Id] = rowUser.OrgId
			orgNames[rowUser.OrgId] = rowUser.OrgName
		}
	}

	return logs, total, stat, userOrg, orgNames, nil
}

// GetBillingConsumptionAll 导出用：不分页拉取消耗明细（带上限保护）。
const billingConsumptionExportCap = 100000

func GetBillingConsumptionAll(userIds, orgIds []int, startTimestamp, endTimestamp int64) (logs []*Log, userOrg map[int]int, orgNames map[int]string, err error) {
	pageInfo := &common.PageInfo{}
	pageInfo.Page = 1
	pageInfo.PageSize = billingConsumptionExportCap
	logs, _, _, userOrg, orgNames, err = GetBillingConsumption(userIds, orgIds, startTimestamp, endTimestamp, pageInfo)
	return logs, userOrg, orgNames, err
}
