package service

import (
	"math"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestApplyUserModelDiscountSettlement 锁定文本/图片结算侧的打折不变量：
// 命中折扣时返回 (折后额度, 折前额度)，未命中或额度为 0 时折前额度为 0，
// 日志据此不写 original_quota/discount（前端回退为「原价 = 费用、折扣 = 100%」）。
func TestApplyUserModelDiscountSettlement(t *testing.T) {
	tests := []struct {
		name            string
		relayInfo       *relaycommon.RelayInfo
		quota           int
		wantQuota       int
		wantQuotaBefore int
	}{
		{
			name:            "命中 8 折",
			relayInfo:       &relaycommon.RelayInfo{UserModelDiscount: 0.8},
			quota:           1000,
			wantQuota:       800,
			wantQuotaBefore: 1000,
		},
		{
			name:            "命中 8.5 折并四舍五入",
			relayInfo:       &relaycommon.RelayInfo{UserModelDiscount: 0.85},
			quota:           999,
			wantQuota:       849,
			wantQuotaBefore: 999,
		},
		{
			name:            "无折扣（默认 1）",
			relayInfo:       &relaycommon.RelayInfo{UserModelDiscount: 1},
			quota:           1000,
			wantQuota:       1000,
			wantQuotaBefore: 0,
		},
		{
			name:            "字段未初始化（如轮询路径空构造 RelayInfo）按原价",
			relayInfo:       &relaycommon.RelayInfo{},
			quota:           1000,
			wantQuota:       1000,
			wantQuotaBefore: 0,
		},
		{
			name:            "非法折扣按原价",
			relayInfo:       &relaycommon.RelayInfo{UserModelDiscount: math.NaN()},
			quota:           1000,
			wantQuota:       1000,
			wantQuotaBefore: 0,
		},
		{
			name:            "relayInfo 为 nil 按原价",
			relayInfo:       nil,
			quota:           1000,
			wantQuota:       1000,
			wantQuotaBefore: 0,
		},
		{
			name:            "零额度不产生折前额度",
			relayInfo:       &relaycommon.RelayInfo{UserModelDiscount: 0.8},
			quota:           0,
			wantQuota:       0,
			wantQuotaBefore: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			quota, quotaBefore := applyUserModelDiscount(tt.relayInfo, tt.quota)
			assert.Equal(t, tt.wantQuota, quota)
			assert.Equal(t, tt.wantQuotaBefore, quotaBefore)
		})
	}
}

// TestAppendModelDiscountInfo 校验日志字段只在真正打折时写入 other 顶层
// （不放 admin_info：用户查看自己的日志也要看到原价/折扣）。
func TestAppendModelDiscountInfo(t *testing.T) {
	other := map[string]interface{}{"model_ratio": 2.0}
	appendModelDiscountInfo(other, 0.8, 1000)
	assert.InDelta(t, 0.8, other["discount"], 1e-9)
	assert.Equal(t, 1000, other["original_quota"])

	// 未打折：不写任何字段，避免日志膨胀。
	for _, tt := range []struct {
		name        string
		discount    float64
		quotaBefore int
	}{
		{name: "无折前额度", discount: 0.8, quotaBefore: 0},
		{name: "折扣为 1", discount: 1, quotaBefore: 1000},
		{name: "折扣为 0", discount: 0, quotaBefore: 1000},
		{name: "折扣大于 1", discount: 1.2, quotaBefore: 1000},
		{name: "折扣为 NaN", discount: math.NaN(), quotaBefore: 1000},
	} {
		t.Run(tt.name, func(t *testing.T) {
			clean := map[string]interface{}{}
			appendModelDiscountInfo(clean, tt.discount, tt.quotaBefore)
			assert.NotContains(t, clean, "discount")
			assert.NotContains(t, clean, "original_quota")
		})
	}

	// nil map 不应 panic。
	appendModelDiscountInfo(nil, 0.8, 1000)
}

// TestTaskUserDiscountFlowsThroughBillingSnapshot 锁定任务/视频侧的折扣链路：
// 提交时写入 PriceData.OtherRatios["user_discount"] → 随 BillingContext 快照落库 →
// 结算按 token 重算时经 OtherRatioMultiplier() 生效，预扣与结算同比例。
func TestTaskUserDiscountFlowsThroughBillingSnapshot(t *testing.T) {
	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		saved[key] = value
		return nil
	}))
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
	})
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode":    `{"seedance-settle-model":"seedance"}`,
		"billing_setting.seedance_config": `{"seedance-settle-model":"{\"1080p\":{\"with_video\":33.12,\"without_video\":55.44}}"}`,
		"group_ratio_setting.group_ratio": `{"default":1}`,
	}))

	const baseQuota = 27_720_000 // 1M tokens × modelRatio 27.72

	t.Run("快照中的用户折扣参与结算", func(t *testing.T) {
		task := makeTask(1, 1, 100, 0, BillingSourceWallet, 0)
		task.Properties.OriginModelName = "seedance-settle-model"
		bc := task.PrivateData.BillingContext
		bc.OriginModelName = "seedance-settle-model"
		bc.ModelRatio = 27.72
		bc.OtherRatios = map[string]float64{
			"seconds":                          2,
			relaycommon.OtherRatioUserDiscount: 0.8,
		}

		quota, clamp, reason, ok := computeTaskQuotaByTokens(task, 1_000_000)
		require.True(t, ok)
		assert.Nil(t, clamp)
		assert.Equal(t, baseQuota*2*8/10, quota)
		assert.Contains(t, reason, "otherMultiplier=1.6000")
	})

	t.Run("无折扣时结算不打折", func(t *testing.T) {
		task := makeTask(1, 1, 100, 0, BillingSourceWallet, 0)
		task.Properties.OriginModelName = "seedance-settle-model"
		bc := task.PrivateData.BillingContext
		bc.OriginModelName = "seedance-settle-model"
		bc.ModelRatio = 27.72
		bc.OtherRatios = map[string]float64{"seconds": 2}

		quota, _, _, ok := computeTaskQuotaByTokens(task, 1_000_000)
		require.True(t, ok)
		assert.Equal(t, baseQuota*2, quota)
	})
}

// TestTaskBillingOtherExposesUserDiscount 校验差额结算/退款日志与提交日志
// 在前端「折扣」列上表现一致（user_discount 是计费快照键名，对外统一为 discount）。
func TestTaskBillingOtherExposesUserDiscount(t *testing.T) {
	task := makeTask(1, 1, 100, 0, BillingSourceWallet, 0)
	task.PrivateData.BillingContext.OtherRatios = map[string]float64{
		"seconds":                          2,
		relaycommon.OtherRatioUserDiscount: 0.85,
	}

	other := taskBillingOther(task)
	assert.Equal(t, 2.0, other["seconds"])
	assert.Equal(t, 0.85, other[relaycommon.OtherRatioUserDiscount])
	assert.InDelta(t, 0.85, other["discount"], 1e-9)

	// 无折扣（或折扣为 1）时不写 discount，前端回退为 100%。
	task.PrivateData.BillingContext.OtherRatios = map[string]float64{"seconds": 2}
	assert.NotContains(t, taskBillingOther(task), "discount")

	task.PrivateData.BillingContext.OtherRatios = map[string]float64{
		relaycommon.OtherRatioUserDiscount: 1,
	}
	assert.NotContains(t, taskBillingOther(task), "discount")
}

// TestModelDiscountsPersistOnUserRow 校验折扣字段的读写与「通用更新路径不得覆盖折扣」：
// 折扣只走 UpdateUserModelDiscounts 专用接口。
func TestModelDiscountsPersistOnUserRow(t *testing.T) {
	truncate(t)
	seedDiscountUser(t, 1, "discount_user_persist", 1000)

	require.NoError(t, model.UpdateUserModelDiscounts(1, `{"seedance*":0.8}`))

	user, err := model.GetUserById(1, false)
	require.NoError(t, err)
	assert.JSONEq(t, `{"seedance*":0.8}`, user.ModelDiscounts)
	assert.InDelta(t, 0.8, common.ResolveUserModelDiscount(user.ModelDiscounts, "seedance-2.0"), 1e-9)
	assert.True(t, common.HasModelDiscounts(user.ModelDiscounts))

	// 清空：空串表示无折扣。
	require.NoError(t, model.UpdateUserModelDiscounts(1, ""))
	user, err = model.GetUserById(1, false)
	require.NoError(t, err)
	assert.Empty(t, user.ModelDiscounts)
	assert.False(t, common.HasModelDiscounts(user.ModelDiscounts))
	assert.InDelta(t, 1.0, common.ResolveUserModelDiscount(user.ModelDiscounts, "seedance-2.0"), 1e-9)

	// 折扣 JSON 损坏时退化为原价，不影响请求。
	require.NoError(t, model.UpdateUserModelDiscounts(1, `{"seedance*":`))
	user, err = model.GetUserById(1, false)
	require.NoError(t, err)
	assert.False(t, common.HasModelDiscounts(user.ModelDiscounts))
	assert.InDelta(t, 1.0, common.ResolveUserModelDiscount(user.ModelDiscounts, "seedance-2.0"), 1e-9)
}

// seedDiscountUser 创建指定用户名（username、aff_code 均带唯一索引）的用户，用于多用户对比场景。
func seedDiscountUser(t *testing.T, id int, username string, quota int) {
	t.Helper()
	user := &model.User{
		Id:       id,
		Username: username,
		AffCode:  "aff_" + username,
		Quota:    quota,
		Status:   common.UserStatusEnabled,
	}
	require.NoError(t, model.DB.Create(user).Error)
}

// TestUserModelDiscountsArePerUser 是需求的核心不变量：不同用户对同一模型
// 可配置不同折扣，且互不影响（A 的 8 折不会漏到 B）。
func TestUserModelDiscountsArePerUser(t *testing.T) {
	truncate(t)
	seedDiscountUser(t, 1, "discount_user_a", 1000)
	seedDiscountUser(t, 2, "discount_user_b", 1000)

	require.NoError(t, model.UpdateUserModelDiscounts(1, `{"doubao-seedance-2.0":0.8,"doubao-seedance-2.5":0.9}`))
	require.NoError(t, model.UpdateUserModelDiscounts(2, `{"doubao-seedance-2.0":0.85,"doubao-seedance-2.5":0.95}`))

	userA, err := model.GetUserById(1, false)
	require.NoError(t, err)
	userB, err := model.GetUserById(2, false)
	require.NoError(t, err)

	assert.InDelta(t, 0.8, common.ResolveUserModelDiscount(userA.ModelDiscounts, "doubao-seedance-2.0"), 1e-9)
	assert.InDelta(t, 0.9, common.ResolveUserModelDiscount(userA.ModelDiscounts, "doubao-seedance-2.5"), 1e-9)
	assert.InDelta(t, 0.85, common.ResolveUserModelDiscount(userB.ModelDiscounts, "doubao-seedance-2.0"), 1e-9)
	assert.InDelta(t, 0.95, common.ResolveUserModelDiscount(userB.ModelDiscounts, "doubao-seedance-2.5"), 1e-9)

	// 未配置的模型仍按原价。
	assert.InDelta(t, 1.0, common.ResolveUserModelDiscount(userB.ModelDiscounts, "gpt-4o"), 1e-9)
}
