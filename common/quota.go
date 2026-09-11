package common

func GetTrustQuota() int {
	return int(10 * QuotaPerUnit)
}

// GetTrustConcurrentLimit 同一用户允许同时在途的信任旁路请求数上限。
// 信任旁路跳过预扣费，余额检查与实际消费之间存在窗口期，需要限制并发
// 以避免高并发下多请求同时通过检查而透支。可通过环境变量覆盖。
func GetTrustConcurrentLimit() int {
	return GetEnvOrDefault("TRUST_CONCURRENT_LIMIT", 5)
}
