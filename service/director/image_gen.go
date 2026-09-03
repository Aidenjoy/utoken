package director

import (
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// ImageGenRequest 图片生成请求参数
type ImageGenRequest struct {
	Prompt          string   // 正向提示词
	Size            string   // 尺寸（如 1440x2560）
	ReferenceImages []string // 参考图 URL 列表
	Model           string   // 覆盖默认模型
	UserID          int      // 转存归属用户
	ProjectID       int      // 转存归档项目
}

// ImageGenerationService 图片生成服务（回环 /v1/images/generations，OpenAI 兼容协议）
type ImageGenerationService struct{}

// generateImage 调用图片生成接口，同步返回图片可访问地址
func (p *ImageGenerationService) generateImage(cfg directorCallConfig, req ImageGenRequest) (string, error) {
	size := req.Size
	if size == "" {
		// 竖屏默认 9:16；1440x2560 为该比例下常见最小合规尺寸
		size = "1440x2560"
	}
	modelName := req.Model
	if modelName == "" {
		modelName = cfg.Model
	}
	body := map[string]any{
		"model":           modelName,
		"prompt":          req.Prompt,
		"n":               1,
		"size":            size,
		"response_format": "url",
		// 火山 Ark 默认在图片右下角盖「AI 生成」水印，显式关闭（与 Playground 图片一致）
		"watermark": false,
	}
	// 参考图输入：image 数组（http URL，多图融合保证角色/场景一致性）
	if len(req.ReferenceImages) > 0 {
		body["image"] = req.ReferenceImages
	}
	var result struct {
		Data []struct {
			URL     string `json:"url"`
			B64JSON string `json:"b64_json"`
		} `json:"data"`
	}
	if err := relayPost(cfg, "/v1/images/generations", body, &result); err != nil {
		return "", err
	}
	if len(result.Data) == 0 || (result.Data[0].URL == "" && result.Data[0].B64JSON == "") {
		return "", errors.New("接口未返回图片")
	}
	if result.Data[0].URL != "" {
		return result.Data[0].URL, nil
	}
	// b64 格式直接转存 TOS
	data, err := base64.StdEncoding.DecodeString(result.Data[0].B64JSON)
	if err != nil {
		return "", fmt.Errorf("解码图片失败: %w", err)
	}
	return storeBytesToTOS(data, fmt.Sprintf("img_%d.png", time.Now().UnixNano()), req.UserID, req.ProjectID)
}

// ============ 生成入口（异步执行，前端轮询任务状态） ============

// SubmitCharacterImage 提交角色形象图生成任务，customPrompt/size 非空时覆盖默认值
func (s *ImageGenerationService) SubmitCharacterImage(userID, characterID int, customPrompt, size string) (int, error) {
	character, err := model.GetDirectorCharacterByID(characterID)
	if err != nil {
		return 0, errors.New("角色不存在")
	}
	project, _ := model.GetDirectorProjectByID(character.ProjectID)
	style := ""
	if project != nil {
		style = project.Style
	}
	// customPrompt 为用户编辑的描述（非完整提示词），为空时用角色现有提示词
	description := strings.TrimSpace(customPrompt)
	if description == "" {
		if strings.TrimSpace(character.Prompt) == "" {
			return 0, errors.New("该角色还没有提示词，请先完善角色信息")
		}
		description = character.Prompt
	} else {
		// 保存用户最后一次编辑的描述，重新打开弹窗时回显
		character.Update(map[string]any{"prompt": description})
	}
	prompt := buildCharacterPrompt(description, character.Role, style)
	gen := &model.DirectorImageGeneration{
		UserID:      userID,
		CharacterID: &characterID,
		ProjectID:   &character.ProjectID,
		ImageType:   "character",
		Prompt:      prompt,
		Status:      model.DirectorGenStatusProcessing,
	}
	projectID := character.ProjectID
	return s.submit(userID, projectID, gen, prompt, size, nil, func(url string) {
		model.DB.Model(&model.DirectorCharacter{}).Where("id = ?", characterID).Update("image_url", url)
		model.DB.Create(&model.DirectorAsset{
			CreatedAt: time.Now().Unix(),
			UpdatedAt: time.Now().Unix(),
			UserID:    userID,
			ProjectID: &character.ProjectID,
			Name:      fmt.Sprintf("角色 %s 形象图", character.Name),
			Type:      "image",
			Category:  "character",
			URL:       url,
		})
	})
}

// SubmitSceneImage 提交场景图生成任务，customPrompt/size 非空时覆盖默认值
func (s *ImageGenerationService) SubmitSceneImage(userID, sceneID int, customPrompt, size string) (int, error) {
	scene, err := model.GetDirectorSceneByID(sceneID)
	if err != nil {
		return 0, errors.New("场景不存在")
	}
	prompt := strings.TrimSpace(customPrompt)
	if prompt == "" {
		prompt = scene.Prompt
		if strings.TrimSpace(prompt) == "" {
			prompt = fmt.Sprintf("%s，%s，电影级场景概念图，无人出现，细节丰富", scene.Location, scene.Time)
		}
		project, _ := model.GetDirectorProjectByID(scene.ProjectID)
		style := ""
		if project != nil {
			style = project.Style
		}
		prompt = withStyle(prompt, style)
	} else {
		// 保存用户最后一次编辑的 prompt（原始 token 文本），重新打开弹窗时回显
		scene.Update(map[string]any{"prompt": prompt})
	}
	// @ 引用展开：提示词中的 @[char:x] 等标识替换为「参考图N」，资产地址作为参考图
	var refImages []string
	prompt, refImages, _ = expandMentions(prompt)
	gen := &model.DirectorImageGeneration{
		UserID:    userID,
		SceneID:   &sceneID,
		ProjectID: &scene.ProjectID,
		ImageType: "scene",
		Prompt:    prompt,
		Status:    model.DirectorGenStatusProcessing,
	}
	projectID := scene.ProjectID
	return s.submit(userID, projectID, gen, prompt, size, refImages, func(url string) {
		model.DB.Model(&model.DirectorScene{}).Where("id = ?", sceneID).Updates(map[string]any{
			"image_url": url,
			"status":    "completed",
		})
		model.DB.Create(&model.DirectorAsset{
			CreatedAt: time.Now().Unix(),
			UpdatedAt: time.Now().Unix(),
			UserID:    userID,
			ProjectID: &scene.ProjectID,
			Name:      fmt.Sprintf("场景 %s-%s 场景图", scene.Location, scene.Time),
			Type:      "image",
			Category:  "scene",
			URL:       url,
		})
	})
}

// SubmitPropImage 提交道具图生成任务，customPrompt/size 非空时覆盖默认值
func (s *ImageGenerationService) SubmitPropImage(userID, propID int, customPrompt, size string) (int, error) {
	prop, err := model.GetDirectorPropByID(propID)
	if err != nil {
		return 0, errors.New("道具不存在")
	}
	prompt := strings.TrimSpace(customPrompt)
	if prompt == "" {
		prompt = strings.TrimSpace(prop.Prompt)
		if prompt == "" {
			prompt = fmt.Sprintf("%s，产品道具单品图，主体居中完整入画，干净简约背景，摄影棚柔光，高清细节", prop.Name)
		}
		project, _ := model.GetDirectorProjectByID(prop.ProjectID)
		style := ""
		if project != nil {
			style = project.Style
		}
		prompt = withStyle(prompt, style)
	} else {
		// 保存用户最后一次编辑的 prompt（原始 token 文本），重新打开弹窗时回显
		prop.Update(map[string]any{"prompt": prompt})
	}
	// @ 引用展开：提示词中的 @[kind:x] 标识替换为「参考图N」并收集资产地址
	var refImages []string
	prompt, refImages, _ = expandMentions(prompt)
	gen := &model.DirectorImageGeneration{
		UserID:    userID,
		PropID:    &propID,
		ProjectID: &prop.ProjectID,
		ImageType: "prop",
		Prompt:    prompt,
		Status:    model.DirectorGenStatusProcessing,
	}
	projectID := prop.ProjectID
	return s.submit(userID, projectID, gen, prompt, size, refImages, func(url string) {
		model.DB.Model(&model.DirectorProp{}).Where("id = ?", propID).Updates(map[string]any{
			"image_url": url,
			"status":    "imaged",
		})
		model.DB.Create(&model.DirectorAsset{
			CreatedAt: time.Now().Unix(),
			UpdatedAt: time.Now().Unix(),
			UserID:    userID,
			ProjectID: &prop.ProjectID,
			Name:      fmt.Sprintf("道具 %s 道具图", prop.Name),
			Type:      "image",
			Category:  "prop",
			URL:       url,
		})
	})
}

// SubmitStoryboardImage 提交分镜首帧图生成任务，customPrompt/size 非空时覆盖默认值
func (s *ImageGenerationService) SubmitStoryboardImage(userID, storyboardID int, customPrompt, size string) (int, error) {
	storyboard, err := model.GetDirectorStoryboardDetail(storyboardID)
	if err != nil {
		return 0, errors.New("分镜不存在")
	}
	episode, err := model.GetDirectorEpisodeByID(storyboard.EpisodeID)
	if err != nil {
		return 0, errors.New("分集不存在")
	}
	prompt := strings.TrimSpace(customPrompt)
	if prompt == "" {
		prompt = storyboard.ImagePrompt
		if strings.TrimSpace(prompt) == "" {
			prompt = fmt.Sprintf("%s，%s，%s镜头", storyboard.Location, storyboard.Time, storyboard.ShotType)
		}
		prompt = withProjectStyle(prompt, episode.ProjectID)
	} else {
		// 保存用户最后一次编辑的 prompt（原始 token 文本），重新打开弹窗时回显
		storyboard.Update(map[string]any{"image_prompt": prompt})
	}
	// 一致性参考图：提示词中的 @ 引用优先；未显式引用时回退自动收集
	// （出镜角色形象图 + 同场景场景图），保证镜头人物与「角色形象」步骤产出的设定图一致
	refImages := make([]string, 0, 4)
	prompt, refImages, _ = expandMentions(prompt)
	if len(refImages) == 0 {
		refImages = collectStoryboardRefs(storyboard, episode)
	}
	if len(refImages) > 0 {
		prompt += "，画面中的人物形象严格保持与参考图中角色一致（面容、发型、服装、体态不变），场景环境与场景参考图一致"
	}
	gen := &model.DirectorImageGeneration{
		UserID:       userID,
		StoryboardID: &storyboardID,
		ProjectID:    &episode.ProjectID,
		ImageType:    "storyboard",
		FrameType:    "first",
		Prompt:       prompt,
		Status:       model.DirectorGenStatusProcessing,
	}
	projectID := episode.ProjectID
	episodeID := storyboard.EpisodeID
	number := storyboard.StoryboardNumber
	return s.submit(userID, projectID, gen, prompt, size, refImages, func(url string) {
		model.DB.Model(&model.DirectorStoryboard{}).Where("id = ?", storyboardID).Updates(map[string]any{
			"first_frame_image": url,
			"status":            "imaged",
		})
		model.DB.Create(&model.DirectorAsset{
			CreatedAt:    time.Now().Unix(),
			UpdatedAt:    time.Now().Unix(),
			UserID:       userID,
			ProjectID:    &projectID,
			EpisodeID:    &episodeID,
			StoryboardID: &storyboardID,
			Name:         fmt.Sprintf("分镜%d 首帧图", number),
			Type:         "image",
			Category:     "storyboard",
			URL:          url,
		})
	})
}

// submit 创建任务记录并异步执行生成，完成后回写
func (s *ImageGenerationService) submit(userID, projectID int, gen *model.DirectorImageGeneration, prompt string, size string, refImages []string, apply func(url string)) (int, error) {
	cfg, err := getDirectorImageConfig(userID)
	if err != nil {
		return 0, err
	}
	gen.Model = cfg.Model
	if err = gen.Insert(); err != nil {
		return 0, err
	}
	go func(genID int) {
		// 并发队列：批量提交时最多同时生成 imageConcurrentLimit 张，其余排队等槽位
		acquireImageSlot()
		defer releaseImageSlot()
		common.SysLog(fmt.Sprintf("云导演图片生成开始: genId=%d, model=%s, size=%s, refs=%d", genID, cfg.Model, size, len(refImages)))
		remoteURL, genErr := s.generateImage(cfg, ImageGenRequest{
			Prompt:          prompt,
			Size:            size,
			ReferenceImages: refImages,
			UserID:          userID,
			ProjectID:       projectID,
		})
		if genErr != nil {
			common.SysError(fmt.Sprintf("云导演图片生成失败: genId=%d, err=%v", genID, genErr))
			updateImageGenFailed(genID, genErr)
			return
		}
		// 转存到 TOS，防止临时链接过期
		finalURL, storeErr := storeRemoteFileToTOS(remoteURL, fmt.Sprintf("img_%d.png", time.Now().UnixNano()), userID, projectID)
		if storeErr != nil {
			common.SysLog(fmt.Sprintf("云导演图片转存失败，使用原始链接: %v", storeErr))
			finalURL = remoteURL
		}
		now := time.Now().Unix()
		model.DB.Model(&model.DirectorImageGeneration{}).Where("id = ?", genID).Updates(map[string]any{
			"status":       model.DirectorGenStatusSuccess,
			"image_url":    finalURL,
			"completed_at": now,
			"updated_at":   now,
		})
		common.SysLog(fmt.Sprintf("云导演图片生成成功: genId=%d, url=%s", genID, finalURL))
		apply(finalURL)
	}(gen.ID)
	return gen.ID, nil
}

func updateImageGenFailed(genID int, err error) {
	now := time.Now().Unix()
	model.DB.Model(&model.DirectorImageGeneration{}).Where("id = ?", genID).Updates(map[string]any{
		"status":       model.DirectorGenStatusFailed,
		"error_msg":    err.Error(),
		"completed_at": now,
		"updated_at":   now,
	})
}

// buildCharacterPrompt 拼装角色形象完整提示词：系统模板（多角度设定图规范）+ 用户角色描述
func buildCharacterPrompt(description, role, style string) string {
	description = strings.TrimSpace(description)
	if description == "" {
		description = "形象待定"
	}
	prompt := fmt.Sprintf(
		"角色形象设定图，character reference sheet，同一画面从左至右并排四个角度的同一角色：正面近景特写、正面全身、侧面全身、背面全身，"+
			"%s，%s，"+
			"四个角度必须是完全相同的角色，面容发型服装体态光影完全一致，"+
			"正面全身旁附带身高参考刻度尺，"+
			"中性灰色无缝背景，摄影棚柔光，光线均匀柔和，无硬阴影，"+
			"全身视角从头顶到脚底完整入画不裁切，"+
			"高清画质，细节丰富，画面除刻度尺外无其他文字，无水印无签名无边框",
		description, role,
	)
	if s, ok := dramaStyleMap[style]; ok {
		prompt += "，" + s
	}
	return prompt
}

var dramaStyleMap = map[string]string{
	"realistic":  "写实风格，电影质感，真人摄影感",
	"anime":      "二次元动漫风格，精美插画",
	"3d":         "3D 渲染风格，C4D 质感",
	"watercolor": "水彩插画风格",
}

func withStyle(prompt, style string) string {
	if s, ok := dramaStyleMap[style]; ok {
		return prompt + "，" + s
	}
	return prompt + "，写实风格，电影质感"
}

func withProjectStyle(prompt string, projectID int) string {
	project, err := model.GetDirectorProjectByID(projectID)
	if err != nil {
		return withStyle(prompt, "")
	}
	return withStyle(prompt, project.Style)
}

// collectStoryboardRefs 收集分镜一致性参考图：出镜角色形象图 + 同场景场景图。
// 拆解未标注出镜角色时回退用本集全部角色
func collectStoryboardRefs(storyboard *model.DirectorStoryboard, episode *model.DirectorEpisode) []string {
	refs := make([]string, 0, 4)
	appendRef := func(imageURL string) {
		if strings.TrimSpace(imageURL) == "" {
			return
		}
		u, err := toDataURL(imageURL)
		if err != nil {
			common.SysLog(fmt.Sprintf("参考图转换失败，跳过: url=%s, err=%v", imageURL, err))
			return
		}
		refs = append(refs, u)
	}
	chars := storyboard.Characters
	if len(chars) == 0 {
		var fallback []model.DirectorCharacter
		model.DB.Model(episode).Association("Characters").Find(&fallback)
		for i := range fallback {
			chars = append(chars, &fallback[i])
		}
	}
	imaged := 0
	for _, c := range chars {
		if imaged >= 3 {
			break
		}
		if strings.TrimSpace(c.ImageURL) != "" {
			appendRef(c.ImageURL)
			imaged++
		}
	}
	var scenes []model.DirectorScene
	model.DB.Model(episode).Association("Scenes").Find(&scenes)
	for _, sc := range scenes {
		if sc.Location == storyboard.Location && strings.TrimSpace(sc.ImageURL) != "" {
			appendRef(sc.ImageURL)
			break
		}
	}
	return refs
}
