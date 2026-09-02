package director

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"gorm.io/gorm"
)

// EditService 在线剪辑服务（草稿保存/读取、云端渲染、字幕纠错）
type EditService struct{}

// ---------- 时间轴 JSON 结构（与前端约定一致） ----------

// editTransition 片段间转场（定义在前一片段上，表示该片段与下一片段之间的过渡）
type editTransition struct {
	Type     string  `json:"type"`     // fade/fadeblack/fadewhite/dissolve/wipeleft/wiperight/slideup/slidedown，空为无转场
	Duration float64 `json:"duration"` // 转场时长（秒）
}

// editCrop 比例裁切（相对源画面的归一化矩形，0-1）
type editCrop struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

// editFilter 画面质感调节（滤镜预设展开为具体参数，显式参数优先）
type editFilter struct {
	Brightness  float64 `json:"brightness"`  // 亮度 -1..1，0 为默认
	Contrast    float64 `json:"contrast"`    // 对比度 0..2，1 为默认
	Saturation  float64 `json:"saturation"`  // 饱和度 0..3，1 为默认
	Temperature int     `json:"temperature"` // 色温 1000-40000K，0 为默认（6500K）
	Preset      string  `json:"preset"`      // 滤镜预设 vivid/soft/film/bw/warm/cool
	Sharpen     bool    `json:"sharpen"`     // 锐化
}

// editClip 时间轴片段
type editClip struct {
	StoryboardID int            `json:"storyboardId"` // 关联分镜（素材替换后可为 0）
	SrcURL       string         `json:"srcUrl"`       // 源视频地址
	Start        float64        `json:"start"`        // 源内入点（秒）
	End          float64        `json:"end"`          // 源内出点（秒）
	Speed        float64        `json:"speed"`        // 变速倍率 0.25-10
	Volume       float64        `json:"volume"`       // 音量 0-2
	Muted        bool           `json:"muted"`        // 静音
	Transition   editTransition `json:"transition"`   // 与下一片段之间的转场
	Rotate       int            `json:"rotate"`       // 旋转角度 0/90/180/270
	Flip         string         `json:"flip"`         // 翻转 h/v/hv，空为无
	Crop         *editCrop      `json:"crop"`         // 比例裁切，nil 为不裁切
	Filter       editFilter     `json:"filter"`       // 质感调节
}

// clipDuration 片段在时间轴上的实际时长（裁剪长度 / 变速倍率）
func (c editClip) clipDuration() float64 {
	speed := c.Speed
	if speed <= 0 {
		speed = 1
	}
	d := (c.End - c.Start) / speed
	if d < 0 {
		return 0
	}
	return d
}

// editSubtitleStyle 字幕样式
type editSubtitleStyle struct {
	FontFamily string `json:"fontFamily"` // 字体名，缺省 PingFang SC
	FontSize   int    `json:"fontSize"`   // 字号
	Color      string `json:"color"`      // #RRGGBB
	Position   string `json:"position"`   // top/middle/bottom
	Animation  string `json:"animation"`  // 动画 ""/fade
}

// editSubtitle 字幕条目（start/end 为时间轴上的秒）
type editSubtitle struct {
	Text  string            `json:"text"`
	Start float64           `json:"start"`
	End   float64           `json:"end"`
	Style editSubtitleStyle `json:"style"`
}

// editAudio 音频轨设置
type editAudio struct {
	BgmURL      string  `json:"bgmUrl"`      // 背景音乐地址，空为无
	BgmVolume   float64 `json:"bgmVolume"`   // BGM 音量 0-2
	VoiceVolume float64 `json:"voiceVolume"` // 原声（人声）音量 0-2
}

// editSticker 贴纸（图片叠加）
type editSticker struct {
	URL   string  `json:"url"`   // 贴纸图片地址
	X     float64 `json:"x"`     // 左上角 X（输出画面像素）
	Y     float64 `json:"y"`     // 左上角 Y（输出画面像素）
	Width float64 `json:"width"` // 显示宽度（像素，高度等比）
	Start float64 `json:"start"` // 出现时间（秒）
	End   float64 `json:"end"`   // 消失时间（秒）
}

// editTimeline 剪辑工程时间轴
type editTimeline struct {
	Clips     []editClip     `json:"clips"`
	Subtitles []editSubtitle `json:"subtitles"`
	Audio     editAudio      `json:"audio"`
	Stickers  []editSticker  `json:"stickers"`
	// 剪辑级输出画幅（空串表示跟随分集设置；横屏素材可单独导出横屏成片）
	AspectRatio string `json:"aspectRatio"`
}

// totalDuration 时间轴总时长（各片段时长之和，不含转场重叠修正的近似值）
func (t editTimeline) totalDuration() float64 {
	total := 0.0
	for _, c := range t.Clips {
		total += c.clipDuration()
	}
	return total
}

// validateRenderTimeline 渲染前的时间轴合法性校验：片段非空、素材地址存在、出点大于入点（出点为 0 会产生零时长片段）
func validateRenderTimeline(tl editTimeline) error {
	if len(tl.Clips) == 0 {
		return errors.New("时间轴上没有视频片段，无法渲染")
	}
	for i, c := range tl.Clips {
		if c.SrcURL == "" {
			return fmt.Errorf("第 %d 个片段缺少源视频地址", i+1)
		}
		if c.End <= c.Start {
			return fmt.Errorf("第 %d 个片段的出点必须大于入点", i+1)
		}
	}
	return nil
}

// ---------- 草稿保存 / 读取 ----------

// GetEditProject 按分集查询剪辑工程；不存在时返回空工程（found=false），由前端初始化草稿
func (s *EditService) GetEditProject(episodeID int) (project model.DirectorEditProject, found bool, err error) {
	p, err := model.GetDirectorEditProjectByEpisode(episodeID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.DirectorEditProject{EpisodeID: episodeID, Status: model.DirectorEditStatusDraft}, false, nil
	}
	if err != nil {
		return
	}
	return *p, true, nil
}

// SaveEditProject 保存剪辑草稿（upsert）：时间轴变化时使既有渲染结果失效（状态回退 draft）
func (s *EditService) SaveEditProject(userID, episodeID int, name, timeline string) (model.DirectorEditProject, error) {
	project, err := model.GetDirectorEditProjectByEpisode(episodeID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		episode, epErr := model.GetDirectorEpisodeByID(episodeID)
		if epErr != nil {
			return model.DirectorEditProject{}, errors.New("分集不存在")
		}
		newProject := model.DirectorEditProject{
			UserID:    userID,
			EpisodeID: episodeID,
			ProjectID: episode.ProjectID,
			Name:      name,
			Timeline:  timeline,
			Status:    model.DirectorEditStatusDraft,
		}
		if newProject.Name == "" {
			newProject.Name = "剪辑工程"
		}
		return newProject, newProject.Insert()
	}
	if err != nil {
		return model.DirectorEditProject{}, err
	}
	if project.Status == model.DirectorEditStatusRendering {
		return *project, errors.New("正在渲染中，请等待渲染完成后再保存")
	}
	updates := map[string]any{
		"name":     name,
		"timeline": timeline,
	}
	// 时间轴内容变化后旧成片不再对应当前草稿，重置状态并清理输出
	if project.Timeline != timeline {
		updates["status"] = model.DirectorEditStatusDraft
		updates["output_url"] = ""
		updates["error_msg"] = ""
	}
	if err = project.Update(updates); err != nil {
		return *project, err
	}
	project.Name = name
	project.Timeline = timeline
	if st, ok := updates["status"]; ok {
		project.Status = st.(string)
		project.OutputURL = ""
		project.ErrorMsg = ""
	}
	return *project, nil
}

// ---------- 渲染 ----------

// SubmitEditRender 提交云端渲染任务（异步执行 ffmpeg filter_complex）
func (s *EditService) SubmitEditRender(userID, episodeID int) (int, error) {
	if _, err := ffmpegPath(); err != nil {
		return 0, err
	}
	if _, err := model.GetDirectorEpisodeByID(episodeID); err != nil {
		return 0, errors.New("分集不存在")
	}
	project, found, err := s.GetEditProject(episodeID)
	if err != nil {
		return 0, err
	}
	if !found || strings.TrimSpace(project.Timeline) == "" {
		return 0, errors.New("请先保存剪辑草稿再渲染")
	}
	var tl editTimeline
	if err = common.Unmarshal([]byte(project.Timeline), &tl); err != nil {
		return 0, fmt.Errorf("剪辑时间轴数据异常: %w", err)
	}
	if err = validateRenderTimeline(tl); err != nil {
		return 0, err
	}
	if project.Status == model.DirectorEditStatusRendering {
		return 0, errors.New("该工程正在渲染中，请勿重复提交")
	}
	if err = model.DB.Model(&model.DirectorEditProject{}).Where("id = ?", project.ID).
		Updates(map[string]any{"status": model.DirectorEditStatusRendering, "error_msg": ""}).Error; err != nil {
		return 0, err
	}
	go s.runEditRender(project.ID, userID)
	return project.ID, nil
}

// ---------- AI 字幕纠错 ----------

// subtitleCorrectLLMOutput LLM 字幕纠错返回结构
type subtitleCorrectLLMOutput struct {
	Corrected []string `json:"corrected"`
}

// CorrectSubtitlesRaw 接收原始字幕 JSON 的纠错入口（供 API 层透传调用）
func (s *EditService) CorrectSubtitlesRaw(userID, episodeID int, raw []byte) ([]editSubtitle, error) {
	var subtitles []editSubtitle
	if err := common.Unmarshal(raw, &subtitles); err != nil {
		return nil, fmt.Errorf("字幕数据格式错误: %w", err)
	}
	return s.CorrectSubtitles(userID, episodeID, subtitles)
}

// CorrectSubtitles 结合上下文对字幕文本做错别字/同音字纠正（仅改文本，不动时间轴）
func (s *EditService) CorrectSubtitles(userID, episodeID int, subtitles []editSubtitle) ([]editSubtitle, error) {
	if len(subtitles) == 0 {
		return subtitles, nil
	}
	episode, err := model.GetDirectorEpisodeByID(episodeID)
	if err != nil {
		return nil, errors.New("分集不存在")
	}
	cfg, err := getDirectorTextConfig(userID)
	if err != nil {
		return nil, err
	}
	llm := &LLMService{}
	var numbered strings.Builder
	for i, sub := range subtitles {
		numbered.WriteString(fmt.Sprintf("%d. %s\n", i+1, sub.Text))
	}
	// 剧本作为上下文参考，提高同音字纠错的准确率
	context := ""
	if episode.ScriptContent != "" {
		context = truncateRunes(episode.ScriptContent, 2000)
	} else {
		context = truncateRunes(episode.Content, 2000)
	}
	messages := []ChatMessage{
		{Role: "system", Content: `你是视频字幕校对专家。用户会给你一段剧本上下文和一组按序号排列的字幕文本。
请结合上下文纠正字幕中的错别字、同音字、语音识别错误与明显语病，保持原意、语气和大致长度不变。
要求：
1. 只修改确实有误的文字，不要润色或改写正确的内容；
2. 不要合并或拆分组幕，输出数量必须与输入完全一致；
3. 以 JSON 格式返回：{"corrected": ["纠正后的第1条", "纠正后的第2条", ...]}`},
		{Role: "user", Content: fmt.Sprintf("剧本上下文：\n%s\n\n待纠正字幕（共 %d 条）：\n%s", context, len(subtitles), numbered.String())},
	}
	content, err := llm.Chat(cfg, messages, true, 4096)
	if err != nil {
		return nil, err
	}
	content = strings.TrimSpace(strings.TrimPrefix(strings.TrimSuffix(strings.TrimPrefix(content, "```json"), "```"), "```"))
	var output subtitleCorrectLLMOutput
	if err = common.Unmarshal([]byte(content), &output); err != nil {
		return nil, fmt.Errorf("解析字幕纠错结果失败: %w", err)
	}
	// 按索引回填；数量不一致时仅回填可取到的部分，保证不丢字幕
	for i := range subtitles {
		if i < len(output.Corrected) && strings.TrimSpace(output.Corrected[i]) != "" {
			subtitles[i].Text = strings.TrimSpace(output.Corrected[i])
		}
	}
	return subtitles, nil
}
