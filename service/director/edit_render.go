package director

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// 剪辑渲染依赖的进阶滤镜能力检测（精简版 ffmpeg 可能缺少 xfade/colortemperature 等）
var (
	editFilterDetectOnce sync.Once
	ffmpegHasXfade       bool
	ffmpegHasColorTemp   bool
)

func detectEditFilters() {
	editFilterDetectOnce.Do(func() {
		ffmpeg, err := ffmpegPath()
		if err != nil {
			return
		}
		out, err := exec.Command(ffmpeg, "-hide_banner", "-filters").Output()
		if err != nil {
			return
		}
		s := string(out)
		ffmpegHasXfade = strings.Contains(s, " xfade ")
		ffmpegHasColorTemp = strings.Contains(s, " colortemperature ")
	})
}

// xfadeTransitions 支持的转场白名单（xfade 原生转场名）
var xfadeTransitions = map[string]bool{
	"fade": true, "fadeblack": true, "fadewhite": true, "dissolve": true,
	"wipeleft": true, "wiperight": true, "slideup": true, "slidedown": true,
}

// outputSize 按画面比例与分辨率推导输出尺寸（短边对齐，长边取偶）
func outputSize(aspectRatio, resolution string) (int, int) {
	short := 1080
	switch strings.ToUpper(strings.TrimSpace(resolution)) {
	case "480P":
		short = 480
	case "720P":
		short = 720
	case "4K", "2160P":
		short = 2160
	}
	rw, rh := 9.0, 16.0
	parts := strings.Split(strings.TrimSpace(aspectRatio), ":")
	if len(parts) == 2 {
		var w, h float64
		if _, err := fmt.Sscanf(parts[0], "%g", &w); err == nil && w > 0 {
			rw = w
		}
		if _, err := fmt.Sscanf(parts[1], "%g", &h); err == nil && h > 0 {
			rh = h
		}
	}
	even := func(v float64) int {
		n := int(math.Round(v))
		if n%2 != 0 {
			n++
		}
		if n < 2 {
			n = 2
		}
		return n
	}
	if rw >= rh {
		return even(float64(short) * rw / rh), short
	}
	return short, even(float64(short) * rh / rw)
}

// applyPreset 展开滤镜预设为具体参数（显式设置的参数优先，预设仅补默认值）
func applyPreset(f *editFilter) {
	switch f.Preset {
	case "vivid": // 鲜艳
		if f.Saturation == 0 || f.Saturation == 1 {
			f.Saturation = 1.3
		}
		if f.Contrast == 0 || f.Contrast == 1 {
			f.Contrast = 1.1
		}
	case "soft": // 柔和
		if f.Contrast == 0 || f.Contrast == 1 {
			f.Contrast = 0.95
		}
		if f.Brightness == 0 {
			f.Brightness = 0.03
		}
		if f.Saturation == 0 || f.Saturation == 1 {
			f.Saturation = 1.05
		}
	case "film": // 胶片
		if f.Contrast == 0 || f.Contrast == 1 {
			f.Contrast = 1.05
		}
		if f.Saturation == 0 || f.Saturation == 1 {
			f.Saturation = 0.9
		}
		if f.Brightness == 0 {
			f.Brightness = 0.02
		}
	case "bw": // 黑白
		f.Saturation = 0
	case "warm": // 暖色
		if f.Temperature == 0 {
			f.Temperature = 5600
		}
	case "cool": // 冷色
		if f.Temperature == 0 {
			f.Temperature = 7800
		}
	}
}

// atempoChain 将变速倍率分解为 atempo 滤镜链（单级 atempo 稳妥范围 0.5-2.0）
func atempoChain(speed float64) string {
	if speed <= 0 {
		speed = 1
	}
	var parts []string
	for speed > 2.0 {
		parts = append(parts, "atempo=2.0")
		speed /= 2.0
	}
	for speed < 0.5 {
		parts = append(parts, "atempo=0.5")
		speed /= 0.5
	}
	if math.Abs(speed-1) > 0.001 {
		parts = append(parts, fmt.Sprintf("atempo=%.4f", speed))
	}
	return strings.Join(parts, ",")
}

// buildClipVideoChain 构建单片段视频滤镜链：
// 裁剪入点出点+变速 → 比例裁切 → 旋转翻转 → 统一尺寸/帧率 → 调色/色温/锐化
func buildClipVideoChain(i int, c editClip, width, height int) string {
	var b strings.Builder
	speed := c.Speed
	if speed <= 0 {
		speed = 1
	}
	fmt.Fprintf(&b, "[%d:v]trim=start=%.3f:end=%.3f,setpts=(PTS-STARTPTS)/%.4f", i, c.Start, c.End, speed)
	// 比例裁切（相对源画面，宽高压到偶数避免 yuv420 报错）
	if c.Crop != nil && c.Crop.W > 0 && c.Crop.W < 1 && c.Crop.H > 0 && c.Crop.H <= 1 {
		fmt.Fprintf(&b, ",crop=floor(iw*%.4f/2)*2:floor(ih*%.4f/2)*2:floor(iw*%.4f/2)*2:floor(ih*%.4f/2)*2",
			c.Crop.W, c.Crop.H, c.Crop.X, c.Crop.Y)
	}
	// 旋转（90/270 会交换宽高，必须在统一尺寸之前）
	switch c.Rotate {
	case 90:
		b.WriteString(",transpose=1")
	case 180:
		b.WriteString(",transpose=1,transpose=1")
	case 270:
		b.WriteString(",transpose=2")
	}
	switch c.Flip {
	case "h":
		b.WriteString(",hflip")
	case "v":
		b.WriteString(",vflip")
	case "hv":
		b.WriteString(",hflip,vflip")
	}
	// 统一输出尺寸与帧率（覆盖式缩放，多余部分居中裁掉）
	fmt.Fprintf(&b, ",scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,fps=24,setsar=1", width, height, width, height)
	// 质感调节
	f := c.Filter
	applyPreset(&f)
	if f.Brightness != 0 || (f.Contrast != 0 && f.Contrast != 1) || (f.Saturation != 0 && f.Saturation != 1) {
		contrast := f.Contrast
		if contrast == 0 {
			contrast = 1
		}
		saturation := f.Saturation
		if saturation == 0 && f.Preset == "" {
			saturation = 1
		}
		fmt.Fprintf(&b, ",eq=brightness=%.3f:contrast=%.3f:saturation=%.3f", f.Brightness, contrast, saturation)
	}
	if f.Temperature > 0 && ffmpegHasColorTemp {
		fmt.Fprintf(&b, ",colortemperature=temperature=%d", f.Temperature)
	}
	if f.Sharpen {
		b.WriteString(",unsharp=5:5:0.8:5:5:0.0")
	}
	fmt.Fprintf(&b, "[v%d]", i)
	return b.String()
}

// buildClipAudioChain 构建单片段音频滤镜链（有音轨时）
func buildClipAudioChain(i int, c editClip) string {
	var b strings.Builder
	fmt.Fprintf(&b, "[%d:a]atrim=start=%.3f:end=%.3f,asetpts=PTS-STARTPTS", i, c.Start, c.End)
	if chain := atempoChain(c.Speed); chain != "" {
		b.WriteString("," + chain)
	}
	volume := c.Volume
	if c.Muted {
		volume = 0
	} else if volume <= 0 {
		volume = 1
	}
	fmt.Fprintf(&b, ",volume=%.3f[a%d]", volume, i)
	return b.String()
}

// editGroup 转场分组：相邻无转场的片段先 concat 为一组，组间再做 xfade
type editGroup struct {
	indices    []int   // 组内片段下标
	duration   float64 // 组时长
	transition float64 // 与下一组之间的转场时长（0 为无）
	transType  string  // 与下一组之间的转场类型
}

// groupClips 按转场把片段分组（转场定义在片段上，表示其与下一片段之间的过渡）
func groupClips(clips []editClip) []editGroup {
	var groups []editGroup
	current := editGroup{}
	for i, c := range clips {
		current.indices = append(current.indices, i)
		current.duration += c.clipDuration()
		tType := strings.TrimSpace(c.Transition.Type)
		tDur := c.Transition.Duration
		if i < len(clips)-1 && tType != "" && tType != "none" && xfadeTransitions[tType] && tDur > 0 && ffmpegHasXfade {
			// 转场时长不能超过相邻段时长
			nextDur := clips[i+1].clipDuration()
			if tDur > current.duration {
				tDur = current.duration
			}
			if tDur > nextDur {
				tDur = nextDur
			}
			current.transition = tDur
			current.transType = tType
			groups = append(groups, current)
			current = editGroup{}
		}
	}
	groups = append(groups, current)
	return groups
}

// assTimestamp 秒 → ass 时间戳 h:mm:ss.cc
func assTimestamp(sec float64) string {
	if sec < 0 {
		sec = 0
	}
	cs := int(math.Round(sec * 100))
	h := cs / 360000
	cs %= 360000
	m := cs / 6000
	cs %= 6000
	s := cs / 100
	cs %= 100
	return fmt.Sprintf("%d:%02d:%02d.%02d", h, m, s, cs)
}

// assColor #RRGGBB → ass &H00BBGGRR
func assColor(hex string) string {
	hex = strings.TrimPrefix(strings.TrimSpace(hex), "#")
	if len(hex) != 6 {
		return "&H00FFFFFF"
	}
	return "&H00" + strings.ToUpper(hex[4:6]+hex[2:4]+hex[0:2])
}

// buildEditASS 生成剪辑字幕文件（多字幕条目 + 多样式去重）
func buildEditASS(path string, subtitles []editSubtitle, width, height int) error {
	// 字幕含中文时才需要在渲染主机上解析可用中文字体（纯英文文本任意字体均可）
	hasCJK := false
	for _, sub := range subtitles {
		if textHasCJK(sub.Text) {
			hasCJK = true
			break
		}
	}
	var resolveErr error
	type styleKey struct {
		font, color, position, animation string
		size                             int
	}
	styleIDs := map[styleKey]int{}
	var styles []styleKey
	getStyle := func(st editSubtitleStyle) int {
		font := strings.TrimSpace(st.FontFamily)
		if font == "" {
			font = "PingFang SC"
		}
		// 按渲染主机实际可用字体解析：请求字体缺失时回退，避免烧录出方块字幕
		if resolveErr == nil {
			resolved, err := resolveSubtitleFont(font, hasCJK)
			if err != nil {
				resolveErr = err
			} else {
				font = resolved
			}
		}
		size := st.FontSize
		if size <= 0 {
			size = 34
		}
		position := st.Position
		if position != "top" && position != "middle" {
			position = "bottom"
		}
		key := styleKey{font: font, color: st.Color, position: position, animation: st.Animation, size: size}
		if id, ok := styleIDs[key]; ok {
			return id
		}
		id := len(styles)
		styleIDs[key] = id
		styles = append(styles, key)
		return id
	}

	var sb strings.Builder
	sb.WriteString("[Script Info]\nScriptType: v4.00+\n")
	fmt.Fprintf(&sb, "PlayResX: %d\nPlayResY: %d\n\n", width, height)
	sb.WriteString("[V4+ Styles]\n")
	sb.WriteString("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n")
	type dialogueLine struct {
		styleID    int
		start, end float64
		text, anim string
	}
	var dialogues []dialogueLine
	for _, sub := range subtitles {
		if strings.TrimSpace(sub.Text) == "" || sub.End <= sub.Start {
			continue
		}
		dialogues = append(dialogues, dialogueLine{
			styleID: getStyle(sub.Style),
			start:   sub.Start,
			end:     sub.End,
			text:    sub.Text,
			anim:    sub.Style.Animation,
		})
	}
	if resolveErr != nil {
		return resolveErr
	}
	for i, st := range styles {
		alignment, marginV := 2, 60
		switch st.position {
		case "top":
			alignment, marginV = 8, 60
		case "middle":
			alignment, marginV = 5, 0
		}
		fmt.Fprintf(&sb, "Style: S%d,%s,%d,%s,&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,2,0,%d,40,40,%d,1\n",
			i, st.font, st.size, assColor(st.color), alignment, marginV)
	}
	sb.WriteString("\n[Events]\n")
	sb.WriteString("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
	for _, d := range dialogues {
		text := strings.ReplaceAll(d.text, "\r\n", "\n")
		text = strings.ReplaceAll(text, "\n", `\N`)
		text = strings.ReplaceAll(text, "{", "")
		text = strings.ReplaceAll(text, "}", "")
		if d.anim == "fade" {
			text = `{\fad(300,300)}` + text
		}
		fmt.Fprintf(&sb, "Dialogue: 0,%s,%s,S%d,,0,0,0,,%s\n",
			assTimestamp(d.start), assTimestamp(d.end), d.styleID, text)
	}
	return os.WriteFile(path, []byte(sb.String()), 0644)
}

// ffprobeHasAudio 探测视频文件是否包含音频流
func ffprobeHasAudio(ffmpeg, filePath string) bool {
	ffprobe := filepath.Join(filepath.Dir(ffmpeg), "ffprobe")
	if _, err := os.Stat(ffprobe); err != nil {
		if p, lookErr := exec.LookPath("ffprobe"); lookErr == nil {
			ffprobe = p
		} else {
			return true // 无 ffprobe 时按有音轨处理，交给 ffmpeg 报错
		}
	}
	out, err := exec.Command(ffprobe, "-v", "error", "-select_streams", "a:0",
		"-show_entries", "stream=codec_type", "-of", "csv=p=0", filePath).Output()
	return err == nil && strings.Contains(string(out), "audio")
}

// EditRenderProgress 剪辑渲染实时进度（内存态，进程重启即失；终态保留供前端最后一次轮询）
type EditRenderProgress struct {
	Stage   string `json:"stage"`   // queued/preparing/encoding/uploading/done/failed
	Percent int    `json:"percent"` // 0-100
	Detail  string `json:"detail"`  // 阶段说明，前端直接展示
}

var editRenderProgressStore sync.Map // projectId(int) -> EditRenderProgress

// setEditRenderProgress 更新进度；阶段切换时打日志，便于从服务端日志直接观察渲染轨迹
func setEditRenderProgress(projectID int, stage string, percent int, detail string) {
	if old, ok := editRenderProgressStore.Load(projectID); !ok || old.(EditRenderProgress).Stage != stage {
		common.SysLog(fmt.Sprintf("云导演剪辑渲染阶段: projectId=%d, stage=%s, percent=%d, detail=%s", projectID, stage, percent, detail))
	}
	editRenderProgressStore.Store(projectID, EditRenderProgress{Stage: stage, Percent: percent, Detail: detail})
}

// GetEditRenderProgress 查询渲染进度（无记录时返回零值，前端按"排队中"展示）
func (s *EditService) GetEditRenderProgress(projectID int) EditRenderProgress {
	if p, ok := editRenderProgressStore.Load(projectID); ok {
		return p.(EditRenderProgress)
	}
	return EditRenderProgress{Stage: "queued", Percent: 0, Detail: "排队等待渲染资源"}
}

// runEditRender 后台执行剪辑渲染：构建 filter_complex_script → ffmpeg → 转存回写
func (s *EditService) runEditRender(projectID, userID int) {
	renderStart := time.Now()
	setEditRenderProgress(projectID, "queued", 0, "排队等待渲染资源")
	acquireRenderSlot()
	defer releaseRenderSlot()
	setEditRenderProgress(projectID, "preparing", 0, "准备渲染环境")

	fail := func(err error) {
		common.SysError(fmt.Sprintf("云导演剪辑渲染失败: projectId=%d, err=%v", projectID, err))
		setEditRenderProgress(projectID, "failed", 0, "渲染失败："+err.Error())
		model.DB.Model(&model.DirectorEditProject{}).Where("id = ?", projectID).Updates(map[string]any{
			"status":    model.DirectorEditStatusFailed,
			"error_msg": err.Error(),
		})
	}

	project, err := model.GetDirectorEditProjectByID(projectID)
	if err != nil {
		fail(err)
		return
	}
	episode, err := model.GetDirectorEpisodeByID(project.EpisodeID)
	if err != nil {
		fail(err)
		return
	}
	var tl editTimeline
	if err := common.Unmarshal([]byte(project.Timeline), &tl); err != nil {
		fail(fmt.Errorf("解析剪辑时间轴失败: %w", err))
		return
	}
	if len(tl.Clips) == 0 {
		fail(fmt.Errorf("时间轴上没有视频片段"))
		return
	}

	detectEditFilters()
	detectFFmpegFilters()
	ffmpeg, _ := ffmpegPath()
	// 输出画幅：剪辑级设置优先（横屏素材可单独导出横屏成片），未设置时跟随分集
	ratio := strings.TrimSpace(tl.AspectRatio)
	if ratio == "" {
		ratio = episode.AspectRatio
	}
	outW, outH := outputSize(ratio, episode.Resolution)

	workDir, err := os.MkdirTemp("", "director-edit-*")
	if err != nil {
		fail(err)
		return
	}
	defer os.RemoveAll(workDir)

	// 1. 下载全部片段源视频并探测音轨
	var args []string
	// -nostats -progress pipe:1：进度键值对输出到 stdout，供实时解析（stderr 只留错误日志）
	args = append(args, "-y", "-nostats", "-progress", "pipe:1")
	clipHasAudio := make([]bool, len(tl.Clips))
	for i, c := range tl.Clips {
		clipPath, err := materializeToLocal(c.SrcURL, workDir, fmt.Sprintf("clip_%03d.mp4", i))
		if err != nil {
			fail(fmt.Errorf("片段%d 视频下载失败: %w", i+1, err))
			return
		}
		args = append(args, "-i", clipPath)
		clipHasAudio[i] = ffprobeHasAudio(ffmpeg, clipPath)
		setEditRenderProgress(projectID, "preparing", (i+1)*25/len(tl.Clips), fmt.Sprintf("下载素材 %d/%d", i+1, len(tl.Clips)))
	}
	inputCount := len(tl.Clips)

	// 2. 贴纸图片输入（无限循环帧）
	stickerInputIdx := make([]int, len(tl.Stickers))
	for k, st := range tl.Stickers {
		ext := filepath.Ext(st.URL)
		if ext == "" || len(ext) > 5 {
			ext = ".png"
		}
		stPath, err := materializeToLocal(st.URL, workDir, fmt.Sprintf("sticker_%03d%s", k, ext))
		if err != nil {
			fail(fmt.Errorf("贴纸%d 下载失败: %w", k+1, err))
			return
		}
		stickerInputIdx[k] = inputCount
		// -loop 1 是无限图片流，必须用 -t 截断到贴纸结束时间，否则滤镜图永不 EOF、ffmpeg 无限编码
		stDur := st.End
		if stDur <= 0 {
			stDur = 1
		}
		args = append(args, "-loop", "1", "-framerate", "24", "-t", fmt.Sprintf("%.3f", stDur), "-i", stPath)
		inputCount++
	}

	// 3. BGM 输入（循环至视频总长）
	bgmIdx := -1
	if strings.TrimSpace(tl.Audio.BgmURL) != "" {
		bgmPath, err := materializeToLocal(tl.Audio.BgmURL, workDir, "bgm"+filepath.Ext(tl.Audio.BgmURL))
		if err != nil {
			fail(fmt.Errorf("背景音乐下载失败: %w", err))
			return
		}
		bgmIdx = inputCount
		args = append(args, "-stream_loop", "-1", "-i", bgmPath)
		inputCount++
	}

	// 4. 静音源（为无音轨片段补静音）
	silentIdx := -1
	silentNeeded := 0
	for _, has := range clipHasAudio {
		if !has {
			silentNeeded++
		}
	}
	if silentNeeded > 0 {
		silentIdx = inputCount
		args = append(args, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100")
		inputCount++
	}

	// 5. 构建滤镜脚本
	var filters []string
	for i, c := range tl.Clips {
		filters = append(filters, buildClipVideoChain(i, c, outW, outH))
		if clipHasAudio[i] {
			filters = append(filters, buildClipAudioChain(i, c))
		}
	}
	// 静音分配：一个静音源 asplit 给所有无音轨片段
	if silentNeeded > 0 {
		var tags []string
		for k := 0; k < silentNeeded; k++ {
			tags = append(tags, fmt.Sprintf("[sil%d]", k))
		}
		filters = append(filters, fmt.Sprintf("[%d:a]asplit=%d%s", silentIdx, silentNeeded, strings.Join(tags, "")))
		k := 0
		for i, c := range tl.Clips {
			if clipHasAudio[i] {
				continue
			}
			filters = append(filters, fmt.Sprintf("[sil%d]atrim=0:%.3f,asetpts=PTS-STARTPTS[a%d]", k, c.clipDuration(), i))
			k++
		}
	}

	// 6. 分组：组内 concat，组间 xfade/acrossfade
	groups := groupClips(tl.Clips)
	var groupV, groupA []string
	for gi, g := range groups {
		if len(g.indices) == 1 {
			i := g.indices[0]
			groupV = append(groupV, fmt.Sprintf("[v%d]", i))
			groupA = append(groupA, fmt.Sprintf("[a%d]", i))
			continue
		}
		var vIns, aIns string
		for _, i := range g.indices {
			vIns += fmt.Sprintf("[v%d]", i)
			aIns += fmt.Sprintf("[a%d]", i)
		}
		filters = append(filters, fmt.Sprintf("%sconcat=n=%d:v=1:a=0[gv%d]", vIns, len(g.indices), gi))
		filters = append(filters, fmt.Sprintf("%sconcat=n=%d:v=0:a=1[ga%d]", aIns, len(g.indices), gi))
		groupV = append(groupV, fmt.Sprintf("[gv%d]", gi))
		groupA = append(groupA, fmt.Sprintf("[ga%d]", gi))
	}

	// 组间串联：xfade 转场链（无转场能力的 ffmpeg 已在分组时降级为整组 concat）
	mainV, mainA := groupV[0], groupA[0]
	totalDuration := groups[0].duration
	for gi := 1; gi < len(groups); gi++ {
		prev := groups[gi-1]
		if prev.transition > 0 {
			offset := totalDuration - prev.transition
			outV := fmt.Sprintf("[xv%d]", gi)
			outA := fmt.Sprintf("[xa%d]", gi)
			filters = append(filters, fmt.Sprintf("%s%sxfade=transition=%s:duration=%.3f:offset=%.3f%s",
				mainV, groupV[gi], prev.transType, prev.transition, offset, outV))
			filters = append(filters, fmt.Sprintf("%s%sacrossfade=d=%.3f:c1=tri:c2=tri%s",
				mainA, groupA[gi], prev.transition, outA))
			mainV, mainA = outV, outA
			totalDuration = totalDuration + groups[gi].duration - prev.transition
		} else {
			// 无 xfade 能力时 transition 已被清零，理论上不会走到这里；兜底硬切
			outV := fmt.Sprintf("[xv%d]", gi)
			outA := fmt.Sprintf("[xa%d]", gi)
			filters = append(filters, fmt.Sprintf("%s%sconcat=n=2:v=1:a=0%s", mainV, groupV[gi], outV))
			filters = append(filters, fmt.Sprintf("%s%sconcat=n=2:v=0:a=1%s", mainA, groupA[gi], outA))
			mainV, mainA = outV, outA
			totalDuration += groups[gi].duration
		}
	}
	// 去掉内部方括号引用形式，统一为标签字符串
	mainV = strings.TrimPrefix(strings.TrimSuffix(mainV, "]"), "[")
	mainA = strings.TrimPrefix(strings.TrimSuffix(mainA, "]"), "[")

	// 7. 贴纸 overlay 链
	cur := mainV
	for k, st := range tl.Stickers {
		if st.Width <= 0 || st.End <= st.Start {
			continue
		}
		tag := fmt.Sprintf("st%d", k)
		filters = append(filters, fmt.Sprintf("[%d:v]format=rgba,scale=%d:-1[%s]", stickerInputIdx[k], int(math.Round(st.Width)), tag))
		next := fmt.Sprintf("vs%d", k)
		filters = append(filters, fmt.Sprintf("[%s][%s]overlay=%.1f:%.1f:enable='between(t,%.3f,%.3f)'[%s]",
			cur, tag, st.X, st.Y, st.Start, st.End, next))
		cur = next
	}

	// 8. 字幕烧录（ass 能力不可用时跳过并告警）
	if len(tl.Subtitles) > 0 && ffmpegHasAss {
		assPath := filepath.Join(workDir, "edit_subtitle.ass")
		if err = buildEditASS(assPath, tl.Subtitles, outW, outH); err != nil {
			fail(err)
			return
		}
		// fontsdir：内置字体目录（resource/fonts）免系统安装加载字体
		assFilter := fmt.Sprintf("ass='%s'", escapeAssPath(assPath))
		if dir := bundledFontsDir(); dir != "" {
			assFilter += fmt.Sprintf(":fontsdir='%s'", escapeAssPath(dir))
		}
		filters = append(filters, fmt.Sprintf("[%s]%s[vout]", cur, assFilter))
		cur = "vout"
	} else if len(tl.Subtitles) > 0 {
		common.SysLog(fmt.Sprintf("云导演剪辑渲染: ffmpeg 缺少 ass 滤镜，本次渲染跳过字幕烧录, projectId=%d", projectID))
	}
	finalV := cur

	// 9. 音频：原声音量 → 与 BGM 混音
	voiceVolume := tl.Audio.VoiceVolume
	if voiceVolume <= 0 {
		voiceVolume = 1
	}
	filters = append(filters, fmt.Sprintf("[%s]volume=%.3f[avoice]", mainA, voiceVolume))
	finalA := "avoice"
	if bgmIdx >= 0 {
		bgmVolume := tl.Audio.BgmVolume
		if bgmVolume <= 0 {
			bgmVolume = 0.8
		}
		filters = append(filters, fmt.Sprintf("[%d:a]atrim=0:%.3f,asetpts=PTS-STARTPTS,volume=%.3f[abgm]", bgmIdx, totalDuration, bgmVolume))
		filters = append(filters, "[avoice][abgm]amix=inputs=2:duration=first:dropout_transition=0[aout]")
		finalA = "aout"
	}

	// 10. 写滤镜脚本并执行渲染
	scriptPath := filepath.Join(workDir, "filter.txt")
	if err = os.WriteFile(scriptPath, []byte(strings.Join(filters, ";\n")+"\n"), 0644); err != nil {
		fail(err)
		return
	}
	outPath := filepath.Join(workDir, "output.mp4")
	setEditRenderProgress(projectID, "encoding", 30, "ffmpeg 编码中")
	args = append(args,
		"-filter_complex_script", scriptPath,
		"-map", "["+finalV+"]", "-map", "["+finalA+"]",
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
		"-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outPath)
	common.SysLog(fmt.Sprintf("云导演剪辑渲染开始: projectId=%d, clips=%d, size=%dx%d", projectID, len(tl.Clips), outW, outH))
	// 超时兜底：防止滤镜图异常导致 ffmpeg 永久卡死（卡死还会占住渲染信号量，阻塞后续所有任务）
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, ffmpeg, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		fail(fmt.Errorf("创建 ffmpeg 进度管道失败: %w", err))
		return
	}
	if err = cmd.Start(); err != nil {
		fail(fmt.Errorf("ffmpeg 启动失败: %w", err))
		return
	}
	// 流式读取 -progress 输出：out_time_us/out_time_ms 单位均为微秒，映射到 30-95%
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "out_time") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		us, _ := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
		if totalDuration <= 0 {
			continue
		}
		pct := 30 + int(float64(us)/1e6/totalDuration*65)
		if pct > 95 {
			pct = 95
		}
		if pct < 30 {
			pct = 30
		}
		setEditRenderProgress(projectID, "encoding", pct, "ffmpeg 编码中")
	}
	if err = cmd.Wait(); err != nil {
		fail(fmt.Errorf("ffmpeg 执行失败: %w, 输出: %s", err, ffmpegTail(stderr.Bytes())))
		return
	}

	// 11. 转存并回写
	setEditRenderProgress(projectID, "uploading", 96, "上传成片")
	data, err := os.ReadFile(outPath)
	if err != nil {
		fail(err)
		return
	}
	finalURL, err := storeBytesToTOS(data, fmt.Sprintf("edited_%d.mp4", time.Now().UnixNano()), userID, episode.ProjectID)
	if err != nil {
		fail(err)
		return
	}
	if err = model.DB.Model(&model.DirectorEditProject{}).Where("id = ?", projectID).Updates(map[string]any{
		"status":     model.DirectorEditStatusDone,
		"output_url": finalURL,
		"error_msg":  "",
		"progress":   100,
	}).Error; err != nil {
		fail(err)
		return
	}
	// 回写分集：时长以剪辑时间轴实际总时长为准，剪辑输出即最终成片
	model.DB.Model(&model.DirectorEpisode{}).Where("id = ?", episode.ID).Updates(map[string]any{
		"duration":  int(math.Round(totalDuration)),
		"video_url": finalURL,
		"status":    "done",
	})

	// 12. 登记素材库
	title := project.Name
	if title == "" || title == "剪辑工程" {
		title = fmt.Sprintf("%s 剪辑成片", episode.Title)
	}
	episodeID := episode.ID
	projectIDOwner := episode.ProjectID
	model.DB.Create(&model.DirectorAsset{
		CreatedAt: time.Now().Unix(),
		UpdatedAt: time.Now().Unix(),
		UserID:    userID,
		ProjectID: &projectIDOwner,
		EpisodeID: &episodeID,
		Name:      title,
		Type:      "video",
		Category:  "edited",
		URL:       finalURL,
		Duration:  int(math.Round(totalDuration)),
	})
	setEditRenderProgress(projectID, "done", 100, "渲染完成")
	common.SysLog(fmt.Sprintf("云导演剪辑渲染完成: projectId=%d, url=%s, cost=%s", projectID, finalURL, time.Since(renderStart).String()))
}
