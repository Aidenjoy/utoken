package service

import (
	"errors"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// setupSmartAssetTest 迁移智能素材依赖的表并注入 stub 协议工厂，测试结束清理相关表。
func setupSmartAssetTest(t *testing.T, stub *stubAssetAdapter) {
	t.Helper()
	model.InitCol()
	require.NoError(t, model.DB.AutoMigrate(&model.Asset{}, &model.SourceAsset{}, &model.Channel{}, &model.Ability{}))
	orig := AssetProtocolFactoryFunc
	AssetProtocolFactoryFunc = func(channel *model.Channel) (AssetProtocolAdapter, error) {
		return stub, nil
	}
	t.Cleanup(func() {
		AssetProtocolFactoryFunc = orig
		model.DB.Exec("DELETE FROM assets")
		model.DB.Exec("DELETE FROM source_assets")
		model.DB.Exec("DELETE FROM channels")
		model.DB.Exec("DELETE FROM abilities")
	})
}

func seedSmartAbility(t *testing.T, group, modelName string, channelId int) {
	t.Helper()
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: group, Model: modelName, ChannelId: channelId, Enabled: true,
	}).Error)
}

func seedSmartSourceAsset(t *testing.T, id int64, userId int) {
	t.Helper()
	source := &model.SourceAsset{
		ID: id, UserID: userId, Name: "smart", AssetType: model.AssetTypeVideo,
		SourceURL: "http://tos/smart.mp4", Status: model.AssetStatusActive,
	}
	require.NoError(t, source.Insert())
}

func seedSmartCopy(t *testing.T, sourceId int64, userId, channelId int, upstreamId, status string) {
	t.Helper()
	sid := sourceId
	require.NoError(t, (&model.Asset{
		UserID:        userId,
		ChannelID:     channelId,
		AssetID:       upstreamId,
		SourceAssetId: &sid,
		Name:          "smart",
		AssetType:     model.AssetTypeVideo,
		Status:        status,
		SourceURL:     "http://tos/smart.mp4",
	}).Insert())
}

func smartErrorKind(t *testing.T, err error) SmartAssetErrorKind {
	t.Helper()
	var smartErr *SmartAssetError
	require.True(t, errors.As(err, &smartErr), "expected *SmartAssetError, got %v", err)
	return smartErr.Kind
}

// TestGetEnabledChannelIdsForGroupModelDBFallback 候选渠道枚举走 abilities 表：
// 只计入 enabled 行，分组隔离，空参返回 nil。
func TestGetEnabledChannelIdsForGroupModelDBFallback(t *testing.T) {
	setupSmartAssetTest(t, &stubAssetAdapter{})
	seedSmartAbility(t, "default", "seedance-lite", 30)
	seedSmartAbility(t, "default", "seedance-lite", 31)
	seedSmartAbility(t, "vip", "seedance-lite", 32)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: "seedance-off", ChannelId: 33, Enabled: false,
	}).Error)

	assert.ElementsMatch(t, []int{30, 31}, model.GetEnabledChannelIdsForGroupModel("default", "seedance-lite"))
	assert.Equal(t, []int{32}, model.GetEnabledChannelIdsForGroupModel("vip", "seedance-lite"))
	assert.Nil(t, model.GetEnabledChannelIdsForGroupModel("default", "seedance-off"))
	assert.Nil(t, model.GetEnabledChannelIdsForGroupModel("", "seedance-lite"))
	assert.Nil(t, model.GetEnabledChannelIdsForGroupModel("default", ""))
}

// TestResolveSmartAssetRefsSyncsWhenNoCopy 无副本时现场同步：挑中协议渠道、
// 触发上传、落 pending 副本并返回上游 ID。
func TestResolveSmartAssetRefsSyncsWhenNoCopy(t *testing.T) {
	stub := &stubAssetAdapter{uploadAssetID: "up-500"}
	setupSmartAssetTest(t, stub)
	seedAssetChannel(t, 30, common.ChannelStatusEnabled, "ark_official")
	seedSmartAbility(t, "default", "seedance-lite", 30)
	seedSmartSourceAsset(t, 500, 42)

	resolutions, channelId, err := ResolveSmartAssetRefs(42, []string{"yun-500"}, "seedance-lite", []string{"default"})
	require.NoError(t, err)
	assert.Equal(t, 30, channelId)
	require.Len(t, resolutions, 1)
	assert.Equal(t, model.AssetStatusPending, resolutions[0].Status)
	assert.Equal(t, "up-500", resolutions[0].UpstreamAssetId)
	assert.Equal(t, int64(500), resolutions[0].SourceAssetId)
	assert.Equal(t, 1, stub.uploadCalls)

	created, err := model.GetAssetBySourceAndChannel(500, 30)
	require.NoError(t, err)
	assert.Equal(t, 42, created.UserID, "副本必须保留源素材归属用户")
	assert.Equal(t, model.AssetStatusPending, created.Status)
	assert.Equal(t, "up-500", created.AssetID)
}

// TestResolveSmartAssetRefsReusesExistingCopies 已有副本时不重复上传：
// active 直接复用，pending/failed 原样返回交由提交预检拦截。
func TestResolveSmartAssetRefsReusesExistingCopies(t *testing.T) {
	tests := []struct {
		name       string
		copyStatus string
		upstreamId string
		wantStatus string
	}{
		{"active copy reused", model.AssetStatusActive, "up-act", model.AssetStatusActive},
		{"pending copy not re-uploaded", model.AssetStatusPending, "up-pend", model.AssetStatusPending},
		{"failed copy not retried", model.AssetStatusFailed, "up-fail", model.AssetStatusFailed},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			stub := &stubAssetAdapter{uploadAssetID: "up-new"}
			setupSmartAssetTest(t, stub)
			seedAssetChannel(t, 30, common.ChannelStatusEnabled, "ark_official")
			seedSmartAbility(t, "default", "seedance-lite", 30)
			seedSmartSourceAsset(t, 501, 42)
			seedSmartCopy(t, 501, 42, 30, tt.upstreamId, tt.copyStatus)

			resolutions, channelId, err := ResolveSmartAssetRefs(42, []string{"yun-501"}, "seedance-lite", []string{"default"})
			require.NoError(t, err)
			assert.Equal(t, 30, channelId)
			require.Len(t, resolutions, 1)
			assert.Equal(t, tt.wantStatus, resolutions[0].Status)
			assert.Equal(t, tt.upstreamId, resolutions[0].UpstreamAssetId)
			assert.Zero(t, stub.uploadCalls, "已有副本时不应触发上传")
		})
	}
}

// TestResolveSmartAssetRefsGuards 归属与引用格式守卫：非本人素材、非法 ID
// 一律按 not_found 处理（不泄露存在性）；模型无渠道 / 渠道无协议分别报错。
func TestResolveSmartAssetRefsGuards(t *testing.T) {
	t.Run("other user's source asset is not_found", func(t *testing.T) {
		stub := &stubAssetAdapter{uploadAssetID: "up-x"}
		setupSmartAssetTest(t, stub)
		seedAssetChannel(t, 30, common.ChannelStatusEnabled, "ark_official")
		seedSmartAbility(t, "default", "seedance-lite", 30)
		seedSmartSourceAsset(t, 502, 43)

		_, _, err := ResolveSmartAssetRefs(42, []string{"yun-502"}, "seedance-lite", []string{"default"})
		assert.Equal(t, SmartAssetNotFound, smartErrorKind(t, err))
		assert.Zero(t, stub.uploadCalls)
	})

	t.Run("malformed refs are not_found", func(t *testing.T) {
		stub := &stubAssetAdapter{}
		setupSmartAssetTest(t, stub)
		for _, ref := range []string{"yun-abc", "yun-0", "yun-"} {
			_, _, err := ResolveSmartAssetRefs(42, []string{ref}, "seedance-lite", []string{"default"})
			assert.Equal(t, SmartAssetNotFound, smartErrorKind(t, err), "ref=%s", ref)
		}
	})

	t.Run("no channel serves the model", func(t *testing.T) {
		stub := &stubAssetAdapter{}
		setupSmartAssetTest(t, stub)
		seedAssetChannel(t, 30, common.ChannelStatusEnabled, "ark_official")
		seedSmartSourceAsset(t, 503, 42)

		_, _, err := ResolveSmartAssetRefs(42, []string{"yun-503"}, "unknown-model", []string{"default"})
		assert.Equal(t, SmartAssetNoModelChannel, smartErrorKind(t, err))
	})

	t.Run("candidate channels without asset protocol", func(t *testing.T) {
		stub := &stubAssetAdapter{}
		setupSmartAssetTest(t, stub)
		// 31 未配置素材协议，32 已禁用：都不可作为智能同步目标
		seedAssetChannel(t, 31, common.ChannelStatusEnabled, "")
		seedAssetChannel(t, 32, common.ChannelStatusManuallyDisabled, "ark_official")
		seedSmartAbility(t, "default", "seedance-lite", 31)
		seedSmartAbility(t, "default", "seedance-lite", 32)
		seedSmartSourceAsset(t, 504, 42)

		_, _, err := ResolveSmartAssetRefs(42, []string{"yun-504"}, "seedance-lite", []string{"default"})
		assert.Equal(t, SmartAssetNoProtocolChannel, smartErrorKind(t, err))
		assert.Zero(t, stub.uploadCalls)
	})
}

// TestResolveSmartAssetRefsConvergence 多引用必须收敛到同一渠道：
// 优先全 active 渠道，其次全有副本渠道，否则取首个候选并现场同步缺失引用。
func TestResolveSmartAssetRefsConvergence(t *testing.T) {
	t.Run("prefers the channel where all refs are active", func(t *testing.T) {
		stub := &stubAssetAdapter{uploadAssetID: "up-new"}
		setupSmartAssetTest(t, stub)
		seedAssetChannel(t, 30, common.ChannelStatusEnabled, "ark_official")
		seedAssetChannel(t, 32, common.ChannelStatusEnabled, "ark_official")
		seedSmartAbility(t, "default", "seedance-lite", 30)
		seedSmartAbility(t, "default", "seedance-lite", 32)
		seedSmartSourceAsset(t, 600, 42)
		seedSmartSourceAsset(t, 601, 42)
		seedSmartCopy(t, 600, 42, 30, "up-600a", model.AssetStatusActive)
		seedSmartCopy(t, 600, 42, 32, "up-600b", model.AssetStatusActive)
		seedSmartCopy(t, 601, 42, 32, "up-601", model.AssetStatusActive)

		resolutions, channelId, err := ResolveSmartAssetRefs(42, []string{"yun-600", "yun-601"}, "seedance-lite", []string{"default"})
		require.NoError(t, err)
		assert.Equal(t, 32, channelId, "601 只在 32 active，应收敛到 32")
		assert.Equal(t, "up-600b", resolutions[0].UpstreamAssetId)
		assert.Equal(t, "up-601", resolutions[1].UpstreamAssetId)
		assert.Zero(t, stub.uploadCalls)
	})

	t.Run("falls back to the channel where all refs have copies", func(t *testing.T) {
		stub := &stubAssetAdapter{uploadAssetID: "up-new"}
		setupSmartAssetTest(t, stub)
		seedAssetChannel(t, 30, common.ChannelStatusEnabled, "ark_official")
		seedAssetChannel(t, 32, common.ChannelStatusEnabled, "ark_official")
		seedSmartAbility(t, "default", "seedance-lite", 30)
		seedSmartAbility(t, "default", "seedance-lite", 32)
		seedSmartSourceAsset(t, 602, 42)
		seedSmartSourceAsset(t, 603, 42)
		seedSmartCopy(t, 602, 42, 30, "up-602", model.AssetStatusActive)
		seedSmartCopy(t, 603, 42, 30, "up-603", model.AssetStatusPending)
		seedSmartCopy(t, 603, 42, 32, "up-603b", model.AssetStatusActive)

		resolutions, channelId, err := ResolveSmartAssetRefs(42, []string{"yun-602", "yun-603"}, "seedance-lite", []string{"default"})
		require.NoError(t, err)
		assert.Equal(t, 30, channelId, "无全 active 渠道时收敛到全有副本的 30")
		assert.Equal(t, model.AssetStatusActive, resolutions[0].Status)
		assert.Equal(t, model.AssetStatusPending, resolutions[1].Status)
		assert.Zero(t, stub.uploadCalls)
	})

	t.Run("syncs missing refs on the first candidate channel", func(t *testing.T) {
		stub := &stubAssetAdapter{uploadAssetID: "up-605"}
		setupSmartAssetTest(t, stub)
		seedAssetChannel(t, 30, common.ChannelStatusEnabled, "ark_official")
		seedAssetChannel(t, 32, common.ChannelStatusEnabled, "ark_official")
		seedSmartAbility(t, "default", "seedance-lite", 30)
		seedSmartAbility(t, "default", "seedance-lite", 32)
		seedSmartSourceAsset(t, 604, 42)
		seedSmartSourceAsset(t, 605, 42)
		seedSmartCopy(t, 604, 42, 30, "up-604", model.AssetStatusActive)

		resolutions, channelId, err := ResolveSmartAssetRefs(42, []string{"yun-604", "yun-605"}, "seedance-lite", []string{"default"})
		require.NoError(t, err)
		assert.Equal(t, 30, channelId)
		assert.Equal(t, model.AssetStatusActive, resolutions[0].Status)
		assert.Equal(t, model.AssetStatusPending, resolutions[1].Status)
		assert.Equal(t, "up-605", resolutions[1].UpstreamAssetId)
		assert.Equal(t, 1, stub.uploadCalls, "只应同步缺副本的引用")
	})
}

// TestResolveSmartAssetRefsSyncFailure 上游上传失败时返回 sync_failed 并带上游错误详情。
func TestResolveSmartAssetRefsSyncFailure(t *testing.T) {
	stub := &stubAssetAdapter{uploadErr: errors.New("upstream 400: invalid media")}
	setupSmartAssetTest(t, stub)
	seedAssetChannel(t, 30, common.ChannelStatusEnabled, "ark_official")
	seedSmartAbility(t, "default", "seedance-lite", 30)
	seedSmartSourceAsset(t, 610, 42)

	_, _, err := ResolveSmartAssetRefs(42, []string{"yun-610"}, "seedance-lite", []string{"default"})
	require.Error(t, err)
	assert.Equal(t, SmartAssetSyncFailed, smartErrorKind(t, err))
	assert.Contains(t, err.Error(), "invalid media")
}
