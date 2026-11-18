package canvas

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// ===== 测试脚手架 =====
// 全部使用：SQLite 内存库 + 本地 mock 上游 + 本地存储替身。
// 不访问任何真实渠道、真实 TOS 与生产队列；未配置的通道在能力接口中判为不可用。

const testImageModel = "doubao-seedream-4-0-250828"

// testEnv 一次测试的上下文
type testEnv struct {
	t          *testing.T
	db         *gorm.DB
	imageSrv   *httptest.Server // 提供图片字节（源图 / 上游结果 / 转存目标）
	relaySrv   *httptest.Server // 模拟网关 /v1/images/generations
	mediaKit   *httptest.Server // 模拟 AI MediaKit
	relayCalls int
	arkHandler http.HandlerFunc
	mkHandler  http.HandlerFunc
	arkBody    map[string]any
	mkBody     map[string]any
}

func TestMain(m *testing.M) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		panic("failed to open test db: " + err.Error())
	}
	model.DB = db
	model.LOG_DB = db
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	common.BatchUpdateEnabled = false
	common.LogConsumeEnabled = true
	model.InitCol()

	sqlDB, err := db.DB()
	if err != nil {
		panic(err)
	}
	sqlDB.SetMaxOpenConns(1)

	if err := db.AutoMigrate(
		&model.User{}, &model.Channel{}, &model.Ability{}, &model.Token{}, &model.Log{},
		&model.CanvasProject{}, &model.CanvasTask{}, &model.CanvasLedger{}, &model.SourceAsset{},
	); err != nil {
		panic("failed to migrate test schema: " + err.Error())
	}
	os.Exit(m.Run())
}

// setupCanvasTest 准备隔离的测试环境：清库、注入本地存储替身与同步执行器、
// 启动 mock 图片服务 / mock 网关 / mock MediaKit。
func setupCanvasTest(t *testing.T) *testEnv {
	t.Helper()
	env := &testEnv{t: t, db: model.DB}
	resetCanvasTables(t)

	env.imageSrv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 任意路径都返回一张 512x512 PNG，既当源图也当上游结果
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(testPNG(t, 512, 512))
	}))
	t.Cleanup(env.imageSrv.Close)

	env.relaySrv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		env.relayCalls++
		var payload map[string]any
		_ = common.DecodeJson(r.Body, &payload)
		env.arkBody = payload
		handler := env.arkHandler
		if handler == nil {
			handler = defaultArkHandler
		}
		handler(w, r)
	}))
	t.Cleanup(env.relaySrv.Close)

	env.mediaKit = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		_ = common.DecodeJson(r.Body, &payload)
		env.mkBody = payload
		handler := env.mkHandler
		if handler == nil {
			handler = env.defaultMediaKitHandler
		}
		handler(w, r)
	}))
	t.Cleanup(env.mediaKit.Close)

	t.Setenv(envCanvasImageModel, testImageModel)
	t.Setenv(envCanvasRelayBase, env.relaySrv.URL)
	t.Setenv(envCanvasMediaKitBase, env.mediaKit.URL)
	t.Setenv(envCanvasMediaKitKey, "test-mediakit-key")
	t.Setenv("CANVAS_UPSTREAM_TIMEOUT", "10")

	origUpload := uploadToStorage
	uploadToStorage = func(data []byte, filename string, userID, projectID int) (string, error) {
		if len(data) == 0 {
			return "", fmt.Errorf("empty")
		}
		return env.imageSrv.URL + "/stored/" + filename, nil
	}
	origExecutor := asyncExecutor
	asyncExecutor = func(taskID int) { executeTask(taskID) }
	t.Cleanup(func() {
		uploadToStorage = origUpload
		asyncExecutor = origExecutor
		os.Unsetenv(envCanvasPricePrefix + "ERASE")
	})
	return env
}

func (e *testEnv) defaultMediaKitHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(fmt.Sprintf(
		`{"success":true,"task_id":"mk-1","task_type":"tools-sync","request_id":"req-1",
		  "result":{"image_url":"%s/out.png","image_width":512,"image_height":512,"image_format":"png"}}`,
		e.imageSrv.URL)))
}

func defaultArkHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"model":"` + testImageModel + `","created":1,
		"data":[{"url":"` + "http://127.0.0.1:1" + `/never.png","size":"512x512","output_format":"png"}],
		"usage":{"generated_images":1}}`))
}

// resetCanvasTables 清空画布相关表，保证用例之间互不影响。
func resetCanvasTables(t *testing.T) {
	t.Helper()
	for _, table := range []string{"canvas_ledgers", "canvas_tasks", "canvas_projects", "source_assets", "channels", "abilities", "tokens", "users"} {
		require.NoError(t, model.DB.Exec("DELETE FROM "+table).Error)
	}
}

// testPNG 生成一张纯色 PNG（用于源图/蒙版/上游结果）
func testPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: 255, G: 255, B: 255, A: 255})
		}
	}
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, img))
	return buf.Bytes()
}

func testPNGDataURL(t *testing.T, width, height int) string {
	t.Helper()
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(testPNG(t, width, height))
}

// seedUser 建一个用户（额度用于计费断言）
func seedUser(t *testing.T, id, quota int) {
	t.Helper()
	require.NoError(t, model.DB.Create(&model.User{
		Id: id, Username: fmt.Sprintf("canvas_user_%d", id), Password: "x",
		Quota: quota, Status: common.UserStatusEnabled, Group: "default", AffCode: fmt.Sprintf("aff%d", id),
	}).Error)
}

// seedArkChannel 建一个承载图片模型的火山方舟图片渠道
func seedArkChannel(t *testing.T, modelName string) *model.Channel {
	t.Helper()
	ch := &model.Channel{
		Type: constant.ChannelTypeVolcEngineImage, Key: "test-key",
		Name: "ark-test", Status: common.ChannelStatusEnabled, Models: modelName, Group: "default",
	}
	require.NoError(t, model.DB.Create(ch).Error)
	return ch
}

// newProject 建一个画布项目
func newProject(t *testing.T, userID int) *model.CanvasProject {
	t.Helper()
	project, err := CreateProject(userID, CreateProjectRequest{Title: "测试画布"})
	require.NoError(t, err)
	return project
}

// sourceImage 返回 mock 图片服务上的源图地址
func (e *testEnv) sourceImage() string { return e.imageSrv.URL + "/source.png" }

// currentQuota 读取用户当前额度
func currentQuota(t *testing.T, userID int) int {
	t.Helper()
	quota, err := model.GetUserQuota(userID, true)
	require.NoError(t, err)
	return quota
}
