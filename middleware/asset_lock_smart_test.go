package middleware

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// stubSmartAssetAdapter 素材协议测试替身（middleware 包内），Upload 返回固定上游 ID。
type stubSmartAssetAdapter struct {
	uploadAssetID string
	uploadErr     error
	uploadCalls   int
}

func (s *stubSmartAssetAdapter) Upload(url string, assetType string, name string) (string, string, string, error) {
	s.uploadCalls++
	if s.uploadErr != nil {
		return "", "", "", s.uploadErr
	}
	return s.uploadAssetID, "grp-1", "proj-1", nil
}

func (s *stubSmartAssetAdapter) Query(assetID string) (string, string, string, error) {
	return model.AssetStatusActive, "", "", nil
}

// setupSmartAssetMiddlewareTest TestMain 只迁移了 assets 表，智能素材链路
// 还需要 source_assets/channels/abilities；同时注入 stub 协议工厂并登记清理。
func setupSmartAssetMiddlewareTest(t *testing.T, stub *stubSmartAssetAdapter) {
	t.Helper()
	model.InitCol()
	require.NoError(t, model.DB.AutoMigrate(&model.SourceAsset{}, &model.Channel{}, &model.Ability{}))
	orig := service.AssetProtocolFactoryFunc
	service.AssetProtocolFactoryFunc = func(channel *model.Channel) (service.AssetProtocolAdapter, error) {
		return stub, nil
	}
	t.Cleanup(func() {
		service.AssetProtocolFactoryFunc = orig
		model.DB.Exec("DELETE FROM assets")
		model.DB.Exec("DELETE FROM source_assets")
		model.DB.Exec("DELETE FROM channels")
		model.DB.Exec("DELETE FROM abilities")
	})
}

func newAssetBodyContext(t *testing.T, body string) *gin.Context {
	t.Helper()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/pg/video/generations", strings.NewReader(body))
	c.Request.ContentLength = int64(len(body))
	t.Cleanup(func() { common.CleanupBodyStorage(c) })
	return c
}

func currentBodyBytes(t *testing.T, c *gin.Context) []byte {
	t.Helper()
	storage, err := common.GetBodyStorage(c)
	require.NoError(t, err)
	data, err := storage.Bytes()
	require.NoError(t, err)
	return data
}

func TestRewriteAssetRefs(t *testing.T) {
	body := []byte(`{"a":"asset://yun-1","b":"asset://yun-12","c":"asset://keep-9"}`)

	t.Run("empty mapping keeps body", func(t *testing.T) {
		assert.Equal(t, body, rewriteAssetRefs(body, nil))
	})

	t.Run("exact ref replaced without prefix collision", func(t *testing.T) {
		got := rewriteAssetRefs(body, map[string]string{"yun-1": "up-100"})
		assert.Equal(t, `{"a":"asset://up-100","b":"asset://yun-12","c":"asset://keep-9"}`, string(got),
			"yun-12 不能被 yun-1 的映射误伤，非智能引用原样保留")
	})

	t.Run("all mapped refs replaced", func(t *testing.T) {
		got := rewriteAssetRefs(body, map[string]string{"yun-1": "up-100", "yun-12": "up-101"})
		assert.Equal(t, `{"a":"asset://up-100","b":"asset://up-101","c":"asset://keep-9"}`, string(got))
	})
}

// TestResolveAssetLockedChannelIdSmartRef yun 引用端到端：解析→锁定渠道→
// body 改写为真实上游 ID→ContentLength 更新→preflight 看到 pending 副本。
func TestResolveAssetLockedChannelIdSmartRef(t *testing.T) {
	stub := &stubSmartAssetAdapter{uploadAssetID: "up-700"}
	setupSmartAssetMiddlewareTest(t, stub)
	require.NoError(t, (&model.SourceAsset{
		ID: 700, UserID: 9, Name: "smart", AssetType: model.AssetTypeVideo,
		SourceURL: "http://tos/smart.mp4", Status: model.AssetStatusActive,
	}).Insert())
	require.NoError(t, model.DB.Create(&model.Channel{
		Id: 40, Name: "ch", Key: "sk-test", Status: common.ChannelStatusEnabled,
		OtherSettings: `{"asset_upload_protocol":"ark_official"}`,
	}).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: "seedance-lite", ChannelId: 40, Enabled: true,
	}).Error)

	body := `{"model":"seedance-lite","content":[{"video_url":{"url":"asset://yun-700"}}]}`
	c := newAssetBodyContext(t, body)

	channelId, err := ResolveAssetLockedChannelId(c, 9, "seedance-lite", "default", "")
	require.NoError(t, err)
	assert.Equal(t, 40, channelId)
	assert.Equal(t, 1, stub.uploadCalls, "无副本时应现场同步一次")

	newBody := currentBodyBytes(t, c)
	assert.Equal(t, []string{"up-700"}, ExtractAssetIDs(newBody), "改写后 body 应只剩真实上游 ID")
	assert.Contains(t, string(newBody), `"asset://up-700"`)
	assert.Equal(t, int64(len(newBody)), c.Request.ContentLength, "ContentLength 必须随改写更新")

	// 改写后的 body 走既有 preflight：pending 副本应被「审核中」拦截
	check := service.CheckAssetsByUpstreamIDs(40, ExtractAssetIDs(newBody))
	assert.False(t, check.Passed)
}

// TestResolveAssetLockedChannelIdSmartErrors 智能解析失败路径：not_found 与
// 无协议渠道都被翻译成 i18n 用户文案（i18n.Init 防止 nil bundle panic）。
func TestResolveAssetLockedChannelIdSmartErrors(t *testing.T) {
	require.NoError(t, i18n.Init())

	t.Run("missing source asset", func(t *testing.T) {
		stub := &stubSmartAssetAdapter{}
		setupSmartAssetMiddlewareTest(t, stub)
		c := newAssetBodyContext(t, `{"content":[{"video_url":{"url":"asset://yun-404"}}]}`)

		_, err := ResolveAssetLockedChannelId(c, 9, "seedance-lite", "default", "")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "yun-404")
		assert.Zero(t, stub.uploadCalls)
	})

	t.Run("no protocol channel", func(t *testing.T) {
		stub := &stubSmartAssetAdapter{}
		setupSmartAssetMiddlewareTest(t, stub)
		require.NoError(t, (&model.SourceAsset{
			ID: 701, UserID: 9, Name: "smart", AssetType: model.AssetTypeVideo,
			SourceURL: "http://tos/smart.mp4", Status: model.AssetStatusActive,
		}).Insert())
		require.NoError(t, model.DB.Create(&model.Channel{
			Id: 41, Name: "ch", Key: "sk-test", Status: common.ChannelStatusEnabled, OtherSettings: "{}",
		}).Error)
		require.NoError(t, model.DB.Create(&model.Ability{
			Group: "default", Model: "seedance-lite", ChannelId: 41, Enabled: true,
		}).Error)
		c := newAssetBodyContext(t, `{"content":[{"video_url":{"url":"asset://yun-701"}}]}`)

		_, err := ResolveAssetLockedChannelId(c, 9, "seedance-lite", "default", "")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "素材上传协议")
		assert.Zero(t, stub.uploadCalls)
	})
}

// TestResolveAssetLockedChannelIdMixedConflict yun 引用与上游 ID 引用混用时
// 必须收敛到同一渠道，跨渠道报渠道冲突。
func TestResolveAssetLockedChannelIdMixedConflict(t *testing.T) {
	require.NoError(t, i18n.Init())
	stub := &stubSmartAssetAdapter{uploadAssetID: "up-800"}
	setupSmartAssetMiddlewareTest(t, stub)
	require.NoError(t, (&model.SourceAsset{
		ID: 800, UserID: 9, Name: "smart", AssetType: model.AssetTypeVideo,
		SourceURL: "http://tos/smart.mp4", Status: model.AssetStatusActive,
	}).Insert())
	require.NoError(t, model.DB.Create(&model.Channel{
		Id: 50, Name: "ch", Key: "sk-test", Status: common.ChannelStatusEnabled,
		OtherSettings: `{"asset_upload_protocol":"ark_official"}`,
	}).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: "seedance-lite", ChannelId: 50, Enabled: true,
	}).Error)
	seedAsset(t, 9, 51, "upstream-on-51")

	body := `{"content":[{"video_url":{"url":"asset://yun-800"}},{"image_url":{"url":"asset://upstream-on-51"}}]}`
	c := newAssetBodyContext(t, body)

	_, err := ResolveAssetLockedChannelId(c, 9, "seedance-lite", "default", "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), i18n.Translate(i18n.LangZhCN, i18n.MsgDistributorAssetChannelConflict))
}

// TestResolveAssetLockedChannelIdUpstreamOnlyUnchanged 纯上游 ID 引用路径
// 行为不变：不触发改写，body 与 ContentLength 原样。
func TestResolveAssetLockedChannelIdUpstreamOnlyUnchanged(t *testing.T) {
	stub := &stubSmartAssetAdapter{}
	setupSmartAssetMiddlewareTest(t, stub)
	seedAsset(t, 9, 60, "plain-upstream")

	body := `{"content":[{"image_url":{"url":"asset://plain-upstream"}}]}`
	c := newAssetBodyContext(t, body)

	channelId, err := ResolveAssetLockedChannelId(c, 9, "seedance-lite", "default", "")
	require.NoError(t, err)
	assert.Equal(t, 60, channelId)
	assert.Equal(t, []byte(body), currentBodyBytes(t, c))
	assert.Equal(t, int64(len(body)), c.Request.ContentLength)
	assert.Zero(t, stub.uploadCalls)
}

// seedance4kBlacklistSetting (模型 × 分辨率) 能力黑名单：seedance-lite 做不了 4k。
const seedance4kBlacklistSetting = `{"resolution_blacklist":{"seedance-lite":["4k"]}}`

// seedResolutionChannel 建一个启用且带素材协议的渠道，并登记 default 分组下的
// seedance-lite 能力；setting 为空表示不配黑名单（即全分辨率可用）。
func seedResolutionChannel(t *testing.T, id int, priority int64, setting string) {
	t.Helper()
	channel := &model.Channel{
		Id: id, Name: "ch", Key: "sk-test", Status: common.ChannelStatusEnabled,
		Priority:      common.GetPointer(priority),
		OtherSettings: `{"asset_upload_protocol":"ark_official"}`,
	}
	if setting != "" {
		channel.Setting = common.GetPointer(setting)
	}
	require.NoError(t, model.DB.Create(channel).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: "seedance-lite", ChannelId: id, Enabled: true,
	}).Error)
}

// TestResolveAssetLockedChannelIdResolutionFallback 素材锁定的渠道做不了本次请求的
// 分辨率时，不能把请求硬发到必然拒绝它的上游：副本源自智能素材就改走智能
// 同步（改锁渠道 + 改写 body）；无源素材的旧副本维持原锁定，不阻断提交。
func TestResolveAssetLockedChannelIdResolutionFallback(t *testing.T) {
	require.NoError(t, i18n.Init())

	t.Run("supported resolution keeps the locked channel", func(t *testing.T) {
		savedCache := common.MemoryCacheEnabled
		common.MemoryCacheEnabled = false
		t.Cleanup(func() { common.MemoryCacheEnabled = savedCache })

		stub := &stubSmartAssetAdapter{uploadAssetID: "up-on-42"}
		setupSmartAssetMiddlewareTest(t, stub)
		seedResolutionChannel(t, 41, 9, seedance4kBlacklistSetting)
		seedResolutionChannel(t, 42, 1, "")
		require.NoError(t, (&model.SourceAsset{
			ID: 800, UserID: 9, Name: "smart", AssetType: model.AssetTypeVideo,
			SourceURL: "http://tos/smart.mp4", Status: model.AssetStatusActive,
		}).Insert())
		sid := int64(800)
		require.NoError(t, (&model.Asset{
			UserID: 9, ChannelID: 41, AssetID: "up-on-41", SourceAssetId: &sid,
			Name: "smart", AssetType: model.AssetTypeVideo, Status: model.AssetStatusActive,
			SourceURL: "http://tos/smart.mp4",
		}).Insert())

		body := `{"resolution":"480p","content":[{"image_url":{"url":"asset://up-on-41"}}]}`
		c := newAssetBodyContext(t, body)

		channelId, err := ResolveAssetLockedChannelId(c, 9, "seedance-lite", "default", "480p")
		require.NoError(t, err)
		assert.Equal(t, 41, channelId)
		assert.Equal(t, []byte(body), currentBodyBytes(t, c), "支持的分辨率不应改写请求体")
		assert.Zero(t, stub.uploadCalls)
	})

	t.Run("unsupported resolution re-resolves to a capable channel", func(t *testing.T) {
		savedCache := common.MemoryCacheEnabled
		common.MemoryCacheEnabled = false
		t.Cleanup(func() { common.MemoryCacheEnabled = savedCache })

		stub := &stubSmartAssetAdapter{uploadAssetID: "up-on-42"}
		setupSmartAssetMiddlewareTest(t, stub)
		seedResolutionChannel(t, 41, 9, seedance4kBlacklistSetting)
		seedResolutionChannel(t, 42, 1, "")
		require.NoError(t, (&model.SourceAsset{
			ID: 801, UserID: 9, Name: "smart", AssetType: model.AssetTypeVideo,
			SourceURL: "http://tos/smart.mp4", Status: model.AssetStatusActive,
		}).Insert())
		sid := int64(801)
		require.NoError(t, (&model.Asset{
			UserID: 9, ChannelID: 41, AssetID: "up-on-41", SourceAssetId: &sid,
			Name: "smart", AssetType: model.AssetTypeVideo, Status: model.AssetStatusActive,
			SourceURL: "http://tos/smart.mp4",
		}).Insert())

		c := newAssetBodyContext(t, `{"resolution":"4k","content":[{"image_url":{"url":"asset://up-on-41"}}]}`)

		channelId, err := ResolveAssetLockedChannelId(c, 9, "seedance-lite", "default", "4k")
		require.NoError(t, err)
		assert.Equal(t, 42, channelId, "41 做不了 4k，必须改锁到能做的 42")
		assert.Equal(t, 1, stub.uploadCalls, "新渠道无副本，应现场同步一次")

		newBody := currentBodyBytes(t, c)
		assert.Equal(t, []string{"up-on-42"}, ExtractAssetIDs(newBody), "旧渠道的上游 ID 已失效，body 必须改写")
		assert.Equal(t, int64(len(newBody)), c.Request.ContentLength)
	})

	t.Run("legacy copy without source asset keeps the lock", func(t *testing.T) {
		savedCache := common.MemoryCacheEnabled
		common.MemoryCacheEnabled = false
		t.Cleanup(func() { common.MemoryCacheEnabled = savedCache })

		stub := &stubSmartAssetAdapter{uploadAssetID: "up-on-42"}
		setupSmartAssetMiddlewareTest(t, stub)
		seedResolutionChannel(t, 41, 9, seedance4kBlacklistSetting)
		seedResolutionChannel(t, 42, 1, "")
		seedAsset(t, 9, 41, "legacy-on-41")

		body := `{"resolution":"4k","content":[{"image_url":{"url":"asset://legacy-on-41"}}]}`
		c := newAssetBodyContext(t, body)

		channelId, err := ResolveAssetLockedChannelId(c, 9, "seedance-lite", "default", "4k")
		require.NoError(t, err)
		assert.Equal(t, 41, channelId, "无源素材时无从同步，只能维持原锁定")
		assert.Equal(t, []byte(body), currentBodyBytes(t, c))
		assert.Zero(t, stub.uploadCalls)
	})

	t.Run("no capable channel reports the resolution", func(t *testing.T) {
		savedCache := common.MemoryCacheEnabled
		common.MemoryCacheEnabled = false
		t.Cleanup(func() { common.MemoryCacheEnabled = savedCache })

		stub := &stubSmartAssetAdapter{uploadAssetID: "up-on-42"}
		setupSmartAssetMiddlewareTest(t, stub)
		seedResolutionChannel(t, 41, 9, seedance4kBlacklistSetting)
		seedResolutionChannel(t, 42, 1, seedance4kBlacklistSetting)
		require.NoError(t, (&model.SourceAsset{
			ID: 802, UserID: 9, Name: "smart", AssetType: model.AssetTypeVideo,
			SourceURL: "http://tos/smart.mp4", Status: model.AssetStatusActive,
		}).Insert())
		sid := int64(802)
		require.NoError(t, (&model.Asset{
			UserID: 9, ChannelID: 41, AssetID: "up-on-41", SourceAssetId: &sid,
			Name: "smart", AssetType: model.AssetTypeVideo, Status: model.AssetStatusActive,
			SourceURL: "http://tos/smart.mp4",
		}).Insert())

		c := newAssetBodyContext(t, `{"resolution":"4k","content":[{"image_url":{"url":"asset://up-on-41"}}]}`)

		_, err := ResolveAssetLockedChannelId(c, 9, "seedance-lite", "default", "4k")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "4k", "报错必须告知是哪个分辨率无可用渠道")
		assert.Zero(t, stub.uploadCalls)
	})
}

// TestExtractRequestedResolution 选路的分辨率输入同时覆盖官方协议顶层 resolution
// 与统一视频协议 metadata.resolution，且解析后请求体仍可完整重读。
func TestExtractRequestedResolution(t *testing.T) {
	tests := []struct {
		name string
		body string
		want string
	}{
		{"top level trimmed and lowercased", `{"resolution":" 4K "}`, "4k"},
		{"metadata fallback", `{"metadata":{"resolution":" 1080p "}}`, "1080p"},
		{"top level wins over metadata", `{"resolution":"4k","metadata":{"resolution":"720p"}}`, "4k"},
		{"absent means upstream default", `{"duration":4}`, ""},
		{"non json body", `resolution=4k`, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := newAssetBodyContext(t, tt.body)
			assert.Equal(t, tt.want, ExtractRequestedResolution(c))
			assert.Equal(t, tt.body, string(currentBodyBytes(t, c)), "解析不得破坏下游重读请求体")
		})
	}
}

// 确认改写后下游仍可正常重读 body（ReadAll 拿到改写内容）。
func TestRewrittenBodyIsReadableDownstream(t *testing.T) {
	stub := &stubSmartAssetAdapter{uploadAssetID: "up-900"}
	setupSmartAssetMiddlewareTest(t, stub)
	require.NoError(t, (&model.SourceAsset{
		ID: 900, UserID: 9, Name: "smart", AssetType: model.AssetTypeVideo,
		SourceURL: "http://tos/smart.mp4", Status: model.AssetStatusActive,
	}).Insert())
	require.NoError(t, model.DB.Create(&model.Channel{
		Id: 70, Name: "ch", Key: "sk-test", Status: common.ChannelStatusEnabled,
		OtherSettings: `{"asset_upload_protocol":"ark_official"}`,
	}).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: "seedance-lite", ChannelId: 70, Enabled: true,
	}).Error)

	body := `{"content":[{"video_url":{"url":"asset://yun-900"}}]}`
	c := newAssetBodyContext(t, body)

	_, err := ResolveAssetLockedChannelId(c, 9, "seedance-lite", "default", "")
	require.NoError(t, err)

	downstream, err := io.ReadAll(c.Request.Body)
	require.NoError(t, err)
	assert.Contains(t, string(downstream), "asset://up-900")
}
