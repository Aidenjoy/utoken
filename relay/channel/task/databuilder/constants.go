package databuilder

import (
	"strings"
)

// ChannelName 渠道显示名。
const ChannelName = "baidu-databuilder"

// DefaultBaseURL DataBuilder 模型服务网关（手册 1.1 地址）。
const DefaultBaseURL = "http://databuilder.bd.baidubce.com"

// SeedancePrefix 视频/素材接口的统一路径前缀。
const SeedancePrefix = "/db-ms/seedance"

// ModelList DataBuilder 当前仅开放 seedance 2.0（手册 §2）。
var ModelList = []string{
	"doubao-seedance-2-0-260128",
}

// trimBase 去掉渠道 base_url 的尾斜杠；未配置时回落到官方网关。
func trimBase(baseURL string) string {
	base := strings.TrimSuffix(strings.TrimSpace(baseURL), "/")
	if base == "" {
		base = DefaultBaseURL
	}
	return base
}

// TaskBaseURL 归一化任务 API 基址（{base}/db-ms/seedance/api/v3）：
// 用户可能配裸网关、带 /db-ms/seedance 前缀或完整任务基址，三种形态都收敛到
// 同一结果；其他自定义路径原样补全任务版本路径。
func TaskBaseURL(baseURL string) string {
	base := trimBase(baseURL)
	switch {
	case strings.HasSuffix(base, "/api/v3"):
		return base
	case strings.HasSuffix(base, SeedancePrefix):
		return base + "/api/v3"
	default:
		return base + SeedancePrefix + "/api/v3"
	}
}

// MaterialBaseURL 归一化素材库 API 基址（{base}/db-ms/seedance/material）。
func MaterialBaseURL(baseURL string) string {
	base := trimBase(baseURL)
	switch {
	case strings.HasSuffix(base, "/material"):
		return base
	case strings.HasSuffix(base, SeedancePrefix):
		return base + "/material"
	case strings.HasSuffix(base, "/api/v3"):
		return strings.TrimSuffix(base, "/api/v3") + "/material"
	default:
		return base + SeedancePrefix + "/material"
	}
}
