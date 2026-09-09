package model

import (
	"sort"
	"time"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// 企业（组织）维度的用量报表、消费明细与成员密钥查询。
//
// 数据源约定：
//   - 用量报表读 quota_data 的 org_id 维度（写入时机与个人看板一致，精确到小时）
//   - logs 表没有 org_id 列，消费明细按成员 user_id 集合过滤，成员归属以 org_members 为准
//   - 密钥同理，按成员 user_id 集合过滤
//
// 按日归并在内存中完成，避免 SQLite / MySQL / PostgreSQL 三套日期函数方言。

// OrgUsageTotal 企业在时间窗内的用量总量
type OrgUsageTotal struct {
	Count     int `json:"count"`
	Quota     int `json:"quota"`
	TokenUsed int `json:"token_used"`
	// CacheHits 命中响应缓存的请求次数，CacheSavedQuota 是这些请求节省下来的额度。
	// 命中请求 Quota=0，因此命中率 = CacheHits / Count，节省额度独立于 Quota 统计。
	CacheHits       int `json:"cache_hits"`
	CacheSavedQuota int `json:"cache_saved_quota"`
}

// OrgUsageByDay 按自然日聚合，Date 为当日零点时间戳（服务器本地时区）
type OrgUsageByDay struct {
	Date            int64 `json:"date"`
	Count           int   `json:"count"`
	Quota           int   `json:"quota"`
	TokenUsed       int   `json:"token_used"`
	CacheHits       int   `json:"cache_hits"`
	CacheSavedQuota int   `json:"cache_saved_quota"`
}

// OrgUsageByMember 按成员聚合，QuotaLimit / QuotaUsed 取自 org_members，便于前端一次渲染成员榜
type OrgUsageByMember struct {
	UserId     int    `json:"user_id"`
	Username   string `json:"username"`
	OrgRole    string `json:"org_role"`
	QuotaLimit int    `json:"quota_limit"`
	QuotaUsed  int    `json:"quota_used"`
	Count      int    `json:"count"`
	Quota      int    `json:"quota"`
	TokenUsed  int    `json:"token_used"`
}

// OrgUsageByModel 按模型聚合
type OrgUsageByModel struct {
	ModelName string `json:"model_name"`
	Count     int    `json:"count"`
	Quota     int    `json:"quota"`
	TokenUsed int    `json:"token_used"`
}

// OrgUsageReport 企业用量报表，一次查询返回总量与三个维度的聚合
type OrgUsageReport struct {
	Total    OrgUsageTotal       `json:"total"`
	ByDay    []*OrgUsageByDay    `json:"by_day"`
	ByMember []*OrgUsageByMember `json:"by_member"`
	ByModel  []*OrgUsageByModel  `json:"by_model"`
}

// OrgDayStart 返回时间戳所在自然日的零点（服务器本地时区），
// 与 model/checkin.go 的"今日"口径保持一致。
func OrgDayStart(ts int64) int64 {
	t := time.Unix(ts, 0)
	year, month, day := t.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, t.Location()).Unix()
}

// GetOrgQuotaData 读取企业在时间窗内的小时级原始聚合行，供上层二次归并
func GetOrgQuotaData(orgId int, startTime int64, endTime int64) ([]*QuotaData, error) {
	if orgId <= 0 {
		return nil, nil
	}
	var rows []*QuotaData
	err := DB.Table("quota_data").
		Select("user_id, username, model_name, created_at, sum(count) as count, sum(quota) as quota, sum(token_used) as token_used, sum(cache_hits) as cache_hits, sum(cache_saved_quota) as cache_saved_quota").
		Where("org_id = ? and created_at >= ? and created_at <= ?", orgId, startTime, endTime).
		Group("user_id, username, model_name, created_at").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// GetOrgUsage 汇总企业在 [startTime, endTime] 内的用量：总量 + 按日 + 按成员 + 按模型。
// 成员维度左连 org_members 以带出角色与子额度；当期没有用量的成员也会出现（子额度可见），
// 已移出企业的历史用量仍按 user_id 保留一行。
func GetOrgUsage(orgId int, startTime int64, endTime int64) (*OrgUsageReport, error) {
	report := &OrgUsageReport{
		ByDay:    []*OrgUsageByDay{},
		ByMember: []*OrgUsageByMember{},
		ByModel:  []*OrgUsageByModel{},
	}
	if orgId <= 0 {
		return report, nil
	}
	rows, err := GetOrgQuotaData(orgId, startTime, endTime)
	if err != nil {
		return nil, err
	}

	dayIndex := map[int64]*OrgUsageByDay{}
	memberIndex := map[int]*OrgUsageByMember{}
	modelIndex := map[string]*OrgUsageByModel{}

	for _, row := range rows {
		report.Total.Count += row.Count
		report.Total.Quota += row.Quota
		report.Total.TokenUsed += row.TokenUsed
		report.Total.CacheHits += row.CacheHits
		report.Total.CacheSavedQuota += row.CacheSavedQuota

		day := OrgDayStart(row.CreatedAt)
		dayRow, ok := dayIndex[day]
		if !ok {
			dayRow = &OrgUsageByDay{Date: day}
			dayIndex[day] = dayRow
		}
		dayRow.Count += row.Count
		dayRow.Quota += row.Quota
		dayRow.TokenUsed += row.TokenUsed
		dayRow.CacheHits += row.CacheHits
		dayRow.CacheSavedQuota += row.CacheSavedQuota

		modelRow, ok := modelIndex[row.ModelName]
		if !ok {
			modelRow = &OrgUsageByModel{ModelName: row.ModelName}
			modelIndex[row.ModelName] = modelRow
		}
		modelRow.Count += row.Count
		modelRow.Quota += row.Quota
		modelRow.TokenUsed += row.TokenUsed

		memberRow, ok := memberIndex[row.UserID]
		if !ok {
			memberRow = &OrgUsageByMember{UserId: row.UserID, Username: row.Username}
			memberIndex[row.UserID] = memberRow
		}
		memberRow.Count += row.Count
		memberRow.Quota += row.Quota
		memberRow.TokenUsed += row.TokenUsed
	}

	// 回填成员角色与子额度，以 user_id 为准（改名不影响归属）
	if details, _, memberErr := GetOrgMembers(orgId, "", 0, orgMemberListLimit); memberErr != nil {
		common.SysLog("failed to load org members for usage report: " + memberErr.Error())
	} else {
		for _, member := range details {
			if row, ok := memberIndex[member.UserId]; ok {
				row.Username = member.Username
				row.OrgRole = member.OrgRole
				row.QuotaLimit = member.QuotaLimit
				row.QuotaUsed = member.QuotaUsed
				continue
			}
			memberIndex[member.UserId] = &OrgUsageByMember{
				UserId:     member.UserId,
				Username:   member.Username,
				OrgRole:    member.OrgRole,
				QuotaLimit: member.QuotaLimit,
				QuotaUsed:  member.QuotaUsed,
			}
		}
	}

	for _, day := range dayIndex {
		report.ByDay = append(report.ByDay, day)
	}
	sort.Slice(report.ByDay, func(i, j int) bool { return report.ByDay[i].Date < report.ByDay[j].Date })

	for _, member := range memberIndex {
		report.ByMember = append(report.ByMember, member)
	}
	sort.Slice(report.ByMember, func(i, j int) bool {
		if report.ByMember[i].Quota != report.ByMember[j].Quota {
			return report.ByMember[i].Quota > report.ByMember[j].Quota
		}
		return report.ByMember[i].UserId < report.ByMember[j].UserId
	})

	for _, item := range modelIndex {
		report.ByModel = append(report.ByModel, item)
	}
	sort.Slice(report.ByModel, func(i, j int) bool {
		if report.ByModel[i].Quota != report.ByModel[j].Quota {
			return report.ByModel[i].Quota > report.ByModel[j].Quota
		}
		return report.ByModel[i].ModelName < report.ByModel[j].ModelName
	})

	return report, nil
}

// GetOrgQuotaTotal 企业在时间窗内的用量总量（报表卡片与告警判定共用）
func GetOrgQuotaTotal(orgId int, startTime int64, endTime int64) (*OrgUsageTotal, error) {
	total := &OrgUsageTotal{}
	if orgId <= 0 {
		return total, nil
	}
	err := DB.Table("quota_data").
		Select("COALESCE(sum(count), 0) as count, COALESCE(sum(quota), 0) as quota, COALESCE(sum(token_used), 0) as token_used, COALESCE(sum(cache_hits), 0) as cache_hits, COALESCE(sum(cache_saved_quota), 0) as cache_saved_quota").
		Where("org_id = ? and created_at >= ? and created_at <= ?", orgId, startTime, endTime).
		Scan(total).Error
	if err != nil {
		return nil, err
	}
	return total, nil
}

// GetOrgDailyQuota 企业当日（服务器本地自然日）累计消耗额度，供日用量告警判定
func GetOrgDailyQuota(orgId int, now int64) (int, error) {
	if orgId <= 0 {
		return 0, nil
	}
	var result struct {
		Quota int `gorm:"column:quota"`
	}
	err := DB.Table("quota_data").
		Select("COALESCE(sum(quota), 0) as quota").
		Where("org_id = ? and created_at >= ?", orgId, OrgDayStart(now)).
		Scan(&result).Error
	if err != nil {
		return 0, err
	}
	return result.Quota, nil
}

// GetOrgLogs 分页读取企业成员的消费明细。
// userId > 0 时收窄到单个成员（调用方需保证该成员属于本企业）。
func GetOrgLogs(userIds []int, logType int, startTimestamp int64, endTimestamp int64, modelName string, userId int, startIdx int, num int) (logs []*Log, total int64, err error) {
	if len(userIds) == 0 {
		return nil, 0, nil
	}
	build := func() *gorm.DB {
		tx := LOG_DB.Where("logs.user_id IN ?", userIds)
		if logType != LogTypeUnknown {
			tx = tx.Where("logs.type = ?", logType)
		}
		if userId > 0 {
			tx = tx.Where("logs.user_id = ?", userId)
		}
		if startTimestamp != 0 {
			tx = tx.Where("logs.created_at >= ?", startTimestamp)
		}
		if endTimestamp != 0 {
			tx = tx.Where("logs.created_at <= ?", endTimestamp)
		}
		return tx
	}

	tx := build()
	if tx, err = applyExplicitLogTextFilter(tx, "logs.model_name", modelName); err != nil {
		return nil, 0, err
	}
	if err = tx.Model(&Log{}).Limit(logSearchCountLimit).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	tx = build()
	if tx, err = applyExplicitLogTextFilter(tx, "logs.model_name", modelName); err != nil {
		return nil, 0, err
	}
	order := "logs.created_at desc, logs.id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("logs.")
	}
	if err = tx.Order(order).Limit(num).Offset(startIdx).Find(&logs).Error; err != nil {
		return nil, 0, err
	}
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		assignDisplayLogIds(logs, startIdx)
	}
	if err = attachLogChannelNames(logs); err != nil {
		return logs, total, err
	}
	return logs, total, nil
}

// GetOrgTokens 分页读取企业成员的密钥（明文 key 由 controller 统一脱敏）。
// userId > 0 时收窄到单个成员；keyword 沿用令牌搜索的 LIKE 语义（不自动补 %）。
func GetOrgTokens(userIds []int, userId int, keyword string, startIdx int, num int) ([]*Token, int64, error) {
	if len(userIds) == 0 {
		return nil, 0, nil
	}
	build := func() *gorm.DB {
		query := DB.Model(&Token{}).Where("user_id IN ?", userIds)
		if userId > 0 {
			query = query.Where("user_id = ?", userId)
		}
		return query
	}
	query := build()
	if keyword != "" {
		pattern, err := sanitizeLikePattern(keyword)
		if err != nil {
			return nil, 0, err
		}
		if pattern != "" {
			query = query.Where("name LIKE ?", pattern)
		}
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var tokens []*Token
	if err := build().Order("id desc").Limit(num).Offset(startIdx).Find(&tokens).Error; err != nil {
		return nil, 0, err
	}
	return tokens, total, nil
}
