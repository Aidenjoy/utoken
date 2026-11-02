package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestFormatUserLogsStripsQuotaSaturation verifies the admin-only quota
// saturation marker (nested under other.admin_info) is removed for non-admin
// log views, since formatUserLogs strips the whole admin_info object.
func TestFormatUserLogsStripsQuotaSaturation(t *testing.T) {
	other := common.MapToJsonStr(map[string]interface{}{
		"model_price": 0.004,
		"task_id":     "public-task",
		"admin_info": map[string]interface{}{
			"quota_saturation": map[string]interface{}{
				"op":      "QuotaFromDecimal",
				"kind":    "overflow",
				"clamped": common.MaxQuota,
			},
		},
	})
	logs := []*Log{{Other: other}}

	formatUserLogs(logs, 0)

	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	_, hasAdminInfo := parsed["admin_info"]
	require.False(t, hasAdminInfo, "admin_info (and nested quota_saturation) must be stripped for non-admin views")
	// model_price 是内部单价，现对非管理员视图一并剥离；非费率字段仍保留。
	require.NotContains(t, parsed, "model_price")
	require.Equal(t, "public-task", parsed["task_id"])
}

func TestFormatUserLogsStripsUpstreamAndChannelFields(t *testing.T) {
	logs := []*Log{{
		UserId:                   119,
		ChannelId:                14,
		ChannelName:              "internal-channel",
		TokenId:                  23,
		UpstreamRequestId:        "upstream-request",
		UpstreamPromptTokens:     100,
		UpstreamCompletionTokens: 200,
		Other: common.MapToJsonStr(map[string]interface{}{
			"model_price":         0.004,
			"task_id":             "public-task",
			"channel_id":          14,
			"channel_name":        "internal-channel",
			"channel_type":        59,
			"request_url":         "https://internal-upstream.example.com/tasks",
			"request_conversion":  []string{"openai -> ark"},
			"is_model_mapped":     true,
			"upstream_model_name": "internal-model",
		}),
	}}

	formatUserLogs(logs, 0)

	require.Zero(t, logs[0].ChannelId)
	require.Empty(t, logs[0].ChannelName)
	require.Zero(t, logs[0].TokenId)
	require.Empty(t, logs[0].UpstreamRequestId)
	require.Zero(t, logs[0].UpstreamPromptTokens)
	require.Zero(t, logs[0].UpstreamCompletionTokens)
	require.Equal(t, 119, logs[0].UserId, "代理商仍需用户 ID 区分成员")

	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	for _, key := range []string{"channel_id", "channel_name", "channel_type", "request_url", "request_conversion", "is_model_mapped", "upstream_model_name", "model_price"} {
		require.NotContains(t, parsed, key)
	}
	require.Equal(t, "public-task", parsed["task_id"])
}

// TestStripAdminOnlyLogFieldsRemovesBillingRates 守护非管理员日志视图不泄露内部费率：
// 所有 *_ratio/*_price 倍率与单价、resolution-* 档倍率、折扣/折前额度、
// 分层计费表达式，以及任务 OtherRatios 展开到顶层的时长/尺寸/张数等倍率均被剥离，
// 而非费率的用量/标识字段保留。
func TestStripAdminOnlyLogFieldsRemovesBillingRates(t *testing.T) {
	logs := []*Log{{Other: common.MapToJsonStr(map[string]interface{}{
		// 后缀规则：*_ratio / *_price
		"model_ratio":             15.0,
		"group_ratio":             2.0,
		"completion_ratio":        4.0,
		"cache_ratio":             0.5,
		"user_group_ratio":        1.5,
		"audio_ratio":             3.0,
		"audio_completion_ratio":  6.0,
		"cache_creation_ratio_5m": 1.25,
		"image_ratio":             2.0,
		"model_price":             0.004,
		"web_search_price":        0.01,
		// 前缀规则：resolution-<档>
		"resolution-720p": 1.666667,
		// 显式黑名单：折扣/原价/分层计费/任务倍率
		"discount":       0.8,
		"original_quota": 12500,
		"billing_mode":   "tiered_expr",
		"expr_b64":       "c29tZS1leHBy",
		"matched_tier":   "tier-2",
		"user_discount":  0.8,
		"seconds":        4.0,
		"size":           1.666667,
		"n":              4.0,
		"duration":       5.0,
		"video_input":    1.5,
		"prompt_extend":  2.0,
		// 非费率字段：应保留
		"task_id":      "public-task",
		"request_path": "/v1/video/generations",
		"cache_tokens": 128,
		"frt":          350.0,
	})}}

	StripAdminOnlyLogFields(logs)

	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	for _, key := range []string{
		"model_ratio", "group_ratio", "completion_ratio", "cache_ratio", "user_group_ratio",
		"audio_ratio", "audio_completion_ratio", "cache_creation_ratio_5m", "image_ratio",
		"model_price", "web_search_price", "resolution-720p",
		"discount", "original_quota", "billing_mode", "expr_b64", "matched_tier",
		"user_discount", "seconds", "size", "n", "duration", "video_input", "prompt_extend",
	} {
		assert.NotContains(t, parsed, key, "rate key %q must be stripped for non-admin views", key)
	}
	assert.Equal(t, "public-task", parsed["task_id"])
	assert.Equal(t, "/v1/video/generations", parsed["request_path"])
	assert.Contains(t, parsed, "cache_tokens")
	assert.Contains(t, parsed, "frt")
}

// TestSanitizeUserLogContent 守护任务计费日志正文不泄露费率公式：
// 剥离提交日志的「计算参数：...」与差额结算的「modelRatio=... otherMultiplier=...」，
// 保留对用户有意义的动作标签；无费率标记的正文原样返回。
func TestSanitizeUserLogContent(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    string
	}{
		{"submit with calc params", "操作 video_generate, 计算参数：seconds: 4.00, size: 1.67", "操作 video_generate"},
		{"submit per-call", "操作 imagine，按次计费", "操作 imagine，按次计费"},
		{"settle token recount", "token重算：tokens=1234, modelRatio=5.00, groupRatio=1.00, otherMultiplier=1.5000", "token重算"},
		{"settle adaptor label", "adaptor计费调整", "adaptor计费调整"},
		{"marker without separator", "内部模型 modelRatio=2.50", "内部模型"},
		{"empty", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, sanitizeUserLogContent(tt.content))
		})
	}
}
