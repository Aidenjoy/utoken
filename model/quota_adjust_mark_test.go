package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// lastAdjustLogId 返回最近一条指定 action 的调额审计日志行 ID，
// 供测试对刚落库的调额行打线下标记。
func lastAdjustLogId(t *testing.T, action string) int {
	t.Helper()
	var logId int
	require.NoError(t, LOG_DB.Model(&Log{}).
		Select("id").
		Where("type = ? AND other LIKE ?", LogTypeManage, `%"action":"`+action+`"%`).
		Order("id desc").
		Limit(1).
		Scan(&logId).Error)
	require.Positive(t, logId, "adjust audit log %s must exist", action)
	return logId
}

// TestMarkQuotaAdjustOfflineLifecycle 锁定线下标记的完整生命周期与守卫：
// 标记方向必须与调额符号一致（调增只能标线下充值、调减只能标线下退款），
// 空 mark 撤销标记恢复为测试额度增减，非调额日志行不得被标记。
func TestMarkQuotaAdjustOfflineLifecycle(t *testing.T) {
	setupTransferFixture(t)
	user := seedWalletUser(t, 501, 0)
	admin := seedWalletUser(t, 900, 0)

	seedAdjustAudit(t, admin.Id, "user.quota_add", map[string]interface{}{
		"target_user_id": user.Id,
		"quota_value":    50,
	})
	addLogId := lastAdjustLogId(t, "user.quota_add")
	seedAdjustAudit(t, admin.Id, "user.quota_subtract", map[string]interface{}{
		"target_user_id": user.Id,
		"quota_value":    30,
	})
	subLogId := lastAdjustLogId(t, "user.quota_subtract")

	// 方向守卫：调增标线下退款、调减标线下充值都必须被拒绝
	require.Error(t, MarkQuotaAdjustOffline(addLogId, QuotaAdjustMarkOfflineRefund, "admin"))
	require.Error(t, MarkQuotaAdjustOffline(subLogId, QuotaAdjustMarkOfflineRecharge, "admin"))
	require.Error(t, MarkQuotaAdjustOffline(addLogId, "bogus_mark", "admin"))
	require.Error(t, MarkQuotaAdjustOffline(999999, QuotaAdjustMarkOfflineRecharge, "admin"), "missing log row")

	// 正常标记 + 覆盖改标 + 读取
	require.NoError(t, MarkQuotaAdjustOffline(addLogId, QuotaAdjustMarkOfflineRecharge, "admin"))
	require.NoError(t, MarkQuotaAdjustOffline(subLogId, QuotaAdjustMarkOfflineRefund, "admin"))
	require.NoError(t, MarkQuotaAdjustOffline(subLogId, QuotaAdjustMarkOfflineRefund, "root"), "re-mark overwrites")
	marks, err := GetQuotaAdjustMarks([]int{addLogId, subLogId})
	require.NoError(t, err)
	require.Len(t, marks, 2)
	assert.Equal(t, QuotaAdjustMarkOfflineRecharge, marks[addLogId].Mark)
	assert.Equal(t, "admin", marks[addLogId].MarkedBy)
	assert.Equal(t, QuotaAdjustMarkOfflineRefund, marks[subLogId].Mark)
	assert.Equal(t, "root", marks[subLogId].MarkedBy, "latest marker wins")
	assert.Positive(t, marks[addLogId].MarkedAt)

	// 撤销标记：删行后恢复未标记
	require.NoError(t, MarkQuotaAdjustOffline(subLogId, "", "admin"))
	marks, err = GetQuotaAdjustMarks([]int{addLogId, subLogId})
	require.NoError(t, err)
	require.Len(t, marks, 1)
	assert.NotContains(t, marks, subLogId)
}

// TestBillingRechargeStatRoutesAdjustsByMark 锁定调额行按线下标记分流的统计口径：
// 已标记才计入线下流入/流出，未标记只进测试额度合计；两种行都进 TotalQuota，
// 保持「净增加额=所选对象余额变化」不变量。AgentView 丢弃未标记行且统计同步收敛。
func TestBillingRechargeStatRoutesAdjustsByMark(t *testing.T) {
	setupTransferFixture(t)
	user := seedWalletUser(t, 501, 0)
	admin := seedWalletUser(t, 900, 0)
	all := BillingScope{Mode: BillingScopeAll}
	none := BillingScope{Mode: BillingScopeNone}

	seedAdjustAudit(t, admin.Id, "user.quota_add", map[string]interface{}{
		"target_user_id": user.Id,
		"quota_value":    100,
	})
	markedAddId := lastAdjustLogId(t, "user.quota_add")
	seedAdjustAudit(t, admin.Id, "user.quota_subtract", map[string]interface{}{
		"target_user_id": user.Id,
		"quota_value":    40,
	})
	markedSubId := lastAdjustLogId(t, "user.quota_subtract")
	seedAdjustAudit(t, admin.Id, "user.quota_add", map[string]interface{}{
		"target_user_id": user.Id,
		"quota_value":    7,
	})
	require.NoError(t, MarkQuotaAdjustOffline(markedAddId, QuotaAdjustMarkOfflineRecharge, "admin"))
	require.NoError(t, MarkQuotaAdjustOffline(markedSubId, QuotaAdjustMarkOfflineRefund, "admin"))

	records, stat, err := GetBillingRechargeRecords(all, none, 0, 0)
	require.NoError(t, err)
	require.Len(t, records, 3)
	byLogId := make(map[int]*BillingRechargeRecord, len(records))
	for _, record := range records {
		byLogId[record.LogId] = record
	}
	require.Contains(t, byLogId, markedAddId)
	assert.Equal(t, QuotaAdjustMarkOfflineRecharge, byLogId[markedAddId].Mark)
	assert.Equal(t, QuotaAdjustMarkOfflineRefund, byLogId[markedSubId].Mark)

	assert.Equal(t, 100, stat.OfflineInflowQuota, "only marked recharge counts as offline inflow")
	assert.Equal(t, 100, stat.InflowQuota)
	assert.Equal(t, -40, stat.OutflowQuota, "only marked refund counts as outflow")
	assert.Equal(t, 7, stat.TestQuotaTotal, "unmarked adjust stays in the test bucket")
	assert.Equal(t, 67, stat.TotalQuota, "every signed row still sums into the net change")
	assert.Equal(t, 3, stat.Count)

	// AgentView：未标记行连记录带统计一并消失
	agentRecords, agentStat, err := GetBillingRechargeRecords(all, none, 0, 0, RechargeQueryOptions{AgentView: true})
	require.NoError(t, err)
	require.Len(t, agentRecords, 2)
	for _, record := range agentRecords {
		assert.NotEmpty(t, record.Mark, "agents only see marked offline adjustments")
	}
	assert.Equal(t, 0, agentStat.TestQuotaTotal)
	assert.Equal(t, 60, agentStat.TotalQuota, "100 offline recharge - 40 offline refund")
	assert.Equal(t, 100, agentStat.OfflineInflowQuota)
	assert.Equal(t, -40, agentStat.OutflowQuota)
}
