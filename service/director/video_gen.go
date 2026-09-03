package director

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// VideoGenRequest 视频生成请求参数
type VideoGenRequest struct {
	Prompt          string   // 运动提示词
	FirstFrameURL   string   // 首帧图 URL
	LastFrameURL    string   // 尾帧图 URL（可选）
	ReferenceImages []string // 参考图 URL 列表
	ReferenceVideos []string // 参考视频 URL 列表
	Duration        int      // 时长（秒）
	AspectRatio     string   // 画幅，如 9:16
	Resolution      string   // 分辨率，如 720p/1080p
	Model           string   // 覆盖默认模型
}

// VideoGenerationService 视频生成服务（回环 /v1/video/generations 统一视频协议，异步任务模式）
type VideoGenerationService struct{}

// SubmitVideoTask 提交视频生成任务，返回任务ID
func (s *VideoGenerationService) SubmitVideoTask(cfg directorCallConfig, req VideoGenRequest) (string, error) {
	modelName := req.Model
	if modelName == "" {
		modelName = cfg.Model
	}
	// 按帧输入推导生成模式，与上游 role 分配规则对应：
	// first_last_frame→images[0]=首帧其余尾帧 / first_frame→全部首帧 / reference→全部参考图
	mode := "text_to_video"
	images := make([]string, 0, 2+len(req.ReferenceImages))
	switch {
	case req.LastFrameURL != "":
		mode = "first_last_frame"
		images = append(images, req.FirstFrameURL, req.LastFrameURL)
	case len(req.ReferenceImages) > 0 || len(req.ReferenceVideos) > 0:
		mode = "reference"
		if req.FirstFrameURL != "" {
			images = append(images, req.FirstFrameURL)
		}
		images = append(images, req.ReferenceImages...)
	case req.FirstFrameURL != "":
		mode = "first_frame"
		images = append(images, req.FirstFrameURL)
	}
	metadata := map[string]any{
		"mode":           mode,
		"generate_audio": true,
		"n":              1,
		// 火山 Ark 默认给视频盖水印，显式关闭（metadata 透传至上游 watermark 字段）
		"watermark": false,
	}
	if req.Resolution != "" {
		metadata["resolution"] = req.Resolution
	}
	if req.AspectRatio != "" {
		metadata["ratio"] = req.AspectRatio
	}
	if req.Duration > 0 {
		metadata["duration"] = req.Duration
	}
	if len(req.ReferenceVideos) > 0 {
		metadata["video_urls"] = req.ReferenceVideos
	}
	body := map[string]any{
		"model":    modelName,
		"prompt":   req.Prompt,
		"metadata": metadata,
	}
	if len(images) > 0 {
		body["images"] = images
	}
	var result struct {
		ID string `json:"id"`
	}
	if err := relayPost(cfg, "/v1/video/generations", body, &result); err != nil {
		return "", err
	}
	if result.ID == "" {
		return "", errors.New("接口未返回任务ID")
	}
	return result.ID, nil
}

// QueryVideoTask 查询视频任务，返回 status（processing/success/failed）与视频地址
func (s *VideoGenerationService) QueryVideoTask(cfg directorCallConfig, taskID string) (string, string, error) {
	url := relayBaseURL() + "/v1/video/generations/" + taskID
	// 兼容两种查询响应：后台任务格式（data.status=SUCCESS / data.result_url）
	// 与 OpenAI video 格式（status=completed / metadata.url），以实际返回为准
	var result struct {
		Status   string            `json:"status"` // OpenAI 格式：queued/in_progress/completed/failed
		Metadata map[string]string `json:"metadata"`
		Error    *struct {
			Message string `json:"message"`
		} `json:"error"`
		Data *struct {
			Status     string `json:"status"` // 后台格式：SUCCESS/FAILURE 等大写枚举
			FailReason string `json:"fail_reason"`
			ResultURL  string `json:"result_url"`
		} `json:"data"`
	}
	if err := relayGet(cfg, url, &result); err != nil {
		return "processing", "", err
	}
	// 后台任务格式优先
	if result.Data != nil && result.Data.Status != "" {
		switch {
		case strings.EqualFold(result.Data.Status, "SUCCESS"):
			if result.Data.ResultURL == "" {
				return "failed", "", errors.New("任务成功但未返回视频地址")
			}
			return "success", result.Data.ResultURL, nil
		case strings.EqualFold(result.Data.Status, "FAILURE"), strings.EqualFold(result.Data.Status, "FAILED"):
			msg := result.Data.FailReason
			if msg == "" {
				msg = "任务失败"
			}
			return "failed", "", errors.New(msg)
		default:
			return "processing", "", nil
		}
	}
	// OpenAI video 格式兜底
	switch result.Status {
	case "completed":
		if result.Metadata["url"] == "" {
			return "failed", "", errors.New("任务成功但未返回视频地址")
		}
		return "success", result.Metadata["url"], nil
	case "failed":
		msg := "任务失败"
		if result.Error != nil {
			msg = result.Error.Message
		}
		return "failed", "", errors.New(msg)
	default:
		return "processing", "", nil
	}
}

// ResumeDirectorPolling 恢复中断的视频任务轮询（进程重启后由启动流程调用）：
// 轮询 goroutine 存于内存，重启即丢失，任务会永久停留在 processing。
// 按任务自身的用户与模型重建回环配置续轮询；配置失效的任务跳过。
func (s *VideoGenerationService) ResumeDirectorPolling() {
	tasks, err := model.ListPendingDirectorVideoGenerations()
	if err != nil || len(tasks) == 0 {
		return
	}
	common.SysLog(fmt.Sprintf("云导演发现中断的视频任务，尝试恢复轮询: count=%d", len(tasks)))
	for _, t := range tasks {
		if t.StoryboardID == nil || t.TaskID == "" || t.UserID <= 0 {
			continue
		}
		key, keyErr := model.GetDirectorTokenKey(t.UserID)
		if keyErr != nil {
			continue
		}
		modelName := t.Model
		if strings.TrimSpace(modelName) == "" {
			if settings, sErr := model.GetDirectorModelSettings(t.UserID); sErr == nil {
				modelName = settings.VideoModel
			}
		}
		if strings.TrimSpace(modelName) == "" {
			continue
		}
		cfg := directorCallConfig{APIKey: key, Model: modelName}
		if _, _, qErr := s.QueryVideoTask(cfg, t.TaskID); qErr != nil {
			continue // 任务已失效或不可达，跳过
		}
		common.SysLog(fmt.Sprintf("云导演恢复视频任务轮询: genId=%d, taskId=%s", t.ID, t.TaskID))
		projectID := 0
		if t.ProjectID != nil {
			projectID = *t.ProjectID
		}
		go s.pollVideoTask(t.ID, cfg, t.TaskID, *t.StoryboardID, t.UserID, projectID)
	}
}

// ============ 生成入口 ============

// SubmitStoryboardVideo 提交分镜图生视频任务（后台轮询回写）。
// customPrompt/aspectRatio/resolution/duration 非空时覆盖默认值；count>1 时提交多个任务。
// frameMode：first_last 首尾帧（默认，尾帧取下一镜头图片）/ reference 参考生成（当前镜头图与 @ 引用均作参考图，兼容旧值 first）；
// 末镜头或下一镜头无图时首尾帧自动降级为仅首帧锚定
func (s *VideoGenerationService) SubmitStoryboardVideo(userID, storyboardID int, customPrompt, aspectRatio, resolution string, duration, count int, frameMode string) (int, error) {
	storyboard, err := model.GetDirectorStoryboardByID(storyboardID)
	if err != nil {
		return 0, errors.New("分镜不存在")
	}
	if storyboard.FirstFrameImage == "" {
		return 0, errors.New("该分镜还没有首帧图，请先生成镜头图片")
	}
	cfg, err := getDirectorConfig(userID, "video")
	if err != nil {
		return 0, err
	}

	prompt := strings.TrimSpace(customPrompt)
	if prompt == "" {
		prompt = storyboard.VideoPrompt
	} else {
		// 保存用户最后一次编辑的 prompt（原始 token 文本），重新打开弹窗时回显
		storyboard.Update(map[string]any{"video_prompt": prompt})
	}
	if strings.TrimSpace(prompt) == "" {
		return 0, errors.New("该分镜缺少视频运动提示词")
	}
	if duration <= 0 {
		duration = storyboard.Duration
	}
	if count <= 0 {
		count = 1
	}
	// 镜头图引用：存储已全面 TOS 化，图片地址可直接被上游访问；
	// 若镜头图片已同步渠道素材库且激活，则按 asset:// 引用（中间件锁定素材所属渠道）
	frameURL := storyboard.FirstFrameImage
	if ref := entityAssetRef(userID, model.DirectorEntityAssetStoryboard, storyboardID, cfg.Model); ref != "" {
		frameURL = ref
	}
	// 帧模式：first_last 首尾帧（默认）/ reference 参考生成（兼容旧值 first）
	useReference := frameMode == "reference" || frameMode == "first"
	// 首尾帧模式：尾帧取同分集内列表序（镜号+ID）下一个已有镜头图片的分镜记录；
	// 同一镜号可有多张镜头图，逐张衔接才能保证视频拼接连贯；末镜头或后续未出图则降级为仅首帧锚定
	lastFrameURL := ""
	lastFrameStored := ""
	if !useReference {
		var next model.DirectorStoryboard
		if model.DB.Where("episode_id = ? AND first_frame_image != '' AND (storyboard_number > ? OR (storyboard_number = ? AND id > ?))",
			storyboard.EpisodeID, storyboard.StoryboardNumber, storyboard.StoryboardNumber, storyboard.ID).
			Order("storyboard_number ASC, id ASC").First(&next).Error == nil {
			lastFrameURL = next.FirstFrameImage
			lastFrameStored = next.FirstFrameImage
			if ref := entityAssetRef(userID, model.DirectorEntityAssetStoryboard, next.ID, cfg.Model); ref != "" {
				lastFrameURL = ref
			}
		}
		// 首尾帧生视频未指定画幅时用 adaptive（画幅跟随首尾帧图片）；指定画幅则按用户选择传递
		if lastFrameURL != "" && aspectRatio == "" {
			aspectRatio = "adaptive"
		}
	}
	// @ 引用展开：提示词中的 @[kind:x] 标识替换为「参考图N/参考视频N」并收集资产地址。
	// 真正走首尾帧时剔除图片引用：不允许 last_frame 与 reference_image 混用（参考视频不受限）
	var refImages, refVideos []string
	prompt, refImages, refVideos = expandMentionsEx(prompt, lastFrameURL == "", mentionEntityAssetRef(userID, cfg.Model), userID)
	// 参考生成模式：当前镜头图作为第一张参考图，不锁定首帧；
	// 镜头图占据参考图1位置，@ 引用的序号需整体后移一位，与模型看到的图片顺序对齐
	reqFirstURL := frameURL
	if useReference {
		prompt = shiftRefIndex(prompt, 1)
		refImages = append([]string{frameURL}, refImages...)
		reqFirstURL = ""
	}
	if aspectRatio == "" {
		aspectRatio = "9:16"
	}

	episode, err := model.GetDirectorEpisodeByID(storyboard.EpisodeID)
	if err != nil {
		return 0, errors.New("分集不存在")
	}
	projectID := episode.ProjectID
	refImagesJSON := ""
	if len(refImages) > 0 {
		if b, mErr := common.Marshal(refImages); mErr == nil {
			refImagesJSON = string(b)
		}
	}

	var lastGenID int
	for i := 0; i < count; i++ {
		gen := &model.DirectorVideoGeneration{
			UserID:             userID,
			StoryboardID:       &storyboardID,
			ProjectID:          &projectID,
			Prompt:             prompt,
			Model:              cfg.Model,
			ReferenceMode:      "first_frame",
			FirstFrameURL:      storyboard.FirstFrameImage,
			LastFrameURL:       lastFrameStored,
			ReferenceImageURLs: refImagesJSON,
			Duration:           duration,
			AspectRatio:        aspectRatio,
			Resolution:         resolution,
			Status:             model.DirectorGenStatusProcessing,
		}
		if lastFrameStored != "" {
			gen.ReferenceMode = "first_last_frame"
		} else if useReference {
			gen.ReferenceMode = "reference"
		}
		if err = gen.Insert(); err != nil {
			return lastGenID, err
		}
		lastGenID = gen.ID
		// 并发队列：批量提交时最多同时跑 videoConcurrentLimit 个任务，其余排队等槽位再发送
		go func(genID int) {
			acquireVideoSlot()
			defer releaseVideoSlot()
			taskID, subErr := s.SubmitVideoTask(cfg, VideoGenRequest{
				Prompt:          prompt,
				FirstFrameURL:   reqFirstURL,
				LastFrameURL:    lastFrameURL,
				ReferenceImages: refImages,
				ReferenceVideos: refVideos,
				Duration:        duration,
				AspectRatio:     aspectRatio,
				Resolution:      resolution,
			})
			if subErr != nil {
				markVideoGenFailed(genID, subErr)
				return
			}
			model.DB.Model(&model.DirectorVideoGeneration{}).Where("id = ?", genID).Update("task_id", taskID)
			s.pollVideoTask(genID, cfg, taskID, storyboardID, userID, projectID)
		}(gen.ID)
	}
	return lastGenID, nil
}

// pollVideoTask 后台轮询视频任务直至完成或超时
func (s *VideoGenerationService) pollVideoTask(genID int, cfg directorCallConfig, taskID string, storyboardID, userID, projectID int) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	timeout := time.After(15 * time.Minute)
	failCount := 0
	for {
		select {
		case <-timeout:
			markVideoGenFailed(genID, errors.New("任务超时（15分钟）"))
			return
		case <-ticker.C:
			status, videoURL, err := s.QueryVideoTask(cfg, taskID)
			if err != nil && status != "processing" {
				failCount++
				if failCount >= 3 {
					markVideoGenFailed(genID, err)
					return
				}
				continue
			}
			switch status {
			case "success":
				finalURL, storeErr := storeRemoteFileToTOS(videoURL, fmt.Sprintf("video_%d.mp4", time.Now().UnixNano()), userID, projectID)
				if storeErr != nil {
					common.SysLog(fmt.Sprintf("云导演视频转存失败，使用原始链接: genId=%d, err=%v", genID, storeErr))
					finalURL = videoURL
				}
				now := time.Now().Unix()
				model.DB.Model(&model.DirectorVideoGeneration{}).Where("id = ?", genID).Updates(map[string]any{
					"status":       model.DirectorGenStatusSuccess,
					"video_url":    finalURL,
					"completed_at": now,
					"updated_at":   now,
				})
				model.DB.Model(&model.DirectorStoryboard{}).Where("id = ?", storyboardID).Updates(map[string]any{
					"video_url":  finalURL,
					"status":     "video_done",
					"updated_at": now,
				})
				// 登记素材
				if sb, sbErr := model.GetDirectorStoryboardByID(storyboardID); sbErr == nil {
					episodeID := sb.EpisodeID
					model.DB.Create(&model.DirectorAsset{
						CreatedAt:    now,
						UpdatedAt:    now,
						UserID:       userID,
						ProjectID:    &projectID,
						EpisodeID:    &episodeID,
						StoryboardID: &storyboardID,
						Name:         fmt.Sprintf("分镜%d 生成视频", sb.StoryboardNumber),
						Type:         "video",
						Category:     "storyboard",
						URL:          finalURL,
						Duration:     sb.Duration,
					})
				}
				return
			case "failed":
				markVideoGenFailed(genID, err)
				return
			}
		}
	}
}

func markVideoGenFailed(genID int, err error) {
	msg := "生成失败"
	if err != nil {
		msg = friendlyAIError(err.Error())
	}
	common.SysError(fmt.Sprintf("云导演视频生成失败: genId=%d, msg=%s, err=%v", genID, msg, err))
	now := time.Now().Unix()
	model.DB.Model(&model.DirectorVideoGeneration{}).Where("id = ?", genID).Updates(map[string]any{
		"status":       model.DirectorGenStatusFailed,
		"error_msg":    msg,
		"completed_at": now,
		"updated_at":   now,
	})
}

// friendlyAIError 将平台常见错误码转为用户可读提示（原始报错保留在日志）
func friendlyAIError(msg string) string {
	switch {
	case strings.Contains(msg, "PrivacyInformation") || strings.Contains(msg, "real person"):
		return "输入图片未通过平台隐私审核（疑似包含真人面孔），请重新生成/调整相关镜头图片后重试"
	case strings.Contains(msg, "cannot be mixed"):
		return "首尾帧模式不能同时使用 @ 图片引用（平台限制），请切换「参考生成」模式或移除 @ 引用"
	case strings.Contains(msg, "SensitiveContent"):
		return "输入内容未通过平台内容审核，请调整提示词或图片后重试"
	}
	return msg
}
