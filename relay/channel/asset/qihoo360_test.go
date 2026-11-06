package asset

import (
	"encoding/base64"
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

func qihoo360TestConfig() ChannelConfig {
	return ChannelConfig{
		BaseURL: "https://api.360.cn/api/v3",
		ApiKey:  "sk-360-key",
		Settings: dto.ChannelOtherSettings{
			AssetUploadProtocol: dto.AssetUploadProtocolQihoo360,
		},
	}
}

// newQihoo360ForTest 直连测试服务器的 360 素材协议（endpoint 覆盖为测试地址）。
func newQihoo360ForTest(t *testing.T, endpoint string, cfg ChannelConfig) *Qihoo360Protocol {
	t.Helper()
	p, err := newQihoo360Protocol(cfg)
	require.NoError(t, err)
	p.endpoint = endpoint
	return p
}

func TestQihoo360EndpointDerivation(t *testing.T) {
	// 素材接口挂在 host 根的 /v1/images/generations，须从视频 base_url（含 /api/v3）剥出 host
	tests := []struct {
		name    string
		baseURL string
		want    string
	}{
		{"strip api/v3 to host root", "https://api.360.cn/api/v3", "https://api.360.cn/v1/images/generations"},
		{"bare host", "https://api.360.cn", "https://api.360.cn/v1/images/generations"},
		{"trailing slash", "https://api.360.cn/api/v3/", "https://api.360.cn/v1/images/generations"},
		{"custom gateway host preserved", "https://gw.example.com/api/v3", "https://gw.example.com/v1/images/generations"},
		{"empty falls back to official host", "", "https://api.360.cn/v1/images/generations"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, qihoo360AssetEndpoint(tt.baseURL))
		})
	}
}

func TestNewQihoo360Protocol(t *testing.T) {
	// 缺渠道密钥直接报错（Bearer 鉴权依赖它）
	_, err := newQihoo360Protocol(ChannelConfig{
		Settings: dto.ChannelOtherSettings{AssetUploadProtocol: dto.AssetUploadProtocolQihoo360},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "channel api key")

	// 多行密钥池取第一条；ProjectName 缺省 default；endpoint 从 base_url 派生
	p, err := newQihoo360Protocol(ChannelConfig{
		BaseURL:  "https://api.360.cn/api/v3",
		ApiKey:   "sk-first\nsk-second",
		Settings: dto.ChannelOtherSettings{AssetUploadProtocol: dto.AssetUploadProtocolQihoo360},
	})
	require.NoError(t, err)
	assert.Equal(t, "sk-first", p.apiKey)
	assert.Equal(t, "default", p.projectName)
	assert.Equal(t, "https://api.360.cn/v1/images/generations", p.endpoint)

	// 显式 ProjectName 不被覆盖
	p, err = newQihoo360Protocol(ChannelConfig{
		ApiKey: "sk-x",
		Settings: dto.ChannelOtherSettings{
			AssetUploadProtocol: dto.AssetUploadProtocolQihoo360,
			AssetProjectName:    "proj-360",
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "proj-360", p.projectName)
}

func TestNewProtocolQihoo360(t *testing.T) {
	p, err := NewProtocol(ChannelConfig{
		ApiKey:   "sk-360",
		Settings: dto.ChannelOtherSettings{AssetUploadProtocol: dto.AssetUploadProtocolQihoo360},
	})
	require.NoError(t, err)
	assert.Equal(t, "*asset.Qihoo360Protocol", typeName(p))
}

func TestQihoo360UploadAutoCreatesGroup(t *testing.T) {
	type callRecord struct {
		model string
		body  string
		auth  string
		path  string
	}
	var calls []callRecord
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		bodyStr := string(b)
		rec := callRecord{body: bodyStr, auth: r.Header.Get("Authorization"), path: r.URL.Path}
		switch {
		case strings.Contains(bodyStr, qihoo360ModelCreateGroup):
			rec.model = qihoo360ModelCreateGroup
			_, _ = w.Write([]byte(`{"created":1,"data":[{"b64_json":"{\"ResponseMetadata\":{},\"Result\":{\"Id\":\"group-360-1\"}}"}]}`))
		case strings.Contains(bodyStr, qihoo360ModelCreateAsset):
			rec.model = qihoo360ModelCreateAsset
			_, _ = w.Write([]byte(`{"created":1,"data":[{"b64_json":"{\"ResponseMetadata\":{},\"Result\":{\"Id\":\"asset-360-1\"}}"}]}`))
		default:
			w.WriteHeader(http.StatusBadRequest)
		}
		calls = append(calls, rec)
	}))
	defer srv.Close()

	p := newQihoo360ForTest(t, srv.URL+"/v1/images/generations", qihoo360TestConfig())
	res, err := p.Upload(UploadRequest{URL: "https://example.com/face.jpg", AssetType: model.AssetTypeImage, Name: "my-asset"})
	require.NoError(t, err)
	assert.Equal(t, "asset-360-1", res.AssetID)
	assert.Equal(t, "group-360-1", res.GroupID)
	assert.Equal(t, "group-360-1", res.CreatedGroupID)
	assert.Equal(t, "default", res.ProjectName)

	require.Len(t, calls, 2)
	// 先建库再建素材，全程 Bearer 渠道密钥，走 /v1/images/generations
	assert.Equal(t, qihoo360ModelCreateGroup, calls[0].model)
	assert.Equal(t, "Bearer sk-360-key", calls[0].auth)
	assert.Equal(t, "/v1/images/generations", calls[0].path)
	assert.Contains(t, calls[0].body, `"model":"cmecloud/create-asset-group"`)
	assert.Contains(t, calls[0].body, `"extra_body"`)
	assert.Contains(t, calls[0].body, `"GroupType":"AIGC"`)

	assert.Equal(t, qihoo360ModelCreateAsset, calls[1].model)
	assert.Contains(t, calls[1].body, `"model":"cmecloud/create-asset"`)
	assert.Contains(t, calls[1].body, `"GroupId":"group-360-1"`)
	assert.Contains(t, calls[1].body, `"URL":"https://example.com/face.jpg"`)
	assert.Contains(t, calls[1].body, `"AssetType":"Image"`)
	assert.Contains(t, calls[1].body, `"Name":"my-asset"`)
}

func TestQihoo360UploadUsesConfiguredGroup(t *testing.T) {
	var models []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		if strings.Contains(string(b), qihoo360ModelCreateAsset) {
			models = append(models, qihoo360ModelCreateAsset)
		}
		_, _ = w.Write([]byte(`{"created":1,"data":[{"b64_json":"{\"ResponseMetadata\":{},\"Result\":{\"Id\":\"asset-360-2\"}}"}]}`))
	}))
	defer srv.Close()

	cfg := qihoo360TestConfig()
	cfg.Settings.AssetGroupID = "group-cfg"
	cfg.Settings.AssetProjectName = "proj-x"
	p := newQihoo360ForTest(t, srv.URL, cfg)
	res, err := p.Upload(UploadRequest{URL: "https://example.com/a.jpg", AssetType: model.AssetTypeImage})
	require.NoError(t, err)
	// 已配置组 ID：不再自动建库，仅一次 create-asset
	assert.Equal(t, []string{qihoo360ModelCreateAsset}, models)
	assert.Equal(t, "asset-360-2", res.AssetID)
	assert.Equal(t, "group-cfg", res.GroupID)
	assert.Equal(t, "proj-x", res.ProjectName)
	assert.Empty(t, res.CreatedGroupID)
}

func TestQihoo360UploadAcceptsBase64B64JSON(t *testing.T) {
	// b64_json 字段名暗示 base64：真 base64 编码的方舟信封也必须能解出
	payload := `{"ResponseMetadata":{},"Result":{"Id":"asset-b64-1"}}`
	encoded := base64.StdEncoding.EncodeToString([]byte(payload))
	resp := `{"created":1,"data":[{"b64_json":"` + encoded + `"}]}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(resp))
	}))
	defer srv.Close()

	cfg := qihoo360TestConfig()
	cfg.Settings.AssetGroupID = "group-cfg"
	p := newQihoo360ForTest(t, srv.URL, cfg)
	res, err := p.Upload(UploadRequest{URL: "https://example.com/a.jpg", AssetType: model.AssetTypeImage})
	require.NoError(t, err)
	assert.Equal(t, "asset-b64-1", res.AssetID)
}

func TestQihoo360QueryStatusNormalization(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		bodyStr := string(b)
		assert.Contains(t, bodyStr, `"model":"cmecloud/get-asset"`)
		assert.Contains(t, bodyStr, `"Id":"asset-1"`)
		assert.Contains(t, bodyStr, `"ProjectName":"default"`)
		_, _ = w.Write([]byte(`{"created":1,"data":[{"b64_json":"{\"ResponseMetadata\":{},\"Result\":{\"Status\":\"Active\",\"URL\":\"https://cdn/x.mp4\"}}"}]}`))
	}))
	defer srv.Close()

	p := newQihoo360ForTest(t, srv.URL, qihoo360TestConfig())
	res, err := p.Query("asset-1")
	require.NoError(t, err)
	assert.Equal(t, model.AssetStatusActive, res.Status)
	assert.Equal(t, "https://cdn/x.mp4", res.PreviewURL)
	assert.Empty(t, res.ErrorMsg)
}

func TestQihoo360QueryTerminalHTTPErrorBecomesFailed(t *testing.T) {
	// HTTP 400 属终端错误：Query 转 failed 结果而非返回 error，前端不再无限转圈
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"code":"11137","message":"invalid asset url"}}`))
	}))
	defer srv.Close()

	p := newQihoo360ForTest(t, srv.URL, qihoo360TestConfig())
	res, err := p.Query("asset-bad")
	require.NoError(t, err)
	assert.Equal(t, model.AssetStatusFailed, res.Status)
	assert.Equal(t, "invalid asset url", res.ErrorMsg)
}

func TestQihoo360QueryRetryableErrorPropagates(t *testing.T) {
	// HTTP 403 属可重试错误：原样返回 error，素材保持 pending 继续轮询
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":{"code":"auth","message":"invalid api key"}}`))
	}))
	defer srv.Close()

	p := newQihoo360ForTest(t, srv.URL, qihoo360TestConfig())
	_, err := p.Query("asset-1")
	require.Error(t, err)
	var upErr *UpstreamError
	require.ErrorAs(t, err, &upErr)
	assert.Equal(t, http.StatusForbidden, upErr.Status)
	assert.False(t, upErr.Terminal(), "403 属可重试错误，素材应保持 pending")
}

func TestQihoo360UploadBusinessErrorEnvelope(t *testing.T) {
	// HTTP 200 但外层携带 error 信封：转成结构化 UpstreamError
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"error":{"code":"11137","message":"internal rpc error"}}`))
	}))
	defer srv.Close()

	cfg := qihoo360TestConfig()
	cfg.Settings.AssetGroupID = "group-cfg"
	p := newQihoo360ForTest(t, srv.URL, cfg)
	_, err := p.Upload(UploadRequest{URL: "https://example.com/a.jpg", AssetType: model.AssetTypeImage})
	require.Error(t, err)
	var upErr *UpstreamError
	require.ErrorAs(t, err, &upErr)
	assert.Equal(t, "11137", upErr.Code)
	assert.Contains(t, upErr.Message, "internal rpc error")
}

func TestQihoo360AssetManagement(t *testing.T) {
	var models []string
	bodies := make(map[string]string)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		bodyText := string(body)
		modelName := ""
		for _, candidate := range []string{
			qihoo360ModelCreateGroup, qihoo360ModelCreateAsset, qihoo360ModelUpdateAsset,
			qihoo360ModelUpdateAssetGroup, qihoo360ModelDeleteAsset, qihoo360ModelDeleteAssetGroup,
		} {
			if strings.Contains(bodyText, `"model":"`+candidate+`"`) {
				modelName = candidate
				break
			}
		}
		require.NotEmpty(t, modelName)
		models = append(models, modelName)
		bodies[modelName] = bodyText
		switch modelName {
		case qihoo360ModelCreateGroup:
			_, _ = w.Write([]byte(`{"data":[{"b64_json":"{\"ResponseMetadata\":{},\"Result\":{\"Id\":\"group-live\"}}"}]}`))
		case qihoo360ModelCreateAsset:
			_, _ = w.Write([]byte(`{"data":[{"b64_json":"{\"ResponseMetadata\":{},\"Result\":{\"Id\":\"asset-live\"}}"}]}`))
		default:
			_, _ = w.Write([]byte(`{"data":[{"b64_json":"{\"ResponseMetadata\":{},\"Result\":{}}"}]}`))
		}
	}))
	defer srv.Close()

	p := newQihoo360ForTest(t, srv.URL, qihoo360TestConfig())
	groupID, err := p.CreateAssetGroup("group-name", "group-description", "AIGC", "project-x")
	require.NoError(t, err)
	assert.Equal(t, "group-live", groupID)
	created, err := p.CreateAssetInGroup(groupID, "https://example.com/a.jpg", model.AssetTypeImage, "asset-name", "project-x")
	require.NoError(t, err)
	assert.Equal(t, "asset-live", created.AssetID)
	require.NoError(t, p.UpdateAsset(created.AssetID, "asset-renamed", "project-x"))
	require.NoError(t, p.UpdateAssetGroup(groupID, "group-renamed", "description-renamed", "project-x"))
	require.NoError(t, p.DeleteAsset(created.AssetID, "project-x"))
	require.NoError(t, p.DeleteAssetGroup(groupID, "project-x"))

	require.Equal(t, []string{
		qihoo360ModelCreateGroup, qihoo360ModelCreateAsset, qihoo360ModelUpdateAsset,
		qihoo360ModelUpdateAssetGroup, qihoo360ModelDeleteAsset, qihoo360ModelDeleteAssetGroup,
	}, models)
	assert.Contains(t, bodies[qihoo360ModelCreateGroup], `"Description":"group-description"`)
	assert.Contains(t, bodies[qihoo360ModelCreateAsset], `"GroupId":"group-live"`)
	assert.Contains(t, bodies[qihoo360ModelUpdateAsset], `"Name":"asset-renamed"`)
	assert.Contains(t, bodies[qihoo360ModelUpdateAssetGroup], `"Description":"description-renamed"`)
	assert.Contains(t, bodies[qihoo360ModelDeleteAsset], `"Id":"asset-live"`)
	assert.Contains(t, bodies[qihoo360ModelDeleteAssetGroup], `"Id":"group-live"`)
	for _, modelName := range models {
		assert.Contains(t, bodies[modelName], `"ProjectName":"project-x"`)
	}
}
