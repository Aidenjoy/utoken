package model

import (
	"strings"
	"time"
)

// ===== 云导演（Cloud Director）核心实体 =====
// 由独立视频创作项目移植而来：项目（短剧/电商/广告/日常）→ 分集 →
// 角色/场景/道具/分镜 → 图片/视频生成 → 剪辑合成。

// 项目类型（对应四个菜单）
const (
	DirectorCategoryDrama     = "drama"     // 短剧剧集
	DirectorCategoryEcommerce = "ecommerce" // 电商视频
	DirectorCategoryAd        = "ad"        // 广告视频
	DirectorCategoryDaily     = "daily"     // 日常视频
)

// 通用状态
const (
	DirectorStatusDraft     = "draft"
	DirectorStatusProducing = "producing"
	DirectorStatusCompleted = "completed"
)

func IsValidDirectorCategory(category string) bool {
	switch category {
	case DirectorCategoryDrama, DirectorCategoryEcommerce, DirectorCategoryAd, DirectorCategoryDaily:
		return true
	}
	return false
}

// DirectorProject 视频项目
type DirectorProject struct {
	ID            int    `json:"id" gorm:"primaryKey"`
	CreatedAt     int64  `json:"createdAt" gorm:"index"`
	UpdatedAt     int64  `json:"updatedAt"`
	UserID        int    `json:"userId" gorm:"index"`
	Title         string `json:"title" gorm:"size:128;not null"`              // 项目名称
	Category      string `json:"category" gorm:"size:32;index"`               // 项目类型
	Description   string `json:"description" gorm:"type:text"`                // 项目简介
	Genre         string `json:"genre" gorm:"size:64"`                        // 题材类型
	Style         string `json:"style" gorm:"size:64"`                        // 画风
	TotalEpisodes int    `json:"totalEpisodes" gorm:"default:1"`              // 计划总集数
	TotalDuration int    `json:"totalDuration" gorm:"default:0"`              // 总时长(秒)
	Status        string `json:"status" gorm:"size:32;index"`                 // draft/producing/completed
	Thumbnail     string `json:"thumbnail" gorm:"size:512"`                   // 封面图
	Tags          string `json:"tags" gorm:"type:text"`                       // 标签JSON数组
	Metadata      string `json:"metadata" gorm:"type:text"`                   // 扩展元数据JSON（类型差异化字段）
}

func (DirectorProject) TableName() string { return "director_projects" }

func (p *DirectorProject) Insert() error {
	now := time.Now().Unix()
	p.CreatedAt = now
	p.UpdatedAt = now
	if p.Category == "" {
		p.Category = DirectorCategoryDrama
	}
	if p.Style == "" {
		p.Style = "realistic"
	}
	if p.Status == "" {
		p.Status = DirectorStatusDraft
	}
	if p.TotalEpisodes <= 0 {
		p.TotalEpisodes = 1
	}
	return DB.Create(p).Error
}

func (p *DirectorProject) Update(fields map[string]any) error {
	p.UpdatedAt = time.Now().Unix()
	return DB.Model(p).Updates(fields).Error
}

func DeleteDirectorProject(id int) error {
	return DB.Delete(&DirectorProject{}, id).Error
}

func GetDirectorProjectByID(id int) (*DirectorProject, error) {
	var p DirectorProject
	err := DB.First(&p, id).Error
	return &p, err
}

// DirectorProjectListFilter 项目列表过滤条件
type DirectorProjectListFilter struct {
	UserID   int    // 0 表示不过滤
	Category string
	Status   string
	Keyword  string // 标题模糊搜索
	Page     int
	PageSize int
}

func ListDirectorProjects(f DirectorProjectListFilter) ([]*DirectorProject, int64, error) {
	query := DB.Model(&DirectorProject{})
	if f.UserID > 0 {
		query = query.Where("user_id = ?", f.UserID)
	}
	if f.Category != "" {
		query = query.Where("category = ?", f.Category)
	}
	if f.Status != "" {
		query = query.Where("status = ?", f.Status)
	}
	if f.Keyword != "" {
		query = query.Where("title LIKE ?", "%"+strings.TrimSpace(f.Keyword)+"%")
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	page, pageSize := normalizePage(f.Page, f.PageSize)
	var list []*DirectorProject
	err := query.Order("id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&list).Error
	return list, total, err
}

// DirectorEpisode 项目分集
type DirectorEpisode struct {
	ID             int                     `json:"id" gorm:"primaryKey"`
	CreatedAt      int64                   `json:"createdAt" gorm:"index"`
	UpdatedAt      int64                   `json:"updatedAt"`
	UserID         int                     `json:"userId" gorm:"index"`
	ProjectID      int                     `json:"projectId" gorm:"index;not null"`          // 所属项目
	EpisodeNumber  int                     `json:"episodeNumber" gorm:"not null"`            // 集号
	Title          string                  `json:"title" gorm:"size:128;not null"`           // 集标题
	Content        string                  `json:"content" gorm:"type:text"`                 // 原始内容
	ScriptContent  string                  `json:"scriptContent" gorm:"type:text"`           // AI改写后剧本
	Description    string                  `json:"description" gorm:"type:text"`             // 本集简介
	Duration       int                     `json:"duration" gorm:"default:0"`                // 时长(秒)
	TargetDuration int                     `json:"targetDuration" gorm:"default:60"`         // 目标总时长(秒)
	AspectRatio    string                  `json:"aspectRatio" gorm:"size:16"`               // 画面比例
	Resolution     string                  `json:"resolution" gorm:"size:16"`                // 分辨率
	Metadata       string                  `json:"metadata" gorm:"type:text"`                // 类型差异化录入字段JSON
	Status         string                  `json:"status" gorm:"size:32"`                    // 状态
	VideoURL       string                  `json:"videoUrl" gorm:"size:512"`                 // 成片地址
	Thumbnail      string                  `json:"thumbnail" gorm:"size:512"`                // 封面
	Characters     []*DirectorCharacter    `json:"characters" gorm:"many2many:director_episode_characters"` // 出场角色
	Scenes         []*DirectorScene        `json:"scenes" gorm:"many2many:director_episode_scenes"`         // 关联场景
}

func (DirectorEpisode) TableName() string { return "director_episodes" }

func (e *DirectorEpisode) Insert() error {
	now := time.Now().Unix()
	e.CreatedAt = now
	e.UpdatedAt = now
	if e.AspectRatio == "" {
		e.AspectRatio = "9:16"
	}
	if e.Resolution == "" {
		e.Resolution = "1080P"
	}
	if e.TargetDuration <= 0 {
		e.TargetDuration = 60
	}
	if e.Status == "" {
		e.Status = DirectorStatusDraft
	}
	return DB.Create(e).Error
}

// UpdateEpisodeFields 更新标量字段；characters/scenes 关联由专用接口维护
func (e *DirectorEpisode) Update(fields map[string]any) error {
	e.UpdatedAt = time.Now().Unix()
	return DB.Model(e).Updates(fields).Error
}

func DeleteDirectorEpisode(id int) error {
	return DB.Delete(&DirectorEpisode{}, id).Error
}

func GetDirectorEpisodeByID(id int) (*DirectorEpisode, error) {
	var e DirectorEpisode
	err := DB.First(&e, id).Error
	return &e, err
}

// GetDirectorEpisodeDetail 详情（预加载角色与场景）
func GetDirectorEpisodeDetail(id int) (*DirectorEpisode, error) {
	var e DirectorEpisode
	err := DB.Preload("Characters").Preload("Scenes").First(&e, id).Error
	return &e, err
}

func ListDirectorEpisodes(projectID int, page, pageSize int) ([]*DirectorEpisode, int64, error) {
	query := DB.Model(&DirectorEpisode{}).Where("project_id = ?", projectID)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	page, pageSize = normalizePage(page, pageSize)
	var list []*DirectorEpisode
	err := query.Order("episode_number ASC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&list).Error
	return list, total, err
}

// DirectorCharacter 角色
type DirectorCharacter struct {
	ID              int    `json:"id" gorm:"primaryKey"`
	CreatedAt       int64  `json:"createdAt" gorm:"index"`
	UpdatedAt       int64  `json:"updatedAt"`
	UserID          int    `json:"userId" gorm:"index"`
	ProjectID       int    `json:"projectId" gorm:"index;not null"`
	Name            string `json:"name" gorm:"size:64;not null"`      // 角色名称
	Role            string `json:"role" gorm:"size:64"`               // 角色定位 主角/配角/反派等
	Description     string `json:"description" gorm:"type:text"`      // 角色描述
	Appearance      string `json:"appearance" gorm:"type:text"`       // 外貌描述
	Prompt          string `json:"prompt" gorm:"type:text"`           // 外貌prompt（形象图生成用）
	Personality     string `json:"personality" gorm:"type:text"`      // 性格
	ImageURL        string `json:"imageUrl" gorm:"size:512"`          // 形象图
	Source          string `json:"source" gorm:"size:16"`             // 形象来源 ai/upload
	ReferenceImages string `json:"referenceImages" gorm:"type:text"`  // 参考图JSON数组
	SeedValue       string `json:"seedValue" gorm:"size:64"`          // 形象种子
	SortOrder       int    `json:"sortOrder" gorm:"default:0"`        // 排序
}

func (DirectorCharacter) TableName() string { return "director_characters" }

func (ch *DirectorCharacter) Insert() error {
	now := time.Now().Unix()
	ch.CreatedAt = now
	ch.UpdatedAt = now
	if ch.Source == "" {
		ch.Source = "ai"
	}
	return DB.Create(ch).Error
}

func (ch *DirectorCharacter) Update(fields map[string]any) error {
	ch.UpdatedAt = time.Now().Unix()
	return DB.Model(ch).Updates(fields).Error
}

func DeleteDirectorCharacter(id int) error {
	return DB.Delete(&DirectorCharacter{}, id).Error
}

func GetDirectorCharacterByID(id int) (*DirectorCharacter, error) {
	var ch DirectorCharacter
	err := DB.First(&ch, id).Error
	return &ch, err
}

func ListDirectorCharacters(projectID int, page, pageSize int) ([]*DirectorCharacter, int64, error) {
	query := DB.Model(&DirectorCharacter{}).Where("project_id = ?", projectID)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	page, pageSize = normalizePage(page, pageSize)
	var list []*DirectorCharacter
	err := query.Order("sort_order ASC, id ASC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&list).Error
	return list, total, err
}

// DirectorScene 场景
type DirectorScene struct {
	ID              int    `json:"id" gorm:"primaryKey"`
	CreatedAt       int64  `json:"createdAt" gorm:"index"`
	UpdatedAt       int64  `json:"updatedAt"`
	UserID          int    `json:"userId" gorm:"index"`
	ProjectID       int    `json:"projectId" gorm:"index;not null"`
	EpisodeID       *int   `json:"episodeId" gorm:"index"`
	Location        string `json:"location" gorm:"size:128;not null"` // 地点
	Time            string `json:"time" gorm:"size:64"`               // 时间 日/夜/黄昏等
	Prompt          string `json:"prompt" gorm:"type:text"`           // 场景图prompt
	StoryboardCount int    `json:"storyboardCount" gorm:"default:1"`  // 分镜数
	ImageURL        string `json:"imageUrl" gorm:"size:512"`          // 场景图
	Source          string `json:"source" gorm:"size:16"`             // 场景图来源 ai/upload
	Status          string `json:"status" gorm:"size:32"`             // 状态
}

func (DirectorScene) TableName() string { return "director_scenes" }

func (s *DirectorScene) Insert() error {
	now := time.Now().Unix()
	s.CreatedAt = now
	s.UpdatedAt = now
	if s.Source == "" {
		s.Source = "ai"
	}
	if s.Status == "" {
		s.Status = "pending"
	}
	if s.StoryboardCount <= 0 {
		s.StoryboardCount = 1
	}
	return DB.Create(s).Error
}

func (s *DirectorScene) Update(fields map[string]any) error {
	s.UpdatedAt = time.Now().Unix()
	return DB.Model(s).Updates(fields).Error
}

func DeleteDirectorScene(id int) error {
	return DB.Delete(&DirectorScene{}, id).Error
}

func GetDirectorSceneByID(id int) (*DirectorScene, error) {
	var s DirectorScene
	err := DB.First(&s, id).Error
	return &s, err
}

func ListDirectorScenes(projectID int, episodeID *int, page, pageSize int) ([]*DirectorScene, int64, error) {
	query := DB.Model(&DirectorScene{}).Where("project_id = ?", projectID)
	if episodeID != nil {
		query = query.Where("episode_id = ?", *episodeID)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	page, pageSize = normalizePage(page, pageSize)
	var list []*DirectorScene
	err := query.Order("id ASC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&list).Error
	return list, total, err
}

// DirectorProp 道具
type DirectorProp struct {
	ID              int    `json:"id" gorm:"primaryKey"`
	CreatedAt       int64  `json:"createdAt" gorm:"index"`
	UpdatedAt       int64  `json:"updatedAt"`
	UserID          int    `json:"userId" gorm:"index"`
	ProjectID       int    `json:"projectId" gorm:"index;not null"`
	Name            string `json:"name" gorm:"size:64;not null"`     // 道具名称
	Type            string `json:"type" gorm:"size:64"`              // 道具类型
	Description     string `json:"description" gorm:"type:text"`     // 道具描述
	Prompt          string `json:"prompt" gorm:"type:text"`          // 道具图prompt
	ImageURL        string `json:"imageUrl" gorm:"size:512"`         // 道具图
	Source          string `json:"source" gorm:"size:16"`            // 道具图来源 ai/upload
	Status          string `json:"status" gorm:"size:32"`            // pending/imaged
	ReferenceImages string `json:"referenceImages" gorm:"type:text"` // 参考图JSON数组
}

func (DirectorProp) TableName() string { return "director_props" }

func (p *DirectorProp) Insert() error {
	now := time.Now().Unix()
	p.CreatedAt = now
	p.UpdatedAt = now
	if p.Source == "" {
		p.Source = "ai"
	}
	if p.Status == "" {
		p.Status = "pending"
	}
	return DB.Create(p).Error
}

func (p *DirectorProp) Update(fields map[string]any) error {
	p.UpdatedAt = time.Now().Unix()
	return DB.Model(p).Updates(fields).Error
}

func DeleteDirectorProp(id int) error {
	return DB.Delete(&DirectorProp{}, id).Error
}

func GetDirectorPropByID(id int) (*DirectorProp, error) {
	var p DirectorProp
	err := DB.First(&p, id).Error
	return &p, err
}

func ListDirectorProps(projectID int, page, pageSize int) ([]*DirectorProp, int64, error) {
	query := DB.Model(&DirectorProp{}).Where("project_id = ?", projectID)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	page, pageSize = normalizePage(page, pageSize)
	var list []*DirectorProp
	err := query.Order("id ASC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&list).Error
	return list, total, err
}

// DirectorStoryboard 分镜
type DirectorStoryboard struct {
	ID               int                 `json:"id" gorm:"primaryKey"`
	CreatedAt        int64               `json:"createdAt" gorm:"index"`
	UpdatedAt        int64               `json:"updatedAt"`
	UserID           int                 `json:"userId" gorm:"index"`
	EpisodeID        int                 `json:"episodeId" gorm:"index;not null"`
	SceneID          *int                `json:"sceneId" gorm:"index"`
	StoryboardNumber int                 `json:"storyboardNumber" gorm:"not null"`       // 镜号
	Title            string              `json:"title" gorm:"size:128"`                  // 分镜标题
	Location         string              `json:"location" gorm:"size:128"`               // 地点
	Time             string              `json:"time" gorm:"size:64"`                    // 时间
	ShotType         string              `json:"shotType" gorm:"size:64"`                // 景别 远/全/中/近/特
	Angle            string              `json:"angle" gorm:"size:64"`                   // 机位角度
	Movement         string              `json:"movement" gorm:"size:64"`                // 运镜
	Result           string              `json:"result" gorm:"type:text"`                // 画面结果
	ImagePrompt      string              `json:"imagePrompt" gorm:"type:text"`           // 图片prompt
	VideoPrompt      string              `json:"videoPrompt" gorm:"type:text"`           // 视频prompt
	BgmPrompt        string              `json:"bgmPrompt" gorm:"type:text"`             // 配乐prompt
	SoundEffect      string              `json:"soundEffect" gorm:"type:text"`           // 音效
	Description      string              `json:"description" gorm:"type:text"`           // 备注
	Duration         int                 `json:"duration" gorm:"default:0"`              // 时长(秒)
	FirstFrameImage  string              `json:"firstFrameImage" gorm:"size:512"`        // 首帧图
	LastFrameImage   string              `json:"lastFrameImage" gorm:"size:512"`         // 尾帧图
	ComposedImage    string              `json:"composedImage" gorm:"size:512"`          // 合成图(九宫格)
	ReferenceImages  string              `json:"referenceImages" gorm:"type:text"`       // 参考图JSON数组
	VideoURL         string              `json:"videoUrl" gorm:"size:512"`               // 生成视频
	SubtitleURL      string              `json:"subtitleUrl" gorm:"size:512"`            // 字幕文件
	ComposedVideoURL string              `json:"composedVideoUrl" gorm:"size:512"`       // 合成后视频
	Status           string              `json:"status" gorm:"size:32;index"`            // 状态
	Characters       []*DirectorCharacter `json:"characters" gorm:"many2many:director_storyboard_characters"` // 出镜角色
}

func (DirectorStoryboard) TableName() string { return "director_storyboards" }

func (sb *DirectorStoryboard) Insert() error {
	now := time.Now().Unix()
	sb.CreatedAt = now
	sb.UpdatedAt = now
	if sb.Status == "" {
		sb.Status = "pending"
	}
	return DB.Create(sb).Error
}

func (sb *DirectorStoryboard) Update(fields map[string]any) error {
	sb.UpdatedAt = time.Now().Unix()
	return DB.Model(sb).Updates(fields).Error
}

func DeleteDirectorStoryboard(id int) error {
	return DB.Delete(&DirectorStoryboard{}, id).Error
}

func GetDirectorStoryboardByID(id int) (*DirectorStoryboard, error) {
	var sb DirectorStoryboard
	err := DB.First(&sb, id).Error
	return &sb, err
}

func GetDirectorStoryboardDetail(id int) (*DirectorStoryboard, error) {
	var sb DirectorStoryboard
	err := DB.Preload("Characters").First(&sb, id).Error
	return &sb, err
}

func ListDirectorStoryboards(episodeID int, status string, page, pageSize int) ([]*DirectorStoryboard, int64, error) {
	query := DB.Model(&DirectorStoryboard{}).Where("episode_id = ?", episodeID)
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	page, pageSize = normalizePage(page, pageSize)
	var list []*DirectorStoryboard
	err := query.Preload("Characters").Order("storyboard_number ASC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&list).Error
	return list, total, err
}

// normalizePage 规范化分页参数
func normalizePage(page, pageSize int) (int, int) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 10
	}
	if pageSize > 200 {
		pageSize = 200
	}
	return page, pageSize
}
