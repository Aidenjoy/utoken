package director

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupCanvasGenDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	prevDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = prevDB })
	require.NoError(t, db.AutoMigrate(&model.CanvasGeneration{}, &model.DirectorAsset{}))
	return db
}

// 用户取消后，迟到的成功/失败结果不得改写取消状态，也不得把结果归档进素材库。
func TestCanvasGenCancelNotOverwritten(t *testing.T) {
	db := setupCanvasGenDB(t)

	gen := &model.CanvasGeneration{
		UserID: 1, ProjectID: 1, NodeID: "n1", Kind: "video",
		Prompt: "p", Status: model.DirectorGenStatusProcessing,
	}
	require.NoError(t, gen.Insert())

	// 非本人任务不可取消
	cancelled, err := model.CancelCanvasGeneration(gen.ID, 2)
	require.NoError(t, err)
	assert.False(t, cancelled)

	cancelled, err = model.CancelCanvasGeneration(gen.ID, 1)
	require.NoError(t, err)
	require.True(t, cancelled)

	markCanvasGenSuccess(gen.ID, "http://example.com/v.mp4")
	markCanvasGenFailed(gen.ID, assert.AnError)

	reloaded, err := model.GetCanvasGenerationByID(gen.ID)
	require.NoError(t, err)
	assert.Equal(t, model.DirectorGenStatusCancelled, reloaded.Status)
	assert.Empty(t, reloaded.ResultURL)

	var assets int64
	require.NoError(t, db.Model(&model.DirectorAsset{}).Count(&assets).Error)
	assert.Zero(t, assets, "已取消的结果不应归档到素材库")

	// 已结束的任务重复取消不命中
	cancelled, err = model.CancelCanvasGeneration(gen.ID, 1)
	require.NoError(t, err)
	assert.False(t, cancelled)
}

// 正常完成的任务照常落盘并归档素材，状态守卫不得误伤正常结算。
func TestCanvasGenSuccessArchivesAsset(t *testing.T) {
	db := setupCanvasGenDB(t)

	gen := &model.CanvasGeneration{
		UserID: 1, ProjectID: 7, NodeID: "n2", Kind: "image",
		Prompt: "hero shot", Status: model.DirectorGenStatusProcessing,
	}
	require.NoError(t, gen.Insert())

	markCanvasGenSuccess(gen.ID, "http://example.com/i.png")

	reloaded, err := model.GetCanvasGenerationByID(gen.ID)
	require.NoError(t, err)
	assert.Equal(t, model.DirectorGenStatusSuccess, reloaded.Status)
	assert.Equal(t, "http://example.com/i.png", reloaded.ResultURL)

	var asset model.DirectorAsset
	require.NoError(t, db.Where("category = ?", "canvas").First(&asset).Error)
	assert.Equal(t, "hero shot", asset.Name)
	assert.Equal(t, "http://example.com/i.png", asset.URL)
	require.NotNil(t, asset.ProjectID)
	assert.Equal(t, 7, *asset.ProjectID)
}
