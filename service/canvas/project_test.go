package canvas

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 保存必须带 revision 做乐观锁：旧版本写入要明确冲突，不能覆盖新内容。
func TestSaveDocumentRevisionConflict(t *testing.T) {
	setupCanvasTest(t)
	seedUser(t, 1, 1_000)
	project := newProject(t, 1)
	require.Equal(t, int64(1), project.Revision)

	doc := CanvasDocument{
		Version: 1, Width: 2048, Height: 2048, Background: "#ffffff",
		Layers: []CanvasLayer{{
			ID: "layer-1", Type: "image", Name: "底图", URL: "https://x/a.png",
			X: 0, Y: 0, Width: 2048, Height: 2048, Scale: 1, Rotation: 0, Opacity: 1, Visible: true,
		}},
	}
	saved, err := SaveDocument(1, SaveDocumentRequest{ProjectID: project.ID, Revision: 1, Document: doc})
	require.NoError(t, err)
	assert.Equal(t, int64(2), saved.Revision)
	assert.Equal(t, 1, saved.LayerCount)

	// 另一个窗口拿着旧 revision 写入 → 冲突
	_, err = SaveDocument(1, SaveDocumentRequest{ProjectID: project.ID, Revision: 1, Document: doc})
	assert.ErrorIs(t, err, model.ErrCanvasRevisionConflict)

	// 用最新 revision 可以继续保存
	saved, err = SaveDocument(1, SaveDocumentRequest{ProjectID: project.ID, Revision: 2, Document: doc})
	require.NoError(t, err)
	assert.Equal(t, int64(3), saved.Revision)

	// 他人不能写我的画布
	seedUser(t, 2, 1_000)
	_, err = SaveDocument(2, SaveDocumentRequest{ProjectID: project.ID, Revision: 3, Document: doc})
	require.Error(t, err)
	assert.NotErrorIs(t, err, model.ErrCanvasRevisionConflict, "越权应报不存在而不是冲突")
}

// 文档结构校验：任何被接受的文档都必须能被编辑器安全还原。
func TestValidateDocument(t *testing.T) {
	base := CanvasDocument{
		Version: 1, Width: 1024, Height: 1024, Background: "#fff",
		Layers: []CanvasLayer{{
			ID: "a", Type: "image", URL: "https://x/a.png",
			Width: 10, Height: 10, Scale: 1, Opacity: 1,
		}},
	}
	require.NoError(t, ValidateDocument(base))

	tests := []struct {
		name    string
		mutate  func(*CanvasDocument)
		wantErr string
	}{
		{"unsupported version", func(d *CanvasDocument) { d.Version = 2 }, "不支持的画布文档版本"},
		{"duplicate layer id", func(d *CanvasDocument) {
			d.Layers = append(d.Layers, d.Layers[0])
		}, "图层 id 重复"},
		{"image layer without url", func(d *CanvasDocument) { d.Layers[0].URL = "" }, "缺少图片地址"},
		{"text layer without text", func(d *CanvasDocument) {
			d.Layers[0].Type = "text"
			d.Layers[0].Text = ""
		}, "缺少文字内容"},
		{"unknown layer type", func(d *CanvasDocument) { d.Layers[0].Type = "video" }, "类型不受支持"},
		{"non positive size", func(d *CanvasDocument) { d.Layers[0].Width = 0 }, "尺寸必须为正数"},
		{"opacity out of range", func(d *CanvasDocument) { d.Layers[0].Opacity = 1.5 }, "不透明度"},
		{"bad crop", func(d *CanvasDocument) {
			d.Layers[0].Crop = &LayerCrop{X: -1, Y: 0, Width: 10, Height: 10}
		}, "裁剪区域非法"},
		{"canvas too wide", func(d *CanvasDocument) { d.Width = 10000 }, "单边不能超过"},
		{"canvas aspect out of range", func(d *CanvasDocument) {
			d.Width = 8192
			d.Height = 64
		}, "宽高比"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			doc := base
			doc.Layers = append([]CanvasLayer(nil), base.Layers...)
			tt.mutate(&doc)
			err := ValidateDocument(doc)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.wantErr)
		})
	}
}

// 新建项目的默认文档必须能被编辑器直接打开（空图层 + 合法画幅）。
func TestCreateProjectDefaults(t *testing.T) {
	setupCanvasTest(t)
	seedUser(t, 1, 1_000)

	project, err := CreateProject(1, CreateProjectRequest{})
	require.NoError(t, err)
	assert.Equal(t, "未命名画布", project.Title)
	assert.Equal(t, 2048, project.Width)
	assert.Equal(t, "#ffffff", project.Background)
	assert.Equal(t, int64(1), project.Revision)

	var doc CanvasDocument
	require.NoError(t, common.UnmarshalJsonStr(project.Document, &doc))
	assert.Equal(t, 1, doc.Version)
	assert.Empty(t, doc.Layers)

	_, err = CreateProject(1, CreateProjectRequest{Width: 99999, Height: 100})
	require.Error(t, err)
}

// 删除项目要连同任务与计费流水一起清理，避免孤儿数据。
func TestDeleteProjectCascades(t *testing.T) {
	setupCanvasTest(t)
	seedUser(t, 1, 1_000)
	project := newProject(t, 1)

	task := &model.CanvasTask{
		UserID: 1, ProjectID: project.ID, Tool: ToolTextToImage, IdempotencyKey: "del-1",
		Status: model.CanvasTaskStatusSucceeded, BillingState: model.CanvasBillingNone,
	}
	inserted, err := model.InsertCanvasTask(task)
	require.NoError(t, err)
	created, err := model.RecordCanvasLedger(&model.CanvasLedger{
		TaskID: inserted.ID, Kind: model.CanvasLedgerPreConsume, UserID: 1, Quota: 0,
	})
	require.NoError(t, err)
	require.True(t, created)

	require.NoError(t, DeleteProject(1, project.ID))

	var tasks, ledgers int64
	require.NoError(t, model.DB.Model(&model.CanvasTask{}).Count(&tasks).Error)
	require.NoError(t, model.DB.Model(&model.CanvasLedger{}).Count(&ledgers).Error)
	assert.Zero(t, tasks)
	assert.Zero(t, ledgers)
}

// 重命名只改标题，不动文档与 revision（避免误判「有人编辑过」）。
func TestRenameProjectKeepsRevision(t *testing.T) {
	setupCanvasTest(t)
	seedUser(t, 1, 1_000)
	project := newProject(t, 1)

	require.NoError(t, RenameProject(1, project.ID, "新名字"))
	updated, err := GetProject(1, project.ID)
	require.NoError(t, err)
	assert.Equal(t, "新名字", updated.Title)
	assert.Equal(t, int64(1), updated.Revision)

	require.Error(t, RenameProject(1, project.ID, "   "))
	require.Error(t, RenameProject(2, project.ID, "越权"))
}
