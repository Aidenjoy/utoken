package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 素材 scene 列为后加的可空列：历史行是 NULL 而非空串。
// 视频工厂场景过滤必须把 NULL/空串行算进来，否则该场景 tab 会空列表。
func TestListDirectorAssetsSceneFilterIncludesLegacyNullRows(t *testing.T) {
	require.NoError(t, DB.Exec(
		"INSERT INTO director_assets (id, created_at, updated_at, user_id, name, type, category, scene, url) VALUES (?, 0, 0, 1, 'legacy', 'image', 'upload', NULL, 'http://example.com/legacy.png')",
		1001,
	).Error)
	require.NoError(t, DB.Exec(
		"INSERT INTO director_assets (id, created_at, updated_at, user_id, name, type, category, scene, url) VALUES (?, 0, 0, 1, 'tryon', 'image', 'upload', ?, 'http://example.com/tryon.png')",
		1002, AssetSceneTryOn,
	).Error)

	fresh := DirectorAsset{
		UserID:   1,
		Name:     "fresh",
		Type:     "image",
		Category: "upload",
		URL:      "http://example.com/fresh.png",
	}
	require.NoError(t, fresh.Insert())
	t.Cleanup(func() {
		_ = DB.Where("id IN ?", []int{1001, 1002, fresh.ID}).Delete(&DirectorAsset{}).Error
	})

	// 登记路径未指定场景时默认归入视频工厂
	assert.Equal(t, AssetSceneVideoFactory, fresh.Scene)

	list, total, err := ListDirectorAssets(DirectorAssetFilter{
		Scene:    AssetSceneVideoFactory,
		Page:     1,
		PageSize: 10,
	})
	require.NoError(t, err)
	assert.EqualValues(t, 2, total)
	names := make([]string, 0, len(list))
	for _, a := range list {
		names = append(names, a.Name)
	}
	assert.ElementsMatch(t, []string{"legacy", "fresh"}, names)

	_, total, err = ListDirectorAssets(DirectorAssetFilter{
		Scene:    AssetSceneTryOn,
		Page:     1,
		PageSize: 10,
	})
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)

	// 不限场景时全部可见
	_, total, err = ListDirectorAssets(DirectorAssetFilter{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.EqualValues(t, 3, total)
}
