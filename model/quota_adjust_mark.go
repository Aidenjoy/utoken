package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
)

// 超管调额记录的线下性质标记：调额审计日志不可变（不回填 other JSON），
// 标记以审计日志行 ID 为键单独落在主库。无标记行 = 未标记 = 测试额度增减，
// 标记后按线下充值（调增）或线下退款（调减）计入对账口径。
const (
	QuotaAdjustMarkOfflineRecharge = "offline_recharge"
	QuotaAdjustMarkOfflineRefund   = "offline_refund"
)

type QuotaAdjustMark struct {
	LogId    int    `json:"log_id" gorm:"primaryKey"`
	Mark     string `json:"mark" gorm:"type:varchar(20)"`
	MarkedBy string `json:"marked_by" gorm:"type:varchar(64)"`
	MarkedAt int64  `json:"marked_at" gorm:"bigint"`
}

func GetQuotaAdjustMarks(logIds []int) (map[int]*QuotaAdjustMark, error) {
	result := make(map[int]*QuotaAdjustMark, len(logIds))
	if len(logIds) == 0 {
		return result, nil
	}
	var marks []*QuotaAdjustMark
	if err := DB.Where("log_id IN ?", logIds).Find(&marks).Error; err != nil {
		return nil, err
	}
	for _, mark := range marks {
		result[mark.LogId] = mark
	}
	return result, nil
}

// MarkQuotaAdjustOffline 给一条调额审计日志打/撤线下标记。mark 为空串表示撤销标记
// （恢复为测试额度增减）。符号校验保证线下充值只落在调增行、线下退款只落在调减行。
func MarkQuotaAdjustOffline(logId int, mark string, operator string) error {
	if logId <= 0 {
		return errors.New("invalid log id")
	}
	switch mark {
	case "", QuotaAdjustMarkOfflineRecharge, QuotaAdjustMarkOfflineRefund:
	default:
		return errors.New("invalid mark")
	}
	record, quota, err := LookupQuotaAdjustRecord(logId)
	if err != nil {
		return err
	}
	if record == nil {
		return errors.New("quota adjust record not found")
	}
	if mark != "" {
		if quota > 0 && mark != QuotaAdjustMarkOfflineRecharge {
			return errors.New("positive adjust can only be marked as offline recharge")
		}
		if quota < 0 && mark != QuotaAdjustMarkOfflineRefund {
			return errors.New("negative adjust can only be marked as offline refund")
		}
	}
	if mark == "" {
		return DB.Where("log_id = ?", logId).Delete(&QuotaAdjustMark{}).Error
	}
	row := &QuotaAdjustMark{
		LogId:    logId,
		Mark:     mark,
		MarkedBy: operator,
		MarkedAt: common.GetTimestamp(),
	}
	return DB.Save(row).Error
}
