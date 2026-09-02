package model

import (
	"time"
)

// ===== 云导演：在线剪辑工程 =====

// 剪辑工程状态
const (
	DirectorEditStatusDraft     = "draft"
	DirectorEditStatusRendering = "rendering"
	DirectorEditStatusDone      = "done"
	DirectorEditStatusFailed    = "failed"
)

// DirectorEditProject 视频剪辑工程（云端在线剪辑）
// Timeline 为 JSON 结构：
//
//	{
//	  "clips":     [{"storyboardId":1,"srcUrl":"...","start":0,"end":5,"speed":1,"volume":1,"muted":false,
//	                 "transition":{"type":"fade","duration":0.5},"rotate":0,"flip":"",
//	                 "filter":{"brightness":0,"contrast":1,"saturation":1,"temperature":0,"preset":"","sharpen":false}}],
//	  "subtitles": [{"text":"...","start":0,"end":3,"style":{"fontSize":30,"color":"#ffffff","position":"bottom","animation":""}}],
//	  "audio":     {"bgmUrl":"...","bgmVolume":0.8,"voiceVolume":1},
//	  "stickers":  [{"url":"...","x":10,"y":10,"width":120,"start":0,"end":5}]
//	}
type DirectorEditProject struct {
	ID          int    `json:"id" gorm:"primaryKey"`
	CreatedAt   int64  `json:"createdAt" gorm:"index"`
	UpdatedAt   int64  `json:"updatedAt"`
	UserID      int    `json:"userId" gorm:"index"`
	EpisodeID   int    `json:"episodeId" gorm:"index;not null"`      // 所属分集
	ProjectID   int    `json:"projectId" gorm:"index"`               // 所属项目
	Name        string `json:"name" gorm:"size:128"`                 // 工程名称
	Timeline    string `json:"timeline" gorm:"type:text"`            // 剪辑时间轴JSON
	Status      string `json:"status" gorm:"size:32"`                // draft/rendering/done/failed
	OutputURL   string `json:"outputUrl" gorm:"size:512"`            // 渲染输出地址
	Progress    int    `json:"progress" gorm:"default:0"`            // 渲染进度 0-100
	ErrorMsg    string `json:"errorMsg" gorm:"type:text"`            // 渲染错误信息
}

func (DirectorEditProject) TableName() string { return "director_edit_projects" }

func (ep *DirectorEditProject) Insert() error {
	now := time.Now().Unix()
	ep.CreatedAt = now
	ep.UpdatedAt = now
	if ep.Status == "" {
		ep.Status = DirectorEditStatusDraft
	}
	return DB.Create(ep).Error
}

func (ep *DirectorEditProject) Update(fields map[string]any) error {
	ep.UpdatedAt = time.Now().Unix()
	return DB.Model(ep).Updates(fields).Error
}

func GetDirectorEditProjectByEpisode(episodeID int) (*DirectorEditProject, error) {
	var ep DirectorEditProject
	err := DB.Where("episode_id = ?", episodeID).Order("id DESC").First(&ep).Error
	return &ep, err
}

func GetDirectorEditProjectByID(id int) (*DirectorEditProject, error) {
	var ep DirectorEditProject
	err := DB.First(&ep, id).Error
	return &ep, err
}
