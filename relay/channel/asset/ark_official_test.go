package asset

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var fixedTime = time.Date(2026, 7, 16, 11, 13, 38, 0, time.UTC)

func officialConfig(endpoint string) ChannelConfig {
	return ChannelConfig{
		Settings: dto.ChannelOtherSettings{
			AssetUploadProtocol: dto.AssetUploadProtocolArkOfficial,
			AssetAK:             "AKLT-test",
			AssetSK:             "sk-test-secret",
			AssetGroupID:        "group-123",
			AssetProjectName:    "test-project",
		},
	}
}

func newOfficialProtocolForTest(endpoint string) *ArkOfficialProtocol {
	return &ArkOfficialProtocol{
		cfg:      officialConfig(endpoint),
		endpoint: endpoint,
		now:      func() time.Time { return fixedTime },
	}
}

func TestArkOfficialUpload(t *testing.T) {
	var gotQueryAction, gotQueryVersion, gotAuth, gotBody, gotXDate, gotSha256 string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQueryAction = r.URL.Query().Get("Action")
		gotQueryVersion = r.URL.Query().Get("Version")
		gotAuth = r.Header.Get("Authorization")
		gotXDate = r.Header.Get("X-Date")
		gotSha256 = r.Header.Get("X-Content-Sha256")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_, _ = w.Write([]byte(`{"ResponseMetadata":{"RequestId":"req-1"},"Result":{"Id":"asset-20260224200602-qn7wr"}}`))
	}))
	defer srv.Close()

	p := newOfficialProtocolForTest(srv.URL)
	res, err := p.Upload(UploadRequest{URL: "https://example.com/face.jpg", AssetType: model.AssetTypeImage, Name: "my-asset"})
	require.NoError(t, err)
	assert.Equal(t, "asset-20260224200602-qn7wr", res.AssetID)
	assert.Equal(t, "group-123", res.GroupID)
	assert.Equal(t, "test-project", res.ProjectName)

	assert.Equal(t, "CreateAsset", gotQueryAction)
	assert.Equal(t, "2024-01-01", gotQueryVersion)
	assert.Contains(t, gotBody, `"GroupId":"group-123"`)
	assert.Contains(t, gotBody, `"URL":"https://example.com/face.jpg"`)
	assert.Contains(t, gotBody, `"AssetType":"Image"`)
	// 上游火山要求 Name 必填，请求体必须透传
	assert.Contains(t, gotBody, `"Name":"my-asset"`)
	assert.Contains(t, gotBody, `"ProjectName":"test-project"`)

	assert.Equal(t, "20260716T111338Z", gotXDate)
	// body 哈希必须与请求体一致
	sum := sha256.Sum256([]byte(gotBody))
	assert.Equal(t, hex.EncodeToString(sum[:]), gotSha256)

	// 独立重算完整签名（含规范头块真实值），防止签名头块被空值化
	u, err := url.Parse(srv.URL)
	require.NoError(t, err)
	canonicalHeaders := "content-type:application/json\n" +
		"host:" + u.Host + "\n" +
		"x-content-sha256:" + gotSha256 + "\n" +
		"x-date:" + gotXDate + "\n"
	canonicalRequest := strings.Join([]string{
		"POST", "/", "Action=CreateAsset&Version=2024-01-01",
		canonicalHeaders, "content-type;host;x-content-sha256;x-date", gotSha256,
	}, "\n")
	stringToSign := strings.Join([]string{
		"HMAC-SHA256", gotXDate, "20260716/cn-beijing/ark/request",
		hexSha256([]byte(canonicalRequest)),
	}, "\n")
	wantSig := hexHmacSha256(deriveSigningKey("sk-test-secret", "20260716", "cn-beijing", "ark"), []byte(stringToSign))
	assert.Contains(t, gotAuth, "Signature="+wantSig)

	// Authorization 格式 + Credential scope
	re := regexp.MustCompile(`^HMAC-SHA256 Credential=AKLT-test/20260716/cn-beijing/ark/request, ` +
		`SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=[0-9a-f]{64}$`)
	assert.Regexp(t, re, gotAuth)
}

func TestArkOfficialSignatureDeterministic(t *testing.T) {
	// 固定输入下签名必须稳定可复现：用独立实现重算 string-to-sign 与签名比对。
	var gotAuths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuths = append(gotAuths, r.Header.Get("Authorization"))
		_, _ = w.Write([]byte(`{"ResponseMetadata":{},"Result":{"Id":"asset-x"}}`))
	}))
	defer srv.Close()

	p := newOfficialProtocolForTest(srv.URL)
	for i := 0; i < 2; i++ {
		_, err := p.Upload(UploadRequest{URL: "https://example.com/a.jpg", AssetType: model.AssetTypeImage})
		require.NoError(t, err)
	}
	require.Len(t, gotAuths, 2)
	assert.Equal(t, gotAuths[0], gotAuths[1], "相同输入签名必须一致")

	// 独立重算：固定 host/body/时间下推导签名密钥与 string-to-sign 必须与实现一致
	sk := "sk-test-secret"
	kDate := hmacSha256Test([]byte(sk), []byte("20260716"))
	kRegion := hmacSha256Test(kDate, []byte("cn-beijing"))
	kService := hmacSha256Test(kRegion, []byte("ark"))
	kSigning := hmacSha256Test(kService, []byte("request"))
	assert.Equal(t, deriveSigningKey(sk, "20260716", "cn-beijing", "ark"), kSigning)

	// SK 变化必须导致签名变化
	p2 := newOfficialProtocolForTest(srv.URL)
	p2.cfg.Settings.AssetSK = "another-secret"
	_, err := p2.Upload(UploadRequest{URL: "https://example.com/a.jpg", AssetType: model.AssetTypeImage})
	require.NoError(t, err)
	require.Len(t, gotAuths, 3)
	assert.NotEqual(t, gotAuths[0], gotAuths[2])
}

func hmacSha256Test(key, data []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write(data)
	return mac.Sum(nil)
}

func TestArkOfficialQueryAndError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "GetAsset", r.URL.Query().Get("Action"))
		b, _ := io.ReadAll(r.Body)
		assert.Contains(t, string(b), `"Id":"asset-x"`)
		_, _ = w.Write([]byte(`{"ResponseMetadata":{},"Result":{"Status":"Active","URL":"https://cdn.example.com/p.jpg"}}`))
	}))
	defer srv.Close()

	p := newOfficialProtocolForTest(srv.URL)
	res, err := p.Query("asset-x")
	require.NoError(t, err)
	assert.Equal(t, model.AssetStatusActive, res.Status)
	assert.Equal(t, "https://cdn.example.com/p.jpg", res.PreviewURL)

	// 上游返回 Error 时应报错
	errSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ResponseMetadata":{"Error":{"CodeN":1001,"Code":"InvalidAsset","Message":"asset not found"}},"Result":null}`))
	}))
	defer errSrv.Close()

	p2 := newOfficialProtocolForTest(errSrv.URL)
	_, err = p2.Query("asset-x")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "InvalidAsset")
	assert.Contains(t, err.Error(), "asset not found")
}

func TestArkOfficialMissingGroupIDAutoCreatesDefaultGroup(t *testing.T) {
	var actions []string
	bodies := map[string]string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		action := r.URL.Query().Get("Action")
		actions = append(actions, action)
		b, _ := io.ReadAll(r.Body)
		bodies[action] = string(b)
		switch action {
		case "CreateAssetGroup":
			_, _ = w.Write([]byte(`{"ResponseMetadata":{},"Result":{"Id":"group-auto-1"}}`))
		case "CreateAsset":
			_, _ = w.Write([]byte(`{"ResponseMetadata":{},"Result":{"Id":"asset-1"}}`))
		default:
			t.Errorf("unexpected action %q", action)
		}
	}))
	defer srv.Close()

	p := newOfficialProtocolForTest(srv.URL)
	p.cfg.Settings.AssetGroupID = ""
	res, err := p.Upload(UploadRequest{URL: "https://example.com/a.jpg", AssetType: model.AssetTypeImage})
	require.NoError(t, err)

	// 必须先建组再建素材，且素材落入自动创建的组
	require.Equal(t, []string{"CreateAssetGroup", "CreateAsset"}, actions)
	assert.Contains(t, bodies["CreateAssetGroup"], `"Name":"new-api-assets"`)
	assert.Contains(t, bodies["CreateAsset"], `"GroupId":"group-auto-1"`)
	assert.Equal(t, "group-auto-1", res.GroupID)
	assert.Equal(t, "group-auto-1", res.CreatedGroupID)

	// 填了字面量 "default" 同样视同未配置，走自动建组
	p2 := newOfficialProtocolForTest(srv.URL)
	p2.cfg.Settings.AssetGroupID = "default"
	res2, err2 := p2.Upload(UploadRequest{URL: "https://example.com/b.jpg", AssetType: model.AssetTypeImage})
	require.NoError(t, err2)
	assert.Equal(t, "group-auto-1", res2.GroupID)
	assert.Equal(t, "group-auto-1", res2.CreatedGroupID)
}

func TestCanonicalQueryAndEscape(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"abc-XYZ_0.~", "abc-XYZ_0.~"},
		{"a b", "a%20b"},
		{"a/b?c=d&e", "a%2Fb%3Fc%3Dd%26e"},
		{"中文", "%E4%B8%AD%E6%96%87"},
	}
	for _, tt := range tests {
		assert.Equal(t, tt.want, canonicalEscape(tt.in), "input=%q", tt.in)
	}

	q := map[string]string{"Version": "2024-01-01", "Action": "CreateAsset"}
	assert.Equal(t, "Action=CreateAsset&Version=2024-01-01", canonicalQuery(q))
}
