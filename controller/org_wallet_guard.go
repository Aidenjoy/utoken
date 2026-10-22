package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// 企业钱包守卫：禁用个人账户（organizations.disable_personal_wallet）与企业内子账号
// （org_members.sub_user）在充值下单、兑换码、订阅购买三个入口统一拦截，
// 计费侧的强制仅池在 service/billing_session.go 里按同一开关处理。
//
// 矩阵（见 model.OrgWalletPolicy）：
//   - 企业管理员（含子账号管理员）：充值放行且直入企业池；兑换码/订阅仍受开关约束
//   - 普通成员：开关关闭时全放行（入个人钱包）；开关开启时充值/兑换/订阅一律拦截
//   - 子账号成员：永远拦截（与企业开关无关）
//
// 策略查询失败（数据库异常）时按放行处理并记错误日志：守卫是产品策略而非安全边界，
// 因瞬时故障把全部用户的充值入口锁死代价更高。

// checkOrgTopUpPermission 充值下单守卫。返回该笔充值应入账的企业池 ID
// （0=入个人钱包）与拒绝文案的 i18n 键（空串表示放行）。
func checkOrgTopUpPermission(userId int) (int, string) {
	policy, err := model.GetUserOrgWalletPolicy(userId)
	if err != nil {
		common.SysError("failed to load org wallet policy for topup: " + err.Error())
		return 0, ""
	}
	if !policy.CanTopUp() {
		return 0, orgWalletDenyKey(policy)
	}
	return policy.TopUpOrgId(), ""
}

// checkOrgPersonalWalletPermission 兑换码/订阅购买守卫。
// 返回拒绝文案的 i18n 键，空串表示放行。
func checkOrgPersonalWalletPermission(userId int) string {
	policy, err := model.GetUserOrgWalletPolicy(userId)
	if err != nil {
		common.SysError("failed to load org wallet policy: " + err.Error())
		return ""
	}
	if !policy.CanUsePersonalWallet() {
		return orgWalletDenyKey(policy)
	}
	return ""
}

// orgWalletDenyKey 按拒绝原因选择文案：子账号永远无钱包权限，
// 其余情况是企业级禁用个人账户开关。
func orgWalletDenyKey(policy *model.OrgWalletPolicy) string {
	if policy != nil && policy.SubUser {
		return i18n.MsgOrgSubUserNoWallet
	}
	return i18n.MsgOrgPersonalWalletDisabled
}

// orgWalletDenyMessage 把拒绝键翻译成当前请求用户的语言。
func orgWalletDenyMessage(c *gin.Context, key string) string {
	return common.TranslateMessage(c, key)
}

// rejectOrgWalletLegacy 以历史支付入口的响应壳（message=error，data=文案）拒绝，
// 易支付/Stripe/Creem/Waffo 等下单入口沿用此结构，前端按 data 展示错误。
func rejectOrgWalletLegacy(c *gin.Context, key string) {
	c.JSON(http.StatusOK, gin.H{"message": "error", "data": orgWalletDenyMessage(c, key)})
}
