package asset

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var dbFixedTime = time.Date(2026, 7, 28, 8, 0, 0, 0, time.UTC)

func dbTestConfig() ChannelConfig {
	return ChannelConfig{
		BaseURL: "",
		Settings: dto.ChannelOtherSettings{
			AssetUploadProtocol: dto.AssetUploadProtocolBaiduDataBuilder,
			AssetAK:             "db-ak",
			AssetSK:             "db-sk",
		},
	}
}

// newDBProtocolForTest 直连测试服务器的 DataBuilder 素材协议（固定时间源）。
func newDBProtocolForTest(t *testing.T, endpoint string, cfg ChannelConfig) *BaiduDataBuilderProtocol {
	t.Helper()
	p, err := newBaiduDataBuilderProtocol(cfg)
	require.NoError(t, err)
	p.endpoint = strings.TrimSuffix(endpoint, "/") + "/db-ms/seedance/material"
	p.now = func() time.Time { return dbFixedTime }
	return p
}

func TestBaiduDataBuilderCredentialSources(t *testing.T) {
	// asset_ak/asset_sk 优先
	p, err := newBaiduDataBuilderProtocol(ChannelConfig{
		BaseURL: "",
		ApiKey:  "key-ak|key-sk",
		Settings: dto.ChannelOtherSettings{
			AssetUploadProtocol: dto.AssetUploadProtocolBaiduDataBuilder,
			AssetAK:             "db-ak",
			AssetSK:             "db-sk",
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "db-ak", p.cred.AK)
	assert.Equal(t, "db-sk", p.cred.SK)
	assert.Equal(t, "default", p.projectName)
	assert.Equal(t, "http://databuilder.bd.baidubce.com/db-ms/seedance/material", p.endpoint)

	// 未配置 asset_ak/sk 时回落渠道密钥 "AK|SK"
	p, err = newBaiduDataBuilderProtocol(ChannelConfig{
		BaseURL: "http://databuilder.bd.baidubce.com",
		ApiKey:  "key-ak|key-sk",
		Settings: dto.ChannelOtherSettings{
			AssetUploadProtocol: dto.AssetUploadProtocolBaiduDataBuilder,
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "key-ak", p.cred.AK)
	assert.Equal(t, "key-sk", p.cred.SK)

	// 两处都拿不到 AK/SK 时构造失败
	_, err = newBaiduDataBuilderProtocol(ChannelConfig{
		ApiKey:   "plain-key",
		Settings: dto.ChannelOtherSettings{AssetUploadProtocol: dto.AssetUploadProtocolBaiduDataBuilder},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "ak|sk")
}

func TestBaiduDataBuilderUploadAutoCreatesGroup(t *testing.T) {
	type callRecord struct {
		action string
		body   string
		auth   string
	}
	var calls []callRecord
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		calls = append(calls, callRecord{
			action: r.URL.Query().Get("Action"),
			body:   string(b),
			auth:   r.Header.Get("Authorization"),
		})
		assert.Equal(t, "2024-01-01", r.URL.Query().Get("Version"))
		assert.Equal(t, "bd", r.Header.Get("X-Region"))
		assert.Equal(t, "api-gateway", r.Header.Get("X-Via"))
		assert.NotEmpty(t, r.Header.Get("X-Bce-Request-Id"))
		switch r.URL.Query().Get("Action") {
		case "CreateAssetGroup":
			_, _ = w.Write([]byte(`{"ResponseMetadata":{},"Result":{"Id":"group-db-1"}}`))
		case "CreateAsset":
			_, _ = w.Write([]byte(`{"ResponseMetadata":{},"Result":{"Id":"asset-db-1"}}`))
		default:
			w.WriteHeader(http.StatusBadRequest)
		}
	}))
	defer srv.Close()

	p := newDBProtocolForTest(t, srv.URL, dbTestConfig())
	res, err := p.Upload(UploadRequest{URL: "https://example.com/face.jpg", AssetType: model.AssetTypeImage, Name: "my-asset"})
	require.NoError(t, err)
	assert.Equal(t, "asset-db-1", res.AssetID)
	assert.Equal(t, "group-db-1", res.GroupID)
	assert.Equal(t, "group-db-1", res.CreatedGroupID)
	assert.Equal(t, "default", res.ProjectName)

	require.Len(t, calls, 2)
	assert.Equal(t, "CreateAssetGroup", calls[0].action)
	assert.Contains(t, calls[0].body, `"GroupType":"AIGC"`)
	assert.Contains(t, calls[0].body, `"ProjectName":"default"`)
	assert.Equal(t, "CreateAsset", calls[1].action)
	assert.Contains(t, calls[1].body, `"GroupId":"group-db-1"`)
	assert.Contains(t, calls[1].body, `"URL":"https://example.com/face.jpg"`)
	assert.Contains(t, calls[1].body, `"AssetType":"Image"`)
	assert.Contains(t, calls[1].body, `"Name":"my-asset"`)

	// 独立重算 BCE 签名（手册算法），锁定 Authorization 值
	u, err := url.Parse(srv.URL)
	require.NoError(t, err)
	hmacHex := func(msg, key string) string {
		m := hmac.New(sha256.New, []byte(key))
		m.Write([]byte(msg))
		return hex.EncodeToString(m.Sum(nil))
	}
	authPrefix := "bce-auth-v1/db-ak/2026-07-28T08:00:00Z/1800"
	canonicalRequest := "POST\n/db-ms/seedance/material/\nAction=CreateAssetGroup&Version=2024-01-01\nhost:" + u.Hostname()
	wantSig := hmacHex(canonicalRequest, hmacHex(authPrefix, "db-sk"))
	assert.Equal(t, authPrefix+"/host/"+wantSig, calls[0].auth)
}

func TestBaiduDataBuilderUploadUsesConfiguredGroup(t *testing.T) {
	var actions []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		actions = append(actions, r.URL.Query().Get("Action"))
		_, _ = w.Write([]byte(`{"ResponseMetadata":{},"Result":{"Id":"asset-db-2"}}`))
	}))
	defer srv.Close()

	cfg := dbTestConfig()
	cfg.Settings.AssetGroupID = "group-cfg"
	cfg.Settings.AssetProjectName = "proj-x"
	p := newDBProtocolForTest(t, srv.URL, cfg)
	res, err := p.Upload(UploadRequest{URL: "https://example.com/a.jpg", AssetType: model.AssetTypeImage})
	require.NoError(t, err)
	assert.Equal(t, []string{"CreateAsset"}, actions)
	assert.Equal(t, "asset-db-2", res.AssetID)
	assert.Equal(t, "group-cfg", res.GroupID)
	assert.Equal(t, "proj-x", res.ProjectName)
	assert.Empty(t, res.CreatedGroupID)
}

func TestBaiduDataBuilderUploadAcceptsFlatResponse(t *testing.T) {
	// 网关可能不带 ResponseMetadata/Result 信封，直接返回结果对象
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"AssetId":"asset-flat-1"}`))
	}))
	defer srv.Close()

	cfg := dbTestConfig()
	cfg.Settings.AssetGroupID = "group-cfg"
	p := newDBProtocolForTest(t, srv.URL, cfg)
	res, err := p.Upload(UploadRequest{URL: "https://example.com/a.jpg", AssetType: model.AssetTypeImage})
	require.NoError(t, err)
	assert.Equal(t, "asset-flat-1", res.AssetID)
}

func TestBaiduDataBuilderQueryStatusNormalization(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "GetAsset", r.URL.Query().Get("Action"))
		b, _ := io.ReadAll(r.Body)
		assert.Contains(t, string(b), `"Id":"asset-1"`)
		assert.Contains(t, string(b), `"ProjectName":"default"`)
		_, _ = w.Write([]byte(`{"ResponseMetadata":{},"Result":{"Status":"ACTIVE","URL":"https://cdn/x.mp4"}}`))
	}))
	defer srv.Close()

	p := newDBProtocolForTest(t, srv.URL, dbTestConfig())
	res, err := p.Query("asset-1")
	require.NoError(t, err)
	assert.Equal(t, model.AssetStatusActive, res.Status)
	assert.Equal(t, "https://cdn/x.mp4", res.PreviewURL)
	assert.Empty(t, res.ErrorMsg)
}

func TestBaiduDataBuilderQueryTerminalErrorBecomesFailed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// HTTP 200 但信封携带 C400 系业务错误：终端错误，素材应标记 failed
		_, _ = w.Write([]byte(`{"ResponseMetadata":{"Error":{"Code":"C400999","Message":"Frame rate must be between 23.8 FPS and 60 FPS."}}}`))
	}))
	defer srv.Close()

	p := newDBProtocolForTest(t, srv.URL, dbTestConfig())
	res, err := p.Query("asset-bad")
	require.NoError(t, err)
	assert.Equal(t, model.AssetStatusFailed, res.Status)
	assert.Equal(t, "Frame rate must be between 23.8 FPS and 60 FPS.", res.ErrorMsg)
}

func TestBaiduDataBuilderQueryHTTPErrorPropagates(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":{"message":"signature does not match"}}`))
	}))
	defer srv.Close()

	p := newDBProtocolForTest(t, srv.URL, dbTestConfig())
	_, err := p.Query("asset-1")
	require.Error(t, err)
	var upErr *UpstreamError
	require.ErrorAs(t, err, &upErr)
	assert.Equal(t, http.StatusForbidden, upErr.Status)
	assert.Equal(t, "signature does not match", upErr.Message)
	assert.False(t, upErr.Terminal(), "403 属可重试错误，素材应保持 pending")
}
