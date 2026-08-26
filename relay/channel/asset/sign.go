package asset

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

// 火山引擎 V4 风格 HMAC-SHA256 签名（自实现，不引入火山 SDK）。
// 参考 volcengine universal API 签名规范：service=ark，host 默认 open.volcengineapi.com。

const (
	arkSignAlgorithm = "HMAC-SHA256"
	arkSignDateFmt   = "20060102"
	arkSignTimeFmt   = "20060102T150405Z"
)

// signParams 构造签名所需的全部输入。
type signParams struct {
	AK          string
	SK          string
	Region      string
	Service     string
	Host        string
	Path        string
	Query       map[string]string
	Headers     http.Header // 参与签名的头（小写 key）
	Body        []byte
	Now         time.Time
	SignedNames []string // 参与签名的头名（小写），如 x-content-sha256;x-date;host
}

// signRequest 在 req 上设置 X-Date、X-Content-Sha256 与 Authorization 头。
func signRequest(req *http.Request, p signParams) {
	t := p.Now.UTC()
	shortDate := t.Format(arkSignDateFmt)
	longDate := t.Format(arkSignTimeFmt)

	payloadHash := hexSha256(p.Body)
	req.Header.Set("X-Date", longDate)
	req.Header.Set("X-Content-Sha256", payloadHash)

	// 规范头表一律用小写 key 直接存取：http.Header.Get 按规范名（Content-Type）
	// 查找，存小写 key 会全部落空，导致签名头块为空值、上游 SignatureDoesNotMatch。
	headers := map[string]string{}
	for k, v := range p.Headers {
		if len(v) > 0 {
			headers[strings.ToLower(strings.TrimSpace(k))] = strings.TrimSpace(v[0])
		}
	}
	headers["host"] = p.Host
	headers["x-date"] = longDate
	headers["x-content-sha256"] = payloadHash

	canonicalHeaders, signedHeaders := canonicalizeHeaders(headers, p.SignedNames)
	canonicalRequest := strings.Join([]string{
		req.Method,
		canonicalURI(p.Path),
		canonicalQuery(p.Query),
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	}, "\n")

	scope := strings.Join([]string{shortDate, p.Region, p.Service, "request"}, "/")
	stringToSign := strings.Join([]string{
		arkSignAlgorithm,
		longDate,
		scope,
		hexSha256([]byte(canonicalRequest)),
	}, "\n")

	signingKey := deriveSigningKey(p.SK, shortDate, p.Region, p.Service)
	signature := hexHmacSha256(signingKey, []byte(stringToSign))

	req.Header.Set("Authorization", fmt.Sprintf(
		"%s Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		arkSignAlgorithm, p.AK, scope, signedHeaders, signature,
	))
}

// canonicalizeHeaders 输出规范头块与参与签名的头名列表（按头名排序）。
func canonicalizeHeaders(headers map[string]string, signedNames []string) (string, string) {
	names := make([]string, 0, len(signedNames))
	seen := make(map[string]bool, len(signedNames))
	for _, n := range signedNames {
		n = strings.ToLower(strings.TrimSpace(n))
		if n == "" || seen[n] {
			continue
		}
		seen[n] = true
		names = append(names, n)
	}
	sort.Strings(names)

	var b strings.Builder
	for _, n := range names {
		b.WriteString(n)
		b.WriteString(":")
		b.WriteString(headers[n])
		b.WriteString("\n")
	}
	return b.String(), strings.Join(names, ";")
}

// canonicalQuery 规范化 query（按 key 排序，值做 URL 编码）。
func canonicalQuery(q map[string]string) string {
	keys := make([]string, 0, len(q))
	for k := range q {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, canonicalEscape(k)+"="+canonicalEscape(q[k]))
	}
	return strings.Join(parts, "&")
}

// canonicalEscape 遵循 RFC3986 编码（保留字符全部转义）。
func canonicalEscape(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '_' || c == '.' || c == '~':
			b.WriteByte(c)
		default:
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

func canonicalURI(path string) string {
	if path == "" {
		return "/"
	}
	return path
}

// deriveSigningKey 派生签名密钥：HMAC(HMAC(HMAC(HMAC(sk,date),region),service),"request")。
func deriveSigningKey(sk, shortDate, region, service string) []byte {
	kDate := hmacSha256([]byte(sk), []byte(shortDate))
	kRegion := hmacSha256(kDate, []byte(region))
	kService := hmacSha256(kRegion, []byte(service))
	return hmacSha256(kService, []byte("request"))
}

func hmacSha256(key, data []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write(data)
	return mac.Sum(nil)
}

func hexHmacSha256(key, data []byte) string {
	return hex.EncodeToString(hmacSha256(key, data))
}

func hexSha256(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
