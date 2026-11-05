package asset

import (
	"bytes"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 服务端 V4 验签的确定性回归：用客户端 signRequest 对固定 AK/SK/body/时间签名，
// 再用 verifyV4Request（注入固定 now）验签，保护「合法签名通过 + 篡改/过期/错钥被拒」
// 这组真实不变量。全部表驱动、无随机、无网络。

const (
	testAK   = "AKUTTESTTESTTESTTEST00"
	testSK   = "test-secret-key-0123456789abcdefghij"
	testHost = "ark.example.com"
)

var (
	testNow   = time.Date(2026, 7, 16, 3, 13, 38, 0, time.UTC)
	testQuery = map[string]string{"Action": "ListAssets", "Version": "2024-01-01"}
	testRaw   = "Action=ListAssets&Version=2024-01-01"
	testBody  = []byte(`{"Filter":{"Statuses":["Active"]},"MaxResults":20}`)
)

// signTestRequest 用固定参数签一个入站请求，并把 Host 写入 header（Go 服务端 Host
// 在 Request.Host 而非 Header，验签按 SignedHeaders 从 header 取 host，故须显式写入）。
func signTestRequest(t *testing.T, body []byte, now time.Time) *http.Request {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, "https://"+testHost+"/?"+testRaw, bytes.NewReader(body))
	require.NoError(t, err)
	req.Host = testHost
	signRequest(req, signParams{
		AK: testAK, SK: testSK, Region: "cn-beijing", Service: "ark",
		Host: testHost, Path: "/", Query: testQuery,
		Headers:     http.Header{},
		Body:        body,
		Now:         now,
		SignedNames: []string{"host", "x-content-sha256", "x-date"},
	})
	req.Header.Set("Host", testHost)
	return req
}

func lookupTestSK(sk string) func(string) (string, bool) {
	return func(ak string) (string, bool) {
		if ak == testAK {
			return sk, true
		}
		return "", false
	}
}

func TestVerifyV4Request(t *testing.T) {
	t.Run("valid signature passes and returns AK", func(t *testing.T) {
		req := signTestRequest(t, testBody, testNow)
		ak, err := verifyV4Request(http.MethodPost, "/", testRaw, req.Header, testBody, lookupTestSK(testSK), testNow)
		require.NoError(t, err)
		assert.Equal(t, testAK, ak)
	})

	t.Run("tampered body is rejected", func(t *testing.T) {
		req := signTestRequest(t, testBody, testNow)
		tampered := []byte(`{"Filter":{"Statuses":["Failed"]},"MaxResults":20}`)
		ak, err := verifyV4Request(http.MethodPost, "/", testRaw, req.Header, tampered, lookupTestSK(testSK), testNow)
		assert.ErrorIs(t, err, ErrSignatureDoesNotMatch)
		assert.Equal(t, testAK, ak)
	})

	t.Run("expired X-Date is rejected", func(t *testing.T) {
		req := signTestRequest(t, testBody, testNow)
		// 服务器时间比签名时间晚 20 分钟（> ±15 分钟窗口）。
		ak, err := verifyV4Request(http.MethodPost, "/", testRaw, req.Header, testBody, lookupTestSK(testSK), testNow.Add(20*time.Minute))
		assert.ErrorIs(t, err, ErrRequestExpired)
		assert.Equal(t, testAK, ak)
	})

	t.Run("future X-Date beyond window is rejected", func(t *testing.T) {
		req := signTestRequest(t, testBody, testNow)
		_, err := verifyV4Request(http.MethodPost, "/", testRaw, req.Header, testBody, lookupTestSK(testSK), testNow.Add(-20*time.Minute))
		assert.ErrorIs(t, err, ErrRequestExpired)
	})

	t.Run("within clock skew window passes", func(t *testing.T) {
		req := signTestRequest(t, testBody, testNow)
		_, err := verifyV4Request(http.MethodPost, "/", testRaw, req.Header, testBody, lookupTestSK(testSK), testNow.Add(5*time.Minute))
		assert.NoError(t, err)
	})

	t.Run("wrong secret key is rejected", func(t *testing.T) {
		req := signTestRequest(t, testBody, testNow)
		_, err := verifyV4Request(http.MethodPost, "/", testRaw, req.Header, testBody, lookupTestSK("a-completely-different-secret-key-xxxx"), testNow)
		assert.ErrorIs(t, err, ErrSignatureDoesNotMatch)
	})

	t.Run("unknown access key is rejected", func(t *testing.T) {
		req := signTestRequest(t, testBody, testNow)
		// lookupSK 对任何 AK 都返回不存在。
		_, err := verifyV4Request(http.MethodPost, "/", testRaw, req.Header, testBody, func(string) (string, bool) { return "", false }, testNow)
		assert.ErrorIs(t, err, ErrInvalidAccessKey)
	})

	t.Run("missing authorization header is rejected", func(t *testing.T) {
		header := http.Header{}
		header.Set("X-Date", testNow.Format(arkSignTimeFmt))
		_, err := verifyV4Request(http.MethodPost, "/", testRaw, header, testBody, lookupTestSK(testSK), testNow)
		assert.ErrorIs(t, err, ErrMissingAuthorization)
	})

	t.Run("missing X-Date is rejected", func(t *testing.T) {
		req := signTestRequest(t, testBody, testNow)
		req.Header.Del("X-Date")
		_, err := verifyV4Request(http.MethodPost, "/", testRaw, req.Header, testBody, lookupTestSK(testSK), testNow)
		assert.ErrorIs(t, err, ErrMissingDate)
	})

	t.Run("tampered query is rejected", func(t *testing.T) {
		req := signTestRequest(t, testBody, testNow)
		// 验签时 query 被改成另一个 Action，规范请求不一致 → 签名不匹配。
		_, err := verifyV4Request(http.MethodPost, "/", "Action=GetAsset&Version=2024-01-01", req.Header, testBody, lookupTestSK(testSK), testNow)
		assert.ErrorIs(t, err, ErrSignatureDoesNotMatch)
	})
}

// TestParseAuthorizationRegion 中间件用解析出的 region 回填响应信封。
func TestParseAuthorizationRegion(t *testing.T) {
	req := signTestRequest(t, testBody, testNow)
	assert.Equal(t, "cn-beijing", ParseAuthorizationRegion(req.Header.Get("Authorization")))
	assert.Empty(t, ParseAuthorizationRegion("garbage"))
	assert.Empty(t, ParseAuthorizationRegion(""))
}
