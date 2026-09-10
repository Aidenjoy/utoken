package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// ResponseCacheSetting 响应缓存（相同请求直接回放上一次的上游响应）的全局配置。
//
// 全局开关是总闸：关闭时企业级 CacheEnabled 与任何个人请求都不会走缓存。
// 企业级开关与 TTL 存在 organizations 表（CacheEnabled / CacheTTL），
// 由企业管理员自助配置；非企业成员命中时使用这里的 TTLSeconds。
type ResponseCacheSetting struct {
	Enabled bool `json:"enabled"`
	// TTLSeconds 非企业成员的缓存存活时间（秒）
	TTLSeconds int `json:"ttl_seconds"`
	// MaxBodyBytes 单条缓存的响应体上限，超过则本次不写缓存，
	// 避免超长输出把 Redis 撑爆
	MaxBodyBytes int `json:"max_body_bytes"`
}

const (
	ResponseCacheTTLDefault = 300
	ResponseCacheTTLMax     = 86400
	// ResponseCacheMaxBodyDefault 1 MiB：足够覆盖绝大多数纯文本对话，
	// 又不至于让单条缓存占用可观内存
	ResponseCacheMaxBodyDefault = 1 << 20
	// ResponseCacheMaxBodyMax 8 MiB，管理员可调的上限
	ResponseCacheMaxBodyMax = 8 << 20
)

// 默认关闭：缓存会让"相同请求返回相同答案"，对温度不为 0 的对话是行为变更，
// 必须由管理员显式开启。
var responseCacheSetting = ResponseCacheSetting{
	Enabled:      false,
	TTLSeconds:   ResponseCacheTTLDefault,
	MaxBodyBytes: ResponseCacheMaxBodyDefault,
}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("response_cache_setting", &responseCacheSetting)
}

func GetResponseCacheSetting() *ResponseCacheSetting {
	return &responseCacheSetting
}

// GetResponseCacheTTL 返回归一化后的全局 TTL（秒）。
// 配置从数据库读取，可能被改成 0 或超大值，因此每次读取都夹紧一次。
func GetResponseCacheTTL() int {
	return ClampResponseCacheTTL(responseCacheSetting.TTLSeconds)
}

// GetResponseCacheMaxBodyBytes 返回归一化后的单条缓存体积上限。
func GetResponseCacheMaxBodyBytes() int {
	if responseCacheSetting.MaxBodyBytes <= 0 {
		return ResponseCacheMaxBodyDefault
	}
	if responseCacheSetting.MaxBodyBytes > ResponseCacheMaxBodyMax {
		return ResponseCacheMaxBodyMax
	}
	return responseCacheSetting.MaxBodyBytes
}

// ClampResponseCacheTTL 把任意 TTL 夹到 [1, ResponseCacheTTLMax]，
// 企业配置的 CacheTTL 与全局配置共用同一套边界。
func ClampResponseCacheTTL(ttl int) int {
	if ttl <= 0 {
		return ResponseCacheTTLDefault
	}
	if ttl > ResponseCacheTTLMax {
		return ResponseCacheTTLMax
	}
	return ttl
}
