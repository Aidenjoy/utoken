package model

import (
	"time"
)

// ===== 智能画布：项目文档与生成任务 =====

// CanvasProject 画布项目：整张画布（节点/连线/视口/外观）以 JSON 文档持久化，
// 列表页只读摘要列（node_count/cover_url），进入编辑器才拉取完整文档。
// Document 刻意不加 gorm type 标签：string 默认映射为 MySQL longtext /
// PostgreSQL text / SQLite text，跨库都是大文本（同 LogBody 的处理方式）。
type CanvasProject struct {
	ID        int    `json:"id" gorm:"primaryKey"`
	CreatedAt int64  `json:"createdAt" gorm:"index"`
	UpdatedAt int64  `json:"updatedAt" gorm:"index"`
	UserID    int    `json:"userId" gorm:"index"`
	Title     string `json:"title" gorm:"size:128"`
	Document  string `json:"document"`
	NodeCount int    `json:"nodeCount"`
	CoverURL  string `json:"coverUrl" gorm:"size:512"`
}

func (CanvasProject) TableName() string { return "canvas_projects" }

func (p *CanvasProject) Insert() error {
	now := time.Now().Unix()
	p.CreatedAt = now
	p.UpdatedAt = now
	return DB.Create(p).Error
}

func (p *CanvasProject) Update(fields map[string]any) error {
	fields["updated_at"] = time.Now().Unix()
	return DB.Model(p).Updates(fields).Error
}

func GetCanvasProjectByID(id int) (*CanvasProject, error) {
	var p CanvasProject
	err := DB.First(&p, id).Error
	return &p, err
}

// ListCanvasProjects 画布项目列表（不含大字段 document），按最近更新排序
func ListCanvasProjects(userID int, keyword string, page, pageSize int) ([]*CanvasProject, int64, error) {
	query := DB.Model(&CanvasProject{}).Where("user_id = ?", userID)
	if keyword != "" {
		query = query.Where("title LIKE ?", "%"+keyword+"%")
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	page, pageSize = normalizePage(page, pageSize)
	var list []*CanvasProject
	err := query.Omit("document").Order("updated_at DESC, id DESC").
		Offset((page - 1) * pageSize).Limit(pageSize).Find(&list).Error
	return list, total, err
}

// CanvasGeneration 画布节点生成任务（图片同步回环 / 视频异步任务，前端轮询本表）
type CanvasGeneration struct {
	ID              int    `json:"id" gorm:"primaryKey"`
	CreatedAt       int64  `json:"createdAt" gorm:"index"`
	UpdatedAt       int64  `json:"updatedAt"`
	UserID          int    `json:"userId" gorm:"index"`
	ProjectID       int    `json:"projectId" gorm:"index"`
	NodeID          string `json:"nodeId" gorm:"size:64;index"`
	Kind            string `json:"kind" gorm:"size:16"`             // image/video
	Prompt          string `json:"prompt" gorm:"type:text"`         // 提示词
	Model           string `json:"model" gorm:"size:128"`           // 模型
	Size            string `json:"size" gorm:"size:32"`             // 图片尺寸
	Duration        int    `json:"duration"`                        // 视频时长(秒)
	AspectRatio     string `json:"aspectRatio" gorm:"size:16"`      // 视频画幅
	Resolution      string `json:"resolution" gorm:"size:32"`       // 视频分辨率
	ReferenceImages string `json:"referenceImages" gorm:"type:text"` // 参考图JSON数组
	Status          string `json:"status" gorm:"size:32;index"`     // processing/success/failed
	TaskID          string `json:"taskId" gorm:"size:128"`          // 第三方视频任务ID
	ResultURL       string `json:"resultUrl" gorm:"size:512"`       // 生成结果地址
	ErrorMsg        string `json:"errorMsg" gorm:"type:text"`       // 错误信息
	CompletedAt     *int64 `json:"completedAt"`                     // 完成时间
}

func (CanvasGeneration) TableName() string { return "canvas_generations" }

func (g *CanvasGeneration) Insert() error {
	now := time.Now().Unix()
	g.CreatedAt = now
	g.UpdatedAt = now
	if g.Status == "" {
		g.Status = DirectorGenStatusProcessing
	}
	return DB.Create(g).Error
}

func GetCanvasGenerationByID(id int) (*CanvasGeneration, error) {
	var g CanvasGeneration
	err := DB.First(&g, id).Error
	return &g, err
}

// ListPendingCanvasVideoGenerations 查找未完成的画布视频任务（进程重启后恢复轮询）
func ListPendingCanvasVideoGenerations() ([]*CanvasGeneration, error) {
	var list []*CanvasGeneration
	err := DB.Where("kind = ? AND status = ? AND task_id != ''", "video", DirectorGenStatusProcessing).
		Find(&list).Error
	return list, err
}