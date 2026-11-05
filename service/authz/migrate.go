package authz

import (
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
)

// migrateLegacyPolicies 把旧权限模型切换到菜单页面级模型时的存量策略一次性迁移：
//
//  1. 旧渠道细粒度权限（channel/read|operate|write|sensitive_write|secret_view）整体作废，
//     由 menu/channels 取代。角色基线随后由 seedDefaultPolicies 重建，用户级覆盖直接删除，
//     避免残留记录让旧权限语义在新模型下继续生效。
//  2. 旧「计费与支付-模型定价」（billing/model_pricing）并入系统设置-计费与支付子菜单，
//     用户级覆盖原样改写为 settings/billing，保留 allow/deny 效果，已授权管理员不受影响。
//
// 仅在主节点 Init 时执行，与 seedBuiltInRoles/resetBuiltInRolePolicies 同一批次。
func migrateLegacyPolicies(db *gorm.DB) error {
	if err := db.Where("ptype = ? AND v1 = ?", "p", "channel").Delete(&model.CasbinRule{}).Error; err != nil {
		return err
	}
	return db.Model(&model.CasbinRule{}).
		Where("ptype = ? AND v1 = ? AND v2 = ?", "p", "billing", "model_pricing").
		Updates(map[string]any{"v1": ResourceSettings, "v2": ActionSettingsBilling}).Error
}
