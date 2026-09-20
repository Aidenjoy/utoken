package service

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

// parseScaledUsage 从缩放后的 body 中取出顶层 usage 对象，便于断言字段类型与数值。
func parseScaledUsage(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var payload struct {
		Usage map[string]any `json:"usage"`
	}
	require.NoError(t, json.Unmarshal(body, &payload))
	require.NotNil(t, payload.Usage)
	return payload.Usage
}

// TestScaleVolcUsageByRate 覆盖纯粹的 usage 缩放逻辑：数字/字符串两种 token 形态、
// result_summary 兜底、四舍五入、以及各类 fail-open 原样返回场景。
func TestScaleVolcUsageByRate(t *testing.T) {
	const userId = 4242

	tests := []struct {
		name            string
		rate            float64
		body            string
		expectUnchanged bool
		expectJSON      string // 缩放后 body 的等价 JSON（忽略键序）
	}{
		{
			name:       "数字形态 token 按 1.5 缩放",
			rate:       1.5,
			body:       `{"id":"t1","status":"succeeded","content":{"video_url":"http://v"},"usage":{"completion_tokens":100,"total_tokens":200}}`,
			expectJSON: `{"id":"t1","status":"succeeded","content":{"video_url":"http://v"},"usage":{"completion_tokens":150,"total_tokens":300}}`,
		},
		{
			name:       "字符串形态 token 缩放后保持字符串类型",
			rate:       1.5,
			body:       `{"status":"succeeded","usage":{"completion_tokens":"100","total_tokens":"201"}}`,
			expectJSON: `{"status":"succeeded","usage":{"completion_tokens":"150","total_tokens":"302"}}`,
		},
		{
			name:       "result_summary.usage 兜底形态",
			rate:       2,
			body:       `{"status":"succeeded","result_summary":{"usage":{"completion_tokens":7,"total_tokens":9}}}`,
			expectJSON: `{"status":"succeeded","result_summary":{"usage":{"completion_tokens":14,"total_tokens":18}}}`,
		},
		{
			name:       "四舍五入（3 × 1.25 → 4）",
			rate:       1.25,
			body:       `{"usage":{"completion_tokens":3,"total_tokens":3}}`,
			expectJSON: `{"usage":{"completion_tokens":4,"total_tokens":4}}`,
		},
		{
			name:            "费率为 0（未设置）原样返回",
			rate:            0,
			body:            `{"usage":{"completion_tokens":100,"total_tokens":200}}`,
			expectUnchanged: true,
		},
		{
			name:            "费率为 1 原样返回（字节级不变）",
			rate:            1,
			body:            `{"usage":{"completion_tokens":100,"total_tokens":200}}`,
			expectUnchanged: true,
		},
		{
			name:            "非法 JSON 原样返回",
			rate:            1.5,
			body:            `not-json`,
			expectUnchanged: true,
		},
		{
			name:            "无 usage 字段原样返回（如失败任务响应）",
			rate:            1.5,
			body:            `{"id":"t1","status":"failed","error":{"code":"500","message":"boom"}}`,
			expectUnchanged: true,
		},
		{
			name:       "部分非法值时仅缩放合法字段",
			rate:       1.5,
			body:       `{"usage":{"completion_tokens":"abc","total_tokens":200}}`,
			expectJSON: `{"usage":{"completion_tokens":"abc","total_tokens":300}}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := scaleVolcUsageByRate([]byte(tt.body), tt.rate, userId, "[Test]")

			if tt.expectUnchanged {
				assert.Equal(t, tt.body, string(got))
				return
			}
			assert.JSONEq(t, tt.expectJSON, string(got))
		})
	}
}

// TestScaleVolcUsageByRate_PreservesStringTypeAndUnrelatedFields 验证缩放只改
// completion_tokens / total_tokens，保持各自原始 JSON 类型，且不动其它字段。
func TestScaleVolcUsageByRate_PreservesStringTypeAndUnrelatedFields(t *testing.T) {
	const userId = 4243

	body := []byte(`{"id":"t1","status":"succeeded","content":{"video_url":"http://v"},"usage":{"completion_tokens":"100","total_tokens":200,"prompt_tokens":5}}`)
	got := scaleVolcUsageByRate(body, 1.5, userId, "[Test]")

	var payload map[string]any
	require.NoError(t, json.Unmarshal(got, &payload))

	usage := parseScaledUsage(t, got)
	// 字符串形态保持字符串，数字形态保持数字
	assert.Equal(t, "150", usage["completion_tokens"])
	assert.EqualValues(t, 300, usage["total_tokens"])
	// 未识别的 usage 字段不做缩放
	assert.EqualValues(t, 5, usage["prompt_tokens"])
	// 与 usage 无关的字段原样保留
	assert.Equal(t, "t1", payload["id"])
	assert.Equal(t, "succeeded", payload["status"])
}

// TestScaleSeedanceTaskUsageByUserRate_Gate 验证 seedance 计费门控：nil 任务、
// 非 seedance 计费模型（默认 ratio）均原样返回，不触发费率查询与缩放。
func TestScaleSeedanceTaskUsageByUserRate_Gate(t *testing.T) {
	body := []byte(`{"usage":{"completion_tokens":100,"total_tokens":200}}`)

	t.Run("nil 任务原样返回", func(t *testing.T) {
		assert.Equal(t, string(body), string(ScaleSeedanceTaskUsageByUserRate(body, nil, "[Test]")))
	})

	t.Run("非 seedance 计费模型原样返回", func(t *testing.T) {
		task := &model.Task{
			UserId:     7,
			Properties: model.Properties{OriginModelName: "gpt-4o"}, // 默认 ratio 计费
		}
		assert.Equal(t, string(body), string(ScaleSeedanceTaskUsageByUserRate(body, task, "[Test]")))
	})
}

// TestScaleVolcUsageByRate_PreservesKeyOrder 验证缩放保持上游原始字段顺序
// （sjson 原地替换），不会重排为字母序 JSON 而被客户端察觉异常。
func TestScaleVolcUsageByRate_PreservesKeyOrder(t *testing.T) {
	const userId = 4244

	body := []byte(`{"id":"t1","model":"doubao-seedance-2-0","status":"succeeded","content":{"video_url":"http://v"},"usage":{"completion_tokens":100,"total_tokens":100},"created_at":1,"seed":2,"resolution":"480p"}`)
	got := scaleVolcUsageByRate(body, 1.5, userId, "[Test]")

	topKeys := func(b []byte) []string {
		var keys []string
		gjson.ParseBytes(b).ForEach(func(k, _ gjson.Result) bool {
			keys = append(keys, k.String())
			return true
		})
		return keys
	}
	assert.Equal(t, topKeys(body), topKeys(got), "顶层字段顺序应保持上游原样")

	usage := parseScaledUsage(t, got)
	assert.EqualValues(t, 150, usage["completion_tokens"])
	assert.EqualValues(t, 150, usage["total_tokens"])
}
