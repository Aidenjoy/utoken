package canvas

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// ===== 智能画布：计费 =====
// 计费边界：
//   - Ark 工具（文生图/参考图/局部编辑）经网关门回环到 /v1/images/generations，
//     由既有 Relay 链路预扣→结算→退款，画布层一分钱都不再扣（避免重复计费）。
//   - MediaKit 工具（擦除/抠图/扩图/超分）没有 Relay 适配器，由本层计费：
//     提交时按单价预扣、成功时按结果张数结算、失败时全额退款。
//     单价默认 0（未配置即免费），配置项见 CANVAS_TOOL_PRICE_<TOOL>。
//
// 至多扣一次/退一次由 canvas_ledgers 的 (task_id, kind) 唯一索引保证：
// 先写流水再动资金，重复调用只会撞索引返回 false。

// maxCanvasBillableUnits 单次任务最多按几张结果计费（上游最多返回 4 张候选，
// 这里再兜一层，防止结果数量被异常放大后乘出离谱额度）。
const maxCanvasBillableUnits = 4

// maxCanvasUnitPrice 单价上限，避免环境变量写错导致额度计算溢出。
const maxCanvasUnitPrice = 100_000_000

// billableQuota 计算本次任务应扣额度。相乘的两个因子都有上界，不会溢出为负数。
func billableQuota(units, price int) int {
	if units <= 0 || price <= 0 {
		return 0
	}
	if units > maxCanvasBillableUnits {
		units = maxCanvasBillableUnits
	}
	if price > maxCanvasUnitPrice {
		price = maxCanvasUnitPrice
	}
	quota := units * price
	if quota < 0 {
		quota = 0
	}
	return quota
}

// canvasBillingSource 解析本次扣费的资金来源：企业成员优先扣企业额度池。
func canvasBillingSource(userID int) (source string, orgID int) {
	orgID = model.GetUserOrgID(userID)
	if orgID > 0 {
		return model.CanvasFundingOrganization, orgID
	}
	return model.CanvasFundingWallet, 0
}

// reserveTaskBilling 提交时预扣。返回错误表示额度不足或不可扣费，调用方需拒绝提交。
func reserveTaskBilling(task *model.CanvasTask, units int) error {
	price := toolUnitPrice(task.Tool)
	if price <= 0 {
		return nil
	}
	quota := billableQuota(units, price)
	if quota <= 0 {
		return nil
	}
	source, orgID := canvasBillingSource(task.UserID)
	created, err := model.RecordCanvasLedger(&model.CanvasLedger{
		TaskID: task.ID, Kind: model.CanvasLedgerPreConsume, UserID: task.UserID,
		OrgID: orgID, Source: source, Quota: quota, Reason: "canvas task submitted",
	})
	if err != nil {
		return err
	}
	if !created {
		return nil
	}
	if err := model.AdjustCanvasFunding(source, task.UserID, orgID, -quota); err != nil {
		return fmt.Errorf("预扣额度失败: %w", err)
	}
	task.BillingState = model.CanvasBillingPreConsumed
	task.BillingSource = source
	task.FundingOrgID = orgID
	task.Quota = quota
	return model.UpdateCanvasTaskFields(task.ID, map[string]any{
		"billing_state":  model.CanvasBillingPreConsumed,
		"billing_source": source,
		"funding_org_id": orgID,
		"quota":          quota,
	})
}

// settleTaskBilling 成功结算：按实际结果张数补扣或退还差额。
func settleTaskBilling(task *model.CanvasTask, actualUnits int) {
	if task.BillingState != model.CanvasBillingPreConsumed {
		return
	}
	price := toolUnitPrice(task.Tool)
	actual := billableQuota(actualUnits, price)
	delta := actual - task.Quota
	if delta == 0 {
		model.UpdateCanvasTaskFields(task.ID, map[string]any{
			"billing_state": model.CanvasBillingSettled,
			"settled_quota": actual,
		})
		return
	}
	created, err := model.RecordCanvasLedger(&model.CanvasLedger{
		TaskID: task.ID, Kind: model.CanvasLedgerSettle, UserID: task.UserID,
		OrgID: task.FundingOrgID, Source: task.BillingSource, Quota: delta,
		Reason: fmt.Sprintf("canvas task settled: %d images", actualUnits),
	})
	if err != nil || !created {
		common.SysError(fmt.Sprintf("canvas settle failed: taskId=%d, err=%v", task.ID, err))
		return
	}
	// delta > 0 表示实际多于预扣：向用户再扣；delta < 0 表示退还差额。
	if err := model.AdjustCanvasFunding(task.BillingSource, task.UserID, task.FundingOrgID, -delta); err != nil {
		common.SysError(fmt.Sprintf("canvas settle adjust failed: taskId=%d, err=%v", task.ID, err))
		return
	}
	model.UpdateCanvasTaskFields(task.ID, map[string]any{
		"billing_state": model.CanvasBillingSettled,
		"settled_quota": actual,
	})
}

// refundTaskBilling 失败/取消时全额退款，重复调用不会重复退。
func refundTaskBilling(task *model.CanvasTask, reason string) {
	if task.BillingState != model.CanvasBillingPreConsumed || task.Quota <= 0 {
		return
	}
	created, err := model.RecordCanvasLedger(&model.CanvasLedger{
		TaskID: task.ID, Kind: model.CanvasLedgerRefund, UserID: task.UserID,
		OrgID: task.FundingOrgID, Source: task.BillingSource, Quota: task.Quota,
		Reason: strings.TrimSpace(reason),
	})
	if err != nil || !created {
		if err != nil {
			common.SysError(fmt.Sprintf("canvas refund failed: taskId=%d, err=%v", task.ID, err))
		}
		return
	}
	if err := model.AdjustCanvasFunding(task.BillingSource, task.UserID, task.FundingOrgID, task.Quota); err != nil {
		common.SysError(fmt.Sprintf("canvas refund adjust failed: taskId=%d, err=%v", task.ID, err))
		return
	}
	task.BillingState = model.CanvasBillingRefunded
	model.UpdateCanvasTaskFields(task.ID, map[string]any{"billing_state": model.CanvasBillingRefunded})
}
