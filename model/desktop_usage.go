package model

import (
	"context"
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

// ErrDesktopUsageQuery marks invalid bounded input, not an internal DB failure.
var ErrDesktopUsageQuery = errors.New("invalid usage log query")

// DesktopUsageLogMaxOffset bounds deep queries using the existing log search budget.
const DesktopUsageLogMaxOffset = logSearchCountLimit - 1

// GetDesktopUsageLogs reads the existing log database with a strict field allowlist.
// GetUserLogs cannot be used unchanged: it rewrites IDs and orders by ID, and only
// accepts a single type. This wrapper reuses its model filter without changing it.
func GetDesktopUsageLogs(ctx context.Context, userID int, query dto.DesktopUsageLogQuery) ([]dto.DesktopUsageLog, int64, error) {
	items := make([]dto.DesktopUsageLog, 0)
	if userID <= 0 || query.Offset < 0 || query.Offset > DesktopUsageLogMaxOffset || query.Limit < 1 || query.Limit > 100 || query.StartTimestamp < 0 || query.EndTimestamp < 0 || (query.EndTimestamp > 0 && query.StartTimestamp > query.EndTimestamp) || len(query.ModelName) > 256 {
		return nil, 0, ErrDesktopUsageQuery
	}
	// 步骤1：账号、类型均由服务端固定；排除没有模型标识的非模型错误行。
	tx := LOG_DB.WithContext(ctx).Model(&Log{}).Where("logs.user_id = ? AND logs.type IN ? AND logs.model_name <> ?", userID, []int{LogTypeConsume, LogTypeError}, "")
	tx, err := applyExplicitLogTextFilter(tx, "logs.model_name", query.ModelName)
	if err != nil {
		return nil, 0, ErrDesktopUsageQuery
	}
	if query.StartTimestamp > 0 {
		tx = tx.Where("logs.created_at >= ?", query.StartTimestamp)
	}
	if query.EndTimestamp > 0 {
		tx = tx.Where("logs.created_at <= ?", query.EndTimestamp)
	}
	// 步骤2：沿用真实记录计数，不做 Token、扣费来源或状态推算。
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	// 步骤3：直接投影安全 DTO，禁止把完整 Log 或 other 返回给客户端。
	order := "logs.created_at DESC, logs.id DESC"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("logs.")
	}
	err = tx.Select("logs.id", "logs.created_at", "logs.model_name", "logs.type", "logs.prompt_tokens", "logs.completion_tokens", "logs.quota", "logs.subscription_quota", "logs.token_name", "logs.request_id", "logs.http_status", "logs.use_time", "logs.is_stream", "logs.cache_hit", "logs.task_settle", "logs.other").Order(order).Offset(query.Offset).Limit(query.Limit).Find(&items).Error
	if err != nil {
		return nil, 0, err
	}
	// 步骤4：只针对本页已按认证账号过滤的 request_id 批量读取输入快照。
	// 主库和日志库可能分离，不能跨库 JOIN，更不能逐条查询或按时间猜会话。
	requestIDs := make([]string, 0, len(items))
	for _, item := range items {
		if item.RequestID != "" {
			requestIDs = append(requestIDs, item.RequestID)
		}
	}
	if len(requestIDs) == 0 {
		return items, total, nil
	}
	rows, bodyErr := DB.WithContext(ctx).Model(&LogBody{}).Select("request_id", "request_data").Where("request_id IN ?", requestIDs).Rows()
	if bodyErr != nil {
		common.SysError("desktop usage input snapshots unavailable: " + bodyErr.Error())
		return items, total, nil
	}
	defer rows.Close()
	type inputPreview struct {
		text      *string
		truncated bool
	}
	previews := make(map[string]inputPreview, len(items))
	// Stream snapshot rows so a page does not retain every full request body in memory.
	for rows.Next() {
		var requestID, requestData string
		if scanErr := rows.Scan(&requestID, &requestData); scanErr != nil {
			common.SysError("desktop usage input snapshot read failed: " + scanErr.Error())
			return items, total, nil
		}
		text, truncated := extractDesktopUsageInput(requestData)
		previews[requestID] = inputPreview{text: text, truncated: truncated}
	}
	if rowErr := rows.Err(); rowErr != nil {
		common.SysError("desktop usage input snapshot iteration failed: " + rowErr.Error())
		return items, total, nil
	}
	for i := range items {
		preview := previews[items[i].RequestID]
		items[i].UserInput = preview.text
		items[i].UserInputTruncated = preview.truncated
	}
	return items, total, nil
}
