package logger

import (
	"bytes"
	"context"

	"github.com/QuantumNous/new-api/common"
)

// 调试日志里的 base64 图片/媒体数据动辄数百 KB，整段写入会瞬间撑爆日志文件。
// 这里在写日志前把 JSON 中的 base64 数据截断为“前 base64KeepChars 个字符 + 省略号”：
// 逐个字符串字面量处理，只缩短 base64 值本身，键名、URL、数字与其余字段原样输出，
// 因此 JSON 结构与字段顺序都不会被破坏。

const (
	// base64KeepChars 是日志中每个 base64 数据保留的开头字符数。
	base64KeepChars = 30
	// rawBase64MinChars 是判定裸 base64 数据的最小长度，短于此长度按普通字段保留，
	// 避免误伤 id、hash 等短字符串。
	rawBase64MinChars = 256
	// base64Ellipsis 替代被截断的部分。
	base64Ellipsis = "..."
)

var (
	dataURIPrefix = []byte("data:")
	base64Marker  = []byte(";base64,")
)

// RedactBase64 返回 data 的副本，其中所有 base64 媒体数据（data URI，以及长度达到
// rawBase64MinChars 的纯 base64 字符串）被截断为前 base64KeepChars 个字符加省略号。
// 入参不会被修改。
func RedactBase64(data []byte) []byte {
	if len(data) < rawBase64MinChars {
		return data
	}

	out := make([]byte, 0, len(data))
	for i := 0; i < len(data); {
		if data[i] != '"' {
			out = append(out, data[i])
			i++
			continue
		}

		closing, ok := closingQuote(data, i)
		if !ok {
			// 引号未闭合（不是 JSON），剩余内容原样输出
			out = append(out, data[i:]...)
			break
		}

		literal := data[i+1 : closing]
		// 键名（闭合引号后紧跟 ':'）原样输出，不做截断
		if !isObjectKey(data, closing) {
			if redacted, keep := redactLiteral(literal); keep {
				out = append(out, '"')
				out = append(out, redacted...)
				out = append(out, '"')
				i = closing + 1
				continue
			}
		}

		out = append(out, data[i:closing+1]...)
		i = closing + 1
	}
	return out
}

// LogDebugJSON 输出 JSON 调试日志，先截断其中的 base64 媒体数据，避免整张图片写入日志。
// 格式串只接受一个 %s 参数，即 data。debug 未开启时直接返回，不产生截分开销。
func LogDebugJSON(ctx context.Context, format string, data []byte) {
	if !common.DebugEnabled {
		return
	}
	LogDebug(ctx, format, RedactBase64(data))
}

// closingQuote 返回 open 处引号的闭合引号下标；引号未闭合时 ok 为 false。
func closingQuote(data []byte, open int) (int, bool) {
	for i := open + 1; i < len(data); i++ {
		switch data[i] {
		case '\\':
			i++ // 跳过被转义的字符
		case '"':
			return i, true
		}
	}
	return 0, false
}

// isObjectKey 判断 closing 处的字符串是否为对象键名（后面紧跟 ':'）。
func isObjectKey(data []byte, closing int) bool {
	for i := closing + 1; i < len(data); i++ {
		switch data[i] {
		case ' ', '\t', '\n', '\r':
			continue
		case ':':
			return true
		default:
			return false
		}
	}
	return false
}

func redactLiteral(literal []byte) ([]byte, bool) {
	if redacted, ok := redactDataURI(literal); ok {
		return redacted, true
	}
	if len(literal) >= rawBase64MinChars && isBase64Charset(literal) {
		kept := make([]byte, 0, base64KeepChars+len(base64Ellipsis))
		kept = append(kept, literal[:base64KeepChars]...)
		return append(kept, base64Ellipsis...), true
	}
	return nil, false
}

// redactDataURI 保留 data:<mime>;base64, 前缀与载荷开头若干字符，便于识别媒体类型。
func redactDataURI(literal []byte) ([]byte, bool) {
	if !bytes.HasPrefix(literal, dataURIPrefix) {
		return nil, false
	}
	marker := bytes.Index(literal, base64Marker)
	if marker < 0 {
		return nil, false
	}
	headEnd := marker + len(base64Marker)
	payload := literal[headEnd:]
	if len(payload) <= base64KeepChars {
		return nil, false
	}
	kept := make([]byte, 0, headEnd+base64KeepChars+len(base64Ellipsis))
	kept = append(kept, literal[:headEnd]...)
	kept = append(kept, payload[:base64KeepChars]...)
	return append(kept, base64Ellipsis...), true
}

// isBase64Charset 判断字符串是否只由 base64（含 URL 安全变体）字符组成，
// 且 '=' 只作为末尾不超过 2 个的填充出现。
func isBase64Charset(s []byte) bool {
	padding := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9',
			c == '+', c == '/', c == '-', c == '_':
			if padding > 0 {
				return false
			}
		case c == '=':
			padding++
			if padding > 2 {
				return false
			}
		default:
			return false
		}
	}
	return true
}
