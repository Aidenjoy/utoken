package canvas

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 蒙版尺寸必须与工具要求的原图尺寸逐像素一致；不一致时在提交阶段就拒绝，
// 不能指望上游报错（上游只会笼统地返回处理失败，用户无从判断原因）。
func TestSubmitRejectsMaskSizeMismatch(t *testing.T) {
	env := setupCanvasTest(t)
	seedUser(t, 1, 10_000_000)
	seedArkChannel(t, testImageModel)
	project := newProject(t, 1)

	_, _, err := Submit(1, SubmitRequest{
		ProjectID: project.ID, Tool: ToolErase, IdempotencyKey: "erase-1",
		Images: []string{env.sourceImage()},
		Mask:   testPNGDataURL(t, 256, 256), // 原图 512x512
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrMaskSizeMismatch)

	task, _, err := Submit(1, SubmitRequest{
		ProjectID: project.ID, Tool: ToolErase, IdempotencyKey: "erase-2",
		Images: []string{env.sourceImage()},
		Mask:   testPNGDataURL(t, 512, 512),
	})
	require.NoError(t, err)
	assert.Equal(t, model.CanvasTaskStatusSucceeded, task.Status)
	assert.Equal(t, 512, task.Input.MaskWidth)
	assert.Equal(t, 512, task.Input.MaskHeight)
}

// Ark 图片生成接口没有蒙版参数：带蒙版提交必须显式拒绝，而不是被静默丢弃。
func TestSubmitRejectsMaskForArkTools(t *testing.T) {
	env := setupCanvasTest(t)
	seedUser(t, 1, 10_000_000)
	seedArkChannel(t, testImageModel)
	project := newProject(t, 1)

	_, _, err := Submit(1, SubmitRequest{
		ProjectID: project.ID, Tool: ToolPromptInpaint, IdempotencyKey: "inpaint-1",
		Prompt: "把天空换成晚霞", Images: []string{env.sourceImage()},
		Mask: testPNGDataURL(t, 512, 512),
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "不接受蒙版")
}

// 同一作用域（用户 + 项目）内：同键同参只产生一个任务，同键异参返回冲突。
func TestSubmitIsIdempotentPerScope(t *testing.T) {
	env := setupCanvasTest(t)
	seedUser(t, 1, 10_000_000)
	seedArkChannel(t, testImageModel)
	project := newProject(t, 1)

	req := SubmitRequest{
		ProjectID: project.ID, Tool: ToolTextToImage, IdempotencyKey: "same-key",
		Prompt: "一只猫",
	}
	first, reused, err := Submit(1, req)
	require.NoError(t, err)
	require.False(t, reused)

	second, reused, err := Submit(1, req)
	require.NoError(t, err)
	assert.True(t, reused, "同键同参应复用既有任务")
	assert.Equal(t, first.ID, second.ID)

	var count int64
	require.NoError(t, model.DB.Model(&model.CanvasTask{}).Count(&count).Error)
	assert.Equal(t, int64(1), count)

	changed := req
	changed.Prompt = "一只狗"
	_, _, err = Submit(1, changed)
	assert.ErrorIs(t, err, model.ErrCanvasIdempotencyConflict)

	// 另一个项目里同样的键属于不同作用域，应独立建任务
	other := newProject(t, 1)
	changed.ProjectID = other.ID
	changed.IdempotencyKey = "same-key"
	_, _, err = Submit(1, changed)
	require.NoError(t, err)
	_ = env
}

// 涂抹消除走 MediaKit：请求体字段与官方一致，结果转存到自有存储。
func TestEraseTaskRunsThroughMediaKit(t *testing.T) {
	env := setupCanvasTest(t)
	seedUser(t, 1, 10_000_000)
	seedArkChannel(t, testImageModel)
	project := newProject(t, 1)

	task, _, err := Submit(1, SubmitRequest{
		ProjectID: project.ID, Tool: ToolErase, IdempotencyKey: "erase-ok",
		Images: []string{env.sourceImage()}, Mask: testPNGDataURL(t, 512, 512),
	})
	require.NoError(t, err)
	require.Equal(t, model.CanvasTaskStatusSucceeded, task.Status)
	require.NotNil(t, task.Result)
	require.Len(t, task.Result.Images, 1)
	assert.Contains(t, task.Result.Images[0].URL, "/stored/", "结果必须转存到自有存储")
	assert.Equal(t, 512, task.Result.Images[0].Width)

	assert.Equal(t, env.sourceImage(), env.mkBody["image_url"])
	assert.Equal(t, "selected_area_erase", env.mkBody["standard_scene"])
	assert.Contains(t, fmt.Sprint(env.mkBody["mask_url"]), "/stored/mask_")
}

// Ark 工具经网关门回环转发：请求体与官方一致，且带上用户图片 Key。
func TestArkTaskForwardsThroughGateway(t *testing.T) {
	env := setupCanvasTest(t)
	seedUser(t, 1, 10_000_000)
	seedArkChannel(t, testImageModel)
	project := newProject(t, 1)

	env.arkHandler = func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1/images/generations", r.URL.Path)
		assert.NotEmpty(t, r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"` + testImageModel + `","data":[
			{"url":"` + env.imageSrv.URL + `/gen1.png","size":"512x512","output_format":"png"}]}`))
	}

	task, _, err := Submit(1, SubmitRequest{
		ProjectID: project.ID, Tool: ToolTextToImage, IdempotencyKey: "ark-1",
		Prompt: "夜海灯塔", Size: "2048x2048",
	})
	require.NoError(t, err)
	require.Equal(t, model.CanvasTaskStatusSucceeded, task.Status)
	require.Len(t, task.Result.Images, 1)
	assert.Contains(t, task.Result.Images[0].URL, "/stored/")
	assert.Equal(t, testImageModel, env.arkBody["model"])
	assert.Equal(t, "夜海灯塔", env.arkBody["prompt"])
	assert.Equal(t, "2048x2048", env.arkBody["size"])
	assert.Equal(t, false, env.arkBody["watermark"])
	assert.NotContains(t, env.arkBody, "image", "文生图不得下发 image 字段")
}

// 上游 5xx：结果未知 → 待核对，既不退款也不重发（重发会重复计费）。
func TestIndeterminateUpstreamEntersReviewing(t *testing.T) {
	env := setupCanvasTest(t)
	seedUser(t, 1, 10_000_000)
	seedArkChannel(t, testImageModel)
	project := newProject(t, 1)
	t.Setenv(envCanvasPricePrefix+"ERASE", "1000")

	env.mkHandler = func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"success":false,"error":{"code":"internal","message":"boom"}}`))
	}

	task, _, err := Submit(1, SubmitRequest{
		ProjectID: project.ID, Tool: ToolErase, IdempotencyKey: "erase-500",
		Images: []string{env.sourceImage()}, Mask: testPNGDataURL(t, 512, 512),
	})
	require.NoError(t, err)
	assert.Equal(t, model.CanvasTaskStatusReviewing, task.Status)
	assert.Equal(t, model.CanvasBillingPreConsumed, task.BillingState)
	assert.Equal(t, 10_000_000-1000, currentQuota(t, 1), "待核对不退款")
}

// 可判定的上游失败：退款且只退一次。
func TestDefiniteFailureRefundsOnce(t *testing.T) {
	env := setupCanvasTest(t)
	seedUser(t, 1, 10_000_000)
	seedArkChannel(t, testImageModel)
	project := newProject(t, 1)
	t.Setenv(envCanvasPricePrefix+"ERASE", "1000")

	env.mkHandler = func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"success":false,"error":{"code":"invalid_param","message":"bad mask"}}`))
	}

	task, _, err := Submit(1, SubmitRequest{
		ProjectID: project.ID, Tool: ToolErase, IdempotencyKey: "erase-400",
		Images: []string{env.sourceImage()}, Mask: testPNGDataURL(t, 512, 512),
	})
	require.NoError(t, err)
	assert.Equal(t, model.CanvasTaskStatusFailed, task.Status)
	assert.Equal(t, "invalid_param", task.ErrorCode)
	assert.Equal(t, 10_000_000, currentQuota(t, 1), "失败必须全额退款")

	// 再退一次不应产生任何资金变动
	stored, err := model.GetCanvasTaskByID(task.ID)
	require.NoError(t, err)
	refundTaskBilling(stored, "重复退款尝试")
	assert.Equal(t, 10_000_000, currentQuota(t, 1))
}

// 结算按实际结果张数补扣，且只结算一次。
func TestSettleChargesOnce(t *testing.T) {
	setupCanvasTest(t)
	seedUser(t, 1, 10_000_000)
	t.Setenv(envCanvasPricePrefix+"ERASE", "1000")

	task := &model.CanvasTask{
		UserID: 1, ProjectID: 1, Tool: ToolErase, IdempotencyKey: "settle-1",
		Status: model.CanvasTaskStatusRunning, BillingState: model.CanvasBillingNone,
	}
	inserted, err := model.InsertCanvasTask(task)
	require.NoError(t, err)
	require.NoError(t, reserveTaskBilling(inserted, 1))
	assert.Equal(t, 10_000_000-1000, currentQuota(t, 1), "提交时预扣一张")

	stored, err := model.GetCanvasTaskByID(inserted.ID)
	require.NoError(t, err)
	settleTaskBilling(stored, 2) // 上游实际返回 2 张
	assert.Equal(t, 10_000_000-2000, currentQuota(t, 1))

	stored, err = model.GetCanvasTaskByID(inserted.ID)
	require.NoError(t, err)
	assert.Equal(t, model.CanvasBillingSettled, stored.BillingState)
	settleTaskBilling(stored, 2) // 重复结算
	assert.Equal(t, 10_000_000-2000, currentQuota(t, 1))

	var ledgerCount int64
	require.NoError(t, model.DB.Model(&model.CanvasLedger{}).
		Where("task_id = ? AND kind = ?", inserted.ID, model.CanvasLedgerSettle).Count(&ledgerCount).Error)
	assert.Equal(t, int64(1), ledgerCount)
}

// 取消能力：只有「已受理未派发」的任务可取消；已派发的同步任务如实返回不支持。
func TestCancelOnlyBeforeDispatch(t *testing.T) {
	env := setupCanvasTest(t)
	seedUser(t, 1, 10_000_000)
	seedArkChannel(t, testImageModel)
	project := newProject(t, 1)
	t.Setenv(envCanvasPricePrefix+"ERASE", "1000")

	// 挂起执行器：任务停在 pending，模拟「已受理未派发」
	asyncExecutor = func(int) {}
	defer func() { asyncExecutor = func(taskID int) { executeTask(taskID) } }()

	task, _, err := Submit(1, SubmitRequest{
		ProjectID: project.ID, Tool: ToolErase, IdempotencyKey: "erase-cancel",
		Images: []string{env.sourceImage()}, Mask: testPNGDataURL(t, 512, 512),
	})
	require.NoError(t, err)
	require.Equal(t, model.CanvasTaskStatusPending, task.Status)
	assert.True(t, task.Cancelable)
	assert.Equal(t, 10_000_000-1000, currentQuota(t, 1))

	canceled, err := Cancel(1, task.ID)
	require.NoError(t, err)
	assert.Equal(t, model.CanvasTaskStatusCanceled, canceled.Status)
	assert.Equal(t, 10_000_000, currentQuota(t, 1), "取消后退预扣")

	// 再次取消是幂等的
	canceled, err = Cancel(1, task.ID)
	require.NoError(t, err)
	assert.Equal(t, model.CanvasTaskStatusCanceled, canceled.Status)
	assert.Equal(t, 10_000_000, currentQuota(t, 1))

	// 已派发（running）的任务无法取消
	stored, err := model.GetCanvasTaskByID(task.ID)
	require.NoError(t, err)
	require.NoError(t, model.UpdateCanvasTaskFields(stored.ID, map[string]any{"status": model.CanvasTaskStatusRunning}))
	_, err = Cancel(1, task.ID)
	assert.ErrorIs(t, err, ErrCancelNotSupported)
}

// 上游已成功但转存失败时，可以从已知结果补存，不重跑模型。
func TestRepersistUsesKnownResult(t *testing.T) {
	env := setupCanvasTest(t)
	seedUser(t, 1, 10_000_000)
	seedArkChannel(t, testImageModel)
	project := newProject(t, 1)

	task := &model.CanvasTask{
		UserID: 1, ProjectID: project.ID, Tool: ToolTextToImage, IdempotencyKey: "rp-1",
		Status: model.CanvasTaskStatusSucceeded, BillingState: model.CanvasBillingNone,
		Result: fmt.Sprintf(`{"images":[{"url":"%s/temp.png","width":512,"height":512,"format":"png"}]}`, env.imageSrv.URL),
	}
	inserted, err := model.InsertCanvasTask(task)
	require.NoError(t, err)

	view, err := RepersistTask(1, inserted.ID)
	require.NoError(t, err)
	require.Len(t, view.Result.Images, 1)
	assert.Contains(t, view.Result.Images[0].URL, "/stored/repersist_")
}

// 重启恢复：未派发的重放；已派发的转待核对，不重发也不退款。
func TestRecoverTasks(t *testing.T) {
	env := setupCanvasTest(t)
	seedUser(t, 1, 10_000_000)
	seedArkChannel(t, testImageModel)
	project := newProject(t, 1)
	_ = env

	running := &model.CanvasTask{
		UserID: 1, ProjectID: project.ID, Tool: ToolErase, IdempotencyKey: "rc-run",
		Status: model.CanvasTaskStatusRunning, BillingState: model.CanvasBillingNone,
	}
	inserted, err := model.InsertCanvasTask(running)
	require.NoError(t, err)

	RecoverTasks()

	stored, err := model.GetCanvasTaskByID(inserted.ID)
	require.NoError(t, err)
	assert.Equal(t, model.CanvasTaskStatusReviewing, stored.Status)
	assert.Equal(t, "interrupted", stored.ErrorCode)
}

// 归属校验：他人的项目与任务一律按「不存在」处理，不泄露存在性。
func TestOwnershipIsolation(t *testing.T) {
	env := setupCanvasTest(t)
	seedUser(t, 1, 10_000_000)
	seedUser(t, 2, 10_000_000)
	seedArkChannel(t, testImageModel)
	project := newProject(t, 1)

	_, err := GetProject(2, project.ID)
	require.Error(t, err)

	task, _, err := Submit(1, SubmitRequest{
		ProjectID: project.ID, Tool: ToolTextToImage, IdempotencyKey: "own-1", Prompt: "x",
	})
	require.NoError(t, err)
	_, err = GetTask(2, task.ID)
	assert.ErrorIs(t, err, ErrTaskNotFound)
	_, err = Cancel(2, task.ID)
	assert.ErrorIs(t, err, ErrTaskNotFound)

	// 他人素材不能作为输入
	otherAsset := &model.SourceAsset{UserID: 2, Name: "别人的图", AssetType: model.AssetTypeImage,
		SourceURL: env.sourceImage(), Status: model.AssetStatusActive}
	require.NoError(t, otherAsset.Insert())
	_, _, err = Submit(1, SubmitRequest{
		ProjectID: project.ID, Tool: ToolImageRefSingle, IdempotencyKey: "own-2",
		Prompt: "x", Images: []string{"asset:" + otherAsset.RefID},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "素材不存在")
}

// 能力接口：未配置渠道时工具不可用且带原因；未配置 MediaKit Key 时四类图像工具不可用。
func TestCapabilitiesReportUnavailableReasons(t *testing.T) {
	setupCanvasTest(t)
	resetCanvasTables(t)
	t.Setenv(envCanvasMediaKitKey, "")

	for _, cap := range Capabilities() {
		assert.False(t, cap.Available, "无渠道时 %s 应不可用", cap.Tool)
		assert.NotEmpty(t, cap.UnavailableReason)
	}

	seedArkChannel(t, testImageModel)
	t.Setenv(envCanvasMediaKitKey, "")
	for _, cap := range Capabilities() {
		if cap.Upstream == UpstreamArk {
			assert.True(t, cap.Available, "%s 应可用", cap.Tool)
			assert.Equal(t, testImageModel, cap.Model)
			assert.Positive(t, cap.ChannelID)
			continue
		}
		assert.False(t, cap.Available)
		assert.Contains(t, cap.UnavailableReason, "CANVAS_MEDIAKIT_API_KEY")
	}

	// 未登记的模型整体判不可用
	t.Setenv(envCanvasImageModel, "unknown-model-x")
	for _, cap := range Capabilities() {
		if cap.Upstream == UpstreamArk {
			assert.False(t, cap.Available)
			assert.Contains(t, cap.UnavailableReason, "未登记")
		}
	}
}
