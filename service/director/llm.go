package director

import (
	"errors"
	"fmt"
	"math"
	"net"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"gorm.io/gorm"
)

// LLMService 大模型编排服务（通过网关回环走 OpenAI 兼容协议）
type LLMService struct{}

// ChatMessage OpenAI 兼容消息
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model          string          `json:"model"`
	Messages       []ChatMessage   `json:"messages"`
	Temperature    float64         `json:"temperature"`
	MaxTokens      int             `json:"max_tokens,omitempty"`
	ResponseFormat *responseFormat `json:"response_format,omitempty"`
}

type responseFormat struct {
	Type string `json:"type"`
}

type chatResponse struct {
	Choices []struct {
		Message ChatMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// llmMaxAttempts LLM 调用最大尝试次数（含首次），针对超时/429/5xx 等瞬时故障退避重试
const llmMaxAttempts = 3

// Chat 调用回环 /v1/chat/completions（瞬时故障自动重试）
func (s *LLMService) Chat(cfg directorCallConfig, messages []ChatMessage, jsonMode bool, maxTokens int) (string, error) {
	reqBody := chatRequest{
		Model:       cfg.Model,
		Messages:    messages,
		Temperature: 0.7,
		MaxTokens:   maxTokens,
	}
	if jsonMode {
		reqBody.ResponseFormat = &responseFormat{Type: "json_object"}
	}

	var lastErr error
	for attempt := 1; attempt <= llmMaxAttempts; attempt++ {
		if attempt > 1 {
			backoff := time.Duration(attempt-1) * 10 * time.Second // 10s / 20s 退避，缓解 429 突发限流
			common.SysLog(fmt.Sprintf("云导演 LLM 重试: model=%s, attempt=%d, err=%v", cfg.Model, attempt, lastErr))
			time.Sleep(backoff)
		}
		acquireLLMSlot()
		content, retryable, err := s.chatOnce(cfg, reqBody)
		releaseLLMSlot()
		if err == nil {
			return content, nil
		}
		lastErr = err
		if !retryable {
			return "", err
		}
	}
	// 重试耗尽：给出可读提示（详情已在日志中）
	switch {
	case strings.Contains(lastErr.Error(), "429"):
		return "", fmt.Errorf("AI 服务限流（429），已自动重试 %d 次仍失败，请稍后再试或切换模型", llmMaxAttempts)
	case isTimeoutErr(lastErr):
		return "", fmt.Errorf("AI 服务响应超时，已自动重试 %d 次仍失败，请稍后再试或切换模型", llmMaxAttempts)
	default:
		return "", lastErr
	}
}

// chatOnce 单次 LLM 调用，返回内容、是否可重试、错误
func (s *LLMService) chatOnce(cfg directorCallConfig, reqBody chatRequest) (string, bool, error) {
	var cr chatResponse
	err := relayPost(cfg, "/v1/chat/completions", reqBody, &cr)
	if err != nil {
		return "", isTimeoutErr(err) || strings.Contains(err.Error(), "429") || strings.Contains(err.Error(), "接口返回 5"), err
	}
	if cr.Error != nil {
		return "", false, errors.New(cr.Error.Message)
	}
	if len(cr.Choices) == 0 {
		return "", false, errors.New("接口未返回任何内容")
	}
	return cr.Choices[0].Message.Content, false, nil
}

// isTimeoutErr 判断是否为网络超时类错误（可重试）
func isTimeoutErr(err error) bool {
	var ne net.Error
	return errors.As(err, &ne) && ne.Timeout()
}

// extractJSON 从 LLM 输出中提取 JSON 主体（容错 markdown 代码块）
func extractJSON(content string) string {
	content = strings.TrimSpace(content)
	if i := strings.Index(content, "```"); i >= 0 {
		content = strings.TrimPrefix(content[i:], "```json")
		content = strings.TrimPrefix(content, "```")
		if j := strings.LastIndex(content, "```"); j > 0 {
			content = content[:j]
		}
	}
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start >= 0 && end > start {
		return content[start : end+1]
	}
	return content
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n] + "..."
	}
	return s
}

// truncateRunes 按字符数截断文本（避免超长上下文）
func truncateRunes(s string, n int) string {
	rs := []rune(s)
	if len(rs) <= n {
		return s
	}
	return string(rs[:n])
}

// dramaRewriteSystem 短剧（默认）改写系统提示词
const dramaRewriteSystem = `你是一位专业短剧编剧。请将用户提供的原始内容改写为竖屏短剧剧本，要求：
1. 保留核心情节与冲突，节奏紧凑、反转密集
2. 按场景组织，每个场景以「场景X：地点-时间」开头
3. 包含角色对白与关键动作、神态描写
4. 对白简短有力，符合短剧风格
5. 直接输出剧本正文，不要输出任何额外解释`

// categoryRewriteSystem 各视频类型的改写系统提示词（短剧走 dramaRewriteSystem）
var categoryRewriteSystem = map[string]string{
	"ecommerce": `你是一位资深电商带货视频编导。请将用户提供的信息改写为竖屏电商带货视频脚本，要求：
1. 先痛点后卖点：开头抛出用户痛点或场景代入，随后引出产品解决方案
2. 节奏轻快、信息密度高，突出产品核心卖点与使用效果
3. 按场景组织，每个场景以「场景X：地点-时间」开头
4. 包含口播文案与关键画面动作描述，口播口语化、有感染力
5. 直接输出脚本正文，不要输出任何额外解释`,
	"ad": `你是一位资深品牌广告创意总监。请将用户提供的信息改写为竖屏品牌广告片脚本，要求：
1. 少而精：镜头与文案克制，每一帧都服务于品牌调性
2. 高级质感：情绪渲染到位，画面描述精致，文案精炼有记忆点
3. 按场景组织，每个场景以「场景X：地点-时间」开头
4. 包含旁白文案与关键画面描述，宣传口号在结尾自然收束
5. 直接输出脚本正文，不要输出任何额外解释`,
	"daily": `你是一位资深生活记录视频创作者。请将用户提供的信息改写为竖屏日常生活视频脚本，要求：
1. 舒缓生活化：节奏自然，真实接地气，不刻意制造冲突
2. 按场景组织，每个场景以「场景X：地点-时间」开头
3. 包含旁白与关键画面动作描述，旁白亲切如朋友讲述
4. 画面温馨有烟火气，突出核心情绪
5. 直接输出脚本正文，不要输出任何额外解释`,
}

// categoryStyleTag 提取/分镜环节的类型称呼（注入 system prompt 让模型知道在处理哪类内容）
var categoryStyleTag = map[string]string{
	"drama":     "短剧剧本",
	"ecommerce": "电商带货视频脚本",
	"ad":        "品牌广告片脚本",
	"daily":     "日常生活视频脚本",
}

// metaFieldDef 类型差异化录入字段定义（与前端元数据字段保持一致）
type metaFieldDef struct{ Key, Label string }

var metadataFieldDefs = map[string][]metaFieldDef{
	"ecommerce": {
		{"productParams", "产品参数"}, {"coreFeatures", "核心功能"}, {"usage", "使用方法"},
		{"sellingPoints", "卖点优势"}, {"useCases", "适用场景"}, {"painPoints", "用户痛点"},
	},
	"ad": {
		{"brandConcept", "品牌理念"}, {"promoCore", "宣传核心"}, {"mainSellingPoints", "主打卖点"},
		{"slogan", "宣传口号"}, {"targetAudience", "目标人群"},
	},
	"daily": {
		{"theme", "拍摄主题"}, {"synopsis", "故事梗概"}, {"emotion", "核心情绪"},
		{"tone", "画面基调"}, {"contentWanted", "呈现内容"},
	},
}

// episodeMetaText 将分集 Metadata JSON 按类型展开为「标签：值」文本，注入 LLM 上下文
func episodeMetaText(category, metadata string) string {
	defs, ok := metadataFieldDefs[category]
	if !ok || strings.TrimSpace(metadata) == "" {
		return ""
	}
	var kv map[string]string
	if err := common.Unmarshal([]byte(metadata), &kv); err != nil {
		return ""
	}
	lines := make([]string, 0, len(defs))
	for _, d := range defs {
		if v := strings.TrimSpace(kv[d.Key]); v != "" {
			lines = append(lines, d.Label+"："+v)
		}
	}
	if len(lines) == 0 {
		return ""
	}
	return "项目参数：\n" + strings.Join(lines, "\n")
}

// RewriteScript 剧本改写：将分集原始内容改写为结构化脚本（按项目类型差异化），写回 scriptContent
func (s *LLMService) RewriteScript(userID, episodeID int) error {
	if unlock, ok := tryAcquireEpisodeTask("rewrite", episodeID); !ok {
		return errors.New("AI 改写正在处理中，请勿重复提交")
	} else {
		defer unlock()
	}
	episode, err := model.GetDirectorEpisodeByID(episodeID)
	if err != nil {
		return errors.New("分集不存在")
	}
	if strings.TrimSpace(episode.Content) == "" {
		return errors.New("该分集还没有原始内容，请先填写")
	}
	cfg, err := getDirectorTextConfig(userID)
	if err != nil {
		return err
	}
	project, _ := model.GetDirectorProjectByID(episode.ProjectID)
	category := model.DirectorCategoryDrama
	if project != nil {
		category = project.Category
	}
	systemPrompt, ok := categoryRewriteSystem[category]
	if !ok {
		systemPrompt = dramaRewriteSystem
	}
	if episode.TargetDuration > 0 {
		systemPrompt += fmt.Sprintf("\n6. 脚本篇幅与目标总时长 %d 秒匹配（口播每秒约 3 字）", episode.TargetDuration)
	}
	userContent := episode.Content
	if metaText := episodeMetaText(category, episode.Metadata); metaText != "" {
		userContent = metaText + "\n\n原始内容：\n" + episode.Content
	}
	messages := []ChatMessage{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: userContent},
	}
	content, err := s.Chat(cfg, messages, false, 8192)
	if err != nil {
		return err
	}
	return episode.Update(map[string]any{
		"script_content": content,
	})
}

// ExtractResult 提取结果
type ExtractResult struct {
	Characters []model.DirectorCharacter `json:"characters"`
	Scenes     []model.DirectorScene     `json:"scenes"`
	Props      []model.DirectorProp      `json:"props"`
}

type extractLLMOutput struct {
	Characters []struct {
		Name   string `json:"name"`
		Role   string `json:"role"`
		Prompt string `json:"prompt"`
	} `json:"characters"`
	Scenes []struct {
		Location string `json:"location"`
		Time     string `json:"time"`
	} `json:"scenes"`
	Props []struct {
		Name   string `json:"name"`
		Type   string `json:"type"`
		Prompt string `json:"prompt"`
	} `json:"props"`
}

// ExtractRolesScenes 从剧本提取角色与场景，去重后入库并返回全量结果
func (s *LLMService) ExtractRolesScenes(userID, episodeID int) (*ExtractResult, error) {
	if unlock, ok := tryAcquireEpisodeTask("extract", episodeID); !ok {
		return nil, errors.New("AI 提取正在处理中，请勿重复提交")
	} else {
		defer unlock()
	}
	episode, err := model.GetDirectorEpisodeByID(episodeID)
	if err != nil {
		return nil, errors.New("分集不存在")
	}
	script := episode.ScriptContent
	if strings.TrimSpace(script) == "" {
		script = episode.Content
	}
	if strings.TrimSpace(script) == "" {
		return nil, errors.New("该分集还没有剧本内容，请先完成剧本改写")
	}
	cfg, err := getDirectorTextConfig(userID)
	if err != nil {
		return nil, err
	}
	project, _ := model.GetDirectorProjectByID(episode.ProjectID)
	category := model.DirectorCategoryDrama
	if project != nil {
		category = project.Category
	}
	tag := categoryStyleTag[category]
	if tag == "" {
		tag = categoryStyleTag["drama"]
	}
	messages := []ChatMessage{
		{Role: "system", Content: fmt.Sprintf(`你是剧本分析助手。从用户提供的%s中提取所有出场角色、场景和关键道具，严格按以下 JSON 格式输出，不要输出任何其他内容：
{"characters":[{"name":"角色名","role":"主角|配角|反派|客串","prompt":"外貌描述(用于AI绘图,含年龄/性别/发型/服装)"}],"scenes":[{"location":"地点","time":"白天|夜晚|黄昏|清晨"}],"props":[{"name":"道具名","type":"道具类型(如 产品/服装/食物/交通工具/摆件)","prompt":"外观描述(用于AI绘图,含造型/材质/颜色)"}]}
注意：角色去重；外貌描述要具体；时间只能是 白天/夜晚/黄昏/清晨 之一；道具只提取对剧情或展示重要的物品，电商与广告脚本务必包含主推产品；没有人物时 characters 可为空数组`, tag)},
		{Role: "user", Content: script},
	}
	content, err := s.Chat(cfg, messages, true, 4096)
	if err != nil {
		return nil, err
	}
	var output extractLLMOutput
	if err = common.Unmarshal([]byte(extractJSON(content)), &output); err != nil {
		return nil, fmt.Errorf("解析提取结果失败: %w", err)
	}

	result := &ExtractResult{}
	// 角色去重入库（按 项目+名称）
	for _, c := range output.Characters {
		name := strings.TrimSpace(c.Name)
		if name == "" {
			continue
		}
		var exist model.DirectorCharacter
		err = model.DB.Where("project_id = ? AND name = ?", episode.ProjectID, name).First(&exist).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			exist = model.DirectorCharacter{
				UserID:    userID,
				ProjectID: episode.ProjectID,
				Name:      name,
				Role:      c.Role,
				Prompt:    strings.TrimSpace(c.Prompt),
			}
			if err = exist.Insert(); err != nil {
				return nil, err
			}
		}
		result.Characters = append(result.Characters, exist)
	}
	// 场景去重入库（按 项目+地点+时间）
	for _, sc := range output.Scenes {
		location := strings.TrimSpace(sc.Location)
		if location == "" {
			continue
		}
		var exist model.DirectorScene
		err = model.DB.Where("project_id = ? AND location = ? AND time = ?", episode.ProjectID, location, sc.Time).First(&exist).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			exist = model.DirectorScene{
				UserID:    userID,
				ProjectID: episode.ProjectID,
				Location:  location,
				Time:      sc.Time,
				Status:    "pending",
			}
			if err = exist.Insert(); err != nil {
				return nil, err
			}
		}
		result.Scenes = append(result.Scenes, exist)
	}
	// 道具去重入库（按 项目+名称），道具为项目级数据
	for _, p := range output.Props {
		name := strings.TrimSpace(p.Name)
		if name == "" {
			continue
		}
		var exist model.DirectorProp
		err = model.DB.Where("project_id = ? AND name = ?", episode.ProjectID, name).First(&exist).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			exist = model.DirectorProp{
				UserID:    userID,
				ProjectID: episode.ProjectID,
				Name:      name,
				Type:      p.Type,
				Prompt:    strings.TrimSpace(p.Prompt),
				Status:    "pending",
			}
			if err = exist.Insert(); err != nil {
				return nil, err
			}
		}
		result.Props = append(result.Props, exist)
	}
	// 关联分集与角色/场景
	characterIDs := make([]int, 0, len(result.Characters))
	for _, c := range result.Characters {
		characterIDs = append(characterIDs, c.ID)
	}
	if len(characterIDs) > 0 {
		var chars []model.DirectorCharacter
		model.DB.Find(&chars, characterIDs)
		model.DB.Model(episode).Association("Characters").Replace(chars)
	}
	sceneIDs := make([]int, 0, len(result.Scenes))
	for _, sc := range result.Scenes {
		sceneIDs = append(sceneIDs, sc.ID)
	}
	if len(sceneIDs) > 0 {
		var scenes []model.DirectorScene
		model.DB.Find(&scenes, sceneIDs)
		model.DB.Model(episode).Association("Scenes").Replace(scenes)
	}
	return result, nil
}

type storyboardLLMOutput struct {
	Scenes []struct {
		Location    string `json:"location"`
		Time        string `json:"time"`
		Storyboards []struct {
			StoryboardNumber int    `json:"storyboardNumber"`
			ShotType         string `json:"shotType"`
			Angle            string `json:"angle"`
			Movement         string `json:"movement"`
			ImagePrompt      string `json:"imagePrompt"`
			Duration         int    `json:"duration"`
		} `json:"storyboards"`
	} `json:"scenes"`
}

// SplitStoryboards 分镜拆解：将剧本拆解为分镜脚本并入库（清空旧分镜）
func (s *LLMService) SplitStoryboards(userID, episodeID int) (int, error) {
	if unlock, ok := tryAcquireEpisodeTask("split", episodeID); !ok {
		return 0, errors.New("分镜拆解正在处理中，请勿重复提交")
	} else {
		defer unlock()
	}
	episode, err := model.GetDirectorEpisodeByID(episodeID)
	if err != nil {
		return 0, errors.New("分集不存在")
	}
	script := episode.ScriptContent
	if strings.TrimSpace(script) == "" {
		script = episode.Content
	}
	if strings.TrimSpace(script) == "" {
		return 0, errors.New("该分集还没有剧本内容，请先完成剧本改写")
	}
	cfg, err := getDirectorTextConfig(userID)
	if err != nil {
		return 0, err
	}
	project, _ := model.GetDirectorProjectByID(episode.ProjectID)
	category := model.DirectorCategoryDrama
	if project != nil {
		category = project.Category
	}
	tag := categoryStyleTag[category]
	if tag == "" {
		tag = categoryStyleTag["drama"]
	}
	targetDuration := episode.TargetDuration
	if targetDuration <= 0 {
		targetDuration = 60
	}
	// @ 引用：把已生成图片的角色/道具/场景清单传给模型，拆解时即在 imagePrompt 中嵌入引用标识，
	// 与镜头图片步骤的 prompt 生成保持一致
	candidates := buildMentionCandidates(episode, []string{"char", "prop", "scene"}, 0)
	messages := []ChatMessage{
		{Role: "system", Content: withMentionSystem(fmt.Sprintf(`你是专业影视分镜师。将用户提供的%s按场景拆解为分镜脚本，严格按以下 JSON 格式输出，不要输出任何其他内容：
{"scenes":[{"location":"地点","time":"白天|夜晚|黄昏|清晨","storyboards":[{"storyboardNumber":1,"shotType":"远景|全景|中景|近景|特写","angle":"平视|俯视|仰视|侧面","movement":"固定|推|拉|摇|移|跟","imagePrompt":"首帧图AI绘图提示词(详细描述人物/场景/光影)","duration":5}]}]}
注意：每个场景 2-6 个分镜；duration 单位秒，单个 4-15 秒（视频模型仅支持 4-15 秒整数）；imagePrompt 必须与剧情人物外观一致；所有分镜 duration 之和必须等于 %d 秒（目标总时长）`, tag, targetDuration), candidates)},
		{Role: "user", Content: script},
	}
	content, err := s.Chat(cfg, messages, true, 8192)
	if err != nil {
		return 0, err
	}
	var output storyboardLLMOutput
	if err = common.Unmarshal([]byte(extractJSON(content)), &output); err != nil {
		return 0, fmt.Errorf("解析分镜结果失败: %w", err)
	}
	// 服务端归一化校准：模型给出的时长往往不精确，等比缩放 + clamp + 差值摊还，保证总和精确等于目标时长
	durs := make([]*int, 0, 32)
	for si := range output.Scenes {
		for bi := range output.Scenes[si].Storyboards {
			durs = append(durs, &output.Scenes[si].Storyboards[bi].Duration)
		}
	}
	normalizeDurations(durs, targetDuration)

	// 兜底：模型未嵌入引用标识时，按必需分类补参考标识（与镜头图片步骤同规则）
	for si := range output.Scenes {
		for bi := range output.Scenes[si].Storyboards {
			sb := &output.Scenes[si].Storyboards[bi]
			sb.ImagePrompt = ensureMentions(sb.ImagePrompt, candidates, []string{"scene", "char"})
		}
	}

	count := 0
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		// 清空旧分镜，重新生成
		if err := tx.Where("episode_id = ?", episodeID).Delete(&model.DirectorStoryboard{}).Error; err != nil {
			return err
		}
		// 镜号全分集统一从 1 递增（模型按场景独立编号会出现重复，不利于列表与首尾帧衔接）
		seq := 0
		now := time.Now().Unix()
		for _, sc := range output.Scenes {
			location := strings.TrimSpace(sc.Location)
			if location == "" || len(sc.Storyboards) == 0 {
				continue
			}
			// 匹配或创建场景
			var scene model.DirectorScene
			err := tx.Where("project_id = ? AND location = ? AND time = ?", episode.ProjectID, location, sc.Time).First(&scene).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				scene = model.DirectorScene{
					CreatedAt: now,
					UpdatedAt: now,
					UserID:    userID,
					ProjectID: episode.ProjectID,
					Location:  location,
					Time:      sc.Time,
					Source:    "ai",
					Status:    "pending",
				}
				if err := tx.Create(&scene).Error; err != nil {
					return err
				}
			} else if err != nil {
				return err
			}
			for _, sb := range sc.Storyboards {
				seq++
				duration := sb.Duration
				if duration <= 0 {
					duration = 5
				}
				storyboard := model.DirectorStoryboard{
					CreatedAt:        now,
					UpdatedAt:        now,
					UserID:           userID,
					EpisodeID:        episodeID,
					SceneID:          &scene.ID,
					StoryboardNumber: seq,
					Location:         location,
					Time:             sc.Time,
					ShotType:         sb.ShotType,
					Angle:            sb.Angle,
					Movement:         sb.Movement,
					ImagePrompt:      sb.ImagePrompt,
					Duration:         duration,
					Status:           "pending",
				}
				if err := tx.Create(&storyboard).Error; err != nil {
					return err
				}
				count++
			}
		}
		return tx.Model(&model.DirectorEpisode{}).Where("id = ?", episodeID).Update("status", "storyboarded").Error
	})
	if err != nil {
		return 0, err
	}
	return count, nil
}

// normalizeDurations 分镜时长归一化：等比缩放到目标总时长，单项 clamp 到 [2,15] 秒，
// 剩余差值多轮摊还（加给最长镜头、从最短的扣），受 clamp 约束时 best-effort 逼近。
func normalizeDurations(durs []*int, target int) {
	if len(durs) == 0 || target <= 0 {
		return
	}
	sum := 0
	for _, d := range durs {
		if *d <= 0 {
			*d = 5
		}
		sum += *d
	}
	// 等比缩放，使总时长量级匹配目标
	for _, d := range durs {
		*d = int(math.Round(float64(*d) * float64(target) / float64(sum)))
	}
	clamp := func(v int) int {
		if v < 2 {
			return 2
		}
		if v > 15 {
			return 15
		}
		return v
	}
	for _, d := range durs {
		*d = clamp(*d)
	}
	// 差值摊还：每轮把差值尽量补到一个可调整的镜头上，直到总和精确等于目标或无法再调
	for rounds := 0; rounds < target+2*len(durs); rounds++ {
		cur := 0
		for _, d := range durs {
			cur += *d
		}
		diff := target - cur
		if diff == 0 {
			return
		}
		if diff > 0 {
			// 加给当前最长且未达上限的镜头
			var best *int
			for _, d := range durs {
				if *d < 15 && (best == nil || *d > *best) {
					best = d
				}
			}
			if best == nil {
				return
			}
			add := diff
			if *best+add > 15 {
				add = 15 - *best
			}
			*best += add
		} else {
			// 从当前最短且未达下限的镜头扣
			var best *int
			for _, d := range durs {
				if *d > 2 && (best == nil || *d < *best) {
					best = d
				}
			}
			if best == nil {
				return
			}
			sub := -diff
			if *best-sub < 2 {
				sub = *best - 2
			}
			*best -= sub
		}
	}
}
