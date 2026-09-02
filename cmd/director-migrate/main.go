// cmd/director-migrate 云导演数据一次性迁移命令。
//
// 从源项目（gin-vue-admin 脚手架 + drama 业务，MySQL）迁移到本网关的
// director_* 表，并把所有素材文件从源文件服务搬运到 TOS。
//
// 用法：
//
//	DIRECTOR_MIGRATE_DSN='user:pass@tcp(123.57.188.187:3306)/gva' \
//	DIRECTOR_FILE_BASE='http://<源文件服务地址>' 或 DIRECTOR_FILE_DIR='<源项目 server 目录>' \
//	SQL_DSN='...目标库...' \
//	TOS_ACCESS_KEY=... TOS_SECRET_KEY=... TOS_BUCKET=... \
//	go run ./cmd/director-migrate
//
// 约定：
//   - 迁移数据全部归属管理员（user_id = 1）；
//   - 保留旧主键值（新表独立无冲突），按旧 ID 重写外键与 many2many 关联；
//   - 幂等：运行前清空全部 director_* 表；
//   - 下载失败的文件保留原 URL 并输出失败报告（director-migrate-failures.txt）。
//   - 源项目的 AI 配置（drama_ai_configs/drama_ai_providers，含明文密钥）不迁移，
//     由用户级「模型设定」替代。
package main

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/joho/godotenv"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const adminUserID = 1 // 迁移数据统一归属管理员

// ---------- 源库（gin-vue-admin，drama_* 表）只读结构 ----------

// 源表公共字段：id/created_at/updated_at/deleted_at 在各结构体中平铺定义，
// 不用嵌入结构体（实测嵌入字段不会被 GORM 扫描，导致 ID/时间全为零值）。

type srcDrama struct {
	ID            uint           `gorm:"column:id;primaryKey"`
	CreatedAt     time.Time      `gorm:"column:created_at"`
	UpdatedAt     time.Time      `gorm:"column:updated_at"`
	DeletedAt     gorm.DeletedAt `gorm:"column:deleted_at"`
	Title         string
	Category      string
	Description   string
	Genre         string
	Style         string
	TotalEpisodes int
	TotalDuration int
	Status        string
	Thumbnail     string
	Tags          string
	Metadata      string
}

func (srcDrama) TableName() string { return "drama_dramas" }

type srcEpisode struct {
	ID             uint           `gorm:"column:id;primaryKey"`
	CreatedAt      time.Time      `gorm:"column:created_at"`
	UpdatedAt      time.Time      `gorm:"column:updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"column:deleted_at"`
	DramaID        uint
	EpisodeNumber  int
	Title          string
	Content        string
	ScriptContent  string
	Description    string
	Duration       int
	TargetDuration int
	AspectRatio    string
	Resolution     string
	Metadata       string
	Status         string
	VideoURL       string
	Thumbnail      string
}

func (srcEpisode) TableName() string { return "drama_episodes" }

type srcCharacter struct {
	ID              uint           `gorm:"column:id;primaryKey"`
	CreatedAt       time.Time      `gorm:"column:created_at"`
	UpdatedAt       time.Time      `gorm:"column:updated_at"`
	DeletedAt       gorm.DeletedAt `gorm:"column:deleted_at"`
	DramaID         uint
	Name            string
	Role            string
	Description     string
	Appearance      string
	Prompt          string
	Personality     string
	ImageURL        string
	Source          string
	ReferenceImages string
	SeedValue       string
	SortOrder       int
}

func (srcCharacter) TableName() string { return "drama_characters" }

type srcScene struct {
	ID              uint           `gorm:"column:id;primaryKey"`
	CreatedAt       time.Time      `gorm:"column:created_at"`
	UpdatedAt       time.Time      `gorm:"column:updated_at"`
	DeletedAt       gorm.DeletedAt `gorm:"column:deleted_at"`
	DramaID         uint
	EpisodeID       *uint
	Location        string
	Time            string
	Prompt          string
	StoryboardCount int
	ImageURL        string
	Source          string
	Status          string
}

func (srcScene) TableName() string { return "drama_scenes" }

type srcProp struct {
	ID              uint           `gorm:"column:id;primaryKey"`
	CreatedAt       time.Time      `gorm:"column:created_at"`
	UpdatedAt       time.Time      `gorm:"column:updated_at"`
	DeletedAt       gorm.DeletedAt `gorm:"column:deleted_at"`
	DramaID         uint
	Name            string
	Type            string
	Description     string
	Prompt          string
	ImageURL        string
	Source          string
	Status          string
	ReferenceImages string
}

func (srcProp) TableName() string { return "drama_props" }

type srcStoryboard struct {
	ID               uint           `gorm:"column:id;primaryKey"`
	CreatedAt        time.Time      `gorm:"column:created_at"`
	UpdatedAt        time.Time      `gorm:"column:updated_at"`
	DeletedAt        gorm.DeletedAt `gorm:"column:deleted_at"`
	EpisodeID        uint
	SceneID          *uint
	StoryboardNumber int
	Title            string
	Location         string
	Time             string
	ShotType         string
	Angle            string
	Movement         string
	Result           string
	ImagePrompt      string
	VideoPrompt      string
	BgmPrompt        string
	SoundEffect      string
	Description      string
	Duration         int
	FirstFrameImage  string
	LastFrameImage   string
	ComposedImage    string
	ReferenceImages  string
	VideoURL         string
	SubtitleURL      string
	ComposedVideoURL string
	Status           string
}

func (srcStoryboard) TableName() string { return "drama_storyboards" }

type srcImageGeneration struct {
	ID              uint           `gorm:"column:id;primaryKey"`
	CreatedAt       time.Time      `gorm:"column:created_at"`
	UpdatedAt       time.Time      `gorm:"column:updated_at"`
	DeletedAt       gorm.DeletedAt `gorm:"column:deleted_at"`
	StoryboardID    *uint
	DramaID         *uint
	SceneID         *uint
	CharacterID     *uint
	PropID          *uint
	ImageType       string
	FrameType       string
	Provider        string
	Prompt          string
	NegativePrompt  string
	Model           string
	Size            string
	Seed            int64
	ImageURL        string
	LocalPath       string
	Status          string
	TaskID          string
	ErrorMsg        string
	ReferenceImages string
	CompletedAt     *time.Time
}

func (srcImageGeneration) TableName() string { return "drama_image_generations" }

type srcVideoGeneration struct {
	ID                 uint           `gorm:"column:id;primaryKey"`
	CreatedAt          time.Time      `gorm:"column:created_at"`
	UpdatedAt          time.Time      `gorm:"column:updated_at"`
	DeletedAt          gorm.DeletedAt `gorm:"column:deleted_at"`
	StoryboardID       *uint
	DramaID            *uint
	ImageGenID         *uint
	Provider           string
	Prompt             string
	Model              string
	ReferenceMode      string
	ImageURL           string
	FirstFrameURL      string
	LastFrameURL       string
	ReferenceImageURLs string
	Duration           int
	Resolution         string
	AspectRatio        string
	Seed               int64
	VideoURL           string
	LocalPath          string
	Status             string
	TaskID             string
	ErrorMsg           string
	CompletedAt        *time.Time
}

func (srcVideoGeneration) TableName() string { return "drama_video_generations" }

type srcVideoMerge struct {
	ID          uint           `gorm:"column:id;primaryKey"`
	CreatedAt   time.Time      `gorm:"column:created_at"`
	UpdatedAt   time.Time      `gorm:"column:updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"column:deleted_at"`
	EpisodeID   *uint
	DramaID     *uint
	Title       string
	Status      string
	Scenes      string
	MergedURL   string
	Duration    int
	TaskID      string
	ErrorMsg    string
	CompletedAt *time.Time
}

func (srcVideoMerge) TableName() string { return "drama_video_merges" }

type srcEditProject struct {
	ID        uint           `gorm:"column:id;primaryKey"`
	CreatedAt time.Time      `gorm:"column:created_at"`
	UpdatedAt time.Time      `gorm:"column:updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"column:deleted_at"`
	EpisodeID uint
	Name      string
	Timeline  string
	Status    string
	OutputURL string
	ErrorMsg  string
}

func (srcEditProject) TableName() string { return "drama_edit_projects" }

type srcAsset struct {
	ID           uint           `gorm:"column:id;primaryKey"`
	CreatedAt    time.Time      `gorm:"column:created_at"`
	UpdatedAt    time.Time      `gorm:"column:updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"column:deleted_at"`
	DramaID      *uint
	EpisodeID    *uint
	StoryboardID *uint
	Name         string
	Type         string
	Category     string
	URL          string
	LocalPath    string
	FileSize     int64
	Width        int
	Height       int
	Duration     int
	IsFavorite   bool
}

func (srcAsset) TableName() string { return "drama_assets" }

type srcAssetCategory struct {
	ID        uint           `gorm:"column:id;primaryKey"`
	CreatedAt time.Time      `gorm:"column:created_at"`
	UpdatedAt time.Time      `gorm:"column:updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"column:deleted_at"`
	Name      string
}

func (srcAssetCategory) TableName() string { return "drama_asset_categories" }

// many2many 关联行（gorm 默认列名）
type srcEpisodeCharacter struct {
	EpisodeID   uint `gorm:"column:episode_id"`
	CharacterID uint `gorm:"column:character_id"`
}

func (srcEpisodeCharacter) TableName() string { return "drama_episode_characters" }

type srcEpisodeScene struct {
	EpisodeID uint `gorm:"column:episode_id"`
	SceneID   uint `gorm:"column:scene_id"`
}

func (srcEpisodeScene) TableName() string { return "drama_episode_scenes" }

type srcStoryboardCharacter struct {
	StoryboardID uint `gorm:"column:storyboard_id"`
	CharacterID  uint `gorm:"column:character_id"`
}

func (srcStoryboardCharacter) TableName() string { return "drama_storyboard_characters" }

// ---------- 文件搬运 ----------

var (
	fileBase   string
	fileDir    string
	urlCache   = map[string]string{}
	urlMu      sync.Mutex
	seq        int
	failures   []string
	failMu     sync.Mutex
	httpClient = &http.Client{Timeout: 10 * time.Minute}
)

func reportFailure(stage, rawURL string, err error) {
	msg := fmt.Sprintf("[%s] %s: %v", stage, rawURL, err)
	failMu.Lock()
	failures = append(failures, msg)
	failMu.Unlock()
	fmt.Println("  ! " + msg)
}

// transferURL 将源服务文件下载并转存 TOS，返回新 URL；失败时保留原 URL。
// data: 内嵌数据与空串原样返回；相同源 URL 只做一次搬运。
func transferURL(raw string, projectID int) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.HasPrefix(raw, "data:") {
		return raw
	}
	urlMu.Lock()
	if v, ok := urlCache[raw]; ok {
		urlMu.Unlock()
		return v
	}
	urlMu.Unlock()

	data, err := readSourceFile(raw)
	if err != nil {
		reportFailure("download", raw, err)
		return raw
	}
	base := path.Base(strings.SplitN(strings.SplitN(raw, "?", 2)[0], "#", 2)[0])
	if base == "" || base == "/" || base == "." {
		base = "file.bin"
	}
	urlMu.Lock()
	seq++
	filename := fmt.Sprintf("%05d_%s", seq, base)
	urlMu.Unlock()
	newURL, _, err := common.UploadBytesToTOS(data, filename, adminUserID, directorBatchID(projectID))
	if err != nil {
		reportFailure("upload", raw, err)
		return raw
	}
	urlMu.Lock()
	urlCache[raw] = newURL
	urlMu.Unlock()
	return newURL
}

func directorBatchID(projectID int) string {
	if projectID > 0 {
		return fmt.Sprintf("director%d", projectID)
	}
	return "director"
}

// readSourceFile 解析源项目文件地址：配置 DIRECTOR_FILE_DIR 时优先从本地磁盘读取
// （相对路径直接拼接，绝对 URL 取其路径段）；本地未命中或未配置时回退 HTTP 下载
// （相对地址需配置 DIRECTOR_FILE_BASE）。
func readSourceFile(raw string) ([]byte, error) {
	rel := strings.SplitN(strings.SplitN(raw, "?", 2)[0], "#", 2)[0]
	if strings.HasPrefix(rel, "http://") || strings.HasPrefix(rel, "https://") {
		if u, err := url.Parse(rel); err == nil {
			rel = u.Path
		}
	}
	rel = strings.TrimLeft(rel, "/")
	if fileDir != "" && rel != "" {
		if data, err := os.ReadFile(filepath.Join(fileDir, rel)); err == nil {
			return data, nil
		}
	}
	full := raw
	if !strings.HasPrefix(raw, "http://") && !strings.HasPrefix(raw, "https://") {
		if fileBase == "" {
			return nil, fmt.Errorf("相对地址且未配置 DIRECTOR_FILE_BASE/DIRECTOR_FILE_DIR")
		}
		full = strings.TrimRight(fileBase, "/") + "/" + strings.TrimLeft(raw, "/")
	}
	resp, err := httpClient.Get(full)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

// transferRefArray 重写参考图 JSON 数组中的 URL（data: 内嵌保留）
func transferRefArray(jsonStr string, projectID int) string {
	s := strings.TrimSpace(jsonStr)
	if s == "" || s == "null" {
		return jsonStr
	}
	var urls []string
	if err := common.Unmarshal([]byte(s), &urls); err != nil {
		return jsonStr
	}
	for i, u := range urls {
		urls[i] = transferURL(u, projectID)
	}
	b, err := common.Marshal(urls)
	if err != nil {
		return jsonStr
	}
	return string(b)
}

// 剪辑时间轴内的文件字段
type tlClip struct {
	SrcURL string `json:"srcUrl"`
}
type tlAudio struct {
	BgmURL string `json:"bgmUrl"`
}
type tlSticker struct {
	URL string `json:"url"`
}

// transferTimeline 重写剪辑时间轴 JSON 中的素材地址
func transferTimeline(jsonStr string, projectID int) string {
	s := strings.TrimSpace(jsonStr)
	if s == "" || s == "null" {
		return jsonStr
	}
	var tl struct {
		Clips    []tlClip    `json:"clips"`
		Audio    tlAudio     `json:"audio"`
		Stickers []tlSticker `json:"stickers"`
	}
	if err := common.Unmarshal([]byte(s), &tl); err != nil {
		return jsonStr
	}
	for i := range tl.Clips {
		tl.Clips[i].SrcURL = transferURL(tl.Clips[i].SrcURL, projectID)
	}
	tl.Audio.BgmURL = transferURL(tl.Audio.BgmURL, projectID)
	for i := range tl.Stickers {
		tl.Stickers[i].URL = transferURL(tl.Stickers[i].URL, projectID)
	}
	b, err := common.Marshal(tl)
	if err != nil {
		return jsonStr
	}
	return string(b)
}

// ---------- 小工具 ----------

func unixOf(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.Unix()
}

func unixPtr(t *time.Time) *int64 {
	if t == nil || t.IsZero() {
		return nil
	}
	v := t.Unix()
	return &v
}

func uintPtr2IntPtr(p *uint) *int {
	if p == nil {
		return nil
	}
	v := int(*p)
	return &v
}

// ---------- 主流程 ----------

func main() {
	_ = godotenv.Load()

	srcDSN := os.Getenv("DIRECTOR_MIGRATE_DSN")
	if srcDSN == "" {
		fmt.Println("缺少 DIRECTOR_MIGRATE_DSN（源库 MySQL DSN）")
		os.Exit(1)
	}
	fileBase = strings.TrimSpace(os.Getenv("DIRECTOR_FILE_BASE"))
	fileDir = strings.TrimSpace(os.Getenv("DIRECTOR_FILE_DIR"))

	// 目标库：复用主进程的数据库配置（SQL_DSN / SQLite），InitDB 内含 AutoMigrate，
	// 会确保 director_* 新表存在。
	common.IsMasterNode = true
	if err := model.InitDB(); err != nil {
		fmt.Println("初始化目标数据库失败:", err)
		os.Exit(1)
	}
	tosOK := false
	if _, ok := common.GetTOSUploadConfig(); ok {
		tosOK = true
	} else {
		fmt.Println("警告: 未配置 TOS（TOS_ACCESS_KEY/TOS_SECRET_KEY/TOS_BUCKET），将保留全部原始 URL，不做文件搬运")
	}

	// 源库（只读）
	src, err := gorm.Open(mysql.Open(srcDSN), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		fmt.Println("连接源数据库失败:", err)
		os.Exit(1)
	}

	// 幂等：清空目标 director_* 表
	cleanTargetTables()

	// ===== 读取源数据 =====
	var dramas []srcDrama
	var episodes []srcEpisode
	var characters []srcCharacter
	var scenes []srcScene
	var props []srcProp
	var storyboards []srcStoryboard
	var imageGens []srcImageGeneration
	var videoGens []srcVideoGeneration
	var merges []srcVideoMerge
	var editProjects []srcEditProject
	var assets []srcAsset
	var categories []srcAssetCategory
	var epChars []srcEpisodeCharacter
	var epScenes []srcEpisodeScene
	var sbChars []srcStoryboardCharacter

	if err := src.Find(&dramas).Error; err != nil {
		fatal("读取源数据失败（确认 DIRECTOR_MIGRATE_DSN 指向含 drama_* 表的库）", err)
	}
	src.Find(&episodes)
	src.Find(&characters)
	src.Find(&scenes)
	src.Find(&props)
	src.Find(&storyboards)
	src.Find(&imageGens)
	src.Find(&videoGens)
	src.Find(&merges)
	src.Find(&editProjects)
	src.Find(&assets)
	src.Find(&categories)
	if err := src.Find(&epChars).Error; err != nil {
		fatal("读取 drama_episode_characters 失败", err)
	}
	if err := src.Find(&epScenes).Error; err != nil {
		fatal("读取 drama_episode_scenes 失败", err)
	}
	if err := src.Find(&sbChars).Error; err != nil {
		fatal("读取 drama_storyboard_characters 失败", err)
	}

	fmt.Printf("源数据: 项目 %d, 分集 %d, 角色 %d, 场景 %d, 道具 %d, 分镜 %d, 图任务 %d, 视频任务 %d, 拼接 %d, 剪辑 %d, 素材 %d, 分类 %d\n",
		len(dramas), len(episodes), len(characters), len(scenes), len(props), len(storyboards),
		len(imageGens), len(videoGens), len(merges), len(editProjects), len(assets), len(categories))
	fmt.Printf("源关联: 分集-角色 %d, 分集-场景 %d, 分镜-角色 %d\n", len(epChars), len(epScenes), len(sbChars))

	// 分集 → 项目（旧 drama_id）映射
	episodeProject := map[uint]int{}
	for _, e := range episodes {
		episodeProject[e.ID] = int(e.DramaID)
	}

	// ===== 项目 =====
	newProjects := make([]model.DirectorProject, 0, len(dramas))
	for _, d := range dramas {
		newProjects = append(newProjects, model.DirectorProject{
			ID:            int(d.ID),
			CreatedAt:     unixOf(d.CreatedAt),
			UpdatedAt:     unixOf(d.UpdatedAt),
			UserID:        adminUserID,
			Title:         d.Title,
			Category:      d.Category,
			Description:   d.Description,
			Genre:         d.Genre,
			Style:         d.Style,
			TotalEpisodes: d.TotalEpisodes,
			TotalDuration: d.TotalDuration,
			Status:        d.Status,
			Thumbnail:     transferMaybe(d.Thumbnail, int(d.ID), tosOK),
			Tags:          d.Tags,
			Metadata:      d.Metadata,
		})
	}
	batchInsert(newProjects)

	// ===== 分集 =====
	newEpisodes := make([]model.DirectorEpisode, 0, len(episodes))
	for _, e := range episodes {
		newEpisodes = append(newEpisodes, model.DirectorEpisode{
			ID:             int(e.ID),
			CreatedAt:      unixOf(e.CreatedAt),
			UpdatedAt:      unixOf(e.UpdatedAt),
			UserID:         adminUserID,
			ProjectID:      int(e.DramaID),
			EpisodeNumber:  e.EpisodeNumber,
			Title:          e.Title,
			Content:        e.Content,
			ScriptContent:  e.ScriptContent,
			Description:    e.Description,
			Duration:       e.Duration,
			TargetDuration: e.TargetDuration,
			AspectRatio:    e.AspectRatio,
			Resolution:     e.Resolution,
			Metadata:       e.Metadata,
			Status:         e.Status,
			VideoURL:       transferMaybe(e.VideoURL, int(e.DramaID), tosOK),
			Thumbnail:      transferMaybe(e.Thumbnail, int(e.DramaID), tosOK),
		})
	}
	batchInsert(newEpisodes)

	// ===== 角色 =====
	newCharacters := make([]model.DirectorCharacter, 0, len(characters))
	characterIDs := map[uint]bool{}
	for _, ch := range characters {
		characterIDs[ch.ID] = true
		newCharacters = append(newCharacters, model.DirectorCharacter{
			ID:              int(ch.ID),
			CreatedAt:       unixOf(ch.CreatedAt),
			UpdatedAt:       unixOf(ch.UpdatedAt),
			UserID:          adminUserID,
			ProjectID:       int(ch.DramaID),
			Name:            ch.Name,
			Role:            ch.Role,
			Description:     ch.Description,
			Appearance:      ch.Appearance,
			Prompt:          ch.Prompt,
			Personality:     ch.Personality,
			ImageURL:        transferMaybe(ch.ImageURL, int(ch.DramaID), tosOK),
			Source:          ch.Source,
			ReferenceImages: transferRefMaybe(ch.ReferenceImages, int(ch.DramaID), tosOK),
			SeedValue:       ch.SeedValue,
			SortOrder:       ch.SortOrder,
		})
	}
	batchInsert(newCharacters)

	// ===== 场景 =====
	newScenes := make([]model.DirectorScene, 0, len(scenes))
	sceneIDs := map[uint]bool{}
	for _, sc := range scenes {
		sceneIDs[sc.ID] = true
		newScenes = append(newScenes, model.DirectorScene{
			ID:              int(sc.ID),
			CreatedAt:       unixOf(sc.CreatedAt),
			UpdatedAt:       unixOf(sc.UpdatedAt),
			UserID:          adminUserID,
			ProjectID:       int(sc.DramaID),
			EpisodeID:       uintPtr2IntPtr(sc.EpisodeID),
			Location:        sc.Location,
			Time:            sc.Time,
			Prompt:          sc.Prompt,
			StoryboardCount: sc.StoryboardCount,
			ImageURL:        transferMaybe(sc.ImageURL, int(sc.DramaID), tosOK),
			Source:          sc.Source,
			Status:          sc.Status,
		})
	}
	batchInsert(newScenes)

	// ===== 道具 =====
	newProps := make([]model.DirectorProp, 0, len(props))
	for _, p := range props {
		newProps = append(newProps, model.DirectorProp{
			ID:              int(p.ID),
			CreatedAt:       unixOf(p.CreatedAt),
			UpdatedAt:       unixOf(p.UpdatedAt),
			UserID:          adminUserID,
			ProjectID:       int(p.DramaID),
			Name:            p.Name,
			Type:            p.Type,
			Description:     p.Description,
			Prompt:          p.Prompt,
			ImageURL:        transferMaybe(p.ImageURL, int(p.DramaID), tosOK),
			Source:          p.Source,
			Status:          p.Status,
			ReferenceImages: transferRefMaybe(p.ReferenceImages, int(p.DramaID), tosOK),
		})
	}
	batchInsert(newProps)

	// ===== 分镜 =====
	newStoryboards := make([]model.DirectorStoryboard, 0, len(storyboards))
	storyboardIDs := map[uint]bool{}
	for _, sb := range storyboards {
		storyboardIDs[sb.ID] = true
		projectID := episodeProject[sb.EpisodeID]
		newStoryboards = append(newStoryboards, model.DirectorStoryboard{
			ID:               int(sb.ID),
			CreatedAt:        unixOf(sb.CreatedAt),
			UpdatedAt:        unixOf(sb.UpdatedAt),
			UserID:           adminUserID,
			EpisodeID:        int(sb.EpisodeID),
			SceneID:          uintPtr2IntPtr(sb.SceneID),
			StoryboardNumber: sb.StoryboardNumber,
			Title:            sb.Title,
			Location:         sb.Location,
			Time:             sb.Time,
			ShotType:         sb.ShotType,
			Angle:            sb.Angle,
			Movement:         sb.Movement,
			Result:           sb.Result,
			ImagePrompt:      sb.ImagePrompt,
			VideoPrompt:      sb.VideoPrompt,
			BgmPrompt:        sb.BgmPrompt,
			SoundEffect:      sb.SoundEffect,
			Description:      sb.Description,
			Duration:         sb.Duration,
			FirstFrameImage:  transferMaybe(sb.FirstFrameImage, projectID, tosOK),
			LastFrameImage:   transferMaybe(sb.LastFrameImage, projectID, tosOK),
			ComposedImage:    transferMaybe(sb.ComposedImage, projectID, tosOK),
			ReferenceImages:  transferRefMaybe(sb.ReferenceImages, projectID, tosOK),
			VideoURL:         transferMaybe(sb.VideoURL, projectID, tosOK),
			SubtitleURL:      transferMaybe(sb.SubtitleURL, projectID, tosOK),
			ComposedVideoURL: transferMaybe(sb.ComposedVideoURL, projectID, tosOK),
			Status:           sb.Status,
		})
	}
	batchInsert(newStoryboards)

	// ===== 图片生成任务 =====
	newImageGens := make([]model.DirectorImageGeneration, 0, len(imageGens))
	for _, g := range imageGens {
		newImageGens = append(newImageGens, model.DirectorImageGeneration{
			ID:              int(g.ID),
			CreatedAt:       unixOf(g.CreatedAt),
			UpdatedAt:       unixOf(g.UpdatedAt),
			UserID:          adminUserID,
			StoryboardID:    uintPtr2IntPtr(g.StoryboardID),
			ProjectID:       uintPtr2IntPtr(g.DramaID),
			SceneID:         uintPtr2IntPtr(g.SceneID),
			CharacterID:     uintPtr2IntPtr(g.CharacterID),
			PropID:          uintPtr2IntPtr(g.PropID),
			ImageType:       g.ImageType,
			FrameType:       g.FrameType,
			Prompt:          g.Prompt,
			NegativePrompt:  g.NegativePrompt,
			Model:           g.Model,
			Size:            g.Size,
			Seed:            g.Seed,
			ImageURL:        transferMaybe(g.ImageURL, int(derefUint(g.DramaID)), tosOK),
			Status:          g.Status,
			TaskID:          g.TaskID,
			ErrorMsg:        g.ErrorMsg,
			ReferenceImages: transferRefMaybe(g.ReferenceImages, int(derefUint(g.DramaID)), tosOK),
			CompletedAt:     unixPtr(g.CompletedAt),
		})
	}
	batchInsert(newImageGens)

	// ===== 视频生成任务 =====
	newVideoGens := make([]model.DirectorVideoGeneration, 0, len(videoGens))
	for _, g := range videoGens {
		newVideoGens = append(newVideoGens, model.DirectorVideoGeneration{
			ID:                 int(g.ID),
			CreatedAt:          unixOf(g.CreatedAt),
			UpdatedAt:          unixOf(g.UpdatedAt),
			UserID:             adminUserID,
			StoryboardID:       uintPtr2IntPtr(g.StoryboardID),
			ProjectID:          uintPtr2IntPtr(g.DramaID),
			ImageGenID:         uintPtr2IntPtr(g.ImageGenID),
			Prompt:             g.Prompt,
			Model:              g.Model,
			ReferenceMode:      g.ReferenceMode,
			ImageURL:           transferMaybe(g.ImageURL, int(derefUint(g.DramaID)), tosOK),
			FirstFrameURL:      transferMaybe(g.FirstFrameURL, int(derefUint(g.DramaID)), tosOK),
			LastFrameURL:       transferMaybe(g.LastFrameURL, int(derefUint(g.DramaID)), tosOK),
			ReferenceImageURLs: transferRefMaybe(g.ReferenceImageURLs, int(derefUint(g.DramaID)), tosOK),
			Duration:           g.Duration,
			Resolution:         g.Resolution,
			AspectRatio:        g.AspectRatio,
			Seed:               g.Seed,
			VideoURL:           transferMaybe(g.VideoURL, int(derefUint(g.DramaID)), tosOK),
			Status:             g.Status,
			TaskID:             g.TaskID,
			ErrorMsg:           g.ErrorMsg,
			CompletedAt:        unixPtr(g.CompletedAt),
		})
	}
	batchInsert(newVideoGens)

	// ===== 整集拼接任务 =====
	newMerges := make([]model.DirectorVideoMerge, 0, len(merges))
	for _, m := range merges {
		newMerges = append(newMerges, model.DirectorVideoMerge{
			ID:          int(m.ID),
			CreatedAt:   unixOf(m.CreatedAt),
			UpdatedAt:   unixOf(m.UpdatedAt),
			UserID:      adminUserID,
			EpisodeID:   uintPtr2IntPtr(m.EpisodeID),
			ProjectID:   uintPtr2IntPtr(m.DramaID),
			Title:       m.Title,
			Status:      m.Status,
			Scenes:      m.Scenes,
			MergedURL:   transferMaybe(m.MergedURL, int(derefUint(m.DramaID)), tosOK),
			Duration:    m.Duration,
			TaskID:      m.TaskID,
			ErrorMsg:    m.ErrorMsg,
			CompletedAt: unixPtr(m.CompletedAt),
		})
	}
	batchInsert(newMerges)

	// ===== 剪辑工程 =====
	newEditProjects := make([]model.DirectorEditProject, 0, len(editProjects))
	for _, ep := range editProjects {
		projectID := episodeProject[ep.EpisodeID]
		newEditProjects = append(newEditProjects, model.DirectorEditProject{
			ID:        int(ep.ID),
			CreatedAt: unixOf(ep.CreatedAt),
			UpdatedAt: unixOf(ep.UpdatedAt),
			UserID:    adminUserID,
			EpisodeID: int(ep.EpisodeID),
			ProjectID: projectID,
			Name:      ep.Name,
			Timeline:  transferTimelineMaybe(ep.Timeline, projectID, tosOK),
			Status:    ep.Status,
			OutputURL: transferMaybe(ep.OutputURL, projectID, tosOK),
			ErrorMsg:  ep.ErrorMsg,
		})
	}
	batchInsert(newEditProjects)

	// ===== 素材 =====
	newAssets := make([]model.DirectorAsset, 0, len(assets))
	for _, a := range assets {
		newAssets = append(newAssets, model.DirectorAsset{
			ID:           int(a.ID),
			CreatedAt:    unixOf(a.CreatedAt),
			UpdatedAt:    unixOf(a.UpdatedAt),
			UserID:       adminUserID,
			ProjectID:    uintPtr2IntPtr(a.DramaID),
			EpisodeID:    uintPtr2IntPtr(a.EpisodeID),
			StoryboardID: uintPtr2IntPtr(a.StoryboardID),
			Name:         a.Name,
			Type:         a.Type,
			Category:     a.Category,
			URL:          transferMaybe(a.URL, int(derefUint(a.DramaID)), tosOK),
			FileSize:     a.FileSize,
			Width:        a.Width,
			Height:       a.Height,
			Duration:     a.Duration,
			IsFavorite:   a.IsFavorite,
		})
	}
	batchInsert(newAssets)

	// ===== 素材自定义分类 =====
	newCategories := make([]model.DirectorAssetCategory, 0, len(categories))
	for _, c := range categories {
		newCategories = append(newCategories, model.DirectorAssetCategory{
			ID:        int(c.ID),
			CreatedAt: unixOf(c.CreatedAt),
			UpdatedAt: unixOf(c.UpdatedAt),
			UserID:    adminUserID,
			Name:      c.Name,
		})
	}
	batchInsert(newCategories)

	// ===== many2many 关联（按旧 ID 重建，过滤两端不存在的孤儿行） =====
	episodeIDs := map[uint]bool{}
	for _, e := range episodes {
		episodeIDs[e.ID] = true
	}
	type episodeCharacterRow struct {
		EpisodeID   int `gorm:"column:director_episode_id"`
		CharacterID int `gorm:"column:director_character_id"`
	}
	type episodeSceneRow struct {
		EpisodeID int `gorm:"column:director_episode_id"`
		SceneID   int `gorm:"column:director_scene_id"`
	}
	type storyboardCharacterRow struct {
		StoryboardID int `gorm:"column:director_storyboard_id"`
		CharacterID  int `gorm:"column:director_character_id"`
	}
	var ecRows []episodeCharacterRow
	for _, r := range epChars {
		if episodeIDs[r.EpisodeID] && characterIDs[r.CharacterID] {
			ecRows = append(ecRows, episodeCharacterRow{int(r.EpisodeID), int(r.CharacterID)})
		} else {
			fmt.Printf("  孤儿行 分集-角色: episode=%d(%v) character=%d(%v)\n",
				r.EpisodeID, episodeIDs[r.EpisodeID], r.CharacterID, characterIDs[r.CharacterID])
		}
	}
	var esRows []episodeSceneRow
	for _, r := range epScenes {
		if episodeIDs[r.EpisodeID] && sceneIDs[r.SceneID] {
			esRows = append(esRows, episodeSceneRow{int(r.EpisodeID), int(r.SceneID)})
		} else {
			fmt.Printf("  孤儿行 分集-场景: episode=%d(%v) scene=%d(%v)\n",
				r.EpisodeID, episodeIDs[r.EpisodeID], r.SceneID, sceneIDs[r.SceneID])
		}
	}
	var scRows []storyboardCharacterRow
	for _, r := range sbChars {
		if storyboardIDs[r.StoryboardID] && characterIDs[r.CharacterID] {
			scRows = append(scRows, storyboardCharacterRow{int(r.StoryboardID), int(r.CharacterID)})
		}
	}
	if len(ecRows) > 0 {
		if err := model.DB.Table("director_episode_characters").CreateInBatches(ecRows, 500).Error; err != nil {
			fatal("写入 director_episode_characters 失败", err)
		}
	}
	if len(esRows) > 0 {
		if err := model.DB.Table("director_episode_scenes").CreateInBatches(esRows, 500).Error; err != nil {
			fatal("写入 director_episode_scenes 失败", err)
		}
	}
	if len(scRows) > 0 {
		if err := model.DB.Table("director_storyboard_characters").CreateInBatches(scRows, 500).Error; err != nil {
			fatal("写入 director_storyboard_characters 失败", err)
		}
	}
	fmt.Printf("关联: 分集-角色 %d, 分集-场景 %d, 分镜-角色 %d（过滤孤儿行后）\n", len(ecRows), len(esRows), len(scRows))

	// ===== 结果汇总 =====
	fmt.Println("迁移完成。")
	if len(failures) > 0 {
		report := "director-migrate-failures.txt"
		content := strings.Join(failures, "\n") + "\n"
		if wErr := os.WriteFile(report, []byte(content), 0644); wErr == nil {
			fmt.Printf("共 %d 个文件搬运失败（已保留原 URL），明细见 %s（%s）\n", len(failures), report, filepath.Base(report))
		} else {
			fmt.Printf("共 %d 个文件搬运失败，且失败报告写入失败: %v\n", len(failures), wErr)
		}
	} else {
		fmt.Println("全部文件搬运成功。")
	}
}

// transferMaybe 未配置 TOS 时跳过搬运（保留原 URL）
func transferMaybe(raw string, projectID int, tosOK bool) string {
	if !tosOK {
		return raw
	}
	return transferURL(raw, projectID)
}

func transferRefMaybe(jsonStr string, projectID int, tosOK bool) string {
	if !tosOK {
		return jsonStr
	}
	return transferRefArray(jsonStr, projectID)
}

func transferTimelineMaybe(jsonStr string, projectID int, tosOK bool) string {
	if !tosOK {
		return jsonStr
	}
	return transferTimeline(jsonStr, projectID)
}

func derefUint(p *uint) uint {
	if p == nil {
		return 0
	}
	return *p
}

// cleanTargetTables 幂等：清空全部 director_* 表（先关联表后主表）
func cleanTargetTables() {
	tables := []string{
		"director_storyboard_characters",
		"director_episode_characters",
		"director_episode_scenes",
		"director_image_generations",
		"director_video_generations",
		"director_video_merges",
		"director_edit_projects",
		"director_storyboards",
		"director_characters",
		"director_scenes",
		"director_props",
		"director_episodes",
		"director_assets",
		"director_asset_categories",
		"director_projects",
	}
	for _, t := range tables {
		if err := model.DB.Exec("DELETE FROM " + t).Error; err != nil {
			fmt.Printf("清空 %s 失败（表可能不存在，忽略）: %v\n", t, err)
		}
	}
	fmt.Println("已清空目标 director_* 表")
}

// batchInsert 批量写入（保留显式 ID；空集合直接跳过）
func batchInsert(rows any) {
	rv := reflect.ValueOf(rows)
	if rv.Kind() != reflect.Slice || rv.Len() == 0 {
		return
	}
	if err := model.DB.CreateInBatches(rows, 200).Error; err != nil {
		fatal("批量写入失败", err)
	}
}

func fatal(msg string, err error) {
	fmt.Println(msg+":", err)
	os.Exit(1)
}
