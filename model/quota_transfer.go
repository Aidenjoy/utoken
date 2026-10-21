package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"

	"github.com/bytedance/gopkg/util/gopool"
	"gorm.io/gorm"
)

// QuotaTransfer 个人钱包 → 企业额度池的自助转移台账。
//
// 一行代表一次单向不可逆转移。它既不是外部资金入账（top_ups），也不是管理员
// 后台调额（管理审计日志），所以单独建表：账单中心据此把一次转移展开成
// 「个人钱包 −X」与「企业额度池 +X」两条明细，并归入"内部转移"口径，
// 与线上充值/线下调额分开统计，避免同一笔钱被重复计入流入。
type QuotaTransfer struct {
	Id        int   `json:"id"`
	UserId    int   `json:"user_id" gorm:"type:int;index;not null"`
	OrgId     int   `json:"org_id" gorm:"type:int;index;not null"`
	Quota     int   `json:"quota" gorm:"type:int;not null"`
	CreatedAt int64 `json:"created_at" gorm:"autoCreateTime;column:created_at;index"`
}

func (QuotaTransfer) TableName() string {
	return "quota_transfers"
}

// TransferUserQuotaToOrg 把用户个人钱包额度转入企业额度池，返回转入后的池余额。
//
// 钱包扣减、池增加与台账写入在同一事务内完成，任一步失败整体回滚，
// 因此台账与实际余额不可能出现偏差。钱包侧沿用 decreaseUserQuota 的原子
// 条件更新（WHERE quota >= ?）兜住并发，余额不足时整体不生效。
// 企业侧只做加额，不触碰成员子额度承诺。
// 返回的池余额取自事务内已加锁的行，可直接用于审计与回显。
func TransferUserQuotaToOrg(userId int, orgId int, quota int) (int, error) {
	if quota <= 0 {
		return 0, ErrQuotaTransferInvalid
	}
	poolQuota := 0
	err := DB.Transaction(func(tx *gorm.DB) error {
		var org Organization
		if err := lockForUpdate(tx).Select("id", "status", "quota").
			Where("id = ?", orgId).First(&org).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrOrgNotFound
			}
			return err
		}
		if org.Status != OrgStatusEnabled {
			return ErrOrgDisabled
		}

		result := tx.Model(&User{}).Where("id = ? AND quota >= ?", userId, quota).
			Update("quota", gorm.Expr("quota - ?", quota))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrInsufficientUserQuota
		}
		if err := tx.Model(&Organization{}).Where("id = ?", orgId).
			Update("quota", gorm.Expr("quota + ?", quota)).Error; err != nil {
			return err
		}
		if err := tx.Create(&QuotaTransfer{UserId: userId, OrgId: orgId, Quota: quota}).Error; err != nil {
			return err
		}
		poolQuota = org.Quota + quota
		return nil
	})
	if err != nil {
		return 0, err
	}
	// 提交成功后才动 Redis 缓存，与 decreaseUserQuota 保持一致：
	// 缓存失败只记日志，不回滚已落库的账。
	gopool.Go(func() {
		if cacheErr := cacheDecrUserQuota(userId, int64(quota)); cacheErr != nil {
			common.SysLog("failed to decrease user quota cache after wallet transfer: " + cacheErr.Error())
		}
	})
	return poolQuota, nil
}

// GetQuotaTransfers 按时间范围拉取转移台账，供账单中心展开明细。
// 带上限保护，防止无界扫描拖垮数据库。
func GetQuotaTransfers(startTimestamp, endTimestamp int64, limit int) ([]*QuotaTransfer, error) {
	tx := DB.Model(&QuotaTransfer{})
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	var transfers []*QuotaTransfer
	if err := tx.Order("id desc").Limit(limit).Find(&transfers).Error; err != nil {
		return nil, err
	}
	return transfers, nil
}
