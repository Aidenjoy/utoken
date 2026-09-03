package director

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// ============ @ 引用（mention）工具 ============
// 提示词中以 @[kind:id] 形式引用资产（角色形象/道具图片/场景图片/镜头图片/视频），
// LLM 生成提示词时嵌入该标识，前端渲染为缩略图 chip，提交生成时展开为「参考图N/参考视频N」
// 并收集对应资产地址作为模型的参考输入，保证角色/场景/道具一致性。

// mentionRe 匹配 @[char:3] 这类引用标识
var mentionRe = regexp.MustCompile(`@\[(char|prop|scene|shot|video):(\d+)\]`)

// MentionKindLabel 引用分类的中文名（与工作室菜单保持一致）
var MentionKindLabel = map[string]string{
	"char":  "角色形象",
	"prop":  "道具图片",
	"scene": "场景图片",
	"shot":  "镜头图片",
	"video": "视频",
}

// mentionAssetURL 查询引用资产的地址，不存在或无图时返回空串
func mentionAssetURL(kind string, id int) string {
	var url string
	switch kind {
	case "char":
		if c, err := model.GetDirectorCharacterByID(id); err == nil {
			url = c.ImageURL
		}
	case "prop":
		if p, err := model.GetDirectorPropByID(id); err == nil {
			url = p.ImageURL
		}
	case "scene":
		if sc, err := model.GetDirectorSceneByID(id); err == nil {
			url = sc.ImageURL
		}
	case "shot":
		if sb, err := model.GetDirectorStoryboardByID(id); err == nil {
			url = sb.FirstFrameImage
		}
	case "video":
		if sb, err := model.GetDirectorStoryboardByID(id); err == nil {
			url = sb.VideoURL
		}
	}
	return strings.TrimSpace(url)
}

// shiftRefIndex 把提示词中的「参考图N」序号整体偏移 offset（参考视频不变）。
// 用于参考生成模式：镜头图作为第一张参考图插入 images 头部后，
// @ 引用的参考图序号需整体 +1，保证 prompt 序号与模型看到的图片顺序一致
var refIdxRe = regexp.MustCompile(`参考图(\d+)`)

func shiftRefIndex(prompt string, offset int) string {
	if offset == 0 {
		return prompt
	}
	return refIdxRe.ReplaceAllStringFunc(prompt, func(m string) string {
		n, _ := strconv.Atoi(m[len("参考图"):])
		return fmt.Sprintf("参考图%d", n+offset)
	})
}

// expandMentions 将提示词中的 @[kind:id] 按出现顺序展开为「参考图N/参考视频N」文本，
// 同时收集资产地址（图片经 toDataURL 校验，视频仅保留 http 地址）。
// 同一资产多次引用复用同一编号；无图资产的标识直接剔除。
func expandMentions(prompt string) (string, []string, []string) {
	return expandMentionsEx(prompt, true, nil)
}

// expandMentionsEx includeImages=false 时剔除图片类引用（不展开、不收集地址）。
// 用于首尾帧生视频：不允许 last_frame 与 reference_image 混用，只能二选一。
// assetRef 可选：把（kind, id）解析为 asset:// 渠道素材引用（仅视频生成传入）。
// 命中时引用直接进入参考图列表（免 base64 转存），由网关中间件锁定素材所属渠道。
func expandMentionsEx(prompt string, includeImages bool, assetRef func(kind string, id int) string) (string, []string, []string) {
	imgIndex := map[string]int{} // 原始地址 -> 参考图编号
	videoIndex := map[string]int{}
	images := make([]string, 0, 4)
	videos := make([]string, 0, 2)
	result := mentionRe.ReplaceAllStringFunc(prompt, func(token string) string {
		m := mentionRe.FindStringSubmatch(token)
		kind, idStr := m[1], m[2]
		id, _ := strconv.Atoi(idStr)
		url := mentionAssetURL(kind, id)
		if url == "" {
			return ""
		}
		if kind == "video" {
			// 视频体积大不做 base64，仅支持可公网访问的地址
			if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
				common.SysLog(fmt.Sprintf("参考视频非 http 地址，跳过: %s", url))
				return ""
			}
			if n, ok := videoIndex[url]; ok {
				return fmt.Sprintf("参考视频%d", n)
			}
			videos = append(videos, url)
			videoIndex[url] = len(videos)
			return fmt.Sprintf("参考视频%d", len(videos))
		}
		if !includeImages {
			return ""
		}
		// 已同步渠道素材库且激活：直接以 asset:// 引用，跳过 base64 转换
		if assetRef != nil {
			if ref := assetRef(kind, id); ref != "" {
				if n, ok := imgIndex[ref]; ok {
					return fmt.Sprintf("参考图%d", n)
				}
				images = append(images, ref)
				imgIndex[ref] = len(images)
				return fmt.Sprintf("参考图%d", len(images))
			}
		}
		dataURL, err := toDataURL(url)
		if err != nil {
			common.SysLog(fmt.Sprintf("引用资产转换失败，跳过: kind=%s, url=%s, err=%v", kind, url, err))
			return ""
		}
		if n, ok := imgIndex[url]; ok {
			return fmt.Sprintf("参考图%d", n)
		}
		images = append(images, dataURL)
		imgIndex[url] = len(images)
		return fmt.Sprintf("参考图%d", len(images))
	})
	result = strings.Join(removeBlankLines(strings.Split(result, "\n")), "\n")
	return strings.TrimSpace(result), images, videos
}

// removeBlankLines 剔除因标识被整体删除而产生的空行
func removeBlankLines(lines []string) []string {
	out := make([]string, 0, len(lines))
	for _, l := range lines {
		if strings.TrimSpace(l) != "" {
			out = append(out, l)
		}
	}
	return out
}

// buildMentionCandidates 构建给 LLM 的候选引用清单（仅列出已生成图片/视频的资产），
// 行格式 "@[char:3] 角色形象·张三"。excludeStoryboardID 用于排除自身分镜。
func buildMentionCandidates(episode *model.DirectorEpisode, kinds []string, excludeStoryboardID int) string {
	enabled := map[string]bool{}
	for _, k := range kinds {
		enabled[k] = true
	}
	lines := make([]string, 0, 12)
	if enabled["char"] {
		var chars []model.DirectorCharacter
		model.DB.Model(episode).Association("Characters").Find(&chars)
		for _, c := range chars {
			if strings.TrimSpace(c.ImageURL) != "" {
				lines = append(lines, fmt.Sprintf("@[char:%d] %s·%s", c.ID, MentionKindLabel["char"], c.Name))
			}
		}
	}
	if enabled["prop"] {
		var props []model.DirectorProp
		model.DB.Where("project_id = ?", episode.ProjectID).Find(&props)
		for _, p := range props {
			if strings.TrimSpace(p.ImageURL) != "" {
				lines = append(lines, fmt.Sprintf("@[prop:%d] %s·%s", p.ID, MentionKindLabel["prop"], p.Name))
			}
		}
	}
	if enabled["scene"] {
		var scenes []model.DirectorScene
		model.DB.Model(episode).Association("Scenes").Find(&scenes)
		for _, sc := range scenes {
			if strings.TrimSpace(sc.ImageURL) != "" {
				lines = append(lines, fmt.Sprintf("@[scene:%d] %s·%s-%s", sc.ID, MentionKindLabel["scene"], sc.Location, sc.Time))
			}
		}
	}
	if enabled["shot"] || enabled["video"] {
		var storyboards []model.DirectorStoryboard
		model.DB.Where("episode_id = ?", episode.ID).Order("storyboard_number").Find(&storyboards)
		for _, sb := range storyboards {
			if sb.ID == excludeStoryboardID {
				continue
			}
			if enabled["shot"] && strings.TrimSpace(sb.FirstFrameImage) != "" {
				lines = append(lines, fmt.Sprintf("@[shot:%d] %s·分镜%d", sb.ID, MentionKindLabel["shot"], sb.StoryboardNumber))
			}
			if enabled["video"] && strings.TrimSpace(sb.VideoURL) != "" {
				lines = append(lines, fmt.Sprintf("@[video:%d] %s·分镜%d", sb.ID, MentionKindLabel["video"], sb.StoryboardNumber))
			}
		}
	}
	return strings.Join(lines, "\n")
}

// mentionSystemSuffix 追加到系统规范后，要求 LLM 在提示词中原样嵌入引用标识
const mentionSystemSuffix = `
参考资产清单（每行以引用标识开头）：
%s
当画面涉及上述资产时，必须在提示词的对应位置原样嵌入其引用标识（如 @[char:3]，不要改写、翻译或加空格），使该资产的参考图参与生成；未涉及的资产不要引用。`

// withMentionSystem 若存在候选资产，把引用规范追加到系统提示词
func withMentionSystem(systemPrompt, candidates string) string {
	if strings.TrimSpace(candidates) == "" {
		return systemPrompt
	}
	return systemPrompt + fmt.Sprintf(mentionSystemSuffix, candidates)
}

// ensureMentions 兜底：LLM 未嵌入任何标识时，按必需分类各补第一个候选标识到提示词末尾，
// 保证一致性参考一定生效。requiredKinds 中的分类在候选中存在才补。
func ensureMentions(prompt, candidates string, requiredKinds []string) string {
	if mentionRe.MatchString(prompt) || strings.TrimSpace(candidates) == "" {
		return prompt
	}
	tokens := make([]string, 0, len(requiredKinds))
	for _, kind := range requiredKinds {
		prefix := fmt.Sprintf("@[%s:", kind)
		for _, line := range strings.Split(candidates, "\n") {
			if strings.HasPrefix(line, prefix) {
				tokens = append(tokens, strings.Fields(line)[0])
				break
			}
		}
	}
	if len(tokens) == 0 {
		return prompt
	}
	return prompt + "（参考：" + strings.Join(tokens, " ") + "）"
}
