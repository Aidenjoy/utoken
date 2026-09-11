package model

import (
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestConcurrentDecreaseTokenQuota 验证并发扣费时令牌余额不为负。
func TestConcurrentDecreaseTokenQuota(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping concurrent test in short mode")
	}

	common.BatchUpdateEnabled = false
	defer func() { common.BatchUpdateEnabled = false }()

	token := &Token{
		Key:          "test_concurrent_token_" + t.Name(),
		UserId:       1,
		RemainQuota:  10000,
		UnlimitedQuota: false,
	}
	require.NoError(t, DB.Create(token).Error)
	defer DB.Unscoped().Delete(&Token{}, "id = ?", token.Id)

	const goroutines = 100
	const perGoroutineQuota = 50

	var wg sync.WaitGroup
	wg.Add(goroutines)

	errs := make([]error, goroutines)
	for i := 0; i < goroutines; i++ {
		go func(idx int) {
			defer wg.Done()
			errs[idx] = DecreaseTokenQuota(token.Id, token.Key, perGoroutineQuota)
		}(i)
	}
	wg.Wait()

	successCount := 0
	for _, err := range errs {
		if err == nil {
			successCount++
		}
	}

	var finalRemain int
	require.NoError(t, DB.Model(&Token{}).Where("id = ?", token.Id).Select("remain_quota").Find(&finalRemain).Error)

	assert.Equal(t, 10000-successCount*perGoroutineQuota, finalRemain)
	assert.GreaterOrEqual(t, finalRemain, 0, "remain_quota must never be negative")
}

// TestDecreaseTokenQuotaInsufficientBalance 验证令牌余额不足时返回正确错误。
func TestDecreaseTokenQuotaInsufficientBalance(t *testing.T) {
	common.BatchUpdateEnabled = false

	token := &Token{
		Key:            "test_insufficient_token_" + t.Name(),
		UserId:         1,
		RemainQuota:    100,
		UnlimitedQuota: false,
	}
	require.NoError(t, DB.Create(token).Error)
	defer DB.Unscoped().Delete(&Token{}, "id = ?", token.Id)

	err := DecreaseTokenQuota(token.Id, token.Key, 200)
	assert.ErrorIs(t, err, ErrInsufficientTokenQuota, "should return ErrInsufficientTokenQuota")

	var remain int
	require.NoError(t, DB.Model(&Token{}).Where("id = ?", token.Id).Select("remain_quota").Find(&remain).Error)
	assert.Equal(t, 100, remain, "remain_quota should remain unchanged after failed deduction")
}

// TestDecreaseTokenQuotaBatchPrecheck 验证批量模式下的预检查。
func TestDecreaseTokenQuotaBatchPrecheck(t *testing.T) {
	resetBatchUpdateStores()
	token := &Token{
		Key:            "test_batch_token_" + t.Name(),
		UserId:         1,
		RemainQuota:    100,
		UnlimitedQuota: false,
	}
	require.NoError(t, DB.Create(token).Error)
	defer DB.Unscoped().Delete(&Token{}, "id = ?", token.Id)

	common.BatchUpdateEnabled = true
	defer func() {
		common.BatchUpdateEnabled = false
		resetBatchUpdateStores()
	}()

	err := DecreaseTokenQuota(token.Id, token.Key, 50)
	assert.NoError(t, err)

	err = DecreaseTokenQuota(token.Id, token.Key, 100)
	assert.ErrorIs(t, err, ErrInsufficientTokenQuota)
}

// TestTokenBatchPrecheckCountsQueuedDeductions 验证令牌批量扣减计入已排队的 delta。
func TestTokenBatchPrecheckCountsQueuedDeductions(t *testing.T) {
	resetBatchUpdateStores()
	token := &Token{
		Key:            "test_token_queued_" + t.Name(),
		UserId:         1,
		RemainQuota:    100,
		UnlimitedQuota: false,
	}
	require.NoError(t, DB.Create(token).Error)
	defer DB.Unscoped().Delete(&Token{}, "id = ?", token.Id)

	common.BatchUpdateEnabled = true
	defer func() {
		common.BatchUpdateEnabled = false
		resetBatchUpdateStores()
	}()

	require.NoError(t, DecreaseTokenQuota(token.Id, token.Key, 60), "first deduction should succeed")
	err := DecreaseTokenQuota(token.Id, token.Key, 60)
	assert.ErrorIs(t, err, ErrInsufficientTokenQuota,
		"second deduction must account for the queued -60, otherwise balance goes negative")
}
