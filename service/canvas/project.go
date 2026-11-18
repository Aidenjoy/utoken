package canvas

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// ===== 智能画布：项目与图层文档 =====
// 文档是前端画布的唯一真相：整份 JSON 存 canvas_projects.document，保存时带 revision。
// 后端只做结构校验（不解释图层渲染语义），保证任何被接受的文档都能被编辑器安全还原。

// maxCanvasLayers 单文档图层上限，避免超大文档拖垮保存与列表。
const maxCanvasLayers = 500

// maxCanvasTitleRunes 项目名长度上限
const maxCanvasTitleRunes = 100

// LayerCrop 源图裁剪区域（原图像素坐标）
type LayerCrop struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// CanvasLayer 画布图层
type CanvasLayer struct {
	ID       string     `json:"id"`
	Type     string     `json:"type"` // image | text
	Name     string     `json:"name"`
	URL      string     `json:"url,omitempty"`
	AssetID  string     `json:"assetId,omitempty"`
	Text     string     `json:"text,omitempty"`
	X        float64    `json:"x"`
	Y        float64    `json:"y"`
	Width    float64    `json:"width"`
	Height   float64    `json:"height"`
	Scale    float64    `json:"scale"`
	Rotation float64    `json:"rotation"`
	Opacity  float64    `json:"opacity"`
	Visible  bool       `json:"visible"`
	Locked   bool       `json:"locked"`
	Crop     *LayerCrop `json:"crop,omitempty"`
	FontSize float64    `json:"fontSize,omitempty"`
	Color    string     `json:"color,omitempty"`
}

// CanvasDocument 画布文档
type CanvasDocument struct {
	Version    int           `json:"version"`
	Width      int           `json:"width"`
	Height     int           `json:"height"`
	Background string        `json:"background"`
	Layers     []CanvasLayer `json:"layers"`
}

// CreateProjectRequest 新建项目入参
type CreateProjectRequest struct {
	Title      string `json:"title"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	Background string `json:"background"`
}

// emptyCanvasDocument 新建项目时的空文档
func emptyCanvasDocument(width, height int, background string) string {
	doc := CanvasDocument{Version: 1, Width: width, Height: height, Background: background, Layers: []CanvasLayer{}}
	payload, _ := common.Marshal(doc)
	return string(payload)
}

// CreateProject 新建画布项目
func CreateProject(userID int, req CreateProjectRequest) (*model.CanvasProject, error) {
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "未命名画布"
	}
	if utf8.RuneCountInString(title) > maxCanvasTitleRunes {
		return nil, fmt.Errorf("项目名称最多 %d 个字符", maxCanvasTitleRunes)
	}
	width, height := req.Width, req.Height
	if width <= 0 {
		width = 2048
	}
	if height <= 0 {
		height = 2048
	}
	if err := validateCanvasSize(width, height); err != nil {
		return nil, err
	}
	background := strings.TrimSpace(req.Background)
	if background == "" {
		background = "#ffffff"
	}
	project := &model.CanvasProject{
		UserID: userID, OrgID: model.GetUserOrgID(userID), Title: title,
		Width: width, Height: height, Background: background,
		Document: emptyCanvasDocument(width, height, background), Revision: 1,
	}
	if err := project.Insert(); err != nil {
		return nil, err
	}
	return project, nil
}

func validateCanvasSize(width, height int) error {
	if width <= 0 || height <= 0 {
		return errors.New("画布尺寸必须为正数")
	}
	if width > maxCanvasSide || height > maxCanvasSide {
		return fmt.Errorf("画布单边不能超过 %d 像素", maxCanvasSide)
	}
	aspect := float64(width) / float64(height)
	if aspect < 1.0/16 || aspect > 16 {
		return errors.New("画布宽高比需在 1:16 ~ 16:1 之间")
	}
	return nil
}

// SaveDocumentRequest 保存画布入参（带 revision 的乐观锁）
type SaveDocumentRequest struct {
	ProjectID  int            `json:"projectId"`
	Revision   int64          `json:"revision"`
	Document   CanvasDocument `json:"document"`
	Thumbnail  string         `json:"thumbnail"`
	Background string         `json:"background"`
}

// ValidateDocument 校验文档结构与数值合法性。
func ValidateDocument(doc CanvasDocument) error {
	if doc.Version != 1 {
		return fmt.Errorf("不支持的画布文档版本: %d", doc.Version)
	}
	if err := validateCanvasSize(doc.Width, doc.Height); err != nil {
		return err
	}
	if len(doc.Layers) > maxCanvasLayers {
		return fmt.Errorf("图层数量不能超过 %d", maxCanvasLayers)
	}
	seen := make(map[string]bool, len(doc.Layers))
	for i := range doc.Layers {
		layer := doc.Layers[i]
		if strings.TrimSpace(layer.ID) == "" {
			return fmt.Errorf("第 %d 个图层缺少 id", i+1)
		}
		if seen[layer.ID] {
			return fmt.Errorf("图层 id 重复: %s", layer.ID)
		}
		seen[layer.ID] = true
		switch layer.Type {
		case "image":
			if strings.TrimSpace(layer.URL) == "" {
				return fmt.Errorf("图层 %s 缺少图片地址", layer.ID)
			}
		case "text":
			if strings.TrimSpace(layer.Text) == "" {
				return fmt.Errorf("图层 %s 缺少文字内容", layer.ID)
			}
		default:
			return fmt.Errorf("图层 %s 类型不受支持: %s", layer.ID, layer.Type)
		}
		for _, v := range []float64{layer.X, layer.Y, layer.Width, layer.Height, layer.Scale, layer.Rotation, layer.Opacity} {
			if math.IsNaN(v) || math.IsInf(v, 0) {
				return fmt.Errorf("图层 %s 含非法数值", layer.ID)
			}
		}
		if layer.Width <= 0 || layer.Height <= 0 {
			return fmt.Errorf("图层 %s 尺寸必须为正数", layer.ID)
		}
		if layer.Scale <= 0 {
			return fmt.Errorf("图层 %s 缩放必须为正数", layer.ID)
		}
		if layer.Opacity < 0 || layer.Opacity > 1 {
			return fmt.Errorf("图层 %s 不透明度需在 0~1 之间", layer.ID)
		}
		if layer.Crop != nil {
			if layer.Crop.Width <= 0 || layer.Crop.Height <= 0 || layer.Crop.X < 0 || layer.Crop.Y < 0 {
				return fmt.Errorf("图层 %s 裁剪区域非法", layer.ID)
			}
		}
	}
	return nil
}

// SaveDocument 保存文档（revision 乐观锁）。
func SaveDocument(userID int, req SaveDocumentRequest) (*model.CanvasProject, error) {
	project, err := model.GetCanvasProjectByID(req.ProjectID)
	if err != nil {
		return nil, errors.New("画布不存在")
	}
	if project.UserID != userID {
		return nil, errors.New("画布不存在")
	}
	if req.Revision <= 0 {
		return nil, errors.New("缺少 revision，无法安全保存")
	}
	if err := ValidateDocument(req.Document); err != nil {
		return nil, err
	}
	payload, err := common.Marshal(req.Document)
	if err != nil {
		return nil, err
	}
	if len(payload) > maxCanvasDocumentBytes {
		return nil, fmt.Errorf("画布文档超过 %dMB，请删除部分图层后再保存", maxCanvasDocumentBytes>>20)
	}
	background := strings.TrimSpace(req.Background)
	if background == "" {
		background = req.Document.Background
	}
	if err := project.SaveCanvasDocument(req.Revision, string(payload), req.Document.Width,
		req.Document.Height, background, req.Thumbnail, len(req.Document.Layers)); err != nil {
		if errors.Is(err, model.ErrCanvasRevisionConflict) {
			return nil, err
		}
		return nil, err
	}
	return project, nil
}

// GetProject 读取项目（含文档正文）
func GetProject(userID, projectID int) (*model.CanvasProject, error) {
	project, err := model.GetCanvasProjectByID(projectID)
	if err != nil || project.UserID != userID {
		return nil, errors.New("画布不存在")
	}
	return project, nil
}

// ListProjects 列出当前用户的项目
func ListProjects(userID int, keyword string, page, pageSize int) ([]*model.CanvasProject, int64, error) {
	return model.ListCanvasProjects(model.CanvasProjectListFilter{
		UserID: userID, Keyword: keyword, Page: page, PageSize: pageSize,
	})
}

// RenameProject 重命名项目
func RenameProject(userID, projectID int, title string) error {
	title = strings.TrimSpace(title)
	if title == "" {
		return errors.New("项目名称不能为空")
	}
	if utf8.RuneCountInString(title) > maxCanvasTitleRunes {
		return fmt.Errorf("项目名称最多 %d 个字符", maxCanvasTitleRunes)
	}
	project, err := model.GetCanvasProjectByID(projectID)
	if err != nil || project.UserID != userID {
		return errors.New("画布不存在")
	}
	return model.RenameCanvasProject(projectID, userID, title)
}

// DeleteProject 删除项目（级联删除任务与流水）
func DeleteProject(userID, projectID int) error {
	project, err := model.GetCanvasProjectByID(projectID)
	if err != nil || project.UserID != userID {
		return errors.New("画布不存在")
	}
	return model.DeleteCanvasProjectCascade(projectID, userID)
}
