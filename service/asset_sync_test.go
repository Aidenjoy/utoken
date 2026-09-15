package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// stubAssetAdapter 素材协议测试替身：Upload 记录入参并返回固定上游 ID。
type stubAssetAdapter struct {
	uploadAssetID string
	uploadErr     error
	uploadedURL   string
	uploadedType  string
	uploadedName  string
}

func (s *stubAssetAdapter) Upload(url string, assetType string, name string) (string, string, string, error) {
	s.uploadedURL = url
	s.uploadedType = assetType
	s.uploadedName = name
	if s.uploadErr != nil {
		return "", "", "", s.uploadErr
	}
	return s.uploadAssetID, "grp-1", "proj-1", nil
}

func (s *stubAssetAdapter) Query(assetID string) (string, string, string, error) {
	return model.AssetStatusActive, "", "", nil
}

// setupAssetSyncTest 确保 assets 表存在并注入 stub 协议工厂，测试结束恢复工厂并清表。
func setupAssetSyncTest(t *testing.T, stub *stubAssetAdapter) {
	t.Helper()
	require.NoError(t, model.DB.AutoMigrate(&model.Asset{}))
	orig := AssetProtocolFactoryFunc
	AssetProtocolFactoryFunc = func(channel *model.Channel) (AssetProtocolAdapter, error) {
		return stub, nil
	}
	t.Cleanup(func() {
		AssetProtocolFactoryFunc = orig
		model.DB.Exec("DELETE FROM assets")
		model.DB.Exec("DELETE FROM channels")
	})
}

func seedAssetChannel(t *testing.T, id int, status int, protocol string) {
	t.Helper()
	settings := "{}"
	if protocol != "" {
		settings = `{"asset_upload_protocol":"` + protocol + `"}`
	}
	ch := &model.Channel{Id: id, Name: "ch", Key: "sk-test", Status: status, OtherSettings: settings}
	require.NoError(t, model.DB.Create(ch).Error)
}

// TestSyncAssetToChannelInputGuards 覆盖不依赖 DB 的前置守卫：源=目标跳过、缺源地址失败。
func TestSyncAssetToChannelInputGuards(t *testing.T) {
	tests := []struct {
		name       string
		src        *model.Asset
		target     int
		wantStatus string
	}{
		{
			name:       "same channel is skipped",
			src:        &model.Asset{ID: 1, ChannelID: 5, SourceURL: "http://src/x.mp4"},
			target:     5,
			wantStatus: "skipped",
		},
		{
			name:       "empty source url fails",
			src:        &model.Asset{ID: 2, ChannelID: 5, SourceURL: ""},
			target:     6,
			wantStatus: "failed",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := SyncAssetToChannel(tt.src, tt.target)
			assert.Equal(t, tt.wantStatus, got.Status)
		})
	}
}

// TestSyncAssetToChannelTargetValidation 目标渠道被禁用或未开启素材协议时判失败。
func TestSyncAssetToChannelTargetValidation(t *testing.T) {
	stub := &stubAssetAdapter{uploadAssetID: "up-1"}
	setupAssetSyncTest(t, stub)
	seedAssetChannel(t, 10, common.ChannelStatusManuallyDisabled, "ark_official")
	seedAssetChannel(t, 11, common.ChannelStatusEnabled, "")

	src := &model.Asset{ID: 100, UserID: 7, ChannelID: 1, SourceURL: "http://src/a.mp4", AssetType: model.AssetTypeVideo, Name: "a"}

	assert.Equal(t, "failed", SyncAssetToChannel(src, 10).Status)
	assert.Equal(t, "failed", SyncAssetToChannel(src, 11).Status)
	assert.Empty(t, stub.uploadedURL, "目标渠道校验未通过时不应触发上传")
}

// TestSyncAssetToChannelHappyPath 同步成功后在目标渠道生成 pending 副本，并保留原归属用户。
func TestSyncAssetToChannelHappyPath(t *testing.T) {
	stub := &stubAssetAdapter{uploadAssetID: "up-999"}
	setupAssetSyncTest(t, stub)
	seedAssetChannel(t, 20, common.ChannelStatusEnabled, "ark_official")

	src := &model.Asset{ID: 200, UserID: 42, ChannelID: 1, SourceURL: "http://src/b.mp4", AssetType: model.AssetTypeVideo, Name: "b"}
	res := SyncAssetToChannel(src, 20)
	require.Equal(t, "pending", res.Status)
	assert.Equal(t, "up-999", res.AssetID)
	assert.Equal(t, "http://src/b.mp4", stub.uploadedURL)
	assert.Equal(t, model.AssetTypeVideo, stub.uploadedType)

	created, err := model.GetAssetByChannelAndSourceURL(20, "http://src/b.mp4")
	require.NoError(t, err)
	assert.Equal(t, 42, created.UserID, "目标副本必须保留原素材归属用户")
	assert.Equal(t, model.AssetStatusPending, created.Status)
	assert.Equal(t, "up-999", created.AssetID)
}

// TestSyncAssetToChannelSkipsWhenActiveCopyExists 目标渠道已有 active 副本时幂等跳过，不再上传。
func TestSyncAssetToChannelSkipsWhenActiveCopyExists(t *testing.T) {
	stub := &stubAssetAdapter{uploadAssetID: "should-not-be-used"}
	setupAssetSyncTest(t, stub)
	seedAssetChannel(t, 30, common.ChannelStatusEnabled, "ark_official")

	existing := &model.Asset{
		UserID: 5, ChannelID: 30, AssetID: "old-1", Name: "c",
		AssetType: model.AssetTypeImage, Status: model.AssetStatusActive, SourceURL: "http://src/c.png",
	}
	require.NoError(t, existing.Insert())

	src := &model.Asset{ID: 300, UserID: 5, ChannelID: 1, SourceURL: "http://src/c.png", AssetType: model.AssetTypeImage, Name: "c"}
	res := SyncAssetToChannel(src, 30)
	assert.Equal(t, "skipped", res.Status)
	assert.Equal(t, "old-1", res.AssetID)
	assert.Empty(t, stub.uploadedURL, "已有 active 副本时不应重复上传")
}

// TestSyncAssetsToChannelRejectsForeignAsset 批量入口拒绝不属于所选源渠道的素材 ID。
func TestSyncAssetsToChannelRejectsForeignAsset(t *testing.T) {
	stub := &stubAssetAdapter{uploadAssetID: "up-1"}
	setupAssetSyncTest(t, stub)
	seedAssetChannel(t, 40, common.ChannelStatusEnabled, "ark_official")

	foreign := &model.Asset{
		ID: 400, UserID: 1, ChannelID: 99, SourceURL: "http://src/d.mp4",
		AssetType: model.AssetTypeVideo, Name: "d", Status: model.AssetStatusActive,
	}
	require.NoError(t, foreign.Insert())

	results := SyncAssetsToChannel(40, 41, []int64{400})
	require.Len(t, results, 1)
	assert.Equal(t, "failed", results[0].Status)
	assert.Empty(t, stub.uploadedURL)
}
