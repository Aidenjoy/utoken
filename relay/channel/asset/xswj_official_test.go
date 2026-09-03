package asset

import (
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

func xswjConfig() ChannelConfig {
	return ChannelConfig{
		Settings: dto.ChannelOtherSettings{
			AssetUploadProtocol: dto.AssetUploadProtocolXswjOfficial,
			AssetAK:             "AKLT-xswj-test",
			AssetSK:             "sk-xswj-secret",
			AssetGroupID:        "group-xswj-001",
		},
	}
}

func TestNewXswjOfficialProtocolEndpoint(t *testing.T) {
	// 素材网关是固定服务：无论 base_url 怎么填，endpoint 恒为星枢无极网关
	for _, base := range []string{"", "https://mirror.example.com/", "https://mintel.591ll.com/render/api"} {
		cfg := xswjConfig()
		cfg.BaseURL = base
		p, err := NewProtocol(cfg)
		require.NoError(t, err)
		ark, ok := p.(*ArkOfficialProtocol)
		require.True(t, ok)
		assert.Equal(t, xswjOfficialEndpoint, ark.endpoint)
		assert.Equal(t, xswjSignHost, ark.signHost)
		assert.Equal(t, xswjSignPath, ark.signPath)
		assert.Equal(t, "default", ark.cfg.Settings.AssetProjectName)
	}

	// 显式配置的 ProjectName 不被覆盖
	cfg := xswjConfig()
	cfg.Settings.AssetProjectName = "my-project"
	p, err := NewProtocol(cfg)
	require.NoError(t, err)
	assert.Equal(t, "my-project", p.(*ArkOfficialProtocol).cfg.Settings.AssetProjectName)
}

func TestNewXswjOfficialProtocolRequiresCredentials(t *testing.T) {
	cfg := xswjConfig()
	cfg.Settings.AssetAK = ""
	_, err := NewProtocol(cfg)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "asset_ak")

	cfg = xswjConfig()
	cfg.Settings.AssetSK = "  "
	_, err = NewProtocol(cfg)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "asset_sk")
}

func TestXswjUploadSignatureUsesCustomHostPath(t *testing.T) {
	// 验证签名的 canonical request 使用 signHost/signPath 而非 URL 的 host/path
	var gotAuth, gotXDate, gotSha256, gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotXDate = r.Header.Get("X-Date")
		gotSha256 = r.Header.Get("X-Content-Sha256")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		_, _ = w.Write([]byte(`{"ResponseMetadata":{"RequestId":"req-xswj"},"Result":{"Id":"asset-xswj-001"}}`))
	}))
	defer srv.Close()

	cfg := xswjConfig()
	cfg.Settings.AssetProjectName = "default"
	p := &ArkOfficialProtocol{
		cfg:      cfg,
		endpoint: srv.URL + "/assets/", // 测试覆盖
		signHost: xswjSignHost,
		signPath: xswjSignPath,
		now:      func() time.Time { return fixedTime },
	}
	res, err := p.Upload(UploadRequest{URL: "https://example.com/photo.jpg", AssetType: model.AssetTypeImage, Name: "test-asset"})
	require.NoError(t, err)
	assert.Equal(t, "asset-xswj-001", res.AssetID)
	assert.Equal(t, "group-xswj-001", res.GroupID)
	assert.Equal(t, "default", res.ProjectName)

	// 请求体字段验证（PascalCase，与火山协议一致）
	assert.Contains(t, gotBody, `"GroupId":"group-xswj-001"`)
	assert.Contains(t, gotBody, `"URL":"https://example.com/photo.jpg"`)
	assert.Contains(t, gotBody, `"AssetType":"Image"`)
	assert.Contains(t, gotBody, `"Name":"test-asset"`)
	assert.Contains(t, gotBody, `"ProjectName":"default"`)

	// X-Date 格式验证
	assert.Equal(t, "20260716T111338Z", gotXDate)

	// body 哈希一致性
	sum := sha256.Sum256([]byte(gotBody))
	assert.Equal(t, hex.EncodeToString(sum[:]), gotSha256)

	// 独立重算签名：canonical request 使用 signHost 和 signPath
	canonicalHeaders := "content-type:application/json\n" +
		"host:" + xswjSignHost + "\n" +
		"x-content-sha256:" + gotSha256 + "\n" +
		"x-date:" + gotXDate + "\n"
	canonicalRequest := strings.Join([]string{
		"POST", xswjSignPath, "Action=CreateAsset&Version=2024-01-01",
		canonicalHeaders, "content-type;host;x-content-sha256;x-date", gotSha256,
	}, "\n")
	stringToSign := strings.Join([]string{
		"HMAC-SHA256", gotXDate, "20260716/cn-beijing/ark/request",
		hexSha256([]byte(canonicalRequest)),
	}, "\n")
	wantSig := hexHmacSha256(deriveSigningKey("sk-xswj-secret", "20260716", "cn-beijing", "ark"), []byte(stringToSign))
	assert.Contains(t, gotAuth, "Signature="+wantSig)

	// Authorization 格式 + Credential scope
	re := regexp.MustCompile(`^HMAC-SHA256 Credential=AKLT-xswj-test/20260716/cn-beijing/ark/request, ` +
		`SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=[0-9a-f]{64}$`)
	assert.Regexp(t, re, gotAuth)
}

func TestXswjUploadAutoCreatesGroup(t *testing.T) {
	var actions []string
	bodies := map[string]string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		action := r.URL.Query().Get("Action")
		actions = append(actions, action)
		b, _ := io.ReadAll(r.Body)
		bodies[action] = string(b)
		switch action {
		case "CreateAssetGroup":
			_, _ = w.Write([]byte(`{"ResponseMetadata":{},"Result":{"Id":"group-xswj-auto"}}`))
		case "CreateAsset":
			_, _ = w.Write([]byte(`{"ResponseMetadata":{},"Result":{"Id":"asset-xswj-auto"}}`))
		default:
			t.Errorf("unexpected action %q", action)
		}
	}))
	defer srv.Close()

	cfg := xswjConfig()
	cfg.Settings.AssetGroupID = ""
	p := &ArkOfficialProtocol{
		cfg:      cfg,
		endpoint: srv.URL + "/assets/",
		signHost: xswjSignHost,
		signPath: xswjSignPath,
		now:      func() time.Time { return fixedTime },
	}
	res, err := p.Upload(UploadRequest{URL: "https://example.com/a.jpg", AssetType: model.AssetTypeImage})
	require.NoError(t, err)

	// 必须先建组再建素材
	require.Equal(t, []string{"CreateAssetGroup", "CreateAsset"}, actions)
	assert.Contains(t, bodies["CreateAssetGroup"], `"Name":"new-api-assets"`)
	assert.Contains(t, bodies["CreateAsset"], `"GroupId":"group-xswj-auto"`)
	assert.Equal(t, "group-xswj-auto", res.GroupID)
	assert.Equal(t, "group-xswj-auto", res.CreatedGroupID)
}

func TestXswjQuery(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "GetAsset", r.URL.Query().Get("Action"))
		b, _ := io.ReadAll(r.Body)
		assert.Contains(t, string(b), `"Id":"asset-xswj-q"`)
		_, _ = w.Write([]byte(`{"ResponseMetadata":{},"Result":{"Status":"Active","URL":"https://cdn.example.com/p.jpg"}}`))
	}))
	defer srv.Close()

	cfg := xswjConfig()
	p := &ArkOfficialProtocol{
		cfg:      cfg,
		endpoint: srv.URL + "/assets/",
		signHost: xswjSignHost,
		signPath: xswjSignPath,
		now:      func() time.Time { return fixedTime },
	}
	res, err := p.Query("asset-xswj-q")
	require.NoError(t, err)
	assert.Equal(t, model.AssetStatusActive, res.Status)
	assert.Equal(t, "https://cdn.example.com/p.jpg", res.PreviewURL)
}

func TestXswjEndpointURLStructure(t *testing.T) {
	// 验证生产 endpoint 的 URL 结构正确
	u, err := url.Parse(xswjOfficialEndpoint)
	require.NoError(t, err)
	assert.Equal(t, "mintel.591ll.com", u.Host)
	assert.Equal(t, "/render/api/assets/", u.Path)
	// signHost 含路径前缀（与官方 Demo 一致）
	assert.Equal(t, "mintel.591ll.com/render/api", xswjSignHost)
	// signPath 仅含末段
	assert.Equal(t, "/assets/", xswjSignPath)
}
