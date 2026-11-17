package asset

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func byteplusOfficialConfig(baseURL string) ChannelConfig {
	return ChannelConfig{
		BaseURL: baseURL,
		Settings: dto.ChannelOtherSettings{
			AssetUploadProtocol: dto.AssetUploadProtocolByteplusOfficial,
			AssetAK:             "ak-test",
			AssetSK:             "sk-test",
		},
	}
}

func TestNewByteplusOfficialProtocolEndpointAndRegion(t *testing.T) {
	// 素材网关是固定服务：无论 base_url 怎么填（视频中转地址），
	// endpoint 恒为 BytePlus 官方网关，ProjectName 缺省落 default
	for _, base := range []string{"", "https://ark.ap-southeast.bytepluses.com/api/v3", "https://mirror.example.com/v1"} {
		p, err := NewProtocol(byteplusOfficialConfig(base))
		require.NoError(t, err)
		ark, ok := p.(*ArkOfficialProtocol)
		require.True(t, ok)
		assert.Equal(t, byteplusOfficialEndpoint, ark.endpoint)
		assert.Equal(t, "default", ark.cfg.Settings.AssetProjectName)
		assert.Equal(t, "ap-southeast-1", ark.cfg.Settings.AssetRegionOrDefault())
	}

	// 网关域名锁定 ap-southeast-1：即使渠道残留国内 region 也强制纠正，
	// 否则 Credential scope 与网关区域不一致必然 SignatureDoesNotMatch
	cfg := byteplusOfficialConfig("")
	cfg.Settings.AssetRegion = "cn-beijing"
	cfg.Settings.AssetProjectName = "my-project"
	p, err := NewProtocol(cfg)
	require.NoError(t, err)
	ark := p.(*ArkOfficialProtocol)
	assert.Equal(t, "ap-southeast-1", ark.cfg.Settings.AssetRegionOrDefault())
	// 显式配置的 ProjectName 不被覆盖
	assert.Equal(t, "my-project", ark.cfg.Settings.AssetProjectName)
}

func TestByteplusOfficialUploadSignsApSoutheastScope(t *testing.T) {
	var gotAction, gotVersion, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAction = r.URL.Query().Get("Action")
		gotVersion = r.URL.Query().Get("Version")
		gotAuth = r.Header.Get("Authorization")
		_, _ = w.Write([]byte(`{"ResponseMetadata":{},"Result":{"Id":"asset-bp-1"}}`))
	}))
	defer srv.Close()

	p := newByteplusOfficialProtocol(byteplusOfficialConfig(""))
	p.endpoint = srv.URL // 测试覆盖：生产恒用 byteplusOfficialEndpoint
	res, err := p.Upload(UploadRequest{URL: "https://example.com/a.jpg", AssetType: model.AssetTypeImage, Name: "test"})
	require.NoError(t, err)
	assert.Equal(t, "asset-bp-1", res.AssetID)
	assert.Equal(t, "CreateAsset", gotAction)
	assert.Equal(t, "2024-01-01", gotVersion)
	assert.Equal(t, "default", res.ProjectName)
	// 与 BytePlus 官方文档示例一致的 V4 签名形态：
	// Credential=AK/<date>/ap-southeast-1/ark/request，SignedHeaders 四件套
	assert.True(t, strings.HasPrefix(gotAuth, "HMAC-SHA256 Credential=ak-test/"), "auth=%s", gotAuth)
	assert.Contains(t, gotAuth, "/ap-southeast-1/ark/request")
	assert.Contains(t, gotAuth, "SignedHeaders=content-type;host;x-content-sha256;x-date")
}

func TestByteplusOfficialQuerySendsProjectName(t *testing.T) {
	// BytePlus 邀测账号的 AK/SK 仅授权专属项目（如 zc_en_01）：
	// GetAsset 不带 ProjectName 会落到 default/project/* 鉴权，实测 403 AccessDenied
	var gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_, _ = w.Write([]byte(`{"ResponseMetadata":{},"Result":{"Status":"Active","URL":"https://cdn.example.com/p.jpg"}}`))
	}))
	defer srv.Close()

	cfg := byteplusOfficialConfig("")
	cfg.Settings.AssetProjectName = "zc_en_01"
	p := newByteplusOfficialProtocol(cfg)
	p.endpoint = srv.URL
	res, err := p.Query("asset-x")
	require.NoError(t, err)
	assert.Equal(t, model.AssetStatusActive, res.Status)
	assert.Contains(t, gotBody, `"ProjectName":"zc_en_01"`)
}
