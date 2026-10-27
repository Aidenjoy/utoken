package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestBackfillLogUpstreamTokens 保护历史回填的严格口径：只折算「非 1.0 费率用户 +
// seedance 模型 + consume 非结算行 + 尚未记录 upstream」的行，绝不误伤同用户的
// 非 seedance 行、结算行、或费率 1.0 用户的行；并保证幂等。
func TestBackfillLogUpstreamTokens(t *testing.T) {
	truncateTables(t)

	// 测试替身：仅 seedance 模型判定为 seedance 计费模式。
	orig := seedanceBillingModeOf
	seedanceBillingModeOf = func(model string) string {
		if model == "seedance-1-0-pro" {
			return billing_setting.BillingModeSeedance
		}
		return billing_setting.BillingModeRatio
	}
	t.Cleanup(func() { seedanceBillingModeOf = orig })

	require.NoError(t, DB.Create(&User{Id: 1, Username: "scaled", AffCode: "aff-scaled", TokenRate: 1.15}).Error)
	require.NoError(t, DB.Create(&User{Id: 2, Username: "flat", AffCode: "aff-flat", TokenRate: 1}).Error)

	// L1: 命中——user1 / seedance / consume 非结算 / completion=1150（缩放后），费率 1.15 → 原始 1000。
	require.NoError(t, LOG_DB.Create(&Log{
		UserId: 1, Type: LogTypeConsume, ModelName: "seedance-1-0-pro",
		PromptTokens: 0, CompletionTokens: 1150, TaskSettle: false, Other: `{"task_id":"t1"}`,
	}).Error)
	// L2: 不命中——同用户但非 seedance（对话/图片链路未被费率缩放），绝不能折算。
	require.NoError(t, LOG_DB.Create(&Log{
		UserId: 1, Type: LogTypeConsume, ModelName: "gpt-4o",
		PromptTokens: 10, CompletionTokens: 1150, TaskSettle: false,
	}).Error)
	// L3: 不命中——seedance 但为结算行（task_settle=true）。
	require.NoError(t, LOG_DB.Create(&Log{
		UserId: 1, Type: LogTypeConsume, ModelName: "seedance-1-0-pro",
		PromptTokens: 0, CompletionTokens: 1150, TaskSettle: true,
	}).Error)
	// L4: 不命中——费率 1.0 用户（原始==计费，展示层回退即可，无需写库）。
	require.NoError(t, LOG_DB.Create(&Log{
		UserId: 2, Type: LogTypeConsume, ModelName: "seedance-1-0-pro",
		PromptTokens: 0, CompletionTokens: 1150, TaskSettle: false,
	}).Error)

	require.NoError(t, backfillLogUpstreamTokens())

	var l1, l2, l3, l4 Log
	require.NoError(t, LOG_DB.Where("model_name = ? AND user_id = ? AND task_settle = ?", "seedance-1-0-pro", 1, false).First(&l1).Error)
	require.NoError(t, LOG_DB.Where("model_name = ?", "gpt-4o").First(&l2).Error)
	require.NoError(t, LOG_DB.Where("task_settle = ?", true).First(&l3).Error)
	require.NoError(t, LOG_DB.Where("user_id = ?", 2).First(&l4).Error)

	// L1：原始 completion=round(1150/1.15)=1000，prompt=total-completion=0，并写入费率快照。
	assert.Equal(t, 1000, l1.UpstreamCompletionTokens)
	assert.Equal(t, 0, l1.UpstreamPromptTokens)
	var other map[string]interface{}
	require.NoError(t, common.UnmarshalJsonStr(l1.Other, &other))
	adminInfo, ok := other["admin_info"].(map[string]interface{})
	require.True(t, ok, "L1 other.admin_info should exist")
	scale, ok := adminInfo["token_rate_scale"].(map[string]interface{})
	require.True(t, ok, "L1 other.admin_info.token_rate_scale should exist")
	assert.InDelta(t, 1.15, scale["rate"], 1e-9)
	assert.EqualValues(t, 1000, scale["original_completion_tokens"])
	// task_id 等既有键必须保留。
	assert.Equal(t, "t1", other["task_id"])

	// L2/L3/L4：一律未被触碰。
	assert.Equal(t, 0, l2.UpstreamCompletionTokens)
	assert.NotContains(t, l2.Other, "token_rate_scale")
	assert.Equal(t, 0, l3.UpstreamCompletionTokens)
	assert.NotContains(t, l3.Other, "token_rate_scale")
	assert.Equal(t, 0, l4.UpstreamCompletionTokens)
	assert.NotContains(t, l4.Other, "token_rate_scale")

	// 幂等：再次运行不改变已回填的行。
	require.NoError(t, backfillLogUpstreamTokens())
	var l1Again Log
	require.NoError(t, LOG_DB.First(&l1Again, l1.Id).Error)
	assert.Equal(t, l1.UpstreamCompletionTokens, l1Again.UpstreamCompletionTokens)
	assert.Equal(t, l1.Other, l1Again.Other)
}
