package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/model"

	"github.com/stretchr/testify/assert"
)

// TestRechargeOriginTextClassifiesFundingSource 锁定账单导出里"资金性质"列的三分口径。
// 对账时管理员靠这一列区分真金白银的入口金额（线上/线下）与客户账户之间的搬运
// （内部转移）；任何新来源被静默归入"线下"都会让线下充值虚增，所以逐一枚举。
func TestRechargeOriginTextClassifiesFundingSource(t *testing.T) {
	tests := []struct {
		source string
		want   string
	}{
		{model.BillingSourceOnlineTopup, "线上"},
		{model.BillingSourceUserAdjust, "线下"},
		{model.BillingSourceOrgAdjust, "线下"},
		{model.BillingSourceWalletTransferIn, "内部转移"},
		{model.BillingSourceWalletTransferOut, "内部转移"},
	}
	for _, tt := range tests {
		t.Run(tt.source, func(t *testing.T) {
			assert.Equal(t, tt.want, rechargeOriginText(tt.source))
		})
	}
}

// TestRechargeTargetTextNamesCounterparties 锁定"对象"列的渲染契约：
// 企业维度记录指向企业池，用户维度记录指向个人钱包，而自助转移必须同时带上
// 对手方，否则导出后无法把「钱包 −X」与「池 +X」两条明细还原成同一笔业务。
// 名称缺失时回落为纯 ID，保证列不会空白。
func TestRechargeTargetTextNamesCounterparties(t *testing.T) {
	tests := []struct {
		name   string
		record *model.BillingRechargeRecord
		want   string
	}{
		{
			name:   "online top-up targets the payer wallet",
			record: &model.BillingRechargeRecord{Source: model.BillingSourceOnlineTopup, UserId: 7, Username: "alice"},
			want:   "alice(ID 7)",
		},
		{
			name:   "user adjustment targets the adjusted wallet",
			record: &model.BillingRechargeRecord{Source: model.BillingSourceUserAdjust, UserId: 7, Username: "alice"},
			want:   "alice(ID 7)",
		},
		{
			name:   "org adjustment targets the pool",
			record: &model.BillingRechargeRecord{Source: model.BillingSourceOrgAdjust, OrgId: 3, OrgName: "Acme"},
			want:   "Acme(ID 3)",
		},
		{
			name:   "transfer into the pool names the pool",
			record: &model.BillingRechargeRecord{Source: model.BillingSourceWalletTransferIn, UserId: 7, Username: "alice", OrgId: 3, OrgName: "Acme"},
			want:   "Acme(ID 3)",
		},
		{
			name:   "transfer out of the wallet names both sides",
			record: &model.BillingRechargeRecord{Source: model.BillingSourceWalletTransferOut, UserId: 7, Username: "alice", OrgId: 3, OrgName: "Acme"},
			want:   "alice(ID 7) → Acme(ID 3)",
		},
		{
			name:   "missing names fall back to bare ids",
			record: &model.BillingRechargeRecord{Source: model.BillingSourceWalletTransferOut, UserId: 7, OrgId: 3},
			want:   "ID 7 → ID 3",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, rechargeTargetText(tt.record))
		})
	}
}
