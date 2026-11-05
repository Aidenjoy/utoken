package asset

import (
	"crypto/hmac"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// 服务端 V4 验签：复用 sign.go 的客户端签名原语（同包未导出函数），
// 对入站请求按火山方舟 V4 规范重算签名并做常量时间比较。

// verifyMaxClockSkew X-Date 与服务器时间的最大允许偏差（防重放）。
const verifyMaxClockSkew = 15 * time.Minute

// VerifyError V4 验签失败的导出错误类型，携带官方错误码与消息，
// 供鉴权中间件映射成 ResponseMetadata.Error。
type VerifyError struct {
	Code    string
	Message string
}

func (e *VerifyError) Error() string { return e.Code + ": " + e.Message }

// 预定义验签错误（错误码对齐火山官方语义）。
var (
	ErrMissingAuthorization   = &VerifyError{Code: "InvalidAuthorization", Message: "missing Authorization header"}
	ErrMalformedAuthorization = &VerifyError{Code: "InvalidAuthorization", Message: "malformed Authorization header"}
	ErrInvalidAccessKey       = &VerifyError{Code: "InvalidAccessKeyId", Message: "the access key id provided does not exist in our records"}
	ErrMissingDate            = &VerifyError{Code: "InvalidRequest", Message: "the X-Date header is required"}
	ErrMalformedDate          = &VerifyError{Code: "InvalidRequest", Message: "the X-Date header is not in 20060102T150405Z format"}
	ErrRequestExpired         = &VerifyError{Code: "RequestExpired", Message: "the request time is out of the valid window"}
	ErrSignatureDoesNotMatch  = &VerifyError{Code: "SignatureDoesNotMatch", Message: "the request signature we calculated does not match the signature you provided"}
)

// authParts 解析后的 Authorization 头各字段。
type authParts struct {
	ak            string
	shortDate     string
	region        string
	service       string
	signedHeaders string
	signature     string
}

// parseAuthorization 解析 `HMAC-SHA256 Credential=<AK>/<date>/<region>/<service>/request,
// SignedHeaders=..., Signature=...`。格式非法返回对应 VerifyError。
func parseAuthorization(auth string) (*authParts, error) {
	if strings.TrimSpace(auth) == "" {
		return nil, ErrMissingAuthorization
	}
	prefix := arkSignAlgorithm + " "
	if !strings.HasPrefix(auth, prefix) {
		return nil, ErrMalformedAuthorization
	}
	p := &authParts{}
	for _, part := range strings.Split(strings.TrimPrefix(auth, prefix), ",") {
		part = strings.TrimSpace(part)
		switch {
		case strings.HasPrefix(part, "Credential="):
			cred := strings.Split(strings.TrimPrefix(part, "Credential="), "/")
			if len(cred) != 5 || cred[4] != "request" {
				return nil, ErrMalformedAuthorization
			}
			p.ak, p.shortDate, p.region, p.service = cred[0], cred[1], cred[2], cred[3]
		case strings.HasPrefix(part, "SignedHeaders="):
			p.signedHeaders = strings.TrimPrefix(part, "SignedHeaders=")
		case strings.HasPrefix(part, "Signature="):
			p.signature = strings.TrimPrefix(part, "Signature=")
		}
	}
	if p.ak == "" || p.signedHeaders == "" || p.signature == "" {
		return nil, ErrMalformedAuthorization
	}
	return p, nil
}

// ParseAuthorizationRegion 从 Authorization 头解析 region（供中间件回填响应信封的 Region）。
// 解析失败返回空串，由调用方取缺省值。
func ParseAuthorizationRegion(authHeader string) string {
	p, err := parseAuthorization(authHeader)
	if err != nil {
		return ""
	}
	return p.region
}

// VerifyV4Request 校验入站请求的火山 V4 签名，成功返回解析出的 AK。
// lookupSK 按 AK 返回 SK（ok=false 表示 AK 不存在）。
// host 从 header.Get("Host") 取——Go 服务端把 Host 放在 Request.Host 而非 Header，
// 故调用方须先把 Request.Host 写入所传 header（中间件已处理）。
func VerifyV4Request(method, path, rawQuery string, header http.Header, body []byte,
	lookupSK func(ak string) (sk string, ok bool)) (string, error) {
	return verifyV4Request(method, path, rawQuery, header, body, lookupSK, time.Now().UTC())
}

// verifyV4Request 带 now 注入的内部实现，供测试做确定性验签断言（含过期用例）。
func verifyV4Request(method, path, rawQuery string, header http.Header, body []byte,
	lookupSK func(ak string) (sk string, ok bool), now time.Time) (string, error) {
	parts, err := parseAuthorization(header.Get("Authorization"))
	if err != nil {
		return "", err
	}
	ak := parts.ak

	sk, ok := lookupSK(ak)
	if !ok || strings.TrimSpace(sk) == "" {
		return ak, ErrInvalidAccessKey
	}

	// X-Date 时效校验（防重放）：与服务器时间偏差超过 ±15 分钟即拒绝。
	xDate := strings.TrimSpace(header.Get("X-Date"))
	if xDate == "" {
		return ak, ErrMissingDate
	}
	reqTime, perr := time.Parse(arkSignTimeFmt, xDate)
	if perr != nil {
		return ak, ErrMalformedDate
	}
	skew := now.Sub(reqTime)
	if skew < 0 {
		skew = -skew
	}
	if skew > verifyMaxClockSkew {
		return ak, ErrRequestExpired
	}

	// body 完整性校验：X-Content-Sha256 必须等于实际 body 的 sha256，否则视为篡改。
	payloadHash := hexSha256(body)
	if got := strings.TrimSpace(header.Get("X-Content-Sha256")); got == "" || !strings.EqualFold(got, payloadHash) {
		return ak, ErrSignatureDoesNotMatch
	}

	// 按 SignedHeaders 从请求头重建规范头（host 单独取，其余按小写头名取值）。
	names := strings.Split(parts.signedHeaders, ";")
	headerMap := make(map[string]string, len(names))
	for _, name := range names {
		name = strings.ToLower(strings.TrimSpace(name))
		if name == "" {
			continue
		}
		headerMap[name] = strings.TrimSpace(header.Get(name))
	}
	canonicalHeaders, signedHeaders := canonicalizeHeaders(headerMap, names)

	// canonicalQuery 由 rawQuery 解析为单值 map（素材 API 仅 Action/Version）。
	values, qerr := url.ParseQuery(rawQuery)
	if qerr != nil {
		return ak, ErrMalformedAuthorization
	}
	queryMap := make(map[string]string, len(values))
	for k, v := range values {
		if len(v) > 0 {
			queryMap[k] = v[0]
		}
	}

	canonicalRequest := strings.Join([]string{
		strings.ToUpper(method),
		canonicalURI(path),
		canonicalQuery(queryMap),
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	}, "\n")

	scope := strings.Join([]string{parts.shortDate, parts.region, parts.service, "request"}, "/")
	stringToSign := strings.Join([]string{
		arkSignAlgorithm,
		xDate,
		scope,
		hexSha256([]byte(canonicalRequest)),
	}, "\n")

	signingKey := deriveSigningKey(sk, parts.shortDate, parts.region, parts.service)
	expected := hexHmacSha256(signingKey, []byte(stringToSign))
	if !hmac.Equal([]byte(expected), []byte(strings.ToLower(strings.TrimSpace(parts.signature)))) {
		return ak, ErrSignatureDoesNotMatch
	}
	return ak, nil
}
