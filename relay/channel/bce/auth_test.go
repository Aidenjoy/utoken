package bce

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseAKSK(t *testing.T) {
	cred, err := ParseAKSK(" ak-123 | sk-456 ")
	require.NoError(t, err)
	assert.Equal(t, "ak-123", cred.AK)
	assert.Equal(t, "sk-456", cred.SK)

	// 全角竖线兼容
	cred, err = ParseAKSK("ak｜sk")
	require.NoError(t, err)
	assert.Equal(t, "ak", cred.AK)
	assert.Equal(t, "sk", cred.SK)

	for _, bad := range []string{"", "onlykey", "a|b|c", "|sk", "ak|"} {
		_, err := ParseAKSK(bad)
		assert.Error(t, err, "input %q should be rejected", bad)
	}
}

func TestNormalizeValue(t *testing.T) {
	// RFC3986 safe 字符 -_.~ 不编码
	assert.Equal(t, "2024-01-01", NormalizeValue("2024-01-01"))
	assert.Equal(t, "a-b_c.d~e", NormalizeValue("a-b_c.d~e"))
	// 空格与特殊字符按 percent-encoding
	assert.Equal(t, "a%20b", NormalizeValue("a b"))
	assert.Equal(t, "x%2Fy", NormalizeValue("x/y"))
	// 已编码输入先解码再编码，结果一致
	assert.Equal(t, "a%20b", NormalizeValue("a%20b"))
	// "+" 不是空格（Python unquote 语义），按字面编码
	assert.Equal(t, "a%2Bb", NormalizeValue("a+b"))
}

func TestCanonicalQuerySortedAndEncoded(t *testing.T) {
	// 按 key=value 排序；空表返回空串（规范化请求保留空行）
	assert.Equal(t, "", CanonicalQuery(nil))
	assert.Equal(t, "Action=GetAsset&Version=2024-01-01", CanonicalQuery(map[string]string{
		"Version": "2024-01-01",
		"Action":  "GetAsset",
	}))
}

func TestSignRequestHeadersAndSignature(t *testing.T) {
	req, err := http.NewRequest(http.MethodPost,
		"http://databuilder.bd.baidubce.com/db-ms/seedance/material/?Action=CreateAsset&Version=2024-01-01", nil)
	require.NoError(t, err)

	now := time.Date(2026, 7, 28, 8, 0, 0, 0, time.UTC)
	cred := Credentials{AK: "test-ak", SK: "test-sk"}
	SignRequest(req, cred, "", map[string]string{
		"Action":  "CreateAsset",
		"Version": "2024-01-01",
	}, now)

	// 测试内独立重算 HMAC 链（不复用被测代码的私有函数），锁定手册规定的算法：
	// signingKey = HMAC(authPrefix, SK)，signature = HMAC(canonicalRequest, signingKey)
	hmacHex := func(msg, key string) string {
		m := hmac.New(sha256.New, []byte(key))
		m.Write([]byte(msg))
		return hex.EncodeToString(m.Sum(nil))
	}
	authPrefix := "bce-auth-v1/test-ak/2026-07-28T08:00:00Z/1800"
	canonicalRequest := "POST\n/db-ms/seedance/material/\nAction=CreateAsset&Version=2024-01-01\nhost:databuilder.bd.baidubce.com"
	wantSignature := hmacHex(canonicalRequest, hmacHex(authPrefix, "test-sk"))

	assert.Equal(t, authPrefix+"/host/"+wantSignature, req.Header.Get("Authorization"))
	assert.Equal(t, "2026-07-28T08:00:00Z", req.Header.Get("X-Bce-Date"))
	assert.Equal(t, "bd", req.Header.Get("X-Region"))
	assert.Equal(t, "api-gateway", req.Header.Get("X-Via"))
	assert.NotEmpty(t, req.Header.Get("X-Bce-Request-Id"))
	assert.Equal(t, "databuilder.bd.baidubce.com", req.Host)
}

func TestSignRequestEmptyQueryKeepsEmptyLine(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet,
		"http://databuilder.bd.baidubce.com/db-ms/seedance/api/v3/contents/generations/tasks/task-1", nil)
	require.NoError(t, err)

	now := time.Date(2026, 7, 28, 8, 0, 0, 0, time.UTC)
	SignRequest(req, Credentials{AK: "ak", SK: "sk"}, "", nil, now)

	hmacHex := func(msg, key string) string {
		m := hmac.New(sha256.New, []byte(key))
		m.Write([]byte(msg))
		return hex.EncodeToString(m.Sum(nil))
	}
	authPrefix := "bce-auth-v1/ak/2026-07-28T08:00:00Z/1800"
	// 空 Query 仍保留空行（第三行为空）
	canonicalRequest := "GET\n/db-ms/seedance/api/v3/contents/generations/tasks/task-1\n\nhost:databuilder.bd.baidubce.com"
	want := authPrefix + "/host/" + hmacHex(canonicalRequest, hmacHex(authPrefix, "sk"))
	assert.Equal(t, want, req.Header.Get("Authorization"))
}
