package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 回归：存量 SQLite 库的 user_subscriptions 带遗留 DEFAULT 0.000000（旧 default:0
// 标签经 GORM %.6f 内联写入表 DDL）。标签移除后 AutoMigrate 会触发 AlterColumn，
// glebarez 驱动重建 decimal(p,s) 列的 DDL 时正则截断括号，启动直接 FATAL；
// 归一化必须先于 AutoMigrate 执行，且保留数据与索引、幂等。
func TestUserSubscriptionLegacyFloatDefaultNormalization(t *testing.T) {
	require.NoError(t, DB.Migrator().DropTable(&UserSubscription{}))
	t.Cleanup(func() {
		_ = DB.Migrator().DropTable(&UserSubscription{})
		require.NoError(t, DB.AutoMigrate(&UserSubscription{}))
	})

	legacyDDL := "CREATE TABLE `user_subscriptions` (" +
		"`points_ratio` decimal(18,8) NOT NULL DEFAULT 0.000000," +
		"`gross_profit_percent` decimal(5,2) DEFAULT 0.000000," +
		"`id` integer,`user_id` integer,`plan_id` integer," +
		"`amount_total` bigint NOT NULL DEFAULT 0,`amount_used` bigint NOT NULL DEFAULT 0," +
		"`start_time` integer,`end_time` integer,`status` varchar(32)," +
		"`source` varchar(32) DEFAULT \"order\"," +
		"`last_reset_time` bigint DEFAULT 0,`next_reset_time` bigint DEFAULT 0," +
		"`upgrade_group` varchar(64) DEFAULT \"\",`prev_user_group` varchar(64) DEFAULT \"\"," +
		"`downgrade_group` varchar(64) DEFAULT \"\",`allow_wallet_overflow` numeric," +
		"`created_at` integer,`updated_at` integer,PRIMARY KEY (`id`))"
	require.NoError(t, DB.Exec(legacyDDL).Error)
	require.NoError(t, DB.Exec("CREATE INDEX `idx_user_subscriptions_user_id` ON `user_subscriptions`(`user_id`)").Error)
	require.NoError(t, DB.Exec("INSERT INTO `user_subscriptions` (`id`,`user_id`,`plan_id`,`points_ratio`,`gross_profit_percent`,`amount_total`,`status`) VALUES (1,7,3,1.5,30,100,'active')").Error)

	require.NoError(t, normalizeUserSubscriptionFloatDefaultsSQLite())
	// 归一化后 AutoMigrate 不再走 AlterColumn 重建（原崩溃路径）
	require.NoError(t, DB.AutoMigrate(&UserSubscription{}))

	var sub UserSubscription
	require.NoError(t, DB.First(&sub, 1).Error)
	assert.Equal(t, 7, sub.UserId)
	assert.Equal(t, 3, sub.PlanId)
	assert.InDelta(t, 1.5, sub.PointsRatio, 1e-9)
	assert.InDelta(t, 30, sub.GrossProfitPercent, 1e-9)
	assert.Equal(t, int64(100), sub.AmountTotal)
	assert.Equal(t, "active", sub.Status)
	assert.True(t, DB.Migrator().HasIndex(&UserSubscription{}, "idx_user_subscriptions_user_id"))

	var ddl string
	require.NoError(t, DB.Raw("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_subscriptions'").Row().Scan(&ddl))
	assert.NotContains(t, ddl, "0.000000")

	// 幂等：再次归一化 + AutoMigrate 仍成功，数据不变
	require.NoError(t, normalizeUserSubscriptionFloatDefaultsSQLite())
	require.NoError(t, DB.AutoMigrate(&UserSubscription{}))
	var count int64
	require.NoError(t, DB.Model(&UserSubscription{}).Count(&count).Error)
	assert.Equal(t, int64(1), count)
}