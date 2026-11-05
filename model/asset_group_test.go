package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setupAssetGroupFixture 迁移官方兼容 API 用到的 asset_groups / assets 两张表
// （model 包 TestMain 未含），并在测试前后清空，保证用例互不串扰。
func setupAssetGroupFixture(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&AssetGroup{}, &Asset{}))
	cleanup := func() {
		DB.Exec("DELETE FROM asset_groups")
		DB.Exec("DELETE FROM assets")
	}
	cleanup()
	t.Cleanup(cleanup)
}

// TestGetUserAssetGroupsIsolation 多租户隔离铁律：ListAssetGroups 只返回调用者
// 自己创建的组，即使其他用户的组 ID 与查询条件相同也不泄露。
func TestGetUserAssetGroupsIsolation(t *testing.T) {
	setupAssetGroupFixture(t)

	const userA, userB = 11, 22
	require.NoError(t, (&AssetGroup{UserID: userA, ChannelID: 1, GroupID: "group-a1", Name: "甲的素材组"}).Insert())
	require.NoError(t, (&AssetGroup{UserID: userA, ChannelID: 1, GroupID: "group-a2", Name: "甲的另一组"}).Insert())
	require.NoError(t, (&AssetGroup{UserID: userB, ChannelID: 2, GroupID: "group-b1", Name: "乙的素材组"}).Insert())

	gotA, next, err := GetUserAssetGroups(userA, nil, "", 0, "")
	require.NoError(t, err)
	assert.Empty(t, next)
	require.Len(t, gotA, 2)
	for _, g := range gotA {
		assert.Equal(t, userA, g.UserID)
		assert.Contains(t, []string{"group-a1", "group-a2"}, g.GroupID)
	}

	gotB, _, err := GetUserAssetGroups(userB, nil, "", 0, "")
	require.NoError(t, err)
	require.Len(t, gotB, 1)
	assert.Equal(t, "group-b1", gotB[0].GroupID)

	// 即便 A 显式传入 B 的组 ID，也查不到（group_id IN 先经 user_id 过滤）。
	gotA2, _, err := GetUserAssetGroups(userA, []string{"group-b1"}, "", 0, "")
	require.NoError(t, err)
	assert.Empty(t, gotA2)
}

// TestGetUserAssetGroupsFilters 组 ID 精确过滤、名称模糊过滤均在归属范围内生效；
// LIKE 的 _ 通配符必须被转义（只匹配字面下划线，不当单字符通配）。
func TestGetUserAssetGroupsFilters(t *testing.T) {
	setupAssetGroupFixture(t)

	const user = 33
	require.NoError(t, (&AssetGroup{UserID: user, ChannelID: 1, GroupID: "g-1", Name: "lions"}).Insert())
	require.NoError(t, (&AssetGroup{UserID: user, ChannelID: 1, GroupID: "g-2", Name: "tigers"}).Insert())
	require.NoError(t, (&AssetGroup{UserID: user, ChannelID: 1, GroupID: "g-3", Name: "a_b"}).Insert())
	require.NoError(t, (&AssetGroup{UserID: user, ChannelID: 1, GroupID: "g-4", Name: "axb"}).Insert())

	byID, _, err := GetUserAssetGroups(user, []string{"g-2"}, "", 0, "")
	require.NoError(t, err)
	require.Len(t, byID, 1)
	assert.Equal(t, "g-2", byID[0].GroupID)

	byName, _, err := GetUserAssetGroups(user, nil, "lion", 0, "")
	require.NoError(t, err)
	require.Len(t, byName, 1)
	assert.Equal(t, "g-1", byName[0].GroupID)

	// "_" 转义后只匹配字面下划线的 "a_b"；若未转义则会当单字符通配误中 "axb"。
	byUnderscore, _, err := GetUserAssetGroups(user, nil, "_", 0, "")
	require.NoError(t, err)
	require.Len(t, byUnderscore, 1)
	assert.Equal(t, "g-3", byUnderscore[0].GroupID)
}

// TestGetUserAssetGroupsPagination 游标分页：按 id desc 翻页，NextToken 正确串联，
// 最后一页返回空游标。
func TestGetUserAssetGroupsPagination(t *testing.T) {
	setupAssetGroupFixture(t)

	const user = 44
	g1 := &AssetGroup{UserID: user, ChannelID: 1, GroupID: "p-1", Name: "1"}
	g2 := &AssetGroup{UserID: user, ChannelID: 1, GroupID: "p-2", Name: "2"}
	g3 := &AssetGroup{UserID: user, ChannelID: 1, GroupID: "p-3", Name: "3"}
	require.NoError(t, g1.Insert())
	require.NoError(t, g2.Insert())
	require.NoError(t, g3.Insert())

	page1, next, err := GetUserAssetGroups(user, nil, "", 2, "")
	require.NoError(t, err)
	require.Len(t, page1, 2)
	assert.NotEmpty(t, next)
	// id desc：先返回后插入的两条
	assert.Equal(t, g3.ID, page1[0].ID)
	assert.Equal(t, g2.ID, page1[1].ID)

	page2, next2, err := GetUserAssetGroups(user, nil, "", 2, next)
	require.NoError(t, err)
	require.Len(t, page2, 1)
	assert.Empty(t, next2)
	assert.Equal(t, g1.ID, page2[0].ID)
}

// TestGetUserAssetGroupsInvalidCursor 非法游标返回 ErrInvalidCursor（控制器据此回 400）。
func TestGetUserAssetGroupsInvalidCursor(t *testing.T) {
	setupAssetGroupFixture(t)

	_, _, err := GetUserAssetGroups(1, nil, "", 0, "!!!not-base64!!!")
	assert.ErrorIs(t, err, ErrInvalidCursor)
}

// TestGetUserAssetsFilteredIsolation ListAssets 只返回本人素材；状态过滤用本地态，
// 跨用户即使共用同一 group_id 也互不可见。
func TestGetUserAssetsFilteredIsolation(t *testing.T) {
	setupAssetGroupFixture(t)

	const userA, userB = 55, 66
	const sharedGroup = "group-shared"
	require.NoError(t, (&Asset{UserID: userA, ChannelID: 1, AssetID: "asset-a1", GroupID: sharedGroup, Name: "a1", AssetType: AssetTypeImage, Status: AssetStatusActive}).Insert())
	require.NoError(t, (&Asset{UserID: userA, ChannelID: 1, AssetID: "asset-a2", GroupID: sharedGroup, Name: "a2", AssetType: AssetTypeImage, Status: AssetStatusPending}).Insert())
	require.NoError(t, (&Asset{UserID: userB, ChannelID: 2, AssetID: "asset-b1", GroupID: sharedGroup, Name: "b1", AssetType: AssetTypeImage, Status: AssetStatusActive}).Insert())

	gotA, _, err := GetUserAssetsFiltered(userA, nil, nil, "", 0, "")
	require.NoError(t, err)
	require.Len(t, gotA, 2)
	for _, a := range gotA {
		assert.Equal(t, userA, a.UserID)
	}

	// 状态过滤（本地态 active）：A 只剩一条。
	activeA, _, err := GetUserAssetsFiltered(userA, nil, []string{AssetStatusActive}, "", 0, "")
	require.NoError(t, err)
	require.Len(t, activeA, 1)
	assert.Equal(t, "asset-a1", activeA[0].AssetID)

	// 同一 group_id 下 B 查不到 A 的素材。
	gotB, _, err := GetUserAssetsFiltered(userB, []string{sharedGroup}, nil, "", 0, "")
	require.NoError(t, err)
	require.Len(t, gotB, 1)
	assert.Equal(t, "asset-b1", gotB[0].AssetID)
}

// TestDeleteAssetsByUserAndGroupID 级联删除仅作用于「本人 × 本组」，不影响他人同组素材。
func TestDeleteAssetsByUserAndGroupID(t *testing.T) {
	setupAssetGroupFixture(t)

	const userA, userB = 77, 88
	const group = "group-del"
	require.NoError(t, (&Asset{UserID: userA, ChannelID: 1, AssetID: "asset-a1", GroupID: group, Name: "a1", AssetType: AssetTypeImage, Status: AssetStatusActive}).Insert())
	require.NoError(t, (&Asset{UserID: userA, ChannelID: 1, AssetID: "asset-a2", GroupID: group, Name: "a2", AssetType: AssetTypeImage, Status: AssetStatusActive}).Insert())
	require.NoError(t, (&Asset{UserID: userB, ChannelID: 2, AssetID: "asset-b1", GroupID: group, Name: "b1", AssetType: AssetTypeImage, Status: AssetStatusActive}).Insert())

	deleted, err := DeleteAssetsByUserAndGroupID(userA, group)
	require.NoError(t, err)
	assert.EqualValues(t, 2, deleted)

	// A 的素材已清空，B 的不受影响。
	remainA, _, err := GetUserAssetsFiltered(userA, nil, nil, "", 0, "")
	require.NoError(t, err)
	assert.Empty(t, remainA)

	remainB, _, err := GetUserAssetsFiltered(userB, nil, nil, "", 0, "")
	require.NoError(t, err)
	assert.Len(t, remainB, 1)

	// 空 group_id 被拒绝，避免误删全表。
	_, err = DeleteAssetsByUserAndGroupID(userA, "")
	assert.Error(t, err)
}

// TestGetAssetGroupByUserAndGroupID 精确查询：命中本人组返回记录，跨用户查同 ID 返回 NotFound。
func TestGetAssetGroupByUserAndGroupID(t *testing.T) {
	setupAssetGroupFixture(t)

	const userA, userB = 91, 92
	require.NoError(t, (&AssetGroup{UserID: userA, ChannelID: 1, GroupID: "gx", Name: "n"}).Insert())

	got, err := GetAssetGroupByUserAndGroupID(userA, "gx")
	require.NoError(t, err)
	assert.Equal(t, "gx", got.GroupID)

	_, err = GetAssetGroupByUserAndGroupID(userB, "gx")
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
}
