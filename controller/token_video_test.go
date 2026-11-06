package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const controllerVideoModel = "doubao-seedance-2-0"

type videoTokenAPIItem struct {
	ID                 int    `json:"id"`
	Name               string `json:"name"`
	ChannelID          int    `json:"channel_id"`
	KeyType            string `json:"key_type"`
	VideoModel         string `json:"video_model"`
	Video4K            bool   `json:"video_4k"`
	Group              string `json:"group"`
	ModelLimitsEnabled bool   `json:"model_limits_enabled"`
	ModelLimits        string `json:"model_limits"`
}

type videoTokenPage struct {
	Items []videoTokenAPIItem `json:"items"`
}

func setupVideoTokenControllerTest(t *testing.T) *gorm.DB {
	t.Helper()
	db := setupTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Channel{}, &model.Ability{}, &model.Agent{}))
	model.InitCol()
	oldMemoryCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() {
		common.MemoryCacheEnabled = oldMemoryCache
	})
	return db
}

func seedVideoTokenUser(t *testing.T, db *gorm.DB, id, role, agentID int) {
	t.Helper()
	require.NoError(t, db.Create(&model.User{
		Id:       id,
		Username: fmt.Sprintf("video-token-user-%d", id),
		AffCode:  fmt.Sprintf("video-token-aff-%d", id),
		Role:     role,
		Status:   common.UserStatusEnabled,
		Group:    "default",
		AgentId:  agentID,
	}).Error)
}

func videoTokenChannelSetting(t *testing.T, modelName string, discount *float64, supports4K bool) string {
	t.Helper()
	payload, err := common.Marshal(dto.ChannelSettings{
		ModelRouteConfigs: map[string]dto.ChannelModelRouteConfig{
			modelName: {Discount: discount, Supports4K: supports4K},
		},
	})
	require.NoError(t, err)
	return string(payload)
}

func seedVideoTokenChannel(t *testing.T, db *gorm.DB, id int, discount *float64, supports4K bool) {
	t.Helper()
	seedVideoTokenModelChannel(t, db, id, controllerVideoModel, discount, supports4K)
}

func seedVideoTokenModelChannel(t *testing.T, db *gorm.DB, id int, modelName string, discount *float64, supports4K bool) {
	t.Helper()
	mappingPayload, err := common.Marshal(map[string]string{modelName: modelName + "-upstream"})
	require.NoError(t, err)
	mapping := string(mappingPayload)
	otherSettings, err := common.Marshal(dto.ChannelOtherSettings{AssetUploadProtocol: dto.AssetUploadProtocolRelay})
	require.NoError(t, err)
	setting := videoTokenChannelSetting(t, modelName, discount, supports4K)
	require.NoError(t, db.Create(&model.Channel{
		Id:            id,
		Name:          fmt.Sprintf("video-token-channel-%d", id),
		Key:           "sk-video-token-test",
		Status:        common.ChannelStatusEnabled,
		Group:         "default",
		Models:        modelName,
		ModelMapping:  &mapping,
		Setting:       &setting,
		OtherSettings: string(otherSettings),
	}).Error)
	require.NoError(t, db.Create(&model.Ability{
		Group:     "default",
		Model:     modelName,
		ChannelId: id,
		Enabled:   true,
	}).Error)
}

func videoTokenDiscount(value float64) *float64 {
	return &value
}

func createVideoToken(t *testing.T, userID int, body map[string]any) videoTokenAPIItem {
	t.Helper()
	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/token/", body, userID)
	AddToken(ctx)
	response := decodeAPIResponse(t, recorder)
	require.True(t, response.Success, response.Message)
	var item videoTokenAPIItem
	require.NoError(t, common.Unmarshal(response.Data, &item))
	return item
}

func loadVideoToken(t *testing.T, db *gorm.DB, id int) model.Token {
	t.Helper()
	var token model.Token
	require.NoError(t, db.First(&token, id).Error)
	return token
}

func TestAddVideoTokenCreatesSnapshotAndIgnoresInjectedRouting(t *testing.T) {
	db := setupVideoTokenControllerTest(t)
	seedVideoTokenUser(t, db, 1, common.RoleCommonUser, 0)
	seedVideoTokenChannel(t, db, 1, videoTokenDiscount(8), false)
	seedVideoTokenChannel(t, db, 2, videoTokenDiscount(9), true)

	created := createVideoToken(t, 1, map[string]any{
		"name":                 "standard-video",
		"key_type":             model.TokenKeyTypeVideo,
		"video_model":          controllerVideoModel,
		"video_4k":             false,
		"channel_id":           999,
		"model_limits_enabled": false,
		"model_limits":         "gpt-4o,doubao-seedance-2-5",
		"group":                "default",
		"expired_time":         -1,
		"unlimited_quota":      true,
	})
	assert.Zero(t, created.ChannelID, "ordinary create response must hide channel")
	stored := loadVideoToken(t, db, created.ID)
	assert.Equal(t, 1, stored.ChannelId)
	assert.Equal(t, model.TokenKeyTypeVideo, stored.KeyType)
	assert.Equal(t, controllerVideoModel, stored.VideoModel)
	assert.False(t, stored.Video4K)
	assert.True(t, stored.ModelLimitsEnabled)
	assert.Equal(t, controllerVideoModel, stored.ModelLimits)

	// 创建后折扣变化只影响新 Key，不回写已有 Key 的渠道快照。
	newSetting := videoTokenChannelSetting(t, controllerVideoModel, videoTokenDiscount(9.5), false)
	require.NoError(t, db.Model(&model.Channel{}).Where("id = ?", 1).Update("setting", newSetting).Error)
	second := createVideoToken(t, 1, map[string]any{
		"name":            "after-discount-change",
		"key_type":        model.TokenKeyTypeVideo,
		"video_model":     controllerVideoModel,
		"group":           "default",
		"expired_time":    -1,
		"unlimited_quota": true,
	})
	assert.Equal(t, 2, loadVideoToken(t, db, second.ID).ChannelId)
	assert.Equal(t, 1, loadVideoToken(t, db, created.ID).ChannelId)
}

func TestAddVideoTokenAsAdminUsesTargetUserPermissions(t *testing.T) {
	db := setupVideoTokenControllerTest(t)
	seedVideoTokenUser(t, db, 10, common.RoleAdminUser, 0)
	seedVideoTokenUser(t, db, 2, common.RoleCommonUser, 1)
	require.NoError(t, db.Create(&model.Agent{
		Id:             1,
		UserId:         99,
		ModelDiscounts: `{"doubao-seedance-2-0":0.8}`,
		Status:         model.AgentStatusEnabled,
	}).Error)
	seedVideoTokenChannel(t, db, 1, videoTokenDiscount(8), true)
	seedVideoTokenModelChannel(t, db, 2, "doubao-seedance-2-5", videoTokenDiscount(1), true)

	deniedCtx, deniedRecorder := newAuthenticatedContext(t, http.MethodPost, "/api/token/", map[string]any{
		"user_id":         2,
		"name":            "outside-agent-allowlist",
		"key_type":        model.TokenKeyTypeVideo,
		"video_model":     "doubao-seedance-2-5",
		"group":           "default",
		"expired_time":    -1,
		"unlimited_quota": true,
	}, 10)
	AddToken(deniedCtx)
	assert.False(t, decodeAPIResponse(t, deniedRecorder).Success)
	var deniedCount int64
	require.NoError(t, db.Model(&model.Token{}).Where("user_id = ?", 2).Count(&deniedCount).Error)
	assert.Zero(t, deniedCount)

	created := createVideoToken(t, 10, map[string]any{
		"user_id":         2,
		"name":            "target-user-video",
		"key_type":        model.TokenKeyTypeVideo,
		"video_model":     controllerVideoModel,
		"video_4k":        true,
		"group":           "default",
		"expired_time":    -1,
		"unlimited_quota": true,
	})
	assert.Equal(t, 1, created.ChannelID, "admin response keeps channel visible")
	stored := loadVideoToken(t, db, created.ID)
	assert.Equal(t, 2, stored.UserId)
	assert.Equal(t, controllerVideoModel, stored.ModelLimits)
}

func TestVideoTokenResponsesHideChannelFromOrdinaryUsers(t *testing.T) {
	db := setupVideoTokenControllerTest(t)
	seedVideoTokenUser(t, db, 1, common.RoleCommonUser, 0)
	seedVideoTokenUser(t, db, 10, common.RoleAdminUser, 0)
	token := seedToken(t, db, 1, "masked-video", "video-token-key-123456")
	require.NoError(t, db.Model(token).Updates(map[string]any{
		"key_type":             model.TokenKeyTypeVideo,
		"video_model":          controllerVideoModel,
		"video_4k":             false,
		"channel_id":           7,
		"model_limits_enabled": true,
		"model_limits":         controllerVideoModel,
	}).Error)

	t.Run("list", func(t *testing.T) {
		ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/token/?p=1&size=10", nil, 1)
		GetAllTokens(ctx)
		response := decodeAPIResponse(t, recorder)
		require.True(t, response.Success, response.Message)
		var page videoTokenPage
		require.NoError(t, common.Unmarshal(response.Data, &page))
		require.Len(t, page.Items, 1)
		assert.Zero(t, page.Items[0].ChannelID)
	})

	t.Run("search", func(t *testing.T) {
		ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/token/search?keyword=masked-video&p=1&size=10", nil, 1)
		SearchTokens(ctx)
		response := decodeAPIResponse(t, recorder)
		require.True(t, response.Success, response.Message)
		var page videoTokenPage
		require.NoError(t, common.Unmarshal(response.Data, &page))
		require.Len(t, page.Items, 1)
		assert.Zero(t, page.Items[0].ChannelID)
	})

	t.Run("detail and admin visibility", func(t *testing.T) {
		for _, testCase := range []struct {
			userID      int
			wantChannel int
		}{{userID: 1, wantChannel: 0}, {userID: 10, wantChannel: 7}} {
			ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/token/"+strconv.Itoa(token.Id), nil, testCase.userID)
			ctx.Params = gin.Params{{Key: "id", Value: strconv.Itoa(token.Id)}}
			GetToken(ctx)
			response := decodeAPIResponse(t, recorder)
			require.True(t, response.Success, response.Message)
			var item videoTokenAPIItem
			require.NoError(t, common.Unmarshal(response.Data, &item))
			assert.Equal(t, testCase.wantChannel, item.ChannelID)
		}
	})

	t.Run("ordinary update masks channel and preserves video configuration", func(t *testing.T) {
		ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/token/", map[string]any{
			"id":                   token.Id,
			"name":                 "ordinary-update",
			"status":               common.TokenStatusEnabled,
			"expired_time":         -1,
			"unlimited_quota":      true,
			"key_type":             model.TokenKeyTypeLanguage,
			"video_model":          "doubao-seedance-2-5",
			"video_4k":             true,
			"channel_id":           99,
			"group":                "vip",
			"model_limits_enabled": false,
			"model_limits":         "gpt-4o,doubao-seedance-2-5",
		}, 1)
		UpdateToken(ctx)
		response := decodeAPIResponse(t, recorder)
		require.True(t, response.Success, response.Message)
		var item videoTokenAPIItem
		require.NoError(t, common.Unmarshal(response.Data, &item))
		assert.Zero(t, item.ChannelID)

		stored := loadVideoToken(t, db, token.Id)
		assert.Equal(t, "ordinary-update", stored.Name)
		assert.Equal(t, model.TokenKeyTypeVideo, stored.KeyType)
		assert.Equal(t, controllerVideoModel, stored.VideoModel)
		assert.False(t, stored.Video4K)
		assert.Equal(t, "default", stored.Group)
		assert.Equal(t, 7, stored.ChannelId)
		assert.True(t, stored.ModelLimitsEnabled)
		assert.Equal(t, controllerVideoModel, stored.ModelLimits)
	})

	t.Run("ordinary user cannot reassign channel", func(t *testing.T) {
		ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/token/?channel_only=true", map[string]any{
			"id":              token.Id,
			"channel_id":      99,
			"unlimited_quota": true,
			"expired_time":    -1,
		}, 1)
		UpdateToken(ctx)
		assert.False(t, decodeAPIResponse(t, recorder).Success)
		assert.Equal(t, 7, loadVideoToken(t, db, token.Id).ChannelId)
	})
}

func TestAdminVideoTokenReassignmentChecksCapabilities(t *testing.T) {
	db := setupVideoTokenControllerTest(t)
	seedVideoTokenUser(t, db, 1, common.RoleCommonUser, 0)
	seedVideoTokenUser(t, db, 10, common.RoleAdminUser, 0)
	seedVideoTokenChannel(t, db, 1, nil, false)
	seedVideoTokenChannel(t, db, 2, nil, true)
	seedVideoTokenChannel(t, db, 3, nil, true)
	token := seedToken(t, db, 1, "reassign-video", "reassign-video-key-123")
	require.NoError(t, db.Model(token).Updates(map[string]any{
		"key_type":             model.TokenKeyTypeVideo,
		"video_model":          controllerVideoModel,
		"video_4k":             true,
		"channel_id":           2,
		"model_limits_enabled": true,
		"model_limits":         controllerVideoModel,
	}).Error)

	deniedCtx, deniedRecorder := newAuthenticatedContext(t, http.MethodPut, "/api/token/?channel_only=true", map[string]any{
		"id":              token.Id,
		"channel_id":      1,
		"unlimited_quota": true,
		"expired_time":    -1,
	}, 10)
	UpdateToken(deniedCtx)
	assert.False(t, decodeAPIResponse(t, deniedRecorder).Success)
	assert.Equal(t, 2, loadVideoToken(t, db, token.Id).ChannelId)

	allowedCtx, allowedRecorder := newAuthenticatedContext(t, http.MethodPut, "/api/token/?channel_only=true", map[string]any{
		"id":              token.Id,
		"channel_id":      3,
		"unlimited_quota": true,
		"expired_time":    -1,
	}, 10)
	UpdateToken(allowedCtx)
	response := decodeAPIResponse(t, allowedRecorder)
	require.True(t, response.Success, response.Message)
	var item videoTokenAPIItem
	require.NoError(t, common.Unmarshal(response.Data, &item))
	assert.Equal(t, 3, item.ChannelID)
	assert.Equal(t, 3, loadVideoToken(t, db, token.Id).ChannelId)
}
