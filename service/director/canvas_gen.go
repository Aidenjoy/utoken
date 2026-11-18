package director

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
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
	AspectRatio     string   // 视频画幅（如 16:9）
	Resolution      string   // 视频分辨率（如 720p）
	Duration        int      // 视频时长（秒）
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

func markCanvasGenFailed(genID int, err error) {
	msg := "生成失败"
	if err != nil {
		msg = friendlyAIError(err.Error())
	}
	common.SysError(fmt.Sprintf("智能画布生成失败: genId=%d, msg=%s, err=%v", genID, msg, err))
	now := time.Now().Unix()
	model.DB.Model(&model.CanvasGeneration{}).Where("id = ?", genID).Updates(map[string]any{
		"status":       model.DirectorGenStatusFailed,
		"error_msg":    msg,
		"completed_at": now,
		"updated_at":   now,
	})
}

func markCanvasGenSuccess(genID int, resultURL string) {
	now := time.Now().Unix()
	model.DB.Model(&model.CanvasGeneration{}).Where("id = ?", genID).Updates(map[string]any{
		"status":       model.DirectorGenStatusSuccess,
		"result_url":   resultURL,
		"completed_at": now,
		"updated_at":   now,
	})
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
			"n":               1,
			"size":            size,
			"response_format": "url",
			// 火山 Ark 默认盖「AI 生成」水印，显式关闭（与云导演一致）
			"watermark": false,
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
		finalURL := result.Data[0].URL
		if finalURL == "" {
			data, dErr := base64.StdEncoding.DecodeString(result.Data[0].B64JSON)
			if dErr != nil {
				markCanvasGenFailed(genID, fmt.Errorf("解码图片失败: %w", dErr))
				return
			}
			url, _, sErr := common.UploadBytesToTOS(data, fmt.Sprintf("img_%d.png", time.Now().UnixNano()), userID, fmt.Sprintf("canvas%d", req.ProjectID))
			if sErr != nil {
				markCanvasGenFailed(genID, sErr)
				return
			}
			finalURL = url
		} else {
			stored, sErr := canvasStoreRemote(finalURL, fmt.Sprintf("img_%d.png", time.Now().UnixNano()), userID, req.ProjectID)
			if sErr != nil {
				common.SysLog(fmt.Sprintf("智能画布图片转存失败，使用原始链接: genId=%d, err=%v", genID, sErr))
			} else {
				finalURL = stored
			}
		}
		markCanvasGenSuccess(genID, finalURL)
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
		taskID, subErr := videoSvc.SubmitVideoTask(cfg, VideoGenRequest{
			Prompt:          req.Prompt,
			ReferenceImages: req.ReferenceImages,
			Duration:        duration,
			AspectRatio:     aspectRatio,
			Resolution:      req.Resolution,
		})
		if subErr != nil {
			markCanvasGenFailed(genID, subErr)
			return
		}
		model.DB.Model(&model.CanvasGeneration{}).Where("id = ?", genID).Update("task_id", taskID)
		pollCanvasVideoTask(videoSvc, genID, cfg, taskID, userID, req.ProjectID)
	}(gen.ID)
	return gen.ID, nil
}

// pollCanvasVideoTask 后台轮询画布视频任务直至完成或超时
func pollCanvasVideoTask(s *VideoGenerationService, genID int, cfg directorCallConfig, taskID string, userID, projectID int) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	timeout := time.After(15 * time.Minute)
	failCount := 0
	for {
		select {
		case <-timeout:
			markCanvasGenFailed(genID, errors.New("任务超时（15分钟）"))
			return
		case <-ticker.C:
			status, videoURL, err := s.QueryVideoTask(cfg, taskID)
			if err != nil && status != "processing" {
				failCount++
				if failCount >= 3 {
					markCanvasGenFailed(genID, err)
					return
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
				markCanvasGenSuccess(genID, finalURL)
				return
			case "failed":
				markCanvasGenFailed(genID, err)
				return
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
		go pollCanvasVideoTask(videoSvc, t.ID, cfg, t.TaskID, t.UserID, t.ProjectID)
	}
}