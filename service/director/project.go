package director

import (
	"errors"

	"github.com/QuantumNous/new-api/model"

	"gorm.io/gorm"
)

// ProjectService 项目/分集业务（级联删除、带统计列表、流水线进度、手动补录角色场景）
type ProjectService struct{}

// ProjectWithStats 项目及统计
type ProjectWithStats struct {
	model.DirectorProject
	EpisodeCount   int64  `json:"episodeCount"`
	CharacterCount int64  `json:"characterCount"`
	SceneCount     int64  `json:"sceneCount"`
	Username       string `json:"username,omitempty"` // 归属用户名（仅管理员视图填充）
}

// fetchUsernames 批量获取用户名映射（管理员视图填充归属信息，去重后一次查询避免 N+1）
func fetchUsernames(userIDs []int) (map[int]string, error) {
	idSet := make(map[int]struct{}, len(userIDs))
	for _, id := range userIDs {
		idSet[id] = struct{}{}
	}
	ids := make([]int, 0, len(idSet))
	for id := range idSet {
		ids = append(ids, id)
	}
	return model.GetUsernamesByIDs(ids)
}

// DeleteProjectCascade 删除项目（级联删除分集/分镜/角色/场景/道具/剪辑工程/生成记录/素材）
func (s *ProjectService) DeleteProjectCascade(projectID int) error {
	return model.DB.Transaction(func(tx *gorm.DB) error {
		// 先物化各实体 ID 列表，避免 GORM 子查询复用问题
		var episodeIDs []int
		if err := tx.Model(&model.DirectorEpisode{}).Where("project_id = ?", projectID).Pluck("id", &episodeIDs).Error; err != nil {
			return err
		}
		var storyboardIDs []int
		if len(episodeIDs) > 0 {
			if err := tx.Model(&model.DirectorStoryboard{}).Where("episode_id IN ?", episodeIDs).Pluck("id", &storyboardIDs).Error; err != nil {
				return err
			}
		}
		var characterIDs []int
		if err := tx.Model(&model.DirectorCharacter{}).Where("project_id = ?", projectID).Pluck("id", &characterIDs).Error; err != nil {
			return err
		}
		var sceneIDs []int
		if err := tx.Model(&model.DirectorScene{}).Where("project_id = ?", projectID).Pluck("id", &sceneIDs).Error; err != nil {
			return err
		}
		// 先清 many2many 关联表（按两侧外键清理，库内外键指向 episodes/storyboards/characters/scenes，不清会触发 1451）
		if len(storyboardIDs) > 0 {
			if err := tx.Exec("DELETE FROM director_storyboard_characters WHERE director_storyboard_id IN ?", storyboardIDs).Error; err != nil {
				return err
			}
		}
		if len(characterIDs) > 0 {
			if err := tx.Exec("DELETE FROM director_storyboard_characters WHERE director_character_id IN ?", characterIDs).Error; err != nil {
				return err
			}
			if err := tx.Exec("DELETE FROM director_episode_characters WHERE director_character_id IN ?", characterIDs).Error; err != nil {
				return err
			}
		}
		if len(episodeIDs) > 0 {
			if err := tx.Exec("DELETE FROM director_episode_characters WHERE director_episode_id IN ?", episodeIDs).Error; err != nil {
				return err
			}
			if err := tx.Exec("DELETE FROM director_episode_scenes WHERE director_episode_id IN ?", episodeIDs).Error; err != nil {
				return err
			}
		}
		if len(sceneIDs) > 0 {
			if err := tx.Exec("DELETE FROM director_episode_scenes WHERE director_scene_id IN ?", sceneIDs).Error; err != nil {
				return err
			}
		}
		if len(episodeIDs) > 0 {
			if err := tx.Where("episode_id IN ?", episodeIDs).Delete(&model.DirectorStoryboard{}).Error; err != nil {
				return err
			}
			if err := tx.Where("episode_id IN ?", episodeIDs).Delete(&model.DirectorEditProject{}).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("project_id = ?", projectID).Delete(&model.DirectorEpisode{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", projectID).Delete(&model.DirectorCharacter{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", projectID).Delete(&model.DirectorScene{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", projectID).Delete(&model.DirectorProp{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", projectID).Delete(&model.DirectorImageGeneration{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", projectID).Delete(&model.DirectorVideoGeneration{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", projectID).Delete(&model.DirectorAsset{}).Error; err != nil {
			return err
		}
		return tx.Delete(&model.DirectorProject{}, projectID).Error
	})
}

// DeleteEpisodeCascade 删除分集（级联删除分镜与剪辑工程）
func (s *ProjectService) DeleteEpisodeCascade(episodeID int) error {
	return model.DB.Transaction(func(tx *gorm.DB) error {
		var storyboardIDs []int
		if err := tx.Model(&model.DirectorStoryboard{}).Where("episode_id = ?", episodeID).Pluck("id", &storyboardIDs).Error; err != nil {
			return err
		}
		// 先清 many2many 关联表（库内外键指向 episodes/storyboards，不清会触发 1451）
		if len(storyboardIDs) > 0 {
			if err := tx.Exec("DELETE FROM director_storyboard_characters WHERE director_storyboard_id IN ?", storyboardIDs).Error; err != nil {
				return err
			}
		}
		if err := tx.Exec("DELETE FROM director_episode_characters WHERE director_episode_id = ?", episodeID).Error; err != nil {
			return err
		}
		if err := tx.Exec("DELETE FROM director_episode_scenes WHERE director_episode_id = ?", episodeID).Error; err != nil {
			return err
		}
		if err := tx.Where("episode_id = ?", episodeID).Delete(&model.DirectorStoryboard{}).Error; err != nil {
			return err
		}
		if err := tx.Where("episode_id = ?", episodeID).Delete(&model.DirectorEditProject{}).Error; err != nil {
			return err
		}
		return tx.Delete(&model.DirectorEpisode{}, episodeID).Error
	})
}

// ListProjectsWithStats 分页获取项目列表（附带统计信息；withUsername 时填充归属用户名，供管理员视图）
func (s *ProjectService) ListProjectsWithStats(f model.DirectorProjectListFilter, withUsername bool) ([]ProjectWithStats, int64, error) {
	projects, total, err := model.ListDirectorProjects(f)
	if err != nil {
		return nil, 0, err
	}
	list := make([]ProjectWithStats, 0, len(projects))
	for _, p := range projects {
		item := ProjectWithStats{DirectorProject: *p}
		model.DB.Model(&model.DirectorEpisode{}).Where("project_id = ?", p.ID).Count(&item.EpisodeCount)
		model.DB.Model(&model.DirectorCharacter{}).Where("project_id = ?", p.ID).Count(&item.CharacterCount)
		model.DB.Model(&model.DirectorScene{}).Where("project_id = ?", p.ID).Count(&item.SceneCount)
		list = append(list, item)
	}
	if withUsername && len(projects) > 0 {
		userIDs := make([]int, 0, len(projects))
		for _, p := range projects {
			userIDs = append(userIDs, p.UserID)
		}
		usernames, err := fetchUsernames(userIDs)
		if err != nil {
			return nil, 0, err
		}
		for i := range list {
			list[i].Username = usernames[list[i].UserID]
		}
	}
	return list, total, nil
}

// PipelineStep 流水线步骤进度
type PipelineStep struct {
	Key       string `json:"key"`                 // 步骤标识
	Name      string `json:"name"`                // 步骤名称
	Total     int64  `json:"total"`               // 待完成总数
	Finished  int64  `json:"finished"`            // 已完成数
	Done      bool   `json:"done"`                // 是否完成
	Running   bool   `json:"running"`             // 关联的异步 AI 任务是否执行中
	TaskError string `json:"taskError,omitempty"` // 关联任务最近一次失败原因
}

// pipelineStepTaskKey 步骤 → 分集级 AI 任务锁名称（limiter.go）；异步/长耗时任务透出执行状态供前端轮询
var pipelineStepTaskKey = map[string]string{
	"rewrite":    "rewrite",
	"extract":    "extract",
	"storyboard": "split",
}

// GetEpisodePipeline 获取分集流水线进度聚合（内容录入 → … → 剪辑）
func (s *ProjectService) GetEpisodePipeline(episodeID int) (episode model.DirectorEpisode, steps []PipelineStep, err error) {
	e, err := model.GetDirectorEpisodeDetail(episodeID)
	if err != nil {
		return
	}
	episode = *e
	db := model.DB

	// 角色 / 场景（项目级，提取环节入库；与 extract-step / entity-step 的项目级列表展示口径一致，
	// 不按分集关联表聚合，避免列表已完成但步骤不亮绿勾、删除关联后绿勾消失）
	var characterTotal, characterImaged int64
	db.Model(&model.DirectorCharacter{}).Where("project_id = ?", episode.ProjectID).Count(&characterTotal)
	db.Model(&model.DirectorCharacter{}).Where("project_id = ? AND image_url <> ''", episode.ProjectID).Count(&characterImaged)

	var sceneTotal, sceneImaged int64
	db.Model(&model.DirectorScene{}).Where("project_id = ?", episode.ProjectID).Count(&sceneTotal)
	db.Model(&model.DirectorScene{}).Where("project_id = ? AND image_url <> ''", episode.ProjectID).Count(&sceneImaged)

	// 道具（项目级，提取环节入库）
	var propTotal, propImaged int64
	db.Model(&model.DirectorProp{}).Where("project_id = ?", episode.ProjectID).Count(&propTotal)
	db.Model(&model.DirectorProp{}).Where("project_id = ? AND image_url <> ''", episode.ProjectID).Count(&propImaged)

	// 分镜各环节
	var sbTotal, sbImaged, sbVideo int64
	db.Model(&model.DirectorStoryboard{}).Where("episode_id = ?", episodeID).Count(&sbTotal)
	db.Model(&model.DirectorStoryboard{}).Where("episode_id = ? AND first_frame_image <> ''", episodeID).Count(&sbImaged)
	db.Model(&model.DirectorStoryboard{}).Where("episode_id = ? AND video_url <> ''", episodeID).Count(&sbVideo)

	// 剪辑工程：存在已渲染完成的工程即视为完成
	var editDone int64
	db.Model(&model.DirectorEditProject{}).
		Where("episode_id = ? AND status = ? AND output_url <> ''", episodeID, model.DirectorEditStatusDone).
		Count(&editDone)

	steps = []PipelineStep{
		{Key: "content", Name: "原始内容", Total: 1, Finished: boolToInt(episode.Content != ""), Done: episode.Content != ""},
		{Key: "rewrite", Name: "AI 改写", Total: 1, Finished: boolToInt(episode.ScriptContent != ""), Done: episode.ScriptContent != ""},
		{Key: "extract", Name: "提取角色道具场景", Total: 1, Finished: boolToInt(characterTotal > 0), Done: characterTotal > 0},
		{Key: "chars", Name: "角色形象", Total: characterTotal, Finished: characterImaged, Done: characterTotal > 0 && characterImaged >= characterTotal},
		// 无道具时不视为完成（0/0 不亮绿勾），避免后续添加道具时步骤突然"完成"
		{Key: "props", Name: "道具图片", Total: propTotal, Finished: propImaged, Done: propTotal > 0 && propImaged >= propTotal},
		{Key: "scenes", Name: "场景图片", Total: sceneTotal, Finished: sceneImaged, Done: sceneTotal > 0 && sceneImaged >= sceneTotal},
		{Key: "storyboard", Name: "分镜拆解", Total: 1, Finished: boolToInt(sbTotal > 0), Done: sbTotal > 0},
		{Key: "shots", Name: "镜头图片", Total: sbTotal, Finished: sbImaged, Done: sbTotal > 0 && sbImaged >= sbTotal},
		{Key: "videos", Name: "视频生成", Total: sbTotal, Finished: sbVideo, Done: sbTotal > 0 && sbVideo >= sbTotal},
		{Key: "edit", Name: "视频剪辑", Total: 1, Finished: boolToInt(editDone > 0), Done: editDone > 0},
	}
	for i := range steps {
		if taskKey, ok := pipelineStepTaskKey[steps[i].Key]; ok {
			steps[i].Running, steps[i].TaskError = EpisodeTaskStatus(taskKey, episodeID)
		}
	}
	return
}

func boolToInt(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

// AddEpisodeCharacter 人工为本集添加角色（创建记录并建立 many2many 关联）
func (s *ProjectService) AddEpisodeCharacter(userID, episodeID int, character *model.DirectorCharacter) error {
	episode, err := model.GetDirectorEpisodeByID(episodeID)
	if err != nil {
		return errors.New("分集不存在")
	}
	character.UserID = userID
	character.ProjectID = episode.ProjectID
	if err = character.Insert(); err != nil {
		return err
	}
	return model.DB.Model(episode).Association("Characters").Append(character)
}

// AddEpisodeScene 人工为本集添加场景（创建记录并建立 many2many 关联）
func (s *ProjectService) AddEpisodeScene(userID, episodeID int, scene *model.DirectorScene) error {
	episode, err := model.GetDirectorEpisodeByID(episodeID)
	if err != nil {
		return errors.New("分集不存在")
	}
	scene.UserID = userID
	scene.ProjectID = episode.ProjectID
	scene.EpisodeID = &episodeID
	if err = scene.Insert(); err != nil {
		return err
	}
	return model.DB.Model(episode).Association("Scenes").Append(scene)
}
