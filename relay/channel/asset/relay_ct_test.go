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

func relayConfig(baseURL string) ChannelConfig {
	return ChannelConfig{
		BaseURL: baseURL,
		ApiKey:  "test-channel-key",
		Settings: dto.ChannelOtherSettings{
			AssetUploadProtocol: dto.AssetUploadProtocolRelay,
		},
	}
}

func TestRelayProtocolUpload(t *testing.T) {
	var gotPath, gotAuth, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_, _ = w.Write([]byte(`{"code":0,"message":"ok","data":{"Id":"asset-20260716111338-vwmxj","GroupId":"g1","ProjectName":"p1"}}`))
	}))
	defer srv.Close()

	p, err := NewProtocol(relayConfig(srv.URL))
	require.NoError(t, err)

	res, err := p.Upload(UploadRequest{URL: "https://example.com/face.jpg", AssetType: model.AssetTypeImage, Name: "我的头像"})
	require.NoError(t, err)
	assert.Equal(t, "asset-20260716111338-vwmxj", res.AssetID)
	assert.Equal(t, "g1", res.GroupID)
	assert.Equal(t, "p1", res.ProjectName)

	assert.Equal(t, "/api/assets/upload", gotPath)
	assert.Equal(t, "Bearer test-channel-key", gotAuth)
	assert.Contains(t, gotBody, `"url":"https://example.com/face.jpg"`)
	assert.Contains(t, gotBody, `"asset_type":"Image"`)
	assert.Contains(t, gotBody, `"name":"我的头像"`)
}

func TestRelayProtocolUploadCustomPathAndError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v2/asset/register", r.URL.Path)
		_, _ = w.Write([]byte(`{"code":4001,"message":"invalid url"}`))
	}))
	defer srv.Close()

	cfg := relayConfig(srv.URL)
	cfg.Settings.AssetUploadPath = "/v2/asset/register"
	p, err := NewProtocol(cfg)
	require.NoError(t, err)

	_, err = p.Upload(UploadRequest{URL: "https://example.com/face.jpg", AssetType: model.AssetTypeImage})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "4001")
	assert.Contains(t, err.Error(), "invalid url")
}

func TestRelayProtocolQuery(t *testing.T) {
	var gotPath, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		_, _ = w.Write([]byte(`{"code":0,"message":"ok","data":{"Status":"success","URL":"https://cdn.example.com/preview.jpg"}}`))
	}))
	defer srv.Close()

	p, err := NewProtocol(relayConfig(srv.URL))
	require.NoError(t, err)

	res, err := p.Query("asset-20260716111338-vwmxj")
	require.NoError(t, err)
	assert.Equal(t, model.AssetStatusActive, res.Status)
	assert.Equal(t, "https://cdn.example.com/preview.jpg", res.PreviewURL)
	assert.Equal(t, "/api/assets/asset-20260716111338-vwmxj", gotPath)
	assert.Equal(t, "Bearer test-channel-key", gotAuth)
}

func TestRelayProtocolNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`unauthorized`))
	}))
	defer srv.Close()

	p, err := NewProtocol(relayConfig(srv.URL))
	require.NoError(t, err)
	_, err = p.Query("asset-x")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "401")
}

func TestNewProtocol(t *testing.T) {
	tests := []struct {
		name     string
		settings dto.ChannelOtherSettings
		wantType string
		wantErr  string
	}{
		{"disabled", dto.ChannelOtherSettings{}, "", "not enabled"},
		{"relay", dto.ChannelOtherSettings{AssetUploadProtocol: dto.AssetUploadProtocolRelay}, "*asset.RelayProtocol", ""},
		{"official without keys", dto.ChannelOtherSettings{AssetUploadProtocol: dto.AssetUploadProtocolArkOfficial}, "", "asset_ak"},
		{"official with keys", dto.ChannelOtherSettings{
			AssetUploadProtocol: dto.AssetUploadProtocolArkOfficial,
			AssetAK:             "ak", AssetSK: "sk",
		}, "*asset.ArkOfficialProtocol", ""},
		{"ecloud without keys", dto.ChannelOtherSettings{AssetUploadProtocol: dto.AssetUploadProtocolEcloud}, "", "asset_ak"},
		{"ecloud with keys", dto.ChannelOtherSettings{
			AssetUploadProtocol: dto.AssetUploadProtocolEcloud,
			AssetAK:             "ak", AssetSK: "sk",
		}, "*asset.EcloudOfficialProtocol", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p, err := NewProtocol(ChannelConfig{Settings: tt.settings})
			if tt.wantErr != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.wantType, typeName(p))
		})
	}
}

func typeName(p Protocol) string {
	switch p.(type) {
	case *RelayProtocol:
		return "*asset.RelayProtocol"
	case *ArkOfficialProtocol:
		return "*asset.ArkOfficialProtocol"
	case *EcloudOfficialProtocol:
		return "*asset.EcloudOfficialProtocol"
	}
	return "unknown"
}

func TestNormalizeUpstreamStatus(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"active", model.AssetStatusActive},
		{"Success", model.AssetStatusActive},
		{"SUCCEEDED", model.AssetStatusActive},
		{"completed", model.AssetStatusActive},
		{"failed", model.AssetStatusFailed},
		{"Error", model.AssetStatusFailed},
		{"FAILED", model.AssetStatusFailed},
		{"expired", model.AssetStatusFailed},
		{"processing", model.AssetStatusPending},
		{"PROCESSING", model.AssetStatusPending},
		{"ACTIVE", model.AssetStatusActive},
		{"", model.AssetStatusPending},
	}
	for _, tt := range tests {
		assert.Equal(t, tt.want, NormalizeUpstreamStatus(tt.in), "input=%q", tt.in)
	}
}

func TestTruncate(t *testing.T) {
	short := "hello"
	assert.Equal(t, short, truncate([]byte(short)))
	long := strings.Repeat("a", 600)
	out := truncate([]byte(long))
	assert.True(t, strings.HasSuffix(out, "...(truncated)"))
	assert.Equal(t, 500+len("...(truncated)"), len(out))
}
