package model

import (
	"fmt"
	"sort"
	"time"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// 渠道账单中心：与上游对账的用量聚合查询模型。
//
// 口径（见 Log.UpstreamPromptTokens/TaskSettle/CacheHit 注释）：
//   - 聚合只计 consume 且非 settle 行：每个上游交互恰好一行——普通 relay 请求
//     一条 consume；异步任务的预扣行（成功时回填为上游真实用量）计入，差额结算
//     行（task_settle）与整单退款行都排除，避免同一任务 tokens 双计。这与既有
//     下游账单 total_tokens 只统计 consume 行的约定一致（见 model/billing.go）。
//     失败任务的预扣行从不回填（backfill 仅成功路径），tokens 保持 0，净额自然为 0。
//   - 排除缓存命中回放（cache_hit）：不打上游、quota=0；
//   - tokens 用上游真实值：upstream 列非 0 优先，为 0 回退计费 tokens 列
//     （历史数据与无费率缩放链路两者一致）；
//   - 费用是估算值：按渠道级上游合同费率卡（channels.upstream_prices）计算，
//     与售价（模型广场价）严格分离；未配置价格的行费用为 0 且显式标记，
//     不静默按 $0 漏计。
//   - 明细视图（GetChannelBillingDetails）另含退款/结算行供审计追溯，其
//     tokens 展示走 Log.UpstreamTokenUsage（结算行显示 0，表示不计入对账）。

// channelBillingRowCap 聚合前拉取的原始行数上限，防止超大时间范围拖垮数据库。
// 超限时报错提示缩小范围，而不是静默截断导致对不上账。
const channelBillingRowCap = 100000

// ChannelBillingFilter 渠道账单查询条件。ChannelIds 为空表示全部渠道。
type ChannelBillingFilter struct {
	ChannelIds []int
	ModelName  string
	Start      int64
	End        int64
}

// ChannelBillingRecord 按「日期 × 渠道 × 模型」聚合的一行。
// Date 为当日 UTC 零点时间戳：time.Truncate(24h) 按绝对时间对齐到 UTC 午夜，
// 与服务器/浏览器时区无关。前端与 CSV 导出都必须按 UTC 格式化该字段，
// 否则负时区偏移下会显示成前一天，与分桶口径不一致。
type ChannelBillingRecord struct {
	Date             int64  `json:"date"`
	ChannelId        int    `json:"channel_id"`
	ChannelName      string `json:"channel_name"`
	ModelName        string `json:"model_name"`
	RequestCount     int64  `json:"request_count"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
	// EstimatedCostQuota 为按渠道费率卡估算的上游成本（quota 口径）。
	// 未配置该渠道价格时为 0 且 PriceConfigured=false，前端据此区分
	// 「估算为 0」与「无法估算」，成本估算永远只是参考、token 才是对账主体。
	EstimatedCostQuota int  `json:"estimated_cost_quota"`
	PriceConfigured    bool `json:"price_configured"`
}

// ChannelBillingStat 筛选范围内的汇总。
type ChannelBillingStat struct {
	RequestCount      int64 `json:"request_count"`
	TotalTokens       int64 `json:"total_tokens"`
	PromptTokens      int64 `json:"prompt_tokens"`
	CompletionTokens  int64 `json:"completion_tokens"`
	EstimatedCost     int64 `json:"estimated_cost_quota"`
	ChannelCount      int   `json:"channel_count"`
	PricedChannelCnt  int   `json:"priced_channel_count"`
	UnpricedRecordCnt int64 `json:"unpriced_record_count"`
}

// channelBillingRow 聚合前的原始行：tokens 的 upstream 回退用 SQL CASE 完成
// （三库通用），天级分桶在 Go 侧做（FROM_UNIXTIME/to_timestamp 在 SQLite
// 不可用，跨库日期函数无法统一）。行已按「consume 且非 settle」过滤，无需再判类型。
type channelBillingRow struct {
	CreatedAt        int64  `gorm:"column:created_at"`
	ChannelId        int    `gorm:"column:channel_id"`
	ModelName        string `gorm:"column:model_name"`
	PromptTokens     int64  `gorm:"column:prompt_tokens"`
	CompletionTokens int64  `gorm:"column:completion_tokens"`
}

// channelBillingBaseQuery 构造对账行公共过滤：真实渠道、排除缓存命中、渠道/模型/时间。
// cache_hit 为新增列，存量行是 NULL，用 COALESCE 兼容三库。
// recordsOnly=true 时额外限定「consume 且非 task_settle」（聚合口径）；
// false 时纳入 consume+refund 全部行（明细审计视图）。
func channelBillingBaseQuery(filter ChannelBillingFilter, recordsOnly bool) (*gorm.DB, error) {
	tx := LOG_DB.Model(&Log{}).
		Where("channel_id > 0").
		Where("COALESCE(cache_hit, " + commonFalseVal + ") = " + commonFalseVal)
	if recordsOnly {
		tx = tx.Where("type = ?", LogTypeConsume).
			Where("COALESCE(task_settle, " + commonFalseVal + ") = " + commonFalseVal)
	} else {
		tx = tx.Where("type IN ?", []int{LogTypeConsume, LogTypeRefund})
	}
	if len(filter.ChannelIds) > 0 {
		tx = tx.Where("channel_id IN ?", filter.ChannelIds)
	}
	if filter.ModelName != "" {
		var err error
		if tx, err = applyExplicitLogTextFilter(tx, "model_name", filter.ModelName); err != nil {
			return nil, err
		}
	}
	if filter.Start != 0 {
		tx = tx.Where("created_at >= ?", filter.Start)
	}
	if filter.End != 0 {
		tx = tx.Where("created_at <= ?", filter.End)
	}
	return tx, nil
}

// channelBillingTokenExpr 上游真实 tokens 的 SQL 口径：
// upstream 列非 0 优先，否则回退计费列（结算行已在 WHERE 过滤，此处无需再判）。
func channelBillingTokenExpr(column, upstreamColumn string) string {
	return fmt.Sprintf(
		"CASE WHEN COALESCE(%s, 0) > 0 THEN %s ELSE COALESCE(%s, 0) END",
		upstreamColumn, upstreamColumn, column)
}

func fetchChannelBillingRows(filter ChannelBillingFilter) ([]channelBillingRow, error) {
	tx, err := channelBillingBaseQuery(filter, true)
	if err != nil {
		return nil, err
	}
	var count int64
	if err := tx.Session(&gorm.Session{}).Count(&count).Error; err != nil {
		return nil, err
	}
	if count > channelBillingRowCap {
		return nil, fmt.Errorf("查询范围过大（%d 行，上限 %d），请缩小时间范围或指定渠道", count, channelBillingRowCap)
	}
	order := "created_at desc, id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("")
	}
	var rows []channelBillingRow
	err = tx.Select(
		"created_at, channel_id, model_name, " +
			channelBillingTokenExpr("prompt_tokens", "upstream_prompt_tokens") + " AS prompt_tokens, " +
			channelBillingTokenExpr("completion_tokens", "upstream_completion_tokens") + " AS completion_tokens",
	).Order(order).Limit(channelBillingRowCap).Find(&rows).Error
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// GetChannelBillingRecords 返回「日期 × 渠道 × 模型」聚合行与汇总，
// 并按渠道费率卡估算成本。排序：日期倒序、渠道升序、模型升序（稳定输出）。
func GetChannelBillingRecords(filter ChannelBillingFilter) (records []ChannelBillingRecord, stat ChannelBillingStat, err error) {
	rows, err := fetchChannelBillingRows(filter)
	if err != nil {
		return nil, stat, err
	}
	type bucketKey struct {
		Day       int64
		ChannelId int
		ModelName string
	}
	buckets := make(map[bucketKey]*ChannelBillingRecord)
	channelSet := make(map[int]bool)
	for _, row := range rows {
		day := time.Unix(row.CreatedAt, 0).Truncate(24 * time.Hour).Unix()
		key := bucketKey{Day: day, ChannelId: row.ChannelId, ModelName: row.ModelName}
		record, ok := buckets[key]
		if !ok {
			record = &ChannelBillingRecord{Date: day, ChannelId: row.ChannelId, ModelName: row.ModelName}
			buckets[key] = record
		}
		record.RequestCount++
		record.PromptTokens += row.PromptTokens
		record.CompletionTokens += row.CompletionTokens
		record.TotalTokens += row.PromptTokens + row.CompletionTokens
		channelSet[row.ChannelId] = true
		stat.RequestCount++
		stat.PromptTokens += row.PromptTokens
		stat.CompletionTokens += row.CompletionTokens
		stat.TotalTokens += row.PromptTokens + row.CompletionTokens
	}
	records = make([]ChannelBillingRecord, 0, len(buckets))
	for _, record := range buckets {
		records = append(records, *record)
	}
	sort.Slice(records, func(i, j int) bool {
		if records[i].Date != records[j].Date {
			return records[i].Date > records[j].Date
		}
		if records[i].ChannelId != records[j].ChannelId {
			return records[i].ChannelId < records[j].ChannelId
		}
		return records[i].ModelName < records[j].ModelName
	})

	if err := attachChannelBillingNames(records); err != nil {
		return nil, stat, err
	}
	pricedChannels, err := applyChannelUpstreamCost(records)
	if err != nil {
		return nil, stat, err
	}
	stat.ChannelCount = len(channelSet)
	stat.PricedChannelCnt = len(pricedChannels)
	for _, record := range records {
		stat.EstimatedCost += int64(record.EstimatedCostQuota)
		if !record.PriceConfigured {
			stat.UnpricedRecordCnt++
		}
	}
	return records, stat, nil
}

// attachChannelBillingNames 回填渠道名（渠道数量有限，直接查表，不走缓存）。
func attachChannelBillingNames(records []ChannelBillingRecord) error {
	if len(records) == 0 {
		return nil
	}
	ids := make([]int, 0, len(records))
	seen := make(map[int]bool)
	for _, record := range records {
		if !seen[record.ChannelId] {
			seen[record.ChannelId] = true
			ids = append(ids, record.ChannelId)
		}
	}
	type channelRow struct {
		Id   int    `gorm:"column:id"`
		Name string `gorm:"column:name"`
	}
	var channels []channelRow
	if err := DB.Table("channels").Select("id, name").Where("id IN ?", ids).Find(&channels).Error; err != nil {
		return err
	}
	nameById := make(map[int]string, len(channels))
	for _, channel := range channels {
		nameById[channel.Id] = channel.Name
	}
	for i := range records {
		records[i].ChannelName = nameById[records[i].ChannelId]
	}
	return nil
}

// applyChannelUpstreamCost 按渠道费率卡估算每行成本并就地写入。
// 返回配置了价格的渠道集合。单价是美元/百万 tokens，成本转 quota 用
// common.QuotaFromFloat（截断，饱和保护集中在 common/quota_math.go）。
func applyChannelUpstreamCost(records []ChannelBillingRecord) (map[int]bool, error) {
	pricedChannels := make(map[int]bool)
	cache := make(map[int]ChannelUpstreamPrices)
	for i := range records {
		record := &records[i]
		prices, ok := cache[record.ChannelId]
		if !ok {
			var err error
			if prices, err = GetChannelUpstreamPricesRaw(record.ChannelId); err != nil {
				return nil, err
			}
			cache[record.ChannelId] = prices
		}
		if len(prices) == 0 {
			continue
		}
		pricedChannels[record.ChannelId] = true
		price, ok := prices[record.ModelName]
		if !ok {
			continue
		}
		record.PriceConfigured = true
		usd := float64(record.PromptTokens)/1e6*price.Input + float64(record.CompletionTokens)/1e6*price.Output
		record.EstimatedCostQuota = common.QuotaFromFloat(usd * common.QuotaPerUnit)
	}
	return pricedChannels, nil
}

// GetChannelBillingDetails 分页查询对账明细日志（consume+refund 全部行，供审计追溯），
// 并回填渠道名。行内 tokens 的前端展示用 Log.UpstreamTokenUsage 同一口径
// （结算行显示 0，表示不计入对账；退款行显示被退的上游用量）。
func GetChannelBillingDetails(filter ChannelBillingFilter, pageInfo *common.PageInfo) (logs []*Log, total int64, err error) {
	tx, err := channelBillingBaseQuery(filter, false)
	if err != nil {
		return nil, 0, err
	}
	if err = tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	order := "created_at desc, id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("")
	}
	if err = tx.Order(order).Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&logs).Error; err != nil {
		return nil, 0, err
	}
	if len(logs) == 0 {
		return logs, total, nil
	}
	ids := make([]int, 0, len(logs))
	seen := make(map[int]bool)
	for _, log := range logs {
		if !seen[log.ChannelId] {
			seen[log.ChannelId] = true
			ids = append(ids, log.ChannelId)
		}
	}
	type channelRow struct {
		Id   int    `gorm:"column:id"`
		Name string `gorm:"column:name"`
	}
	var channels []channelRow
	if err = DB.Table("channels").Select("id, name").Where("id IN ?", ids).Find(&channels).Error; err != nil {
		return nil, 0, err
	}
	nameById := make(map[int]string, len(channels))
	for _, channel := range channels {
		nameById[channel.Id] = channel.Name
	}
	for _, log := range logs {
		log.ChannelName = nameById[log.ChannelId]
	}
	return logs, total, nil
}

// GetChannelBillingDetailsAll 导出用：不分页拉取明细（带上限保护）。
func GetChannelBillingDetailsAll(filter ChannelBillingFilter) (logs []*Log, err error) {
	pageInfo := &common.PageInfo{}
	pageInfo.Page = 1
	pageInfo.PageSize = channelBillingRowCap
	logs, _, err = GetChannelBillingDetails(filter, pageInfo)
	return logs, err
}
