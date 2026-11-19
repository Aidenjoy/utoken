package director

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// ===== 智能画布：节点图片/视频生成 =====
// 画布属于视频工厂，复用云导演的模型设定与内部令牌回环网关模式：
// 费用计到调用者本人账户，限额/日志与真实请求完全一致。

// CanvasGenRequest 画布节点生成请求（上游连线图片作为参考图传入）
type CanvasGenRequest struct {
	ProjectID       int
	NodeID          string
	Prompt          string
	Size            string   // 图片尺寸（如 2048x2048）
	Quality         string   // 图片画质档位（low/standard/high/ultra/extreme）
	Background      string   // 图片背景（auto/keep/transparent）
	AspectRatio     string   // 视频画幅（如 16:9）
	Resolution      string   // 视频分辨率（如 720p）
	Duration        int      // 视频时长（秒）
	GenerateAudio   *bool    // 视频是否生成音频（nil 默认开启）
	Count           int      // 产出数量（图片张数/文本段数/视频个数）
	Voice           string   // 音频音色（如 alloy）
	AudioFormat     string   // 音频格式（如 mp3）
	Speed           float64  // 音频语速倍率
	ReferenceImages []string // 参考图 URL 列表
}

// canvasStoreRemote 下载远程文件并转存 TOS（防临时链接过期），归档到画布项目批次
func canvasStoreRemote(remoteURL, filename string, userID, projectID int) (string, error) {
	client := &http.Client{Timeout: 300 * time.Second}
	resp, err := client.Get(remoteURL)
	if err != nil {
		return "", fmt.Errorf("下载远程文件失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("下载远程文件失败: HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	url, _, err := common.UploadBytesToTOS(data, filename, userID, fmt.Sprintf("canvas%d", projectID))
	return url, err
}

// canvasStoreBytes 存储生成产物字节：优先 TOS，未配置时回退本地磁盘（与画布上传一致）
func canvasStoreBytes(data []byte, filename string, userID, projectID int) (string, error) {
	if _, ok := common.GetTOSUploadConfig(); ok {
		url, _, err := common.UploadBytesToTOS(data, filename, userID, fmt.Sprintf("canvas%d", projectID))
		return url, err
	}
	return common.SaveUploadLocal(data, filename, userID)
}

func markCanvasGenFailed(genID int, err error) {
	msg := "生成失败"
	if err != nil {
		msg = friendlyAIError(err.Error())
	}
	common.SysError(fmt.Sprintf("智能画布生成失败: genId=%d, msg=%s, err=%v", genID, msg, err))
	now := time.Now().Unix()
	// 仅覆盖进行中的任务，避免迟到的失败结果改写用户已取消的状态
	model.DB.Model(&model.CanvasGeneration{}).
		Where("id = ? AND status = ?", genID, model.DirectorGenStatusProcessing).
		Updates(map[string]any{
			"status":       model.DirectorGenStatusFailed,
			"error_msg":    msg,
			"completed_at": now,
			"updated_at":   now,
		})
}

func markCanvasGenSuccess(genID int, resultURL string) {
	now := time.Now().Unix()
	// 仅覆盖进行中的任务，已取消的任务不再落盘结果也不入素材库
	res := model.DB.Model(&model.CanvasGeneration{}).
		Where("id = ? AND status = ?", genID, model.DirectorGenStatusProcessing).
		Updates(map[string]any{
			"status":       model.DirectorGenStatusSuccess,
			"result_url":   resultURL,
			"completed_at": now,
			"updated_at":   now,
		})
	if res.RowsAffected == 0 {
		return
	}
	// 生成结果归档到素材库，供画布「从素材库插入」与视频工厂复用（与云导演生成流水线一致）
	gen, err := model.GetCanvasGenerationByID(genID)
	if err != nil {
		return
	}
	name := strings.TrimSpace(gen.Prompt)
	if name == "" {
		name = "画布生成"
	}
	if runes := []rune(name); len(runes) > 60 {
		name = string(runes[:60]) + "…"
	}
	projectID := gen.ProjectID
	if cErr := model.DB.Create(&model.DirectorAsset{
		CreatedAt: now,
		UpdatedAt: now,
		UserID:    gen.UserID,
		ProjectID: &projectID,
		Name:      name,
		Type:      gen.Kind,
		Category:  "canvas",
		URL:       resultURL,
	}).Error; cErr != nil {
		common.SysError(fmt.Sprintf("智能画布素材归档失败: genId=%d, err=%v", genID, cErr))
	}
}

// markCanvasGenTextSuccess 文本生成成功落盘（无媒体 URL，不入素材库）
func markCanvasGenTextSuccess(genID int, resultText string) {
	now := time.Now().Unix()
	model.DB.Model(&model.CanvasGeneration{}).
		Where("id = ? AND status = ?", genID, model.DirectorGenStatusProcessing).
		Updates(map[string]any{
			"status":       model.DirectorGenStatusSuccess,
			"result_text":  resultText,
			"completed_at": now,
			"updated_at":   now,
		})
}

// markCanvasGenExtras 多产出结果落盘（仅覆盖进行中任务，与成功/取消守卫一致）
func markCanvasGenExtras(genID int, extras []string) {
	if len(extras) == 0 {
		return
	}
	data, err := common.Marshal(extras)
	if err != nil {
		return
	}
	model.DB.Model(&model.CanvasGeneration{}).
		Where("id = ? AND status = ?", genID, model.DirectorGenStatusProcessing).
		Update("result_extras", string(data))
}

// SubmitCanvasImage 提交画布图片节点生成任务（异步执行，前端轮询任务状态）
func SubmitCanvasImage(userID int, req CanvasGenRequest) (int, error) {
	cfg, err := getDirectorConfig(userID, "image")
	if err != nil {
		return 0, err
	}
	size := req.Size
	if size == "" {
		size = "2048x2048"
	}
	count := req.Count
	if count < 1 {
		count = 1
	}
	refJSON := ""
	if len(req.ReferenceImages) > 0 {
		if b, mErr := common.Marshal(req.ReferenceImages); mErr == nil {
			refJSON = string(b)
		}
	}
	gen := &model.CanvasGeneration{
		UserID:          userID,
		ProjectID:       req.ProjectID,
		NodeID:          req.NodeID,
		Kind:            "image",
		Prompt:          req.Prompt,
		Model:           cfg.Model,
		Size:            size,
		ReferenceImages: refJSON,
		Status:          model.DirectorGenStatusProcessing,
	}
	if err = gen.Insert(); err != nil {
		return 0, err
	}
	go func(genID int) {
		acquireImageSlot()
		defer releaseImageSlot()
		body := map[string]any{
			"model":           cfg.Model,
			"prompt":          req.Prompt,
			"n":               count,
			"size":            size,
			"response_format": "url",
			// 火山 Ark 默认盖「AI 生成」水印，显式关闭（与云导演一致）
			"watermark": false,
		}
		// 画质/背景仅对支持该参数的上游下发，避免不支持的供应商报 400：
		// gpt-image 系用 low/medium/high + background；dall-e-3 用 standard/hd；其余省略
		if strings.Contains(cfg.Model, "gpt-image") {
			switch req.Quality {
			case "low":
				body["quality"] = "low"
			case "standard":
				body["quality"] = "medium"
			case "high", "ultra", "extreme":
				body["quality"] = "high"
			}
			switch req.Background {
			case "keep":
				body["background"] = "opaque"
			case "transparent":
				body["background"] = "transparent"
			}
		} else if strings.Contains(cfg.Model, "dall-e-3") {
			switch req.Quality {
			case "high", "ultra", "extreme":
				body["quality"] = "hd"
			}
		}
		if len(req.ReferenceImages) > 0 {
			body["image"] = req.ReferenceImages
		}
		var result struct {
			Data []struct {
				URL     string `json:"url"`
				B64JSON string `json:"b64_json"`
			} `json:"data"`
		}
		if rErr := relayPost(cfg, "/v1/images/generations", body, &result); rErr != nil {
			markCanvasGenFailed(genID, rErr)
			return
		}
		if len(result.Data) == 0 || (result.Data[0].URL == "" && result.Data[0].B64JSON == "") {
			markCanvasGenFailed(genID, errors.New("接口未返回图片"))
			return
		}
		// 逐张转存；首张作为节点主结果，其余写入 extras 由前端生成兄弟节点
		storedURLs := make([]string, 0, len(result.Data))
		for _, item := range result.Data {
			finalURL := item.URL
			if finalURL == "" && item.B64JSON != "" {
				data, dErr := base64.StdEncoding.DecodeString(item.B64JSON)
				if dErr != nil {
					markCanvasGenFailed(genID, fmt.Errorf("解码图片失败: %w", dErr))
					return
				}
				url, sErr := canvasStoreBytes(data, fmt.Sprintf("img_%d.png", time.Now().UnixNano()), userID, req.ProjectID)
				if sErr != nil {
					markCanvasGenFailed(genID, sErr)
					return
				}
				finalURL = url
			} else if finalURL != "" {
				stored, sErr := canvasStoreRemote(finalURL, fmt.Sprintf("img_%d.png", time.Now().UnixNano()), userID, req.ProjectID)
				if sErr != nil {
					common.SysLog(fmt.Sprintf("智能画布图片转存失败，使用原始链接: genId=%d, err=%v", genID, sErr))
				} else {
					finalURL = stored
				}
			}
			if finalURL != "" {
				storedURLs = append(storedURLs, finalURL)
			}
		}
		if len(storedURLs) == 0 {
			markCanvasGenFailed(genID, errors.New("接口未返回图片"))
			return
		}
		markCanvasGenExtras(genID, storedURLs[1:])
		markCanvasGenSuccess(genID, storedURLs[0])
	}(gen.ID)
	return gen.ID, nil
}

// SubmitCanvasVideo 提交画布视频节点生成任务（统一视频协议，后台轮询回写）。
// 有上游连线图片时走参考生成模式，否则文生视频。
func SubmitCanvasVideo(userID int, req CanvasGenRequest) (int, error) {
	cfg, err := getDirectorConfig(userID, "video")
	if err != nil {
		return 0, err
	}
	duration := req.Duration
	if duration <= 0 {
		duration = 5
	}
	aspectRatio := req.AspectRatio
	if aspectRatio == "" {
		aspectRatio = "16:9"
	}
	count := req.Count
	if count < 1 {
		count = 1
	}
	if count > 4 {
		count = 4
	}
	refJSON := ""
	if len(req.ReferenceImages) > 0 {
		if b, mErr := common.Marshal(req.ReferenceImages); mErr == nil {
			refJSON = string(b)
		}
	}
	gen := &model.CanvasGeneration{
		UserID:          userID,
		ProjectID:       req.ProjectID,
		NodeID:          req.NodeID,
		Kind:            "video",
		Prompt:          req.Prompt,
		Model:           cfg.Model,
		Duration:        duration,
		AspectRatio:     aspectRatio,
		Resolution:      req.Resolution,
		ReferenceImages: refJSON,
		Status:          model.DirectorGenStatusProcessing,
	}
	if err = gen.Insert(); err != nil {
		return 0, err
	}
	videoSvc := &VideoGenerationService{}
	go func(genID int) {
		acquireVideoSlot()
		defer releaseVideoSlot()
		// 数量>1 时提交多个上游任务（上游协议无 n 参数），首个结果为主产出，
		// 其余写入 extras 由前端生成兄弟节点（与图片多产出链路一致）
		taskIDs := make([]string, 0, count)
		for i := 0; i < count; i++ {
			taskID, subErr := videoSvc.SubmitVideoTask(cfg, VideoGenRequest{
				Prompt:          req.Prompt,
				ReferenceImages: req.ReferenceImages,
				Duration:        duration,
				AspectRatio:     aspectRatio,
				Resolution:      req.Resolution,
				GenerateAudio:   req.GenerateAudio,
			})
			if subErr != nil {
				markCanvasGenFailed(genID, subErr)
				return
			}
			taskIDs = append(taskIDs, taskID)
		}
		model.DB.Model(&model.CanvasGeneration{}).Where("id = ?", genID).Update("task_id", taskIDs[0])
		urls := make([]string, 0, len(taskIDs))
		for _, taskID := range taskIDs {
			videoURL, ok := pollCanvasVideoTask(videoSvc, genID, cfg, taskID, userID, req.ProjectID)
			if !ok {
				return // 失败/超时已落盘；取消时状态守卫兜底
			}
			urls = append(urls, videoURL)
		}
		markCanvasGenExtras(genID, urls[1:])
		markCanvasGenSuccess(genID, urls[0])
	}(gen.ID)
	return gen.ID, nil
}

// pollCanvasVideoTask 后台轮询画布视频任务直至完成或超时，成功返回转存后的视频地址；
// 失败/超时内部落盘错误状态，取消时直接退出，由调用方决定结果落盘时机
func pollCanvasVideoTask(s *VideoGenerationService, genID int, cfg directorCallConfig, taskID string, userID, projectID int) (string, bool) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	timeout := time.After(15 * time.Minute)
	failCount := 0
	for {
		select {
		case <-timeout:
			markCanvasGenFailed(genID, errors.New("任务超时（15分钟）"))
			return "", false
		case <-ticker.C:
			// 任务可能已被用户取消，及时退出轮询，不再消耗上游查询
			var current model.CanvasGeneration
			if dbErr := model.DB.Select("status").First(&current, genID).Error; dbErr != nil || current.Status != model.DirectorGenStatusProcessing {
				return "", false
			}
			status, videoURL, err := s.QueryVideoTask(cfg, taskID)
			if err != nil && status != "processing" {
				failCount++
				if failCount >= 3 {
					markCanvasGenFailed(genID, err)
					return "", false
				}
				continue
			}
			switch status {
			case "success":
				finalURL, storeErr := canvasStoreRemote(videoURL, fmt.Sprintf("video_%d.mp4", time.Now().UnixNano()), userID, projectID)
				if storeErr != nil {
					common.SysLog(fmt.Sprintf("智能画布视频转存失败，使用原始链接: genId=%d, err=%v", genID, storeErr))
					finalURL = videoURL
				}
				return finalURL, true
			case "failed":
				markCanvasGenFailed(genID, err)
				return "", false
			}
		}
	}
}

// ResumeCanvasPolling 恢复中断的画布视频任务轮询（进程重启后由启动流程调用）
func ResumeCanvasPolling() {
	tasks, err := model.ListPendingCanvasVideoGenerations()
	if err != nil || len(tasks) == 0 {
		return
	}
	common.SysLog(fmt.Sprintf("智能画布发现中断的视频任务，尝试恢复轮询: count=%d", len(tasks)))
	videoSvc := &VideoGenerationService{}
	for _, t := range tasks {
		if t.UserID <= 0 || t.TaskID == "" {
			continue
		}
		key, keyErr := model.GetDirectorTokenKey(t.UserID, "video")
		if keyErr != nil {
			continue
		}
		modelName := strings.TrimSpace(t.Model)
		if modelName == "" {
			if settings, sErr := model.GetDirectorModelSettings(t.UserID); sErr == nil {
				modelName = settings.VideoModel
			}
		}
		if modelName == "" {
			continue
		}
		cfg := directorCallConfig{APIKey: key, Model: modelName}
		if _, _, qErr := videoSvc.QueryVideoTask(cfg, t.TaskID); qErr != nil {
			continue // 任务已失效或不可达，跳过
		}
		common.SysLog(fmt.Sprintf("智能画布恢复视频任务轮询: genId=%d, taskId=%s", t.ID, t.TaskID))
		go func(genID int, callCfg directorCallConfig, resumeTaskID string, resumeUserID, resumeProjectID int) {
			videoURL, ok := pollCanvasVideoTask(videoSvc, genID, callCfg, resumeTaskID, resumeUserID, resumeProjectID)
			if ok {
				markCanvasGenSuccess(genID, videoURL)
			}
		}(t.ID, cfg, t.TaskID, t.UserID, t.ProjectID)
	}
}

// canvasTextSeparator 多段文本产出分隔符（单独一行 ---）
var canvasTextSeparator = regexp.MustCompile(`(?m)^\s*---+\s*$`)

// SubmitCanvasText 提交画布文本节点生成任务（文本模型回环，异步执行）。
// 数量>1 时要求模型产出多段独立文本，首段落主结果，其余入 extras。
func SubmitCanvasText(userID int, req CanvasGenRequest) (int, error) {
	cfg, err := getDirectorTextConfig(userID)
	if err != nil {
		return 0, err
	}
	count := req.Count
	if count < 1 {
		count = 1
	}
	gen := &model.CanvasGeneration{
		UserID:    userID,
		ProjectID: req.ProjectID,
		NodeID:    req.NodeID,
		Kind:      "text",
		Prompt:    req.Prompt,
		Model:     cfg.Model,
		Status:    model.DirectorGenStatusProcessing,
	}
	if err = gen.Insert(); err != nil {
		return 0, err
	}
	go func(genID int) {
		acquireLLMSlot()
		defer releaseLLMSlot()
		system := "你是文本创作助手。根据用户要求生成文本内容，只输出文本正文，不要解释、不要 Markdown 标题。输出语言与用户输入一致。"
		if count > 1 {
			system += fmt.Sprintf("请生成 %d 段相互独立、各自完整的内容，段与段之间用单独一行的 --- 分隔。", count)
		}
		svc := &LLMService{}
		content, cErr := svc.Chat(cfg, []ChatMessage{
			{Role: "system", Content: system},
			{Role: "user", Content: req.Prompt},
		}, false, 4096)
		if cErr != nil {
			markCanvasGenFailed(genID, cErr)
			return
		}
		content = strings.TrimSpace(content)
		if content == "" {
			markCanvasGenFailed(genID, errors.New("接口未返回文本"))
			return
		}
		parts := canvasTextSeparator.Split(content, -1)
		texts := make([]string, 0, len(parts))
		for _, part := range parts {
			if trimmed := strings.TrimSpace(part); trimmed != "" {
				texts = append(texts, trimmed)
			}
		}
		if len(texts) == 0 {
			markCanvasGenFailed(genID, errors.New("接口未返回文本"))
			return
		}
		markCanvasGenExtras(genID, texts[1:])
		markCanvasGenTextSuccess(genID, texts[0])
	}(gen.ID)
	return gen.ID, nil
}

// SubmitCanvasAudio 提交画布音频节点生成任务（TTS 回环 /v1/audio/speech，产物转存后回写 URL）
func SubmitCanvasAudio(userID int, req CanvasGenRequest) (int, error) {
	cfg, err := getDirectorConfig(userID, "audio")
	if err != nil {
		return 0, err
	}
	voice := req.Voice
	if voice == "" {
		voice = "alloy"
	}
	format := req.AudioFormat
	if format == "" {
		format = "mp3"
	}
	speed := req.Speed
	if speed <= 0 {
		speed = 1
	}
	gen := &model.CanvasGeneration{
		UserID:    userID,
		ProjectID: req.ProjectID,
		NodeID:    req.NodeID,
		Kind:      "audio",
		Prompt:    req.Prompt,
		Model:     cfg.Model,
		Status:    model.DirectorGenStatusProcessing,
	}
	if err = gen.Insert(); err != nil {
		return 0, err
	}
	go func(genID int) {
		acquireLLMSlot()
		defer releaseLLMSlot()
		data, rErr := relayPostRaw(cfg, "/v1/audio/speech", map[string]any{
			"model":           cfg.Model,
			"input":           req.Prompt,
			"voice":           voice,
			"response_format": format,
			"speed":           speed,
		})
		if rErr != nil {
			markCanvasGenFailed(genID, rErr)
			return
		}
		if len(data) == 0 {
			markCanvasGenFailed(genID, errors.New("接口未返回音频"))
			return
		}
		url, sErr := canvasStoreBytes(data, fmt.Sprintf("audio_%d.%s", time.Now().UnixNano(), format), userID, req.ProjectID)
		if sErr != nil {
			markCanvasGenFailed(genID, sErr)
			return
		}
		markCanvasGenSuccess(genID, url)
	}(gen.ID)
	return gen.ID, nil
}
