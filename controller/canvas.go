package controller

import (
	"errors"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	directorService "github.com/QuantumNous/new-api/service/director"

	"github.com/gin-gonic/gin"
)

// ===== 智能画布（Smart Canvas）API =====
// 画布项目 CRUD / 文档持久化 / 节点生成 / 文件上传。
// 全部挂载在已认证的 /api/canvas 分组下，userId 取自会话；
// 生成复用云导演模型设定与内部令牌回环网关，计费计到调用者本人账户。

// canvasMaxDocumentBytes 画布文档上限：节点/连线/视口均为 URL 引用不含媒体本体，
// 2MB 足够数千节点，超出视为异常请求拒绝（防大字段撑爆存储）
const canvasMaxDocumentBytes = 2 << 20

var canvasImageSizePattern = regexp.MustCompile(`^\d{3,4}x\d{3,4}$`)

// canvasOwnedProject 校验画布项目归属，失败时已写入响应
func canvasOwnedProject(c *gin.Context, id int) (*model.CanvasProject, bool) {
	p, err := model.GetCanvasProjectByID(id)
	if err != nil || !directorOwned(c, p.UserID) {
		common.ApiErrorMsg(c, "画布项目不存在")
		return nil, false
	}
	return p, true
}

// canvasDocumentSummary 从画布文档提取节点数与封面（首个有产出的图片/视频节点）。
// 兼容单画布（v1：顶层 nodes）与多画布（v2：canvases[].nodes）两种文档结构。
func canvasDocumentSummary(document string) (nodeCount int, coverURL string) {
	var doc struct {
		Nodes    []canvasSummaryNode `json:"nodes"`
		Canvases []struct {
			Nodes []canvasSummaryNode `json:"nodes"`
		} `json:"canvases"`
	}
	if err := common.UnmarshalJsonStr(document, &doc); err != nil {
		return 0, ""
	}
	nodes := doc.Nodes
	for _, cv := range doc.Canvases {
		nodes = append(nodes, cv.Nodes...)
	}
	videoCover := ""
	for _, n := range nodes {
		if n.Metadata.URL == "" {
			continue
		}
		if n.Type == "image" && coverURL == "" {
			coverURL = n.Metadata.URL
		}
		if n.Type == "video" && videoCover == "" {
			videoCover = n.Metadata.URL
		}
	}
	if coverURL == "" {
		coverURL = videoCover
	}
	return len(nodes), coverURL
}

type canvasSummaryNode struct {
	Type     string `json:"type"`
	Metadata struct {
		URL string `json:"url"`
	} `json:"metadata"`
}

// CanvasCreateProject 创建画布项目（空文档，进入编辑器后由前端初始化并保存）
func CanvasCreateProject(c *gin.Context) {
	userID := c.GetInt("id")
	var body struct {
		Title string `json:"title"`
	}
	_ = c.ShouldBindJSON(&body)
	title := strings.TrimSpace(body.Title)
	if title == "" {
		title = i18n.T(c, i18n.MsgCanvasUntitledTitle)
	}
	if utf8.RuneCountInString(title) > 64 {
		common.ApiErrorMsg(c, "项目名称过长")
		return
	}
	p := &model.CanvasProject{UserID: userID, Title: title}
	if err := p.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, p)
}

// CanvasGetProject 画布项目详情（含完整文档）
func CanvasGetProject(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	p, ok := canvasOwnedProject(c, id)
	if !ok {
		return
	}
	common.ApiSuccess(c, p)
}

// CanvasGetProjectList 画布项目列表（不含文档大字段）
func CanvasGetProjectList(c *gin.Context) {
	userID := c.GetInt("id")
	page, pageSize := directorPage(c)
	list, total, err := model.ListCanvasProjects(userID, strings.TrimSpace(c.Query("keyword")), page, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, directorPageResult(list, total, page, pageSize))
}

// CanvasUpdateProject 重命名 / 保存画布文档（自动保存），两者可单独提交
func CanvasUpdateProject(c *gin.Context) {
	var body struct {
		ID       int     `json:"id"`
		Title    *string `json:"title"`
		Document *string `json:"document"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ID <= 0 {
		common.ApiErrorMsg(c, "缺少项目ID")
		return
	}
	p, ok := canvasOwnedProject(c, body.ID)
	if !ok {
		return
	}
	fields := map[string]any{}
	if body.Title != nil {
		title := strings.TrimSpace(*body.Title)
		if title == "" {
			common.ApiErrorMsg(c, "项目名称不能为空")
			return
		}
		if utf8.RuneCountInString(title) > 64 {
			common.ApiErrorMsg(c, "项目名称过长")
			return
		}
		fields["title"] = title
	}
	if body.Document != nil {
		if len(*body.Document) > canvasMaxDocumentBytes {
			common.ApiErrorMsg(c, "画布内容过大，请删减部分节点")
			return
		}
		var docCheck map[string]any
		if err := common.UnmarshalJsonStr(*body.Document, &docCheck); err != nil {
			common.ApiErrorMsg(c, "画布文档格式错误")
			return
		}
		nodeCount, coverURL := canvasDocumentSummary(*body.Document)
		fields["document"] = *body.Document
		fields["node_count"] = nodeCount
		fields["cover_url"] = coverURL
	}
	if len(fields) == 0 {
		common.ApiErrorMsg(c, "没有需要更新的内容")
		return
	}
	if err := p.Update(fields); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": p.ID, "updatedAt": p.UpdatedAt})
}

// CanvasDeleteProject 删除画布项目及其生成任务记录
func CanvasDeleteProject(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	p, ok := canvasOwnedProject(c, id)
	if !ok {
		return
	}
	if err = model.DB.Delete(&model.CanvasProject{}, p.ID).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// CanvasRecycleBinList 回收站列表（已软删除的画布项目）
func CanvasRecycleBinList(c *gin.Context) {
	list, err := model.ListDeletedCanvasProjects(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"list": list, "total": len(list)})
}

// CanvasRestoreProject 从回收站恢复画布项目
func CanvasRestoreProject(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err = model.RestoreCanvasProject(id, c.GetInt("id")); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// CanvasPermanentDeleteProject 彻底删除回收站中的画布项目及其生成记录
func CanvasPermanentDeleteProject(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	userID := c.GetInt("id")
	var count int64
	model.DB.Unscoped().Model(&model.CanvasProject{}).
		Where("id = ? AND user_id = ? AND deleted_at IS NOT NULL", id, userID).Count(&count)
	if count == 0 {
		common.ApiErrorMsg(c, "project not in recycle bin")
		return
	}
	if err = model.PermanentDeleteCanvasProject(id, userID); err != nil {
		common.ApiError(c, err)
		return
	}
	model.DB.Where("project_id = ?", id).Delete(&model.CanvasGeneration{})
	common.ApiSuccess(c, nil)
}

// CanvasOptimizePrompt 提示词优化：文本模型改写提示词，返回改写结果
func CanvasOptimizePrompt(c *gin.Context) {
	var body struct {
		Prompt string `json:"prompt"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	optimized, err := directorService.SubmitCanvasPromptOptimize(c.GetInt("id"), body.Prompt)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"prompt": optimized})
}

// CanvasDuplicateProject 创建画布项目副本
func CanvasDuplicateProject(c *gin.Context) {
	userID := c.GetInt("id")
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	p, ok := canvasOwnedProject(c, id)
	if !ok {
		return
	}
	title := p.Title + i18n.T(c, i18n.MsgCanvasCopySuffix)
	if utf8.RuneCountInString(title) > 64 {
		title = string([]rune(title)[:64])
	}
	dup := &model.CanvasProject{
		UserID:    userID,
		Title:     title,
		Document:  p.Document,
		NodeCount: p.NodeCount,
		CoverURL:  p.CoverURL,
	}
	if err = dup.Insert(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, dup)
}

// CanvasUpload 上传参考图/素材到 TOS，仅返回 URL（不登记素材库）
func CanvasUpload(c *gin.Context) {
	userID := c.GetInt("id")
	header, err := c.FormFile("file")
	if err != nil {
		common.ApiErrorMsg(c, "请选择要上传的文件")
		return
	}
	if header.Size > 32<<20 {
		common.ApiErrorMsg(c, "文件不能超过 32MB")
		return
	}
	// 未配置 TOS 时回退本地磁盘存储（自托管部署无对象存储也能用画布上传）
	if _, ok := common.GetTOSUploadConfig(); !ok {
		lf, lErr := header.Open()
		if lErr != nil {
			common.ApiError(c, lErr)
			return
		}
		defer lf.Close()
		content, rErr := io.ReadAll(lf)
		if rErr != nil {
			common.ApiError(c, rErr)
			return
		}
		localURL, sErr := common.SaveUploadLocal(content, header.Filename, userID)
		if sErr != nil {
			common.ApiError(c, sErr)
			return
		}
		common.ApiSuccess(c, gin.H{"url": localURL})
		return
	}
	f, err := header.Open()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	defer f.Close()
	url, _, err := common.UploadReaderToTOS(f, header.Filename, userID, "canvas")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"url": url})
}

// canvasGenerateRequest 画布节点生成请求
type canvasGenerateRequest struct {
	ProjectID       int      `json:"projectId"`
	NodeID          string   `json:"nodeId"`
	Kind            string   `json:"kind"` // image/video/text/audio
	Prompt          string   `json:"prompt"`
	Size            string   `json:"size"`        // 图片尺寸（如 2048x2048）
	AspectRatio     string   `json:"aspectRatio"` // 视频画幅
	Resolution      string   `json:"resolution"`  // 视频分辨率
	Duration        int      `json:"duration"`    // 视频时长（秒）
	Count           int      `json:"count"`       // 产出数量（图片张数/文本段数）
	Voice           string   `json:"voice"`       // 音频音色
	AudioFormat     string   `json:"audioFormat"` // 音频格式
	Speed           float64  `json:"speed"`       // 音频语速倍率
	ReferenceImages []string `json:"referenceImages"`
}

// validate 计费安全边界：尺寸/时长/参考图数量全部在到达配额计算前收敛
func (r *canvasGenerateRequest) validate() error {
	r.Prompt = strings.TrimSpace(r.Prompt)
	if r.Prompt == "" {
		return errors.New("请输入提示词")
	}
	if len(r.Prompt) > 8000 {
		return errors.New("提示词过长")
	}
	if r.NodeID == "" || len(r.NodeID) > 64 {
		return errors.New("节点ID无效")
	}
	if len(r.ReferenceImages) > 8 {
		return errors.New("参考图最多 8 张")
	}
	for _, ref := range r.ReferenceImages {
		if len(ref) > 2048 || (!strings.HasPrefix(ref, "http://") && !strings.HasPrefix(ref, "https://")) {
			return errors.New("参考图地址无效")
		}
	}
	switch r.Kind {
	case "image":
		if r.Count < 0 || r.Count > dto.MaxImageN {
			return fmt.Errorf("图片数量需在 1~%d 之间", dto.MaxImageN)
		}
		if r.Size != "" {
			if !canvasImageSizePattern.MatchString(r.Size) {
				return errors.New("图片尺寸格式无效")
			}
			parts := strings.SplitN(r.Size, "x", 2)
			w, _ := strconv.Atoi(parts[0])
			h, _ := strconv.Atoi(parts[1])
			if w < 512 || h < 512 || w > 4096 || h > 4096 {
				return errors.New("图片尺寸需在 512~4096 之间")
			}
		}
	case "video":
		if r.Duration < 0 || r.Duration > relaycommon.MaxTaskDurationSeconds {
			return fmt.Errorf("视频时长需在 1~%d 秒之间", relaycommon.MaxTaskDurationSeconds)
		}
		switch r.AspectRatio {
		case "", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive":
		default:
			return errors.New("视频画幅无效")
		}
		switch r.Resolution {
		case "", "480p", "720p", "1080p":
		default:
			return errors.New("视频分辨率无效")
		}
	case "text":
		if r.Count < 0 || r.Count > 4 {
			return errors.New("文本数量需在 1~4 之间")
		}
	case "audio":
		switch r.Voice {
		case "", "alloy", "echo", "fable", "onyx", "nova", "shimmer":
		default:
			return errors.New("音频音色无效")
		}
		switch r.AudioFormat {
		case "", "mp3", "opus", "aac", "flac", "wav":
		default:
			return errors.New("音频格式无效")
		}
		if r.Speed < 0 || r.Speed > 4 {
			return errors.New("语速倍率需在 0.25~4 之间")
		}
	default:
		return errors.New("生成类型无效")
	}
	return nil
}

// CanvasGenerate 提交画布节点生成任务（异步，前端轮询 CanvasGetGeneration）
func CanvasGenerate(c *gin.Context) {
	userID := c.GetInt("id")
	var req canvasGenerateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if err := req.validate(); err != nil {
		common.ApiError(c, err)
		return
	}
	if _, ok := canvasOwnedProject(c, req.ProjectID); !ok {
		return
	}
	genReq := directorService.CanvasGenRequest{
		ProjectID:       req.ProjectID,
		NodeID:          req.NodeID,
		Prompt:          req.Prompt,
		Size:            req.Size,
		AspectRatio:     req.AspectRatio,
		Resolution:      req.Resolution,
		Duration:        req.Duration,
		Count:           req.Count,
		Voice:           req.Voice,
		AudioFormat:     req.AudioFormat,
		Speed:           req.Speed,
		ReferenceImages: req.ReferenceImages,
	}
	var genID int
	var err error
	switch req.Kind {
	case "image":
		genID, err = directorService.SubmitCanvasImage(userID, genReq)
	case "text":
		genID, err = directorService.SubmitCanvasText(userID, genReq)
	case "audio":
		genID, err = directorService.SubmitCanvasAudio(userID, genReq)
	default:
		genID, err = directorService.SubmitCanvasVideo(userID, genReq)
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"generationId": genID})
}

// CanvasGetGeneration 画布生成任务详情（前端轮询）
func CanvasGetGeneration(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	g, err := model.GetCanvasGenerationByID(id)
	if err != nil || !directorOwned(c, g.UserID) {
		common.ApiErrorMsg(c, "任务不存在")
		return
	}
	common.ApiSuccess(c, g)
}

// CanvasCancelGeneration 取消进行中的画布生成任务（停止后台轮询，迟到结果不再覆盖取消状态）
func CanvasCancelGeneration(c *gin.Context) {
	id, err := directorIDParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	cancelled, err := model.CancelCanvasGeneration(id, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !cancelled {
		common.ApiErrorMsg(c, "任务不存在或已结束")
		return
	}
	common.ApiSuccess(c, nil)
}

// CanvasGetGenerationList 画布生成历史（projectId 缺省表示当前用户全部画布）
func CanvasGetGenerationList(c *gin.Context) {
	userID := c.GetInt("id")
	page, pageSize := directorPage(c)
	projectID, _ := strconv.Atoi(c.Query("projectId"))
	list, total, err := model.ListCanvasGenerations(userID, projectID, page, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, directorPageResult(list, total, page, pageSize))
}

// CanvasAgentDraft Agent 草案：文本模型按创作需求产出节点画布草案（前端预览后应用）
func CanvasAgentDraft(c *gin.Context) {
	userID := c.GetInt("id")
	var body struct {
		ProjectID int    `json:"projectId"`
		Prompt    string `json:"prompt"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if _, ok := canvasOwnedProject(c, body.ProjectID); !ok {
		return
	}
	draft, err := directorService.SubmitCanvasAgentDraft(userID, body.Prompt)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, draft)
}

// CanvasScriptSplit 分镜脚本 AI 拆分：文本模型把剧本拆为镜头列表（同步返回）
func CanvasScriptSplit(c *gin.Context) {
	userID := c.GetInt("id")
	var body struct {
		Script          string `json:"script"`
		TotalDuration   int    `json:"totalDuration"`
		PerShotDuration int    `json:"perShotDuration"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if body.TotalDuration < 0 || body.TotalDuration > 3600 {
		common.ApiErrorMsg(c, "总时长无效")
		return
	}
	if body.PerShotDuration < 0 || body.PerShotDuration > 15 {
		common.ApiErrorMsg(c, "单镜时长需在 2~15 秒之间")
		return
	}
	shots, err := directorService.SplitCanvasScript(userID, body.Script, body.TotalDuration, body.PerShotDuration)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"shots": shots})
}
