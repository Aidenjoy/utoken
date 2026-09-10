package service

import (
	"github.com/QuantumNous/new-api/model"
)

// ---------------------------------------------------------------------------
// OrganizationFunding — 企业额度池资金来源实现
// ---------------------------------------------------------------------------

// OrganizationFunding 让成员消费直接扣企业额度池，而不是成员个人钱包。
//
// 与 WalletFunding 的关键差异：扣减由 model.ConsumeOrgQuota 在单个事务内完成
// 双条件校验（企业池余额充足 且 成员子额度未超限），任一条件不满足整体回滚，
// 因此不存在"企业池扣了但成员子额度超了"的中间态。
type OrganizationFunding struct {
	orgId    int
	userId   int // 成员用户 id，用于同步 org_members.quota_used
	orgName  string
	consumed int // 已预扣（含 Reserve 追加）的企业额度，Refund 时按此退还
}

func (o *OrganizationFunding) Source() string { return BillingSourceOrganization }

// OrgId 返回资金所属企业，供 RelayInfo 同步与日志归属使用。
func (o *OrganizationFunding) OrgId() int { return o.orgId }

// OrgName 返回企业标识（organizations.name），仅用于日志展示。
func (o *OrganizationFunding) OrgName() string { return o.orgName }

func (o *OrganizationFunding) PreConsume(amount int) error {
	if amount <= 0 {
		return nil
	}
	if err := model.ConsumeOrgQuota(o.orgId, o.userId, amount); err != nil {
		return err
	}
	o.consumed = amount
	return nil
}

func (o *OrganizationFunding) Settle(delta int) error {
	if delta == 0 {
		return nil
	}
	if delta > 0 {
		return model.ConsumeOrgQuota(o.orgId, o.userId, delta)
	}
	return model.RefundOrgQuota(o.orgId, o.userId, -delta)
}

func (o *OrganizationFunding) Refund() error {
	if o.consumed <= 0 {
		return nil
	}
	// RefundOrgQuota 是 quota += N 的非幂等操作，不能重试，否则会多退额度。
	// 幂等性由 BillingSession.refunded 标记保证（与 WalletFunding 一致）。
	return model.RefundOrgQuota(o.orgId, o.userId, o.consumed)
}
