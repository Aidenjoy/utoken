package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// setupDistributeResolutionTest 迁移选路依赖的表并造两个渠道：高优先级渠道做不了
// 4k，低优先级渠道全分辨率可用。这正是「4K 请求必须绕过优先级更高的渠道」的场景。
func setupDistributeResolutionTest(t *testing.T) {
	t.Helper()
	require.NoError(t, i18n.Init())
	model.InitCol()
	require.NoError(t, model.DB.AutoMigrate(&model.Channel{}, &model.Ability{}))

	savedCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() {
		common.MemoryCacheEnabled = savedCache
		model.DB.Exec("DELETE FROM channels")
		model.DB.Exec("DELETE FROM abilities")
	})

	for _, ch := range []struct {
		id       int
		priority int64
		setting  string
	}{
		{80, 9, `{"resolution_blacklist":{"seedance-lite":["4k"]}}`},
		{81, 1, ""},
	} {
		channel := &model.Channel{
			Id: ch.id, Name: "ch", Key: "sk-test", Status: common.ChannelStatusEnabled,
			Priority: common.GetPointer(ch.priority),
		}
		if ch.setting != "" {
			channel.Setting = common.GetPointer(ch.setting)
		}
		require.NoError(t, model.DB.Create(channel).Error)
		// 选路按 abilities.priority 分层（同层内加权随机），渠道行的 priority 供
		// 智能素材挑候选用；两处必须一致，否则选路结果不确定。
		require.NoError(t, model.DB.Create(&model.Ability{
			Group: "default", Model: "seedance-lite", ChannelId: ch.id, Enabled: true,
			Priority: common.GetPointer(ch.priority),
		}).Error)
	}
}

// TestDistributeSelectsChannelByResolution 视频提交首次选路必须带上请求分辨率：
// 控制器只在重试时才重新选路，首次尝试直接复用这里选定的渠道，漏传分辨率就等于
// (渠道 × 模型 × 分辨率) 能力过滤在主链路上完全不生效。
func TestDistributeSelectsChannelByResolution(t *testing.T) {
	tests := []struct {
		name       string
		resolution string
		wantId     int
	}{
		{"480p goes to the higher priority channel", `"resolution":"480p",`, 80},
		{"4k skips the channel that cannot do 4k", `"resolution":"4k",`, 81},
		{"no resolution keeps priority order", "", 80},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setupDistributeResolutionTest(t)
			gin.SetMode(gin.TestMode)
			body := `{"model":"seedance-lite",` + tt.resolution + `"duration":4}`

			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/video/generations", strings.NewReader(body))
			c.Request.Header.Set("Content-Type", "application/json")
			c.Request.ContentLength = int64(len(body))
			common.SetContextKey(c, constant.ContextKeyUsingGroup, "default")
			t.Cleanup(func() { common.CleanupBodyStorage(c) })

			Distribute()(c)

			require.False(t, c.IsAborted(), "response: %s", w.Body.String())
			assert.Equal(t, tt.wantId, common.GetContextKeyInt(c, constant.ContextKeyChannelId))
		})
	}
}

// TestDistributeReportsResolutionWhenNoChannelCanServe 全部渠道都做不了请求分辨率时，
// 报错要点名分辨率，否则用户只看到「无可用渠道」，无法判断该降档还是找管理员。
func TestDistributeReportsResolutionWhenNoChannelCanServe(t *testing.T) {
	setupDistributeResolutionTest(t)
	require.NoError(t, model.DB.Model(&model.Channel{}).Where("id = ?", 81).
		Update("setting", `{"resolution_blacklist":{"seedance-lite":["4k"]}}`).Error)

	gin.SetMode(gin.TestMode)
	body := `{"model":"seedance-lite","resolution":"4k"}`
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/video/generations", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Request.ContentLength = int64(len(body))
	common.SetContextKey(c, constant.ContextKeyUsingGroup, "default")
	t.Cleanup(func() { common.CleanupBodyStorage(c) })

	Distribute()(c)

	require.True(t, c.IsAborted())
	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	assert.Contains(t, w.Body.String(), "4k")
}
