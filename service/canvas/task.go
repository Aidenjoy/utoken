package canvas

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// ===== 智能画布：任务编排 =====
// 上游图片接口都是同步的（Ark 非流式 / MediaKit tools-sync 直接返回结果），
// 因此画布统一采用「本地异步任务 + 前端轮询」：提交立即返回任务，执行在后台完成，
// 避免把 20~120 秒的上游耗时暴露给浏览器请求。任务状态只有一处真相（canvas_tasks）。

// 任务阶段（前端展示用）
const (
	stageQueued      = "queued"      // 已受理，排队等待执行
	stageDispatching = "dispatching" // 正在请求上游
	stagePersisting  = "persisting"  // 正在转存结果
	stageCompleted   = "completed"   // 完成
	stageFailed      = "failed"      // 失败
	stageCanceled    = "canceled"    // 取消
	stageRestarted   = "restart"     // 进程重启导致中断
)

var (
	// ErrTaskNotFound 任务不存在或不属于当前用户
	ErrTaskNotFound = errors.New("任务不存在")
	// ErrCancelNotSupported 上游为同步接口，执行中无法取消
	ErrCancelNotSupported = errors.New("当前工具的上游接口为同步调用，执行中无法取消")
)

// asyncExecutor 决定任务执行方式：生产为后台 goroutine，测试替换为同步执行以获得确定性。
var asyncExecutor = func(taskID int) {
	go executeTask(taskID)
}

// SubmitRequest 任务提交入参
type SubmitRequest struct {
	ProjectID      int            `json:"projectId"`
	Tool           string         `json:"tool"`
	IdempotencyKey string         `json:"idempotencyKey"`
	Prompt         string         `json:"prompt"`
	Images         []string       `json:"images"`
	Mask           string         `json:"mask"` // data:image/png;base64,...，尺寸须与原图一致
	Size           string         `json:"size"`
	Params         map[string]any `json:"params"`
}

// TaskSnapshot 输入快照：重试、核对、审计都以它为唯一依据
type TaskSnapshot struct {
	Tool          string         `json:"tool"`
	Prompt        string         `json:"prompt,omitempty"`
	Images        []string       `json:"images,omitempty"`
	MaskURL       string         `json:"maskUrl,omitempty"`
	MaskWidth     int            `json:"maskWidth,omitempty"`
	MaskHeight    int            `json:"maskHeight,omitempty"`
	Size          string         `json:"size,omitempty"`
	Params        map[string]any `json:"params,omitempty"`
	SourceWidth   int            `json:"sourceWidth,omitempty"`
	SourceHeight  int            `json:"sourceHeight,omitempty"`
	Model         string         `json:"model,omitempty"`
	ProjectWidth  int            `json:"projectWidth,omitempty"`
	ProjectHeight int            `json:"projectHeight,omitempty"`
}

// TaskResult 结果：images 一定是我们自己存储（或兜底的 24h 上游链接）
type TaskResult struct {
	Images   []ResultImage `json:"images"`
	Warnings []string      `json:"warnings,omitempty"`
	// Sources 记录上游原始结果地址，用于「转存失败后从已知结果补存」
	Sources []string `json:"sources,omitempty"`
}

// TaskView 返回给前端的任务详情
type TaskView struct {
	ID              int           `json:"id"`
	ProjectID       int           `json:"projectId"`
	Tool            string        `json:"tool"`
	ToolLabel       string        `json:"toolLabel"`
	Status          string        `json:"status"`
	Stage           string        `json:"stage"`
	Progress        int           `json:"progress"`
	Model           string        `json:"model,omitempty"`
	Quota           int           `json:"quota"`
	SettledQuota    int           `json:"settledQuota"`
	BillingState    string        `json:"billingState"`
	Cancelable      bool          `json:"cancelable"`
	CancelRequested bool          `json:"cancelRequested"`
	CreatedAt       int64         `json:"createdAt"`
	UpdatedAt       int64         `json:"updatedAt"`
	StartedAt       int64         `json:"startedAt"`
	FinishedAt      int64         `json:"finishedAt"`
	ErrorCode       string        `json:"errorCode,omitempty"`
	ErrorMsg        string        `json:"errorMsg,omitempty"`
	Input           *TaskSnapshot `json:"input,omitempty"`
	Result          *TaskResult   `json:"result,omitempty"`
}

// Submit 提交任务。返回的 reused=true 表示命中同一幂等键（参数一致）的既有任务。
func Submit(userID int, req SubmitRequest) (*TaskView, bool, error) {
	spec, ok := GetToolSpec(req.Tool)
	if !ok {
		return nil, false, fmt.Errorf("不支持的工具: %s", req.Tool)
	}
	cap, _ := GetCapability(spec.Tool)
	if !cap.Available {
		return nil, false, fmt.Errorf("%w: %s", ErrToolUnavailable, cap.UnavailableReason)
	}
	project, err := GetProject(userID, req.ProjectID)
	if err != nil {
		return nil, false, err
	}
	if key := strings.TrimSpace(req.IdempotencyKey); key == "" {
		return nil, false, errors.New("缺少幂等键 idempotencyKey")
	} else if len(key) > 191 {
		return nil, false, errors.New("幂等键过长")
	}

	snapshot, err := buildSnapshot(userID, spec, cap, req, project)
	if err != nil {
		return nil, false, err
	}
	payload, err := common.Marshal(snapshot)
	if err != nil {
		return nil, false, err
	}
	paramsHash := model.HashCanvasParams(payload)

	if existing, err := model.GetCanvasTaskByIdempotency(userID, req.ProjectID, strings.TrimSpace(req.IdempotencyKey)); err == nil {
		if existing.ParamsHash != paramsHash {
			return nil, false, model.ErrCanvasIdempotencyConflict
		}
		view, viewErr := buildTaskView(existing)
		return view, true, viewErr
	}

	task := &model.CanvasTask{
		UserID: userID, ProjectID: req.ProjectID, Tool: spec.Tool,
		IdempotencyKey: strings.TrimSpace(req.IdempotencyKey), ParamsHash: paramsHash,
		Status: model.CanvasTaskStatusPending, Stage: stageQueued, Progress: 0,
		Upstream: spec.Upstream, Model: cap.Model, ChannelID: cap.ChannelID,
		InputSnapshot: string(payload), BillingState: model.CanvasBillingNone,
	}
	inserted, err := model.InsertCanvasTask(task)
	if err != nil {
		return nil, false, err
	}
	if inserted.ID != task.ID {
		return nil, false, model.ErrCanvasIdempotencyConflict
	}
	if err := reserveTaskBilling(inserted, 1); err != nil {
		// 计费不成立：任务不应留存，直接删除，避免留下无法执行的空任务
		model.DB.Delete(&model.CanvasTask{}, inserted.ID)
		return nil, false, err
	}
	asyncExecutor(inserted.ID)
	fresh, err := model.GetCanvasTaskByID(inserted.ID)
	if err != nil {
		return nil, false, err
	}
	view, err := buildTaskView(fresh)
	return view, false, err
}

// ErrToolUnavailable 工具不可用（未配置渠道/凭证、模型未登记）
var ErrToolUnavailable = errors.New("工具不可用")

// buildSnapshot 校验入参并生成快照
func buildSnapshot(userID int, spec ToolSpec, cap Capability, req SubmitRequest, project *model.CanvasProject) (*TaskSnapshot, error) {
	prompt := strings.TrimSpace(req.Prompt)
	if spec.RequiresPrompt && prompt == "" {
		return nil, errors.New("该工具需要提示词")
	}
	if utf8.RuneCountInString(prompt) > cap.Limits.MaxPromptRunes {
		return nil, fmt.Errorf("提示词最多 %d 个字符", cap.Limits.MaxPromptRunes)
	}

	inputs := make([]string, 0, len(req.Images))
	for _, item := range req.Images {
		if strings.TrimSpace(item) != "" {
			inputs = append(inputs, strings.TrimSpace(item))
		}
	}
	if spec.RequiresImage && len(inputs) < spec.MinImages {
		return nil, fmt.Errorf("该工具至少需要 %d 张输入图", spec.MinImages)
	}
	if spec.MaxImages > 0 && len(inputs) > spec.MaxImages {
		return nil, fmt.Errorf("输入图最多 %d 张", spec.MaxImages)
	}
	if len(inputs) == 0 && !spec.RequiresImage {
		// 文生图：无输入图
	}

	resolved, infos, err := resolveTaskImages(userID, inputs)
	if err != nil {
		return nil, err
	}
	snapshot := &TaskSnapshot{
		Tool: spec.Tool, Prompt: prompt, Images: resolved, Params: req.Params,
		Model: cap.Model, ProjectWidth: project.Width, ProjectHeight: project.Height,
	}
	if len(infos) > 0 {
		snapshot.SourceWidth, snapshot.SourceHeight = infos[0].Width, infos[0].Height
	}

	if spec.SupportsMask == MaskRequired {
		if strings.TrimSpace(req.Mask) == "" {
			return nil, errors.New("该工具必须提交蒙版")
		}
		if len(infos) == 0 {
			return nil, errors.New("缺少原图，无法校验蒙版尺寸")
		}
		maskURL, maskInfo, err := storeMaskToTOS(req.Mask, infos[0].Width, infos[0].Height, userID, project.ID)
		if err != nil {
			return nil, err
		}
		snapshot.MaskURL, snapshot.MaskWidth, snapshot.MaskHeight = maskURL, maskInfo.Width, maskInfo.Height
	} else if strings.TrimSpace(req.Mask) != "" {
		return nil, fmt.Errorf("工具 %s 的上游接口不接受蒙版，请改用涂抹消除", spec.Tool)
	}

	if cap.Upstream == UpstreamMediaKit {
		scene := stringParam(req.Params, "scene", "general")
		if len(infos) > 0 {
			if err := validateMediaKitImage(spec.Tool, scene, infos[0]); err != nil {
				return nil, err
			}
		}
		if spec.Tool == ToolOutpaint {
			mode := stringParam(req.Params, "mode", "ratio")
			if _, _, _, _, err := expandRatios(mode, req.Params, infos[0].Width, infos[0].Height); err != nil {
				return nil, err
			}
		}
		snapshot.Size = strings.TrimSpace(req.Size)
		return snapshot, nil
	}

	profile, known := resolveImageModel(cap.Model)
	if !known {
		return nil, fmt.Errorf("图片模型 %s 未登记在画布能力表内", cap.Model)
	}
	size, err := resolveArkSize(spec, strings.TrimSpace(req.Size), profile, infos)
	if err != nil {
		return nil, err
	}
	snapshot.Size = size
	return snapshot, nil
}

// resolveArkSize 决定下发给 Ark 的 size。
// 局部编辑类工具默认沿用原图尺寸（保证编辑结果与原图逐像素对齐，便于回贴画布）。
func resolveArkSize(spec ToolSpec, requested string, profile imageModelProfile, infos []ImageInfo) (string, error) {
	hasTier := func(tier string) bool {
		for _, item := range profile.Tiers {
			if strings.EqualFold(item, tier) {
				return true
			}
		}
		return false
	}
	if requested == "" {
		if len(infos) > 0 && spec.RequiresImage {
			candidate := fmt.Sprintf("%dx%d", infos[0].Width, infos[0].Height)
			if err := validateArkSizeString(candidate, profile); err == nil {
				return candidate, nil
			}
		}
		if hasTier("2K") {
			return "2K", nil
		}
		if len(profile.Tiers) > 0 {
			return profile.Tiers[0], nil
		}
		return "", errors.New("该模型未声明可用尺寸")
	}
	if hasTier(requested) {
		return requested, nil
	}
	if err := validateArkSizeString(requested, profile); err != nil {
		return "", err
	}
	return requested, nil
}

// validateArkSizeString 校验 WxH 尺寸是否落在模型的总像素与宽高比区间内。
func validateArkSizeString(size string, profile imageModelProfile) error {
	width, height, ok := parseSize(size)
	if !ok {
		return fmt.Errorf("尺寸格式应为 WxH 或分辨率档位（%s），收到 %s",
			strings.Join(profile.Tiers, "/"), size)
	}
	pixels := width * height
	if profile.MinPixels > 0 && pixels < profile.MinPixels {
		return fmt.Errorf("尺寸 %s 总像素不足模型下限 %d", size, profile.MinPixels)
	}
	if profile.MaxPixels > 0 && pixels > profile.MaxPixels {
		return fmt.Errorf("尺寸 %s 总像素超过模型上限 %d", size, profile.MaxPixels)
	}
	aspect := float64(width) / float64(height)
	if profile.AspectMin > 0 && aspect < profile.AspectMin {
		return fmt.Errorf("尺寸 %s 宽高比超出模型允许范围", size)
	}
	if profile.AspectMax > 0 && aspect > profile.AspectMax {
		return fmt.Errorf("尺寸 %s 宽高比超出模型允许范围", size)
	}
	return nil
}

// executeTask 后台执行任务：CAS 抢锁 → 调上游 → 转存 → 落终态 → 结算/退款。
func executeTask(taskID int) {
	claimed, err := model.ClaimCanvasTask(taskID, []string{model.CanvasTaskStatusPending}, model.CanvasTaskStatusRunning)
	if err != nil || !claimed {
		return
	}
	task, err := model.GetCanvasTaskByID(taskID)
	if err != nil {
		return
	}
	if task.CancelRequested {
		finalizeCanceled(task, "提交后取消")
		return
	}
	model.UpdateCanvasTaskFields(taskID, map[string]any{
		"stage": stageDispatching, "progress": 10, "started_at": time.Now().Unix(),
	})

	var snapshot TaskSnapshot
	if err := common.UnmarshalJsonStr(task.InputSnapshot, &snapshot); err != nil {
		failTask(task, "bad_snapshot", fmt.Errorf("任务入参快照损坏: %w", err), false)
		return
	}

	images, sources, warnings, runErr := dispatch(task, snapshot)
	if runErr != nil {
		var upErr *upstreamError
		indeterminate := errors.As(runErr, &upErr) && upErr.indeterminate
		code := "upstream_error"
		if errors.As(runErr, &upErr) && upErr.code != "" {
			code = upErr.code
		}
		failTask(task, code, runErr, indeterminate)
		return
	}

	model.UpdateCanvasTaskFields(taskID, map[string]any{"stage": stagePersisting, "progress": 80})
	result := TaskResult{Images: images, Warnings: warnings, Sources: sources}
	payload, err := common.Marshal(result)
	if err != nil {
		failTask(task, "encode_result_failed", err, false)
		return
	}
	finalized, err := model.FinalizeCanvasTask(taskID, model.CanvasTaskStatusSucceeded, map[string]any{
		"result": string(payload), "progress": 100, "stage": stageCompleted,
		"error_code": "", "error_msg": "",
	})
	if err != nil || !finalized {
		// 终态已被其他路径写入（用户在待执行阶段取消）：本次结果作废，预扣额度退回
		refundTaskBilling(task, "结果未采用")
		return
	}
	settleTaskBilling(task, len(images))
}

// dispatch 按上游分派一次调用，返回画布结果图与上游原始地址。
func dispatch(task *model.CanvasTask, snapshot TaskSnapshot) ([]ResultImage, []string, []string, error) {
	switch task.Upstream {
	case UpstreamArk:
		items, err := callArkImage(task.UserID, arkImageRequest{
			Model:     task.Model,
			Prompt:    snapshot.Prompt,
			Images:    snapshot.Images,
			Size:      snapshot.Size,
			Watermark: false,
		})
		if err != nil {
			return nil, nil, nil, err
		}
		sources := make([]string, 0, len(items))
		for _, item := range items {
			if item.URL != "" {
				sources = append(sources, item.URL)
			}
		}
		images, warnings := persistArkItems(items, task.UserID, task.ProjectID)
		return images, sources, warnings, nil
	case UpstreamMediaKit:
		sourceImage := ""
		if len(snapshot.Images) > 0 {
			sourceImage = snapshot.Images[0]
		}
		info := ImageInfo{Width: snapshot.SourceWidth, Height: snapshot.SourceHeight}
		images, err := runMediaKitTool(task.Tool, sourceImage, snapshot.MaskURL,
			snapshot.Params, info, task.UserID, task.ProjectID)
		if err != nil {
			return nil, nil, nil, err
		}
		return images, nil, nil, nil
	}
	return nil, nil, nil, fmt.Errorf("未知上游: %s", task.Upstream)
}

// failTask 落失败终态：可判定失败退款；上游结果未知则进入待核对（不退款、不重发）。
func failTask(task *model.CanvasTask, code string, cause error, indeterminate bool) {
	msg := cause.Error()
	if indeterminate {
		finalized, _ := model.FinalizeCanvasTask(task.ID, model.CanvasTaskStatusReviewing, map[string]any{
			"stage": stageFailed, "progress": 100,
			"error_code": code, "error_msg": msg,
		})
		if finalized {
			common.SysError(fmt.Sprintf("画布任务待核对（上游结果未知）: taskId=%d, code=%s, err=%v", task.ID, code, cause))
		}
		return
	}
	finalized, _ := model.FinalizeCanvasTask(task.ID, model.CanvasTaskStatusFailed, map[string]any{
		"stage": stageFailed, "progress": 100,
		"error_code": code, "error_msg": msg,
	})
	if finalized {
		refundTaskBilling(task, "上游失败")
	}
}

// finalizeCanceled 待执行阶段取消：落取消终态并退款。
func finalizeCanceled(task *model.CanvasTask, reason string) {
	finalized, _ := model.FinalizeCanvasTask(task.ID, model.CanvasTaskStatusCanceled, map[string]any{
		"stage": stageCanceled, "progress": 100, "error_msg": reason,
	})
	if finalized {
		refundTaskBilling(task, reason)
	}
}

// GetTask 任务详情（含归属校验）
func GetTask(userID, taskID int) (*TaskView, error) {
	task, err := model.GetCanvasTaskByID(taskID)
	if err != nil || task.UserID != userID {
		return nil, ErrTaskNotFound
	}
	return buildTaskView(task)
}

// ListTasks 任务历史
func ListTasks(userID, projectID int, tool, status string, page, pageSize int) ([]*TaskView, int64, error) {
	tasks, total, err := model.ListCanvasTasks(model.CanvasTaskListFilter{
		UserID: userID, ProjectID: projectID, Tool: tool, Status: status,
		Page: page, PageSize: pageSize,
	})
	if err != nil {
		return nil, 0, err
	}
	views := make([]*TaskView, 0, len(tasks))
	for _, task := range tasks {
		view, err := buildTaskView(task)
		if err != nil {
			continue
		}
		views = append(views, view)
	}
	return views, total, nil
}

// buildTaskView 组装前端视图（解析快照与结果）
func buildTaskView(task *model.CanvasTask) (*TaskView, error) {
	view := &TaskView{
		ID: task.ID, ProjectID: task.ProjectID, Tool: task.Tool, ToolLabel: toolLabel(task.Tool),
		Status: task.Status, Stage: task.Stage, Progress: task.Progress, Model: task.Model,
		Quota: task.Quota, SettledQuota: task.SettledQuota, BillingState: task.BillingState,
		Cancelable:      task.Status == model.CanvasTaskStatusPending,
		CancelRequested: task.CancelRequested,
		CreatedAt:       task.CreatedAt, UpdatedAt: task.UpdatedAt,
		StartedAt: task.StartedAt, FinishedAt: task.FinishedAt,
		ErrorCode: task.ErrorCode, ErrorMsg: task.ErrorMsg,
	}
	if task.InputSnapshot != "" {
		var snapshot TaskSnapshot
		if err := common.UnmarshalJsonStr(task.InputSnapshot, &snapshot); err == nil {
			view.Input = &snapshot
		}
	}
	if task.Result != "" {
		var result TaskResult
		if err := common.UnmarshalJsonStr(task.Result, &result); err == nil {
			view.Result = &result
		}
	}
	return view, nil
}

func toolLabel(tool string) string {
	if spec, ok := GetToolSpec(tool); ok {
		return spec.Label
	}
	return tool
}

// Cancel 取消任务：仅「已受理未派发」的任务可取消。
// 上游图片接口是同步调用，一旦派发就无法在服务端中止，因此如实返回不支持，
// 而不是伪造一个「已取消」但上游仍在计费的状态。
func Cancel(userID, taskID int) (*TaskView, error) {
	task, err := model.GetCanvasTaskByID(taskID)
	if err != nil || task.UserID != userID {
		return nil, ErrTaskNotFound
	}
	switch task.Status {
	case model.CanvasTaskStatusCanceled:
		return buildTaskView(task)
	case model.CanvasTaskStatusPending:
		claimed, err := model.ClaimCanvasTask(taskID, []string{model.CanvasTaskStatusPending}, model.CanvasTaskStatusCanceled)
		if err != nil {
			return nil, err
		}
		if !claimed {
			return nil, ErrCancelNotSupported
		}
		// 抢到锁后再退款：退款本身按流水去重，重复执行不会重复退
		task.Status = model.CanvasTaskStatusCanceled
		model.UpdateCanvasTaskFields(taskID, map[string]any{"stage": stageCanceled, "progress": 100, "error_msg": "用户取消"})
		refundTaskBilling(task, "用户取消")
		updated, err := model.GetCanvasTaskByID(taskID)
		if err != nil {
			return nil, err
		}
		return buildTaskView(updated)
	default:
		return nil, ErrCancelNotSupported
	}
}

// RepersistTask 从已知上游结果补存到自有存储，不重跑模型。
// 适用场景：上游已成功但转存失败（结果里保留了 24h 上游链接与 sources）。
func RepersistTask(userID, taskID int) (*TaskView, error) {
	task, err := model.GetCanvasTaskByID(taskID)
	if err != nil || task.UserID != userID {
		return nil, ErrTaskNotFound
	}
	if task.Status != model.CanvasTaskStatusSucceeded || task.Result == "" {
		return nil, errors.New("只有已成功且有结果的任务可以补存")
	}
	var result TaskResult
	if err := common.UnmarshalJsonStr(task.Result, &result); err != nil {
		return nil, err
	}
	changed := false
	for i := range result.Images {
		img := &result.Images[i]
		if strings.Contains(img.URL, "canvas/") || !isHTTPURL(img.URL) {
			continue
		}
		// 兜底链接仍是上游地址：尝试重新下载并转存
		name := fmt.Sprintf("repersist_%d_%d.%s", task.ID, i, img.Format)
		stored, storeErr := storeRemoteToCanvasBucket(img.URL, name, userID, task.ProjectID)
		if storeErr != nil {
			continue
		}
		img.URL = stored
		changed = true
	}
	if !changed {
		return buildTaskView(task)
	}
	payload, err := common.Marshal(result)
	if err != nil {
		return nil, err
	}
	if err := model.UpdateCanvasTaskFields(taskID, map[string]any{"result": string(payload)}); err != nil {
		return nil, err
	}
	updated, err := model.GetCanvasTaskByID(taskID)
	if err != nil {
		return nil, err
	}
	return buildTaskView(updated)
}

// RecoverTasks 进程启动后收敛中断任务：
//   - pending：尚未派发上游，安全重放；
//   - running：已派发给同步上游但进程中途退出，结果未知，转「待核对」，
//     既不重发（会重复计费）也不退款（上游可能已成功）。
func RecoverTasks() {
	tasks, err := model.ListUnfinishedCanvasTasks(500)
	if err != nil {
		common.SysError("读取未完成画布任务失败: " + err.Error())
		return
	}
	if len(tasks) == 0 {
		return
	}
	replayed, parked := 0, 0
	for _, task := range tasks {
		switch task.Status {
		case model.CanvasTaskStatusPending:
			replayed++
			asyncExecutor(task.ID)
		case model.CanvasTaskStatusRunning:
			parked++
			model.FinalizeCanvasTask(task.ID, model.CanvasTaskStatusReviewing, map[string]any{
				"stage": stageRestarted, "progress": 100,
				"error_code": "interrupted",
				"error_msg":  "服务重启导致执行中断，上游是否已受理未知：未重复提交、未退款，请核对后重新提交",
			})
		}
	}
	common.SysLog(fmt.Sprintf("画布任务恢复: 重放 %d 条, 转待核对 %d 条", replayed, parked))
}

// ToolList 返回能力列表（按注册表顺序）
func ToolList() []Capability { return Capabilities() }
