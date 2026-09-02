package director

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// 角色外貌 prompt 生成的系统规范（单个与批量共用）
const characterPromptSystem = `你是专业角色形象设计师。根据角色信息撰写用于 AI 绘图的外貌提示词，要求：
1. 涵盖性别、年龄感、发型发色、五官特征、服装服饰、身形体态、气质
2. 细节具体可直接用于绘图，避免抽象形容词堆砌
3. 单段文字，120字以内，直接输出提示词本身，不要任何解释或前缀`

// 场景图 prompt 生成的系统规范（单个与批量共用）
const scenePromptSystem = `你是专业场景概念设计师。根据场景信息撰写用于 AI 绘图的场景图提示词，要求：
1. 涵盖环境布局、关键陈设/景物、材质细节、光线方向、时间氛围、色调
2. 若引用了角色形象，可描述其在场景中的位置与状态；未引用时画面中不出现人物
3. 单段文字，120字以内，直接输出提示词本身，不要任何解释或前缀`

// 道具图 prompt 生成的系统规范
const propPromptSystem = `你是专业产品道具设计师。根据道具信息撰写用于 AI 绘图的道具图提示词，要求：
1. 涵盖外观造型、材质、颜色、细节纹理、摆放状态、背景与光线
2. 画面中不出现人物，单品主体突出
3. 单段文字，120字以内，直接输出提示词本身，不要任何解释或前缀`

// 分镜首帧图 prompt 生成的系统规范
const storyboardPromptSystem = `你是专业影视分镜师。根据分镜信息撰写用于 AI 绘图的镜头首帧图提示词，要求：
1. 具体描述画面中的人物外貌服装、动作姿态、表情神态与环境细节
2. 体现景别构图与光线氛围，画面可直接作为视频首帧
3. 单段文字，120字以内，直接输出提示词本身，不要任何解释或前缀`

// 分镜视频运动 prompt 生成的系统规范
const storyboardVideoPromptSystem = `你是专业影视动作指导。根据分镜信息撰写用于图生视频的运动提示词，要求：
1. 具体描述镜头内的运动内容：人物动作轨迹、表情变化、运镜方式与速度
2. 运动连贯自然，符合物理规律，不引入首帧之外的新元素
3. 单段文字，120字以内，直接输出提示词本身，不要任何解释或前缀`

// GenerateCharacterPrompt 用 LLM 生成角色外貌 prompt 并写回 character.prompt
func (s *LLMService) GenerateCharacterPrompt(userID, characterID int) (string, error) {
	character, err := model.GetDirectorCharacterByID(characterID)
	if err != nil {
		return "", errors.New("角色不存在")
	}
	project, _ := model.GetDirectorProjectByID(character.ProjectID)
	style := ""
	if project != nil {
		style = project.Style
	}
	cfg, err := getDirectorTextConfig(userID)
	if err != nil {
		return "", err
	}
	messages := []ChatMessage{
		{Role: "system", Content: characterPromptSystem},
		{Role: "user", Content: buildCharacterInfoText(*character, style)},
	}
	content, err := s.Chat(cfg, messages, false, 1024)
	if err != nil {
		return "", err
	}
	prompt := strings.TrimSpace(content)
	if prompt == "" {
		return "", errors.New("模型未返回有效提示词")
	}
	if err = character.Update(map[string]any{"prompt": prompt}); err != nil {
		return "", err
	}
	return prompt, nil
}

// GenerateScenePrompt 用 LLM 生成场景图 prompt 并写回 scene.prompt
func (s *LLMService) GenerateScenePrompt(userID, sceneID int) (string, error) {
	scene, err := model.GetDirectorSceneByID(sceneID)
	if err != nil {
		return "", errors.New("场景不存在")
	}
	project, _ := model.GetDirectorProjectByID(scene.ProjectID)
	style := ""
	if project != nil {
		style = project.Style
	}
	cfg, err := getDirectorTextConfig(userID)
	if err != nil {
		return "", err
	}
	// @ 引用：场景图提示词必须引用画面涉及的角色形象与道具图片
	var candidates string
	if scene.EpisodeID != nil {
		if episode, eErr := model.GetDirectorEpisodeByID(*scene.EpisodeID); eErr == nil {
			candidates = buildMentionCandidates(episode, []string{"char", "prop"}, 0)
		}
	}
	messages := []ChatMessage{
		{Role: "system", Content: withMentionSystem(scenePromptSystem, candidates)},
		{Role: "user", Content: buildSceneInfoText(*scene, style)},
	}
	content, err := s.Chat(cfg, messages, false, 1024)
	if err != nil {
		return "", err
	}
	prompt := strings.TrimSpace(content)
	if prompt == "" {
		return "", errors.New("模型未返回有效提示词")
	}
	prompt = ensureMentions(prompt, candidates, []string{"char", "prop"})
	if err = scene.Update(map[string]any{"prompt": prompt}); err != nil {
		return "", err
	}
	return prompt, nil
}

// GeneratePropPrompt 用 LLM 生成道具图 prompt 并写回 prop.prompt
func (s *LLMService) GeneratePropPrompt(userID, propID int) (string, error) {
	prop, err := model.GetDirectorPropByID(propID)
	if err != nil {
		return "", errors.New("道具不存在")
	}
	project, _ := model.GetDirectorProjectByID(prop.ProjectID)
	style := ""
	if project != nil {
		style = project.Style
	}
	cfg, err := getDirectorTextConfig(userID)
	if err != nil {
		return "", err
	}
	parts := []string{fmt.Sprintf("道具名：%s", prop.Name)}
	if prop.Type != "" {
		parts = append(parts, "类型："+prop.Type)
	}
	if prop.Description != "" {
		parts = append(parts, "描述："+prop.Description)
	}
	if style != "" {
		parts = append(parts, "剧集风格："+style)
	}
	messages := []ChatMessage{
		{Role: "system", Content: propPromptSystem},
		{Role: "user", Content: strings.Join(parts, "，")},
	}
	content, err := s.Chat(cfg, messages, false, 1024)
	if err != nil {
		return "", err
	}
	prompt := strings.TrimSpace(content)
	if prompt == "" {
		return "", errors.New("模型未返回有效提示词")
	}
	if err = prop.Update(map[string]any{"prompt": prompt}); err != nil {
		return "", err
	}
	return prompt, nil
}

// GenerateStoryboardPrompt 用 LLM 重新生成分镜首帧图 prompt 并写回 storyboard.image_prompt
func (s *LLMService) GenerateStoryboardPrompt(userID, storyboardID int) (string, error) {
	storyboard, err := model.GetDirectorStoryboardByID(storyboardID)
	if err != nil {
		return "", errors.New("分镜不存在")
	}
	episode, err := model.GetDirectorEpisodeByID(storyboard.EpisodeID)
	if err != nil {
		return "", errors.New("分集不存在")
	}
	project, _ := model.GetDirectorProjectByID(episode.ProjectID)
	style := ""
	if project != nil {
		style = project.Style
	}
	cfg, err := getDirectorTextConfig(userID)
	if err != nil {
		return "", err
	}
	parts := []string{
		fmt.Sprintf("地点：%s", storyboard.Location),
		"时间：" + storyboard.Time,
		"景别：" + storyboard.ShotType,
	}
	if storyboard.Movement != "" {
		parts = append(parts, "运镜："+storyboard.Movement)
	}
	if style != "" {
		parts = append(parts, "剧集风格："+style)
	}
	// @ 引用：镜头图提示词必须引用画面涉及的场景/角色/道具图片
	candidates := buildMentionCandidates(episode, []string{"char", "prop", "scene"}, storyboardID)
	messages := []ChatMessage{
		{Role: "system", Content: withMentionSystem(storyboardPromptSystem, candidates)},
		{Role: "user", Content: strings.Join(parts, "，")},
	}
	content, err := s.Chat(cfg, messages, false, 1024)
	if err != nil {
		return "", err
	}
	prompt := strings.TrimSpace(content)
	if prompt == "" {
		return "", errors.New("模型未返回有效提示词")
	}
	prompt = ensureMentions(prompt, candidates, []string{"scene", "char"})
	if err = storyboard.Update(map[string]any{"image_prompt": prompt}); err != nil {
		return "", err
	}
	return prompt, nil
}

// GenerateStoryboardVideoPrompt 用 LLM 重新生成分镜视频运动 prompt 并写回 storyboard.video_prompt
func (s *LLMService) GenerateStoryboardVideoPrompt(userID, storyboardID int) (string, error) {
	storyboard, err := model.GetDirectorStoryboardByID(storyboardID)
	if err != nil {
		return "", errors.New("分镜不存在")
	}
	episode, err := model.GetDirectorEpisodeByID(storyboard.EpisodeID)
	if err != nil {
		return "", errors.New("分集不存在")
	}
	project, _ := model.GetDirectorProjectByID(episode.ProjectID)
	style := ""
	if project != nil {
		style = project.Style
	}
	cfg, err := getDirectorTextConfig(userID)
	if err != nil {
		return "", err
	}
	parts := []string{
		fmt.Sprintf("地点：%s", storyboard.Location),
		"时间：" + storyboard.Time,
		"景别：" + storyboard.ShotType,
	}
	if storyboard.Movement != "" {
		parts = append(parts, "运镜："+storyboard.Movement)
	}
	if style != "" {
		parts = append(parts, "剧集风格："+style)
	}
	// @ 引用：视频提示词必须引用画面涉及的角色/场景/镜头/视频（排除自身）
	candidates := buildMentionCandidates(episode, []string{"char", "scene", "shot", "video"}, storyboardID)
	messages := []ChatMessage{
		{Role: "system", Content: withMentionSystem(storyboardVideoPromptSystem, candidates)},
		{Role: "user", Content: strings.Join(parts, "，")},
	}
	content, err := s.Chat(cfg, messages, false, 1024)
	if err != nil {
		return "", err
	}
	prompt := strings.TrimSpace(content)
	if prompt == "" {
		return "", errors.New("模型未返回有效提示词")
	}
	prompt = ensureMentions(prompt, candidates, []string{"char", "scene"})
	if err = storyboard.Update(map[string]any{"video_prompt": prompt}); err != nil {
		return "", err
	}
	return prompt, nil
}

// GenerateEpisodePrompts 整集批量：为本集关联的角色与场景一次性生成 prompt（各一次 LLM 调用），已有 prompt 的不覆盖
func (s *LLMService) GenerateEpisodePrompts(userID, episodeID int) error {
	episode, err := model.GetDirectorEpisodeByID(episodeID)
	if err != nil {
		return errors.New("分集不存在")
	}
	project, _ := model.GetDirectorProjectByID(episode.ProjectID)
	style := ""
	if project != nil {
		style = project.Style
	}

	var characters []model.DirectorCharacter
	model.DB.Model(episode).Association("Characters").Find(&characters)
	var scenes []model.DirectorScene
	model.DB.Model(episode).Association("Scenes").Find(&scenes)
	if len(characters) == 0 && len(scenes) == 0 {
		return errors.New("本集还没有角色与场景，请先完成提取")
	}
	cfg, err := getDirectorTextConfig(userID)
	if err != nil {
		return err
	}

	// 角色批量生成
	charTargets := make([]model.DirectorCharacter, 0, len(characters))
	for _, c := range characters {
		if strings.TrimSpace(c.Prompt) == "" {
			charTargets = append(charTargets, c)
		}
	}
	if len(charTargets) > 0 {
		inputs := make([]string, 0, len(charTargets))
		for _, c := range charTargets {
			inputs = append(inputs, buildCharacterInfoText(c, style))
		}
		messages := []ChatMessage{
			{Role: "system", Content: characterPromptSystem + `
有多个角色需要处理，严格按以下 JSON 格式输出，顺序与输入一致，不要输出任何其他内容：
{"prompts":["角色1的提示词","角色2的提示词"]}`},
			{Role: "user", Content: "角色列表：\n" + strings.Join(numberLines(inputs), "\n")},
		}
		content, chatErr := s.Chat(cfg, messages, true, 4096)
		if chatErr != nil {
			return chatErr
		}
		var output struct {
			Prompts []string `json:"prompts"`
		}
		if err = common.Unmarshal([]byte(extractJSON(content)), &output); err != nil {
			return fmt.Errorf("解析角色提示词失败: %w", err)
		}
		for i, c := range charTargets {
			if i >= len(output.Prompts) {
				break
			}
			prompt := strings.TrimSpace(output.Prompts[i])
			if prompt == "" {
				continue
			}
			model.DB.Model(&model.DirectorCharacter{}).Where("id = ?", c.ID).Update("prompt", prompt)
		}
	}

	// 场景批量生成
	sceneTargets := make([]model.DirectorScene, 0, len(scenes))
	for _, sc := range scenes {
		if strings.TrimSpace(sc.Prompt) == "" {
			sceneTargets = append(sceneTargets, sc)
		}
	}
	if len(sceneTargets) > 0 {
		inputs := make([]string, 0, len(sceneTargets))
		for _, sc := range sceneTargets {
			inputs = append(inputs, buildSceneInfoText(sc, style))
		}
		sceneCandidates := buildMentionCandidates(episode, []string{"char", "prop"}, 0)
		messages := []ChatMessage{
			{Role: "system", Content: withMentionSystem(scenePromptSystem, sceneCandidates) + `
有多个场景需要处理，严格按以下 JSON 格式输出，顺序与输入一致，不要输出任何其他内容：
{"prompts":["场景1的提示词","场景2的提示词"]}`},
			{Role: "user", Content: "场景列表：\n" + strings.Join(numberLines(inputs), "\n")},
		}
		content, chatErr := s.Chat(cfg, messages, true, 4096)
		if chatErr != nil {
			return chatErr
		}
		var output struct {
			Prompts []string `json:"prompts"`
		}
		if err = common.Unmarshal([]byte(extractJSON(content)), &output); err != nil {
			return fmt.Errorf("解析场景提示词失败: %w", err)
		}
		for i, sc := range sceneTargets {
			if i >= len(output.Prompts) {
				break
			}
			prompt := strings.TrimSpace(output.Prompts[i])
			if prompt == "" {
				continue
			}
			model.DB.Model(&model.DirectorScene{}).Where("id = ?", sc.ID).Update("prompt", prompt)
		}
	}
	return nil
}

// buildCharacterInfoText 组装角色信息文本（供 LLM 生成外貌 prompt）
func buildCharacterInfoText(c model.DirectorCharacter, style string) string {
	parts := []string{fmt.Sprintf("角色名：%s", c.Name)}
	if c.Role != "" {
		parts = append(parts, "定位："+c.Role)
	}
	if c.Appearance != "" {
		parts = append(parts, "外貌："+c.Appearance)
	}
	if c.Personality != "" {
		parts = append(parts, "性格："+c.Personality)
	}
	if style != "" {
		parts = append(parts, "剧集风格："+style)
	}
	return strings.Join(parts, "，")
}

// buildSceneInfoText 组装场景信息文本（供 LLM 生成场景图 prompt）
func buildSceneInfoText(sc model.DirectorScene, style string) string {
	parts := []string{fmt.Sprintf("地点：%s", sc.Location), "时间：" + sc.Time}
	if style != "" {
		parts = append(parts, "剧集风格："+style)
	}
	return strings.Join(parts, "，")
}

// numberLines 给每行加序号，帮助 LLM 按序输出
func numberLines(items []string) []string {
	out := make([]string, 0, len(items))
	for i, item := range items {
		out = append(out, fmt.Sprintf("%d. %s", i+1, item))
	}
	return out
}
