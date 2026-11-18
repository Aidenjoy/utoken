package model

import (
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// CompleteMembershipTask updates the original task, provider evidence and quota ledger
// in one transaction. It never checks current subscription expiry or touches wallet balances.
// quantity is the adapter-verified completed output count: one on success, zero on failure.
func CompleteMembershipTask(task *Task, quantity int64, receipt []byte) error {
	if quantity < 0 || quantity > 1 || len(receipt) == 0 || (task.Status != TaskStatusSuccess && task.Status != TaskStatusFailure && task.Status != TaskStatusCancelled) {
		return errors.New("invalid membership task terminal receipt")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		// Step 1: serialize terminal callbacks, cancellation and administrator reconciliation.
		var stored Task
		if err := lockForUpdate(tx).First(&stored, task.ID).Error; err != nil {
			return err
		}
		requestID := stored.PrivateData.MembershipRequestId
		if requestID == "" || requestID != task.PrivateData.MembershipRequestId {
			return errors.New("membership task binding mismatch")
		}
		var record SubscriptionChannelRequest
		if err := tx.Where("request_id = ?", requestID).First(&record).Error; err != nil {
			return err
		}
		if record.UserId != stored.UserId || record.ChannelId != stored.ChannelId || record.TokenId != stored.PrivateData.TokenId || record.Model != stored.Properties.OriginModelName || record.Unit != MembershipUnitVideos || record.QuantityReserved != 1 {
			return errors.New("membership task grant mismatch")
		}
		// Step 2: immutable terminal ledger makes repeated polling a no-op and rejects regressions.
		if record.Status == "settled" {
			if record.QuantityUsed != quantity || stored.Status != task.Status {
				return errors.New("membership task terminal conflict")
			}
			return nil
		}
		if quantity == 1 && task.Status != TaskStatusSuccess || quantity == 0 && task.Status == TaskStatusSuccess {
			return errors.New("membership task status and count disagree")
		}
		if err := finishMembershipTx(tx, requestID, 0, 0, quantity, "settled", "verified task terminal receipt"); err != nil {
			return err
		}
		if err := tx.Model(&SubscriptionChannelRequest{}).Where("id = ?", record.Id).Update("provider_usage", JSONValue(receipt)).Error; err != nil {
			return err
		}
		// Step 3: commit task terminal state together with quota release/settlement.
		task.Progress = "100%"
		if task.FinishTime == 0 {
			task.FinishTime = time.Now().Unix()
		}
		return tx.Model(&Task{}).Where("id = ?", stored.ID).Updates(map[string]interface{}{
			"status": task.Status, "progress": task.Progress, "finish_time": task.FinishTime, "fail_reason": task.FailReason,
			"data": task.Data, "private_data": task.PrivateData, "updated_at": common.GetTimestamp(),
		}).Error
	})
}
