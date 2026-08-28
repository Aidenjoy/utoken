package asset

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func ecloudConfig() ChannelConfig {
	return ChannelConfig{
		Settings: dto.ChannelOtherSettings{
			AssetUploadProtocol: dto.AssetUploadProtocolEcloud,
			AssetAK:             "testid",
			AssetSK:             "testsecret",
			AssetGroupID:        "group-20260731170706-sbjbr",
		},
	}
}

func newEcloudProtocolForTest(endpoint string) *EcloudOfficialProtocol {
	return &EcloudOfficialProtocol{
		cfg:      ecloudConfig(),
		endpoint: endpoint,
		now:      func() time.Time { return fixedTime },
	}
}

// TestSignEcloudRequestMatchesOfficialExample 用移动云《通用签名机制》文档中的
// 官方示例（AK=testid/SK=testsecret，GET /api/keypair）校验签名算法实现。
func TestSignEcloudRequestMatchesOfficialExample(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "https://ecloud.10086.cn/api/keypair", nil)
	require.NoError(t, err)
	signEcloudRequest(req, ecloudSignParams{
		AK:    "testid",
		SK:    "testsecret",
		Path:  "/api/keypair",
		Now:   time.Date(2017, 1, 11, 15, 15, 11, 0, time.UTC),
		Nonce: "9d81ffbeaaf7477390db5df577bb3299",
	})

	q := req.URL.Query()
	assert.Equal(t, "2976158792407a581305786b2a82c56d9b007362", q.Get("Signature"))
	assert.Equal(t, "testid", q.Get("AccessKey"))
	assert.Equal(t, "2017-01-11T15%3A15%3A11Z", url.QueryEscape(q.Get("Timestamp")))
	assert.Equal(t, "HmacSHA1", q.Get("SignatureMethod"))
	assert.Equal(t, "V2.0", q.Get("SignatureVersion"))
}

func TestEcloudUpload(t *testing.T) {
	var gotMethod, gotPath, gotContentType, gotBody string
	var gotQuery url.Values
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotContentType = r.Header.Get("Content-Type")
		gotQuery = r.URL.Query()
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_, _ = w.Write([]byte(`{"requestId":"req-1","state":"OK","errorCode":"","errorMessage":"","body":"asset-20260731170718-dbnvv"}`))
	}))
	defer srv.Close()

	p := newEcloudProtocolForTest(srv.URL)
	res, err := p.Upload(UploadRequest{URL: "https://example.com/test.mp4", AssetType: model.AssetTypeVideo, Name: "产品介绍视频"})
	require.NoError(t, err)
	assert.Equal(t, "asset-20260731170718-dbnvv", res.AssetID)
	assert.Equal(t, "group-20260731170706-sbjbr", res.GroupID)

	assert.Equal(t, http.MethodPost, gotMethod)
	assert.Equal(t, "/api/openapi-maas/exp/aicc/v2/asset", gotPath)
	assert.Equal(t, "application/json", gotContentType)
	assert.Contains(t, gotBody, `"groupId":"group-20260731170706-sbjbr"`)
	assert.Contains(t, gotBody, `"assetName":"产品介绍视频"`)
	assert.Contains(t, gotBody, `"assetUrl":"https://example.com/test.mp4"`)
	assert.Contains(t, gotBody, `"assetType":"Video"`)

	// 签名公共参数齐全，且 Signature 可被独立重算
	for _, name := range []string{"Version", "AccessKey", "Timestamp", "SignatureMethod", "SignatureVersion", "SignatureNonce", "Signature"} {
		assert.NotEmpty(t, gotQuery.Get(name), "missing query param %s", name)
	}
	assert.Equal(t, fixedTime.Format("2006-01-02T15:04:05Z"), gotQuery.Get("Timestamp"))
	signed := map[string]string{}
	for k, v := range gotQuery {
		if k != "Signature" && len(v) > 0 {
			signed[k] = v[0]
		}
	}
	stringToSign := strings.Join([]string{
		http.MethodPost,
		canonicalEscape("/api/openapi-maas/exp/aicc/v2/asset"),
		hexSha256([]byte(canonicalQuery(signed))),
	}, "\n")
	mac := hmac.New(sha1.New, []byte("BC_SIGNATURE&testsecret"))
	mac.Write([]byte(stringToSign))
	assert.Equal(t, hex.EncodeToString(mac.Sum(nil)), gotQuery.Get("Signature"))
}

func TestEcloudUploadTruncatesLongName(t *testing.T) {
	var gotName string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			AssetName string `json:"assetName"`
		}
		b, _ := io.ReadAll(r.Body)
		require.NoError(t, common.Unmarshal(b, &body))
		gotName = body.AssetName
		_, _ = w.Write([]byte(`{"state":"OK","body":"asset-1"}`))
	}))
	defer srv.Close()

	p := newEcloudProtocolForTest(srv.URL)
	_, err := p.Upload(UploadRequest{
		URL:       "https://example.com/test.mp4",
		AssetType: model.AssetTypeVideo,
		Name:      strings.Repeat("名", 100),
	})
	require.NoError(t, err)
	// 上游限制素材名称最长 64 个字符（按字符而非字节）
	assert.Equal(t, strings.Repeat("名", 64), gotName)
}

func TestEcloudUploadErrorEnvelope(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"requestId":"req-2","state":"ERROR","errorCode":"GROUP_NOT_FOUND","errorMessage":"asset group not exist"}`))
	}))
	defer srv.Close()

	p := newEcloudProtocolForTest(srv.URL)
	_, err := p.Upload(UploadRequest{URL: "https://example.com/a.jpg", AssetType: model.AssetTypeImage, Name: "a"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "GROUP_NOT_FOUND")
	assert.Contains(t, err.Error(), "asset group not exist")
}

func TestEcloudUploadAutoCreatesGroup(t *testing.T) {
	var groupBody, assetBody struct {
		path string
		body string
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		switch r.URL.Path {
		case "/api/openapi-maas/exp/aicc/v2/asset-group":
			groupBody.path = r.URL.Path
			groupBody.body = string(b)
			_, _ = w.Write([]byte(`{"state":"OK","body":{"groupId":"group-auto-1","groupType":"AIGC","groupName":"new-api-assets"}}`))
		case "/api/openapi-maas/exp/aicc/v2/asset":
			assetBody.path = r.URL.Path
			assetBody.body = string(b)
			_, _ = w.Write([]byte(`{"state":"OK","body":"asset-1"}`))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer srv.Close()

	cfg := ecloudConfig()
	cfg.Settings.AssetGroupID = ""
	p := &EcloudOfficialProtocol{cfg: cfg, endpoint: srv.URL, now: func() time.Time { return fixedTime }}
	res, err := p.Upload(UploadRequest{URL: "https://example.com/a.jpg", AssetType: model.AssetTypeImage, Name: "a"})
	require.NoError(t, err)
	assert.Equal(t, "asset-1", res.AssetID)
	assert.Equal(t, "group-auto-1", res.GroupID)
	assert.Equal(t, "group-auto-1", res.CreatedGroupID)

	// 先建组（AIGC 类型 + 默认组名），再用新建的组注册素材
	assert.Equal(t, "/api/openapi-maas/exp/aicc/v2/asset-group", groupBody.path)
	assert.Contains(t, groupBody.body, `"groupType":"AIGC"`)
	assert.Contains(t, groupBody.body, `"groupName":"new-api-assets"`)
	assert.Equal(t, "/api/openapi-maas/exp/aicc/v2/asset", assetBody.path)
	assert.Contains(t, assetBody.body, `"groupId":"group-auto-1"`)
}

func TestEcloudQuery(t *testing.T) {
	tests := []struct {
		name       string
		resp       string
		wantStatus string
		wantURL    string
		wantErr    string
	}{
		{
			name:       "active",
			resp:       `{"state":"OK","body":{"assetId":"asset-1","assetUrl":"https://cdn.example.com/preview.png","status":"ACTIVE"}}`,
			wantStatus: model.AssetStatusActive,
			wantURL:    "https://cdn.example.com/preview.png",
		},
		{
			name:       "processing",
			resp:       `{"state":"OK","body":{"assetId":"asset-1","status":"PROCESSING"}}`,
			wantStatus: model.AssetStatusPending,
		},
		{
			name:       "failed",
			resp:       `{"state":"OK","body":{"assetId":"asset-1","status":"FAILED","errorMessage":"download timeout"}}`,
			wantStatus: model.AssetStatusFailed,
			wantErr:    "download timeout",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotMethod, gotPath string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotMethod = r.Method
				gotPath = r.URL.Path
				_, _ = w.Write([]byte(tt.resp))
			}))
			defer srv.Close()

			p := newEcloudProtocolForTest(srv.URL)
			res, err := p.Query("asset-20260731170718-dbnvv")
			require.NoError(t, err)
			assert.Equal(t, http.MethodGet, gotMethod)
			assert.Equal(t, "/api/openapi-maas/exp/aicc/v2/asset/asset-20260731170718-dbnvv", gotPath)
			assert.Equal(t, tt.wantStatus, res.Status)
			assert.Equal(t, tt.wantURL, res.PreviewURL)
			assert.Equal(t, tt.wantErr, res.ErrorMsg)
		})
	}
}
