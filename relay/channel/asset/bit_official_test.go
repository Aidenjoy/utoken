package asset

import (
	"net/http"
	"net/http/httptest"
	"net/url"
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
	// 素材网关是固定服务：无论 base_url 怎么填（视频中转地址），
	// endpoint 恒为官方 tokenbit 网关，ProjectName 缺省落 default
	for _, base := range []string{"", "https://mirror.example.com/", "https://mirror.example.com/seedance25/api/v3"} {
		p, err := NewProtocol(bitOfficialConfig(base))
		require.NoError(t, err)
		ark, ok := p.(*ArkOfficialProtocol)
		require.True(t, ok)
		assert.Equal(t, bitOfficialDefaultEndpoint, ark.endpoint)
		assert.Equal(t, "default", ark.cfg.Settings.AssetProjectName)
	}

	// 显式配置的 ProjectName 不被覆盖
	cfg := bitOfficialConfig("")
	cfg.Settings.AssetProjectName = "my-project"
	p, err := NewProtocol(cfg)
	require.NoError(t, err)
	assert.Equal(t, "my-project", p.(*ArkOfficialProtocol).cfg.Settings.AssetProjectName)
}

func TestNewProtocolSanitizesCredentials(t *testing.T) {
	cfg := bitOfficialConfig("")
	cfg.Settings.AssetAK = " ak-test \n"
	cfg.Settings.AssetSK = "\tsk-test \r\n"
	p, err := NewProtocol(cfg)
	require.NoError(t, err)
	ark := p.(*ArkOfficialProtocol)
	assert.Equal(t, "ak-test", ark.cfg.Settings.AssetAK)
	assert.Equal(t, "sk-test", ark.cfg.Settings.AssetSK)
}

func TestBitOfficialUploadHitsAssetGatewayPath(t *testing.T) {
	// 官方网关路径必须带尾斜杠（参与 V4 签名路径，实测通过形态）
	u, err := url.Parse(bitOfficialDefaultEndpoint)
	require.NoError(t, err)
	assert.Equal(t, "/seedance25/openapi/", u.Path)

	var gotPath, gotAction string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAction = r.URL.Query().Get("Action")
		_, _ = w.Write([]byte(`{"ResponseMetadata":{},"Result":{"Id":"asset-bit-1"}}`))
	}))
	defer srv.Close()

	p := newBitOfficialProtocol(bitOfficialConfig(""))
	p.endpoint = srv.URL // 测试覆盖：生产恒用 bitOfficialDefaultEndpoint
	res, err := p.Upload(UploadRequest{URL: "https://example.com/a.jpg", AssetType: model.AssetTypeImage, Name: "test"})
	require.NoError(t, err)
	assert.Equal(t, "asset-bit-1", res.AssetID)
	assert.Equal(t, "/", gotPath) // httptest 根路径，仅验证请求链路
	assert.Equal(t, "CreateAsset", gotAction)
	// ProjectName 缺省显式落 default 项目（实测与文档缺省行为一致）
	assert.Equal(t, "default", res.ProjectName)
}
