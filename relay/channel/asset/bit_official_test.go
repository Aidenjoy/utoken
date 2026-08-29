package asset

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func bitOfficialConfig(baseURL string) ChannelConfig {
	return ChannelConfig{
		BaseURL: baseURL,
		Settings: dto.ChannelOtherSettings{
			AssetUploadProtocol: dto.AssetUploadProtocolBitOfficial,
			AssetAK:             "ak-test",
			AssetSK:             "sk-test",
		},
	}
}

func TestNewBitOfficialProtocolEndpoint(t *testing.T) {
	// 未配置 base_url 时用官方默认网关，ProjectName 缺省落 default
	p, err := NewProtocol(bitOfficialConfig(""))
	require.NoError(t, err)
	ark, ok := p.(*ArkOfficialProtocol)
	require.True(t, ok)
	assert.Equal(t, bitOfficialDefaultEndpoint, ark.endpoint)
	assert.Equal(t, "default", ark.cfg.Settings.AssetProjectName)

	// 配置了 base_url 时素材网关取 {base}/seedance25/openapi/（尾斜杠参与签名路径）
	p, err = NewProtocol(bitOfficialConfig("https://mirror.example.com/"))
	require.NoError(t, err)
	ark = p.(*ArkOfficialProtocol)
	assert.Equal(t, "https://mirror.example.com/seedance25/openapi/", ark.endpoint)

	// 显式配置的 ProjectName 不被覆盖
	cfg := bitOfficialConfig("")
	cfg.Settings.AssetProjectName = "my-project"
	p, err = NewProtocol(cfg)
	require.NoError(t, err)
	assert.Equal(t, "my-project", p.(*ArkOfficialProtocol).cfg.Settings.AssetProjectName)
}

func TestBitOfficialUploadHitsAssetGatewayPath(t *testing.T) {
	var gotPath, gotAction string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAction = r.URL.Query().Get("Action")
		_, _ = w.Write([]byte(`{"ResponseMetadata":{},"Result":{"Id":"asset-bit-1"}}`))
	}))
	defer srv.Close()

	p, err := NewProtocol(bitOfficialConfig(srv.URL))
	require.NoError(t, err)
	res, err := p.Upload(UploadRequest{URL: "https://example.com/a.jpg", AssetType: model.AssetTypeImage, Name: "test"})
	require.NoError(t, err)
	assert.Equal(t, "asset-bit-1", res.AssetID)
	assert.Equal(t, "/seedance25/openapi/", gotPath)
	assert.Equal(t, "CreateAsset", gotAction)
	// ProjectName 缺省显式落 default 项目（实测与文档缺省行为一致）
	assert.Equal(t, "default", res.ProjectName)
}
