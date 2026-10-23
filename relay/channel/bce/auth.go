// Package bce 实现百度智能云 BCE Auth V1 签名（DataBuilder 模型服务专用形态）。
//
// 与标准 BCE SDK 签名的差异（严格按《DataBuilder模型服务使用手册》）：
//   - 规范化请求只签 host 一个头：METHOD\nPATH\nCANONICAL_QUERY\nhost:{sign_host}
//   - signingKey = HMAC-SHA256(key=SK, msg=authPrefix)（hex 字符串再作下一轮 key）
//   - Authorization: {authPrefix}/host/{signature}
//   - 需附带 X-Region / X-Via: api-gateway / X-Bce-Request-Id 网关头
//
// 视频任务接口与素材库接口共用本包，任务适配器与素材协议各自持有 AK/SK。
package bce

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

// DefaultRegion DataBuilder 服务固定部署在 bd 地域。
const DefaultRegion = "bd"

// DefaultExpirationSeconds 手册默认签名有效期。
const DefaultExpirationSeconds = 1800

// Credentials BCE AK/SK 凭据对。
type Credentials struct {
	AK string
	SK string
}

// ParseAKSK 解析 "AK|SK" 格式的渠道密钥（与 jimeng 渠道先例一致），
// 兼容全角竖线与首尾空白。
func ParseAKSK(key string) (Credentials, error) {
	parts := strings.Split(strings.ReplaceAll(strings.TrimSpace(key), "｜", "|"), "|")
	if len(parts) != 2 {
		return Credentials{}, fmt.Errorf("invalid api key format for baidu databuilder: expected 'ak|sk'")
	}
	ak := strings.TrimSpace(parts[0])
	sk := strings.TrimSpace(parts[1])
	if ak == "" || sk == "" {
		return Credentials{}, fmt.Errorf("invalid api key format for baidu databuilder: empty ak or sk")
	}
	return Credentials{AK: ak, SK: sk}, nil
}

// NormalizeValue 对参与签名的 query 参数值做规范化编码：
// 先 unquote 再 quote（safe="-_.~"），与官方 Python 示例的 normalize() 等价，
// 保证已编码/未编码输入产生一致的签名串。
func NormalizeValue(value string) string {
	// PathUnescape 与 Python unquote 一致：不把 "+" 解码成空格
	decoded, err := url.PathUnescape(value)
	if err != nil {
		// 含非法 % 序列时按原文编码（与 Python unquote 的容错行为一致）
		decoded = value
	}
	encoded := url.QueryEscape(decoded)
	// QueryEscape 面向 form 编码：空格转 +、~ 转 %7E；BCE 要求 RFC3986（safe=-_.~）
	encoded = strings.ReplaceAll(encoded, "+", "%20")
	encoded = strings.ReplaceAll(encoded, "%7E", "~")
	return encoded
}

// CanonicalQuery 把 query 参数表转成规范化查询串：按 "key=value" 排序、值规范化编码。
// 空表返回空串（规范化请求中仍保留空行）。
func CanonicalQuery(query map[string]string) string {
	if len(query) == 0 {
		return ""
	}
	params := make([]string, 0, len(query))
	for k, v := range query {
		params = append(params, k+"="+NormalizeValue(v))
	}
	sort.Strings(params)
	return strings.Join(params, "&")
}

func hmacSHA256Hex(message, key string) string {
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(message))
	return hex.EncodeToString(mac.Sum(nil))
}

// SignRequest 按 BCE Auth V1（DataBuilder 形态）给请求签名并写入全部必需头：
// Authorization / Host / X-Bce-Date / X-Region / X-Via / X-Bce-Request-Id。
//
// signHost 为空时取 req.URL.Host（不带端口）；query 必须是构造 req.URL.RawQuery
// 时使用的同一份参数表，否则签名与实际请求不一致。Content-Type/Accept 由调用方
// 按接口自行设置（不参与签名）。now 为空时使用当前 UTC 时间。
func SignRequest(req *http.Request, cred Credentials, signHost string, query map[string]string, now time.Time) {
	if signHost == "" {
		signHost = req.URL.Hostname()
	}
	if now.IsZero() {
		now = time.Now()
	}
	requestDate := now.UTC().Format(time.RFC3339)

	canonicalRequest := strings.Join([]string{
		strings.ToUpper(req.Method),
		req.URL.Path,
		CanonicalQuery(query),
		"host:" + signHost,
	}, "\n")
	authPrefix := strings.Join([]string{
		"bce-auth-v1", cred.AK, requestDate, fmt.Sprintf("%d", DefaultExpirationSeconds),
	}, "/")
	signingKey := hmacSHA256Hex(authPrefix, cred.SK)
	signature := hmacSHA256Hex(canonicalRequest, signingKey)

	req.Header.Set("Authorization", authPrefix+"/host/"+signature)
	req.Header.Set("X-Bce-Date", requestDate)
	req.Header.Set("X-Region", DefaultRegion)
	req.Header.Set("X-Via", "api-gateway")
	req.Header.Set("X-Bce-Request-Id", uuid.NewString())
	// Host 头必须与签名值一致（经网关转发时 URL host 可能与签名 host 不同）
	req.Host = signHost
}
