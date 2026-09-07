package logger

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const base64Payload = "abcdefghijklmnopqrstuvwxyz0123" // 30 chars, kept in full
const longBase64 = base64Payload + "MOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMOREMORE"

func TestRedactBase64KeepsJSONStructure(t *testing.T) {
	input := []byte(`{"image":["data:image/png;base64,` + longBase64 + `"],"model":"doubao-seedream-5-0","n":1,"temperature":0.7}`)

	out := RedactBase64(input)

	var parsed map[string]any
	require.NoError(t, common.Unmarshal(out, &parsed), "redacted output must stay valid JSON")
	assert.Equal(t, "doubao-seedream-5-0", parsed["model"])
	assert.JSONEq(t, `{"image":["data:image/png;base64,`+base64Payload+`..."],"model":"doubao-seedream-5-0","n":1,"temperature":0.7}`, string(out))
}

func TestRedactBase64OnlyTouchesBase64Values(t *testing.T) {
	longURL := "https://example.com/img/" + strings.Repeat("a", 400) + ".png"
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "http url untouched",
			input: `{"url":"` + longURL + `"}`,
			want:  `{"url":"` + longURL + `"}`,
		},
		{
			name:  "plain text untouched",
			input: `{"prompt":"` + strings.Repeat("a cat ", 60) + `"}`,
			want:  `{"prompt":"` + strings.Repeat("a cat ", 60) + `"}`,
		},
		{
			name:  "short data uri untouched",
			input: `{"image":"data:image/png;base64,` + base64Payload + `","pad":"` + strings.Repeat("x ", 200) + `"}`,
			want:  `{"image":"data:image/png;base64,` + base64Payload + `","pad":"` + strings.Repeat("x ", 200) + `"}`,
		},
		{
			name:  "object key untouched",
			input: `{"` + strings.Repeat("A", 300) + `":"value","pad":"` + strings.Repeat("y ", 60) + `"}`,
			want:  `{"` + strings.Repeat("A", 300) + `":"value","pad":"` + strings.Repeat("y ", 60) + `"}`,
		},
		{
			name:  "raw base64 value truncated",
			input: `{"source":{"type":"base64","media_type":"image/png","data":"` + longBase64 + `"},"pad":"` + strings.Repeat("z ", 20) + `"}`,
			want:  `{"source":{"type":"base64","media_type":"image/png","data":"` + base64Payload + `..."},"pad":"` + strings.Repeat("z ", 20) + `"}`,
		},
		{
			name:  "escaped quotes preserved",
			input: `{"prompt":"he said \"hi\" to me ` + strings.Repeat("word ", 60) + `","image":"data:image/jpeg;base64,` + longBase64 + `"}`,
			want:  `{"prompt":"he said \"hi\" to me ` + strings.Repeat("word ", 60) + `","image":"data:image/jpeg;base64,` + base64Payload + `..."}`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, string(RedactBase64([]byte(tc.input))))
		})
	}
}

func TestRedactBase64LeavesSmallAndNonJSONInputAlone(t *testing.T) {
	small := []byte(`{"image":"data:image/png;base64,AAAA"}`)
	assert.Equal(t, string(small), string(RedactBase64(small)), "payloads below the raw-base64 threshold are returned unchanged")

	// 非 JSON（如 SSE 文本）且引号未闭合时，剩余内容必须原样输出。
	plain := []byte("data: " + strings.Repeat("chunk ", 60) + `{"error":"unterminated`)
	assert.Equal(t, string(plain), string(RedactBase64(plain)))
}

func TestRedactBase64DoesNotMutateInput(t *testing.T) {
	input := []byte(`{"image":"data:image/png;base64,` + longBase64 + `"}`)
	original := strings.Clone(string(input))

	_ = RedactBase64(input)

	assert.Equal(t, original, string(input), "the request body sent upstream must stay intact")
}
