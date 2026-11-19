package director

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
)

// ===== 智能画布：Agent 草案生成 =====
// 复用云导演文本模型回环网关，按用户描述产出一份画布草案（节点 + 连线），
// 前端预览后一键应用到画布。费用计到调用者本人账户。

// CanvasDraftNode 草案节点（type 限 text/image/video，prompt 用于生成、content 用于文本）
type CanvasDraftNode struct {
	Type    string `json:"type"`
	Title   string `json:"title"`
	Prompt  string `json:"prompt"`
	Content string `json:"content"`
}

// CanvasDraftConnection 草案连线（from/to 为 nodes 数组下标）
type CanvasDraftConnection struct {
	From int `json:"from"`
	To   int `json:"to"`
}

// CanvasDraft Agent 产出的画布草案
type CanvasDraft struct {
	Nodes       []CanvasDraftNode       `json:"nodes"`
	Connections []CanvasDraftConnection `json:"connections"`
}

// 计费与存储安全边界：草案节点/连线/文本长度全部收敛，防止超大输出撑爆文档或配额
const (
	canvasDraftMaxNodes       = 12
	canvasDraftMaxConnections = 24
	canvasDraftMaxText        = 8000
	canvasDraftMaxTitle       = 64
	canvasDraftMaxTokens      = 4096
)

const canvasDraftSystemPrompt = `你是智能画布的创作助手。用户会给出一段创作需求，你把它拆解成一张节点画布草案。
只输出 JSON，格式为 {"nodes":[{"type":"text|image|video","title":"短标题","prompt":"生成提示词","content":"文本内容"}],"connections":[{"from":0,"to":1}]}。
规则：
- nodes 最多 12 个；type 只能是 text、image、video。
- image/video 节点必须填写 prompt（详细的画面/镜头描述）；text 节点填写 content（创意说明、脚本或旁白）。
- title 不超过 20 个字。
- connections 用 nodes 数组下标表示参考关系：from 是上游参考节点，to 是下游生成节点（例如文本→图片、图片→视频）。最多 24 条，from 不等于 to。
- 草案要可直接执行：先文本构思，再图片，最后视频，形成清晰的创作链路。
- 不要输出 JSON 以外的任何文字。`

// SubmitCanvasAgentDraft 调用文本模型生成画布草案（结构化输出 + 解析重试）
func SubmitCanvasAgentDraft(userID int, prompt string) (*CanvasDraft, error) {
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return nil, errors.New("请输入创作需求")
	}
	if len(prompt) > canvasDraftMaxText {
		return nil, errors.New("创作需求过长")
	}
	cfg, err := getDirectorTextConfig(userID)
	if err != nil {
		return nil, err
	}
	messages := []ChatMessage{
		{Role: "system", Content: canvasDraftSystemPrompt},
		{Role: "user", Content: prompt},
	}
	var draft CanvasDraft
	svc := &LLMService{}
	err = svc.chatStructured(cfg, messages, canvasDraftMaxTokens, func(jsonText string) error {
		var parsed CanvasDraft
		if uErr := common.UnmarshalJsonStr(jsonText, &parsed); uErr != nil {
			return uErr
		}
		if vErr := validateCanvasDraft(&parsed); vErr != nil {
			return vErr
		}
		draft = parsed
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("生成草案失败: %w", err)
	}
	return &draft, nil
}

const canvasOptimizeSystemPrompt = `你是 AI 绘画与视频提示词专家。用户给出一段提示词，你在保持原意与主体不变的前提下把它改写得更具体：补充光线、材质、构图、镜头运动与氛围细节。
只输出改写后的提示词文本，不要解释、不要引号、不要 Markdown。输出语言与用户输入一致。长度不超过 600 字。`

// SubmitCanvasPromptOptimize 调用文本模型优化画布提示词（纯文本输出）
func SubmitCanvasPromptOptimize(userID int, prompt string) (string, error) {
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return "", errors.New("请输入提示词")
	}
	if len(prompt) > canvasDraftMaxText {
		return "", errors.New("提示词过长")
	}
	cfg, err := getDirectorTextConfig(userID)
	if err != nil {
		return "", err
	}
	messages := []ChatMessage{
		{Role: "system", Content: canvasOptimizeSystemPrompt},
		{Role: "user", Content: prompt},
	}
	svc := &LLMService{}
	result, err := svc.Chat(cfg, messages, false, 1024)
	if err != nil {
		return "", fmt.Errorf("优化提示词失败: %w", err)
	}
	result = strings.TrimSpace(result)
	if result == "" {
		return "", errors.New("优化结果为空")
	}
	if utf8.RuneCountInString(result) > 600 {
		result = string([]rune(result)[:600])
	}
	return result, nil
}

// validateCanvasDraft 收敛草案规模与字段长度，越界即视为非法输出触发重新采样
func validateCanvasDraft(d *CanvasDraft) error {
	if len(d.Nodes) == 0 {
		return errors.New("草案为空")
	}
	if len(d.Nodes) > canvasDraftMaxNodes {
		return errors.New("草案节点过多")
	}
	if len(d.Connections) > canvasDraftMaxConnections {
		return errors.New("草案连线过多")
	}
	for i := range d.Nodes {
		n := &d.Nodes[i]
		switch n.Type {
		case "text", "image", "video":
		default:
			return errors.New("草案节点类型无效")
		}
		if utf8.RuneCountInString(n.Title) > canvasDraftMaxTitle {
			n.Title = string([]rune(n.Title)[:canvasDraftMaxTitle])
		}
		if len(n.Prompt) > canvasDraftMaxText {
			return errors.New("草案提示词过长")
		}
		if len(n.Content) > canvasDraftMaxText {
			return errors.New("草案文本过长")
		}
	}
	for _, c := range d.Connections {
		if c.From < 0 || c.To < 0 || c.From >= len(d.Nodes) || c.To >= len(d.Nodes) || c.From == c.To {
			return errors.New("草案连线下标无效")
		}
	}
	return nil
}

// ===== 智能画布：分镜脚本 AI 拆分 =====

// CanvasScriptShot 拆分产出的单个镜头（前端写入分镜表格行）
type CanvasScriptShot struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Dialogue    string `json:"dialogue"`
	Narration   string `json:"narration"`
	Duration    int    `json:"duration"`
}

const (
	canvasScriptMaxShots = 60
	canvasScriptMaxText  = 8000
)

// SplitCanvasScript 调用文本模型把剧本/剧情拆分为镜头列表。
// totalDuration>0 时归一化总时长；perShotDuration>0 时锁定单镜时长。
func SplitCanvasScript(userID int, script string, totalDuration, perShotDuration int) ([]CanvasScriptShot, error) {
	script = strings.TrimSpace(script)
	if script == "" {
		return nil, errors.New("请输入剧本或剧情内容")
	}
	if len(script) > canvasScriptMaxText {
		return nil, errors.New("剧本内容过长")
	}
	cfg, err := getDirectorTextConfig(userID)
	if err != nil {
		return nil, err
	}
	durationRule := "duration 单位秒，单个 2-15 秒整数，按剧情节奏自行分配。"
	if perShotDuration > 0 {
		durationRule = fmt.Sprintf("每个镜头的 duration 必须等于 %d 秒。", perShotDuration)
	} else if totalDuration > 0 {
		durationRule = fmt.Sprintf("duration 单位秒，单个 2-15 秒整数，所有镜头 duration 之和必须等于 %d 秒。", totalDuration)
	}
	messages := []ChatMessage{
		{Role: "system", Content: fmt.Sprintf(`你是专业影视分镜师。把用户提供的剧本或剧情拆分为连续镜头，严格按以下 JSON 格式输出，不要输出任何其他内容：
{"shots":[{"title":"镜头短标题","description":"视频提示词：主体动作、景别、构图、机位、运镜、光线、情绪","dialogue":"台词（没有则空字符串）","narration":"旁白（没有则空字符串）","duration":5}]}
规则：镜头数 1-%d 个；%s保持人物、场景与道具一致，镜头之间具有连续性；只输出一个合法 JSON 对象。`, canvasScriptMaxShots, durationRule)},
		{Role: "user", Content: script},
	}
	var output struct {
		Shots []CanvasScriptShot `json:"shots"`
	}
	svc := &LLMService{}
	if err = svc.chatStructured(cfg, messages, 8192, func(jsonText string) error {
		var parsed struct {
			Shots []CanvasScriptShot `json:"shots"`
		}
		if uErr := common.UnmarshalJsonStr(jsonText, &parsed); uErr != nil {
			return uErr
		}
		if len(parsed.Shots) == 0 {
			return errors.New("拆分结果为空")
		}
		output = parsed
		return nil
	}); err != nil {
		return nil, fmt.Errorf("拆分分镜失败: %w", err)
	}
	shots := output.Shots
	if len(shots) > canvasScriptMaxShots {
		shots = shots[:canvasScriptMaxShots]
	}
	durs := make([]*int, 0, len(shots))
	for i := range shots {
		if shots[i].Duration <= 0 {
			shots[i].Duration = 5
		}
		if utf8.RuneCountInString(shots[i].Title) > 64 {
			shots[i].Title = string([]rune(shots[i].Title)[:64])
		}
		durs = append(durs, &shots[i].Duration)
	}
	if perShotDuration > 0 {
		for _, d := range durs {
			*d = perShotDuration
		}
	} else if totalDuration > 0 {
		normalizeDurations(durs, totalDuration)
	}
	return shots, nil
}
