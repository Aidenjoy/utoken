package model

import (
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// resetBatchUpdateStores 清空进程级批量累加器。
// 批量累加器是包级全局变量，且测试库中自增 ID 会被回收，残留的 delta
// 会污染后续用例（表现为新用户带着上一个用例的欠费额度）。批量相关用例
// 必须在开始前调用本函数。
func resetBatchUpdateStores() {
	for i := 0; i < BatchUpdateTypeCount; i++ {
		batchUpdateLocks[i].Lock()
		batchUpdateStores[i] = make(map[int]int)
		batchUpdateLocks[i].Unlock()
	}
}

// TestConcurrentDecreaseUserQuota 验证并发扣费时余额不为负。
// 100 个 goroutine 同时扣费，总额度不超过初始余额的 80%，
// 确保即使并发也不会出现负数。
func TestConcurrentDecreaseUserQuota(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping concurrent test in short mode")
	}

	common.BatchUpdateEnabled = false
	defer func() { common.BatchUpdateEnabled = false }()

	// 创建测试用户，初始余额 10000
	user := &User{
		Username: "test_concurrent_user_" + t.Name(),
		Quota:    10000,
	}
	require.NoError(t, DB.Create(user).Error)
	defer DB.Unscoped().Delete(&User{}, "id = ?", user.Id)

	const goroutines = 100
	const perGoroutineQuota = 50 // 每个 goroutine 扣 50，总计 5000 < 10000

	var wg sync.WaitGroup
	wg.Add(goroutines)

	errs := make([]error, goroutines)
	for i := 0; i < goroutines; i++ {
		go func(idx int) {
			defer wg.Done()
			errs[idx] = DecreaseUserQuota(user.Id, perGoroutineQuota, true)
		}(i)
	}
	wg.Wait()

	// 统计成功次数
	successCount := 0
	for _, err := range errs {
		if err == nil {
			successCount++
		}
	}

	// 验证：余额不为负
	var finalQuota int
	require.NoError(t, DB.Model(&User{}).Where("id = ?", user.Id).Select("quota").Find(&finalQuota).Error)

	// 所有成功的扣费总额 = successCount * 50
	assert.Equal(t, 10000-successCount*perGoroutineQuota, finalQuota, "final quota should match successful deductions")

	// 余额绝不能为负
	assert.GreaterOrEqual(t, finalQuota, 0, "quota must never be negative under concurrent access")
}

// TestDecreaseUserQuotaInsufficientBalance 验证余额不足时返回正确错误。
func TestDecreaseUserQuotaInsufficientBalance(t *testing.T) {
	common.BatchUpdateEnabled = false

	user := &User{
		Username: "test_insufficient_user_" + t.Name(),
		Quota:    100,
	}
	require.NoError(t, DB.Create(user).Error)
	defer DB.Unscoped().Delete(&User{}, "id = ?", user.Id)

	// 尝试扣减超过余额的额度
	err := DecreaseUserQuota(user.Id, 200, true)
	assert.ErrorIs(t, err, ErrInsufficientUserQuota, "should return ErrInsufficientUserQuota")

	// 验证余额未变
	var quota int
	require.NoError(t, DB.Model(&User{}).Where("id = ?", user.Id).Select("quota").Find(&quota).Error)
	assert.Equal(t, 100, quota, "quota should remain unchanged after failed deduction")
}

// TestDecreaseUserQuotaBatchPrecheck 验证批量模式下的预检查。
func TestDecreaseUserQuotaBatchPrecheck(t *testing.T) {
	resetBatchUpdateStores()
	user := &User{
		Username: "test_batch_precheck_user_" + t.Name(),
		Quota:    100,
	}
	require.NoError(t, DB.Create(user).Error)
	defer DB.Unscoped().Delete(&User{}, "id = ?", user.Id)

	// 开启批量模式
	common.BatchUpdateEnabled = true
	defer func() {
		common.BatchUpdateEnabled = false
		resetBatchUpdateStores()
	}()

	// 余额充足：预扣应成功
	err := DecreaseUserQuota(user.Id, 50, false)
	assert.NoError(t, err, "sufficient balance should pass precheck")

	// 余额不足：预扣应立即拒绝
	// 注意：余额 100，已排队扣减 50，剩余可用 50；再扣 100 必须被拒绝
	err = DecreaseUserQuota(user.Id, 100, false)
	assert.ErrorIs(t, err, ErrInsufficientUserQuota, "insufficient balance should fail precheck")
}

// TestBatchPrecheckCountsQueuedDeductions 验证批量模式的余额判定计入已排队未刷写的 delta。
// 回归保护：若仅检查 DB 余额（刷写前不变），连续扣减会被重复放行导致超额。
func TestBatchPrecheckCountsQueuedDeductions(t *testing.T) {
	resetBatchUpdateStores()
	user := &User{
		Username: "test_batch_queued_" + t.Name(),
		Quota:    100,
	}
	require.NoError(t, DB.Create(user).Error)
	defer DB.Unscoped().Delete(&User{}, "id = ?", user.Id)

	common.BatchUpdateEnabled = true
	defer func() {
		common.BatchUpdateEnabled = false
		resetBatchUpdateStores()
	}()

	// 连续两次扣减 60，DB 余额在刷写前恒为 100。
	// 只有计入首次排队的 -60，第二次才会被拒绝。
	require.NoError(t, DecreaseUserQuota(user.Id, 60, false), "first deduction should succeed")
	err := DecreaseUserQuota(user.Id, 60, false)
	assert.ErrorIs(t, err, ErrInsufficientUserQuota,
		"second deduction must account for the queued -60, otherwise balance goes negative")
}
