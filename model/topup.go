package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

type TopUp struct {
	Id              int     `json:"id"`
	UserId          int     `json:"user_id" gorm:"index"`
	Amount          int64   `json:"amount"`
	Money           float64 `json:"money"`
	TradeNo         string  `json:"trade_no" gorm:"unique;type:varchar(255);index"`
	PaymentMethod   string  `json:"payment_method" gorm:"type:varchar(50)"`
	PaymentProvider string  `json:"payment_provider" gorm:"type:varchar(50);default:''"`
	// OrgId 是下单时的企业归属快照：>0 表示该笔充值由企业管理员发起，
	// 入账时直接计入企业额度池而非个人钱包。下单后成员关系变化不影响路由
	//（回调重试/退企后仍按快照入账）；0=入个人钱包（含存量订单）。
	OrgId        int    `json:"org_id" gorm:"type:int;index;default:0"`
	CreateTime   int64  `json:"create_time"`
	CompleteTime int64  `json:"complete_time"`
	Status       string `json:"status"`
}

const (
	PaymentMethodStripe       = "stripe"
	PaymentMethodCreem        = "creem"
	PaymentMethodWaffo        = "waffo"
	PaymentMethodWaffoPancake = "waffo_pancake"
	PaymentMethodBalance      = "balance"
)

const (
	PaymentProviderEpay         = "epay"
	PaymentProviderStripe       = "stripe"
	PaymentProviderCreem        = "creem"
	PaymentProviderWaffo        = "waffo"
	PaymentProviderWaffoPancake = "waffo_pancake"
	PaymentProviderBalance      = "balance"
)

var (
	ErrPaymentMethodMismatch = errors.New("payment method mismatch")
	ErrTopUpNotFound         = errors.New("topup not found")
	ErrTopUpStatusInvalid    = errors.New("topup status invalid")
)

func (topUp *TopUp) Insert() error {
	var err error
	err = DB.Create(topUp).Error
	return err
}

func (topUp *TopUp) Update() error {
	var err error
	err = DB.Save(topUp).Error
	return err
}

func GetTopUpById(id int) *TopUp {
	var topUp *TopUp
	var err error
	err = DB.Where("id = ?", id).First(&topUp).Error
	if err != nil {
		return nil
	}
	return topUp
}

func GetTopUpByTradeNo(tradeNo string) *TopUp {
	var topUp *TopUp
	var err error
	err = DB.Where("trade_no = ?", tradeNo).First(&topUp).Error
	if err != nil {
		return nil
	}
	return topUp
}

func UpdatePendingTopUpStatus(tradeNo string, expectedPaymentProvider string, targetStatus string) error {
	if tradeNo == "" {
		return errors.New("未提供支付单号")
	}

	refCol := "`trade_no`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		refCol = `"trade_no"`
	}

	return DB.Transaction(func(tx *gorm.DB) error {
		topUp := &TopUp{}
		if err := lockForUpdate(tx).Where(refCol+" = ?", tradeNo).First(topUp).Error; err != nil {
			return ErrTopUpNotFound
		}
		if expectedPaymentProvider != "" && topUp.PaymentProvider != expectedPaymentProvider {
			return ErrPaymentMethodMismatch
		}
		if topUp.Status != common.TopUpStatusPending {
			return ErrTopUpStatusInvalid
		}

		topUp.Status = targetStatus
		return tx.Save(topUp).Error
	})
}

// CreditQuota 返回订单应入账的额度（quota）：
//   - Creem：Amount 即产品配置的充值额度，原值入账
//   - Stripe：Money 是经分组倍率换算后的美元数量，* QuotaPerUnit
//   - 其他（易支付/Waffo 等）：Amount 为美元数量，* QuotaPerUnit
func (topUp *TopUp) CreditQuota() int {
	dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
	switch topUp.PaymentProvider {
	case PaymentProviderCreem:
		return int(topUp.Amount)
	case PaymentProviderStripe:
		return int(decimal.NewFromFloat(topUp.Money).Mul(dQuotaPerUnit).IntPart())
	default:
		return int(decimal.NewFromInt(topUp.Amount).Mul(dQuotaPerUnit).IntPart())
	}
}

// SettleTopUpCredit 单一入账函数（事务内调用，调用方已持有订单行锁）：
// 按下单时的 OrgId 快照路由——企业池入账（锁企业行后 quota+）或个人钱包入账。
// 企业行缺失（下单后被删）时降级入个人钱包并记错误日志，资金不丢失。
func SettleTopUpCredit(tx *gorm.DB, topUp *TopUp, quota int) error {
	if quota <= 0 {
		return errors.New("无效的充值额度")
	}
	if topUp.OrgId > 0 {
		var org Organization
		if err := lockForUpdate(tx).Where("id = ?", topUp.OrgId).First(&org).Error; err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			common.SysError(fmt.Sprintf("topup org missing, credit to personal wallet instead: org_id=%d trade_no=%s", topUp.OrgId, topUp.TradeNo))
		} else {
			return tx.Model(&Organization{}).Where("id = ?", org.Id).
				Update("quota", gorm.Expr("quota + ?", quota)).Error
		}
	}
	return tx.Model(&User{}).Where("id = ?", topUp.UserId).
		Update("quota", gorm.Expr("quota + ?", quota)).Error
}

// SettleTopUpByTradeNo 统一的订单确认入账入口：单事务内锁订单行 → 校验支付网关 →
// 状态机幂等（success 直接返回 settled=false）→ 执行 hook（各网关的附加写入）→
// 标记完成 → SettleTopUpCredit 按 OrgId 快照入账。6 处确认/补单路径全部收敛到这里，
// 顺带修复历史上「先改订单再入账」两步不原子的缺陷。
func SettleTopUpByTradeNo(tradeNo string, expectedProvider string, hook func(tx *gorm.DB, topUp *TopUp) error) (*TopUp, bool, error) {
	if tradeNo == "" {
		return nil, false, errors.New("未提供支付单号")
	}

	refCol := "`trade_no`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		refCol = `"trade_no"`
	}

	topUp := &TopUp{}
	settled := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).Where(refCol+" = ?", tradeNo).First(topUp).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrTopUpNotFound
			}
			return err
		}
		if expectedProvider != "" && topUp.PaymentProvider != expectedProvider {
			return ErrPaymentMethodMismatch
		}
		if topUp.Status == common.TopUpStatusSuccess {
			return nil // 幂等：已成功直接返回，不重复入账
		}
		if topUp.Status != common.TopUpStatusPending {
			return ErrTopUpStatusInvalid
		}
		if hook != nil {
			if err := hook(tx, topUp); err != nil {
				return err
			}
		}
		topUp.CompleteTime = common.GetTimestamp()
		topUp.Status = common.TopUpStatusSuccess
		if err := tx.Save(topUp).Error; err != nil {
			return err
		}
		if err := SettleTopUpCredit(tx, topUp, topUp.CreditQuota()); err != nil {
			return err
		}
		settled = true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	// 企业池在线充值入账后补记一条系统审计（事务已提交，避免与入账同事务争锁）。
	if settled && topUp.OrgId > 0 {
		recordOrgPoolTopUpAudit(topUp)
	}
	return topUp, settled, nil
}

// recordOrgPoolTopUpAudit 为直入企业池的在线充值补记审计事件 org.pool_topup。
// 归属发起充值的企业管理员（topUp.UserId）；异步回调无请求上下文，IP 留空。
// content 为英文兜底，本地化由前端按 action+params 渲染。
func recordOrgPoolTopUpAudit(topUp *TopUp) {
	orgName := ""
	if org, err := GetOrganizationById(topUp.OrgId); err == nil {
		orgName = org.DisplayName
		if orgName == "" {
			orgName = org.Name
		}
	}
	quota := topUp.CreditQuota()
	params := map[string]interface{}{
		"name":     orgName,
		"org_id":   topUp.OrgId,
		"quota":    quota,
		"trade_no": topUp.TradeNo,
	}
	content := fmt.Sprintf("Organization %s pool received online top-up of %d (order %s)", orgName, quota, topUp.TradeNo)
	RecordOperationAuditLog(topUp.UserId, content, "", "org.pool_topup", params, nil, nil)
}

func Recharge(referenceId string, customerId string, callerIp string) (err error) {
	topUp, settled, err := SettleTopUpByTradeNo(referenceId, PaymentProviderStripe, func(tx *gorm.DB, t *TopUp) error {
		return tx.Model(&User{}).Where("id = ?", t.UserId).Update("stripe_customer", customerId).Error
	})
	if err != nil {
		common.SysError("topup failed: " + err.Error())
		return errors.New("充值失败，请稍后重试")
	}
	if settled {
		RecordTopupLog(topUp.UserId, fmt.Sprintf("使用在线充值成功，充值金额: %v，支付金额：%d", logger.FormatQuota(topUp.CreditQuota()), topUp.Amount), callerIp, topUp.PaymentMethod, PaymentMethodStripe)
	}

	return nil
}

// topUpQueryWindowSeconds 限制充值记录查询的时间窗口（秒）。
const topUpQueryWindowSeconds int64 = 30 * 24 * 60 * 60

// topUpQueryCutoff 返回允许查询的最早 create_time（秒级 Unix 时间戳）。
func topUpQueryCutoff() int64 {
	return common.GetTimestamp() - topUpQueryWindowSeconds
}

func GetUserTopUps(userId int, pageInfo *common.PageInfo) (topups []*TopUp, total int64, err error) {
	// Start transaction
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	cutoff := topUpQueryCutoff()

	// Get total count within transaction
	err = tx.Model(&TopUp{}).Where("user_id = ? AND create_time >= ?", userId, cutoff).Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Get paginated topups within same transaction
	err = tx.Where("user_id = ? AND create_time >= ?", userId, cutoff).Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&topups).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Commit transaction
	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return topups, total, nil
}

// GetAllTopUps 获取全平台的充值记录（管理员使用，不限制时间窗口）
func GetAllTopUps(pageInfo *common.PageInfo) (topups []*TopUp, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	if err = tx.Model(&TopUp{}).Count(&total).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&topups).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return topups, total, nil
}

// searchTopUpCountHardLimit 搜索充值记录时 COUNT 的安全上限，
// 防止对超大表执行无界 COUNT 触发 DoS。
const searchTopUpCountHardLimit = 10000

// SearchUserTopUps 按订单号搜索某用户的充值记录
func SearchUserTopUps(userId int, keyword string, pageInfo *common.PageInfo) (topups []*TopUp, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	query := tx.Model(&TopUp{}).Where("user_id = ? AND create_time >= ?", userId, topUpQueryCutoff())
	if keyword != "" {
		pattern, perr := sanitizeLikePattern(keyword)
		if perr != nil {
			tx.Rollback()
			return nil, 0, perr
		}
		query = query.Where("trade_no LIKE ? ESCAPE '!'", pattern)
	}

	if err = query.Limit(searchTopUpCountHardLimit).Count(&total).Error; err != nil {
		tx.Rollback()
		common.SysError("failed to count search topups: " + err.Error())
		return nil, 0, errors.New("搜索充值记录失败")
	}

	if err = query.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&topups).Error; err != nil {
		tx.Rollback()
		common.SysError("failed to search topups: " + err.Error())
		return nil, 0, errors.New("搜索充值记录失败")
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}
	return topups, total, nil
}

// SearchAllTopUps 按订单号搜索全平台充值记录（管理员使用，不限制时间窗口）
func SearchAllTopUps(keyword string, pageInfo *common.PageInfo) (topups []*TopUp, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	query := tx.Model(&TopUp{})
	if keyword != "" {
		pattern, perr := sanitizeLikePattern(keyword)
		if perr != nil {
			tx.Rollback()
			return nil, 0, perr
		}
		query = query.Where("trade_no LIKE ? ESCAPE '!'", pattern)
	}

	if err = query.Limit(searchTopUpCountHardLimit).Count(&total).Error; err != nil {
		tx.Rollback()
		common.SysError("failed to count search topups: " + err.Error())
		return nil, 0, errors.New("搜索充值记录失败")
	}

	if err = query.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&topups).Error; err != nil {
		tx.Rollback()
		common.SysError("failed to search topups: " + err.Error())
		return nil, 0, errors.New("搜索充值记录失败")
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}
	return topups, total, nil
}

// ManualCompleteTopUp 管理员手动完成订单并入账（按 OrgId 快照入企业池或个人钱包）
func ManualCompleteTopUp(tradeNo string, callerIp string) error {
	topUp, settled, err := SettleTopUpByTradeNo(tradeNo, "", nil)
	if err != nil {
		return err
	}
	if settled {
		// 事务外记录日志，避免阻塞
		RecordTopupLog(topUp.UserId, fmt.Sprintf("管理员补单成功，充值金额: %v，支付金额：%f", logger.FormatQuota(topUp.CreditQuota()), topUp.Money), callerIp, topUp.PaymentMethod, "admin")
	}
	return nil
}
func RechargeCreem(referenceId string, customerEmail string, customerName string, callerIp string) (err error) {
	topUp, settled, err := SettleTopUpByTradeNo(referenceId, PaymentProviderCreem, func(tx *gorm.DB, t *TopUp) error {
		// 如果有客户邮箱且用户邮箱为空，补写为支付时使用的邮箱
		if customerEmail == "" {
			return nil
		}
		var user User
		if err := tx.Select("id, email").Where("id = ?", t.UserId).First(&user).Error; err != nil {
			return err
		}
		if user.Email != "" {
			return nil
		}
		return tx.Model(&User{}).Where("id = ?", t.UserId).Update("email", customerEmail).Error
	})
	if err != nil {
		common.SysError("creem topup failed: " + err.Error())
		return errors.New("充值失败，请稍后重试")
	}

	if settled {
		RecordTopupLog(topUp.UserId, fmt.Sprintf("使用Creem充值成功，充值额度: %v，支付金额：%.2f", topUp.CreditQuota(), topUp.Money), callerIp, topUp.PaymentMethod, PaymentMethodCreem)
	}

	return nil
}

func RechargeWaffo(tradeNo string, callerIp string) (err error) {
	topUp, settled, err := SettleTopUpByTradeNo(tradeNo, PaymentProviderWaffo, nil)
	if err != nil {
		common.SysError("waffo topup failed: " + err.Error())
		return errors.New("充值失败，请稍后重试")
	}

	if settled {
		RecordTopupLog(topUp.UserId, fmt.Sprintf("Waffo充值成功，充值额度: %v，支付金额: %.2f", logger.FormatQuota(topUp.CreditQuota()), topUp.Money), callerIp, topUp.PaymentMethod, PaymentMethodWaffo)
	}

	return nil
}

func RechargeWaffoPancake(tradeNo string) (err error) {
	topUp, settled, err := SettleTopUpByTradeNo(tradeNo, PaymentProviderWaffoPancake, nil)
	if err != nil {
		common.SysError("waffo pancake topup failed: " + err.Error())
		return errors.New("充值失败，请稍后重试")
	}

	if settled {
		RecordLog(topUp.UserId, LogTypeTopup, fmt.Sprintf("Waffo Pancake充值成功，充值额度: %v，支付金额: %.2f", logger.FormatQuota(topUp.CreditQuota()), topUp.Money))
	}

	return nil
}
