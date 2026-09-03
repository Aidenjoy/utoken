package model

import (
	"time"
)

// ===== 云导演：图片/视频生成任务与整集拼接 =====

// 生成任务状态
const (
	DirectorGenStatusPending    = "pending"
	DirectorGenStatusProcessing = "processing"
	DirectorGenStatusSuccess    = "success"
	DirectorGenStatusFailed     = "failed"
)

// DirectorImageGeneration 图片生成任务
type DirectorImageGeneration struct {
	ID              int    `json:"id" gorm:"primaryKey"`
	CreatedAt       int64  `json:"createdAt" gorm:"index"`
	UpdatedAt       int64  `json:"updatedAt"`
	UserID          int    `json:"userId" gorm:"index"`
	StoryboardID    *int   `json:"storyboardId" gorm:"index"`
	ProjectID       *int   `json:"projectId" gorm:"index"`
	SceneID         *int   `json:"sceneId" gorm:"index"`
	CharacterID     *int   `json:"characterId" gorm:"index"`
	PropID          *int   `json:"propId" gorm:"index"`
	ImageType       string `json:"imageType" gorm:"size:32;index"`         // character/scene/storyboard/prop
	Prompt          string `json:"prompt" gorm:"type:text"`                // 提示词
	Model           string `json:"model" gorm:"size:128"`                  // 模型
	Size            string `json:"size" gorm:"size:32"`                    // 尺寸
	ImageURL        string `json:"imageUrl" gorm:"size:512"`               // 图片地址
	Status          string `json:"status" gorm:"size:32;index"`            // pending/processing/success/failed
	TaskID          string `json:"taskId" gorm:"size:128"`                 // 第三方任务ID
	ErrorMsg        string `json:"errorMsg" gorm:"type:text"`              // 错误信息
	ReferenceImages string `json:"referenceImages" gorm:"type:text"`       // 参考图JSON数组
	CompletedAt     *int64 `json:"completedAt"`                            // 完成时间
}

func (DirectorImageGeneration) TableName() string { return "director_image_generations" }

func (g *DirectorImageGeneration) Insert() error {
	now := time.Now().Unix()
	g.CreatedAt = now
	g.UpdatedAt = now
	if g.Status == "" {
		g.Status = DirectorGenStatusPending
	}
	return DB.Create(g).Error
}

func (g *DirectorImageGeneration) Update(fields map[string]any) error {
	g.UpdatedAt = time.Now().Unix()
	return DB.Model(g).Updates(fields).Error
}

func GetDirectorImageGenerationByID(id int) (*DirectorImageGeneration, error) {
	var g DirectorImageGeneration
	err := DB.First(&g, id).Error
	return &g, err
}

// DirectorImageGenerationFilter 图片任务列表过滤
type DirectorImageGenerationFilter struct {
	UserID       int // 0 表示不过滤（仅管理员可用不过滤语义）
	StoryboardID *int
	CharacterID  *int
	SceneID      *int
	PropID       *int
	ProjectID    *int
	Status       string
	Page         int
	PageSize     int
}

func ListDirectorImageGenerations(f DirectorImageGenerationFilter) ([]*DirectorImageGeneration, int64, error) {
	query := DB.Model(&DirectorImageGeneration{})
	if f.UserID > 0 {
		query = query.Where("user_id = ?", f.UserID)
	}
	if f.StoryboardID != nil {
		query = query.Where("storyboard_id = ?", *f.StoryboardID)
	}
	if f.CharacterID != nil {
		query = query.Where("character_id = ?", *f.CharacterID)
	}
	if f.SceneID != nil {
		query = query.Where("scene_id = ?", *f.SceneID)
	}
	if f.PropID != nil {
		query = query.Where("prop_id = ?", *f.PropID)
	}
	if f.ProjectID != nil {
		query = query.Where("project_id = ?", *f.ProjectID)
	}
	if f.Status != "" {
		query = query.Where("status = ?", f.Status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	page, pageSize := normalizePage(f.Page, f.PageSize)
	var list []*DirectorImageGeneration
	err := query.Order("id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&list).Error
	return list, total, err
}

// DirectorVideoGeneration 视频生成任务
type DirectorVideoGeneration struct {
	ID                 int    `json:"id" gorm:"primaryKey"`
	CreatedAt          int64  `json:"createdAt" gorm:"index"`
	UpdatedAt          int64  `json:"updatedAt"`
	UserID             int    `json:"userId" gorm:"index"`
	StoryboardID       *int   `json:"storyboardId" gorm:"index"`
	ProjectID          *int   `json:"projectId" gorm:"index"`
	Prompt             string `json:"prompt" gorm:"type:text"`           // 提示词
	Model              string `json:"model" gorm:"size:128"`             // 模型
	ReferenceMode      string `json:"referenceMode" gorm:"size:32"`      // first_frame/last_frame/images
	FirstFrameURL      string `json:"firstFrameUrl" gorm:"size:512"`     // 首帧图
	LastFrameURL       string `json:"lastFrameUrl" gorm:"size:512"`      // 尾帧图
	ReferenceImageURLs string `json:"referenceImageUrls" gorm:"type:text"` // 参考图JSON数组
	Duration           int    `json:"duration"`                          // 时长(秒)
	Resolution         string `json:"resolution" gorm:"size:32"`         // 分辨率
	AspectRatio        string `json:"aspectRatio" gorm:"size:16"`        // 宽高比
	VideoURL           string `json:"videoUrl" gorm:"size:512"`          // 视频地址
	Status             string `json:"status" gorm:"size:32;index"`       // pending/processing/success/failed
	TaskID             string `json:"taskId" gorm:"size:128"`            // 第三方任务ID
	ErrorMsg           string `json:"errorMsg" gorm:"type:text"`         // 错误信息
	CompletedAt        *int64 `json:"completedAt"`                       // 完成时间
}

func (DirectorVideoGeneration) TableName() string { return "director_video_generations" }

func (g *DirectorVideoGeneration) Insert() error {
	now := time.Now().Unix()
	g.CreatedAt = now
	g.UpdatedAt = now
	if g.Status == "" {
		g.Status = DirectorGenStatusPending
	}
	return DB.Create(g).Error
}

func (g *DirectorVideoGeneration) Update(fields map[string]any) error {
	g.UpdatedAt = time.Now().Unix()
	return DB.Model(g).Updates(fields).Error
}

func GetDirectorVideoGenerationByID(id int) (*DirectorVideoGeneration, error) {
	var g DirectorVideoGeneration
	err := DB.First(&g, id).Error
	return &g, err
}

// DirectorVideoGenerationFilter 视频任务列表过滤
type DirectorVideoGenerationFilter struct {
	UserID       int // 0 表示不过滤（仅管理员可用不过滤语义）
	StoryboardID *int
	ProjectID    *int
	Status       string
	Page         int
	PageSize     int
}

func ListDirectorVideoGenerations(f DirectorVideoGenerationFilter) ([]*DirectorVideoGeneration, int64, error) {
	query := DB.Model(&DirectorVideoGeneration{})
	if f.UserID > 0 {
		query = query.Where("user_id = ?", f.UserID)
	}
	if f.StoryboardID != nil {
		query = query.Where("storyboard_id = ?", *f.StoryboardID)
	}
	if f.ProjectID != nil {
		query = query.Where("project_id = ?", *f.ProjectID)
	}
	if f.Status != "" {
		query = query.Where("status = ?", f.Status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	page, pageSize := normalizePage(f.Page, f.PageSize)
	var list []*DirectorVideoGeneration
	err := query.Order("id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&list).Error
	return list, total, err
}

// ListPendingDirectorVideoGenerations 查找未完成的视频任务（进程重启后恢复轮询）
func ListPendingDirectorVideoGenerations() ([]*DirectorVideoGeneration, error) {
	var list []*DirectorVideoGeneration
	err := DB.Where("status IN ?", []string{DirectorGenStatusPending, DirectorGenStatusProcessing}).
		Where("task_id != ''").
		Find(&list).Error
	return list, err
}
