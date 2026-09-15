package service

import (
	"context"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// seedUnlimitedToken 建一把无限额度令牌。前端创建无限令牌时 remain_quota 落库为 0，
// 历史结算还可能把它扣成负数——两者都必须能正常提交异步任务。
func seedUnlimitedToken(t *testing.T, id, userId int, key string, remainQuota int) {
	t.Helper()
	token := &model.Token{
		Id:             id,
		UserId:         userId,
		Key:            key,
		Name:           "unlimited_token",
		Status:         common.TokenStatusEnabled,
		RemainQuota:    remainQuota,
		UsedQuota:      0,
		UnlimitedQuota: true,
	}
	require.NoError(t, model.DB.Create(token).Error)
}

// TestPreConsumeTokenQuotaUnlimitedBypasses 复现线上故障：无限额度令牌提交视频任务时
// 强制全额预扣（ForcePreConsume 关闭信任旁路），此前会在 DecreaseTokenQuota 处因
// remain_quota<=0 被误判为 insufficient token quota。修复后应直接放行且不动令牌余额。
func TestPreConsumeTokenQuotaUnlimitedBypasses(t *testing.T) {
	truncate(t)
	seedUser(t, 1, 1_000_000)

	cases := []struct {
		name   string
		remain int
	}{
		{"新建无限令牌 remain=0", 0},
		{"历史结算扣负 remain<0", -40_195_617},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			require.NoError(t, model.DB.Exec("DELETE FROM tokens").Error)
			seedUnlimitedToken(t, 10, 1, "sk-unlimited", tc.remain)

			info := &relaycommon.RelayInfo{
				UserId:         1,
				TokenId:        10,
				TokenKey:       "sk-unlimited",
				TokenUnlimited: true,
			}
			// ¥2.3 的视频预扣（约 1_150_000 额度），远大于令牌余额。
			require.NoError(t, PreConsumeTokenQuota(info, 1_150_000))
			assert.Equal(t, tc.remain, getTokenRemainQuota(t, 10), "无限令牌 remain_quota 不应被预扣改动")
			assert.Equal(t, 0, getTokenUsedQuota(t, 10), "无限令牌 used_quota 不应被预扣改动")
		})
	}
}

// TestPostConsumeQuotaUnlimitedSkipsTokenDecrease 结算侧对称性：无限令牌结算时
// 钱包照常扣费，但令牌余额不再被扣减（否则 remain_quota 会越扣越负）。
func TestPostConsumeQuotaUnlimitedSkipsTokenDecrease(t *testing.T) {
	truncate(t)
	seedUser(t, 1, 1_000_000)
	seedUnlimitedToken(t, 30, 1, "sk-unlimited-settle", -40_195_617)

	info := &relaycommon.RelayInfo{
		UserId:         1,
		TokenId:        30,
		TokenKey:       "sk-unlimited-settle",
		TokenUnlimited: true,
		BillingSource:  BillingSourceWallet,
	}

	require.NoError(t, PostConsumeQuota(info, 5000, 0, false))
	assert.Equal(t, 1_000_000-5000, getUserQuota(t, 1), "钱包应正常扣费")
	assert.Equal(t, -40_195_617, getTokenRemainQuota(t, 30), "无限令牌 remain_quota 不应被结算改动")
	assert.Equal(t, 0, getTokenUsedQuota(t, 30), "无限令牌 used_quota 不应被结算改动")
}

// TestNeedsRefundWalletWithoutTokenConsumed 修复连带缺口：无限令牌 tokenConsumed 恒为 0，
// 但钱包已预扣，请求失败时仍须判定为需退款，否则用户钱包预扣不会被退还。
func TestNeedsRefundWalletWithoutTokenConsumed(t *testing.T) {
	preConsumed := &BillingSession{
		relayInfo: &relaycommon.RelayInfo{TokenUnlimited: true},
		funding:   &WalletFunding{userId: 1, consumed: 5000},
	}
	assert.True(t, preConsumed.needsRefundLocked(), "钱包已预扣必须可退")

	notConsumed := &BillingSession{
		relayInfo: &relaycommon.RelayInfo{TokenUnlimited: true},
		funding:   &WalletFunding{userId: 1, consumed: 0},
	}
	assert.False(t, notConsumed.needsRefundLocked(), "未预扣不应触发退款")
}

// TestTaskAdjustTokenQuotaUnlimitedSkips 异步任务结算/退费路径（taskAdjustTokenQuota）
// 对无限令牌必须跳过令牌级调整，否则结算把 remain_quota 越扣越负、退费又抬回。
func TestTaskAdjustTokenQuotaUnlimitedSkips(t *testing.T) {
	truncate(t)
	seedUser(t, 1, 1_000_000)
	seedUnlimitedToken(t, 40, 1, "sk-task-unlimited", -100)

	task := makeTask(1, 1, 0, 40, BillingSourceWallet, 0)
	ctx := context.Background()

	// 结算扣费与退费都不得触碰无限令牌余额。
	taskAdjustTokenQuota(ctx, task, 5000)
	taskAdjustTokenQuota(ctx, task, -5000)
	assert.Equal(t, -100, getTokenRemainQuota(t, 40), "无限令牌 remain_quota 不应被任务结算改动")
	assert.Equal(t, 0, getTokenUsedQuota(t, 40), "无限令牌 used_quota 不应被任务结算改动")
}
