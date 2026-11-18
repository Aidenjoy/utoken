package model

import (
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestMembershipTaskAtomicTerminalAndConcurrentReplay runs unchanged on the
// SQLite fixture and opt-in independent MySQL/PostgreSQL databases.
func TestMembershipTaskAtomicTerminalAndConcurrentReplay(t *testing.T) {
	_, sub := membershipFixture(t)
	require.NoError(t, DB.AutoMigrate(&Task{}))
	require.NoError(t, DB.Model(&SubscriptionChannelQuota{}).Where("user_subscription_id = ?", sub.Id).Updates(map[string]interface{}{
		"profile": MembershipVideoProfile, "unit": MembershipUnitVideos, "quantity_limit": 1, "input_limit": 0, "output_limit": 0, "models": JSONValue(`["sora-2"]`),
	}).Error)
	record := &SubscriptionChannelRequest{RequestId: "mock-video-task", UserId: 701, TokenId: 55, ChannelId: 702, UserSubscriptionId: sub.Id, Model: "sora-2", QuantityReserved: 1}
	require.NoError(t, ReserveMembership(record))
	require.NoError(t, DispatchMembership(record.RequestId))
	task := Task{TaskID: record.RequestId, UserId: 701, ChannelId: 702, Status: TaskStatusQueued, Properties: Properties{OriginModelName: record.Model}, PrivateData: TaskPrivateData{TokenId: 55, MembershipRequestId: record.RequestId}}
	require.NoError(t, DB.Create(&task).Error)
	require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", sub.Id).Update("end_time", common.GetTimestamp()-1).Error)
	terminal := task
	terminal.Status = TaskStatusSuccess
	// A quota-ledger mismatch must roll back both task state and the claimed receipt.
	require.NoError(t, DB.Model(&SubscriptionChannelQuota{}).Where("user_subscription_id = ?", sub.Id).Update("quantity_reserved", 0).Error)
	require.Error(t, CompleteMembershipTask(&terminal, 1, []byte(`{"id":"mock-video-task","status":"completed"}`)))
	var persisted Task
	require.NoError(t, DB.First(&persisted, task.ID).Error)
	assert.EqualValues(t, TaskStatusQueued, persisted.Status)
	var ledger SubscriptionChannelRequest
	require.NoError(t, DB.First(&ledger, record.Id).Error)
	assert.Equal(t, "dispatched", ledger.Status)
	require.NoError(t, DB.Model(&SubscriptionChannelQuota{}).Where("user_subscription_id = ?", sub.Id).Update("quantity_reserved", 1).Error)
	// Poller and administrator replay may race, but consume exactly one count.
	errors := make(chan error, 2)
	var workers sync.WaitGroup
	for i := 0; i < 2; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			copy := terminal
			errors <- CompleteMembershipTask(&copy, 1, []byte(`{"id":"mock-video-task","status":"completed"}`))
		}()
	}
	workers.Wait()
	close(errors)
	for err := range errors {
		require.NoError(t, err)
	}
	var grant SubscriptionChannelQuota
	require.NoError(t, DB.Where("user_subscription_id = ?", sub.Id).First(&grant).Error)
	assert.EqualValues(t, 1, grant.QuantityUsed)
	assert.Zero(t, grant.QuantityReserved)
	require.NoError(t, DB.First(&persisted, task.ID).Error)
	assert.EqualValues(t, TaskStatusSuccess, persisted.Status)
	terminal.Status = TaskStatusFailure
	require.Error(t, CompleteMembershipTask(&terminal, 0, []byte(`{"id":"mock-video-task","status":"failed"}`)))
}
