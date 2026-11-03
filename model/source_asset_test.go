package model

import (
	"regexp"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setupSourceAssetFixture 迁移 source_assets 表（model 包 TestMain 未含）并注册清理。
func setupSourceAssetFixture(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&SourceAsset{}))
	cleanup := func() { DB.Exec("DELETE FROM source_assets") }
	cleanup()
	t.Cleanup(cleanup)
}

// sourceAssetRefPattern 对外引用的格式契约：asset-<14位年月日时分秒>-sm<3位数字>。
var sourceAssetRefPattern = regexp.MustCompile(`^asset-\d{14}-sm\d{3}$`)

// TestSourceAssetInsertGeneratesRefID Insert 必须为未指定 ref_id 的源素材生成合规
// 对外引用；已显式指定 ref_id 时原样保留（供确定性测试与历史数据复用）。
func TestSourceAssetInsertGeneratesRefID(t *testing.T) {
	setupSourceAssetFixture(t)

	auto := &SourceAsset{ID: 1, UserID: 42, Name: "a", AssetType: AssetTypeImage, SourceURL: "http://tos/a", Status: AssetStatusActive}
	require.NoError(t, auto.Insert())
	assert.Regexp(t, sourceAssetRefPattern, auto.RefID)

	explicit := &SourceAsset{ID: 2, RefID: "asset-20260907221226-sm042", UserID: 42, Name: "b", AssetType: AssetTypeImage, SourceURL: "http://tos/b", Status: AssetStatusActive}
	require.NoError(t, explicit.Insert())
	assert.Equal(t, "asset-20260907221226-sm042", explicit.RefID)
}

// TestGetSourceAssetByRefId 按 ref_id 精确查询：命中返回对应行，未命中返回
// gorm.ErrRecordNotFound（service 层据此把未知引用翻译为 not_found）。
func TestGetSourceAssetByRefId(t *testing.T) {
	setupSourceAssetFixture(t)
	require.NoError(t, (&SourceAsset{
		ID: 20, RefID: "asset-20260907221226-sm042", UserID: 42,
		Name: "x", AssetType: AssetTypeImage, SourceURL: "http://tos/x", Status: AssetStatusActive,
	}).Insert())

	got, err := GetSourceAssetByRefId("asset-20260907221226-sm042")
	require.NoError(t, err)
	assert.Equal(t, int64(20), got.ID)

	_, err = GetSourceAssetByRefId("asset-20260907221226-sm999")
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
}

// TestBackfillSourceAssetRefIDs 为历史（ref_id 为空）源素材补发引用：同一秒创建的多行
// 全部拿到合规且互不相同的 ref_id（时间戳取各行 CreatedAt，随机后缀经内存去重），
// 重复运行保持幂等，模拟多节点共享库重启时的自愈语义。
func TestBackfillSourceAssetRefIDs(t *testing.T) {
	setupSourceAssetFixture(t)

	for _, id := range []int64{10, 11, 12} {
		require.NoError(t, (&SourceAsset{
			ID: id, UserID: 42, Name: "legacy", AssetType: AssetTypeVideo,
			SourceURL: "http://tos/legacy", Status: AssetStatusActive,
		}).Insert())
	}
	// 模拟迁移前的历史行：ref_id 置 NULL，并把 CreatedAt 固定为同一秒以触发同秒去重。
	require.NoError(t, DB.Exec("UPDATE source_assets SET ref_id = NULL, created_at = 1700000000").Error)

	require.NoError(t, backfillSourceAssetRefIDs())

	var assets []*SourceAsset
	require.NoError(t, DB.Order("id asc").Find(&assets).Error)
	require.Len(t, assets, 3)
	seen := map[string]bool{}
	first := make([]string, 0, len(assets))
	for _, a := range assets {
		assert.Regexp(t, sourceAssetRefPattern, a.RefID)
		assert.False(t, seen[a.RefID], "ref_id 必须唯一, 重复: %s", a.RefID)
		seen[a.RefID] = true
		first = append(first, a.RefID)
	}

	require.NoError(t, backfillSourceAssetRefIDs())
	var after []*SourceAsset
	require.NoError(t, DB.Order("id asc").Find(&after).Error)
	require.Len(t, after, 3)
	for i, a := range after {
		assert.Equal(t, first[i], a.RefID, "重复回填必须保持幂等")
	}
}
