package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type modelsInfoResponse struct {
	Success bool                 `json:"success"`
	Object  string               `json:"object"`
	Data    []dto.ModelsInfoItem `json:"data"`
}

type modelInfoSettingsResponse struct {
	Success bool `json:"success"`
	Data    struct {
		LanguageModels []string          `json:"language_models"`
		Infos          []model.ModelInfo `json:"infos"`
	} `json:"data"`
}

// setupModelInfoControllerTest 自建可见模型清单：语言/图片/视频各一个名字线索模型。
// 开启自用模式跳过计费配置门槛，使清单只由 abilities 决定。
func setupModelInfoControllerTest(t *testing.T) {
	t.Helper()

	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.ModelInfo{}))

	originalSelfUse := operation_setting.SelfUseModeEnabled
	operation_setting.SelfUseModeEnabled = true
	t.Cleanup(func() {
		operation_setting.SelfUseModeEnabled = originalSelfUse
		model.InvalidatePricingCache()
	})

	require.NoError(t, db.Create(&model.User{
		Id:       1001,
		Username: "model-info-user",
		Password: "password",
		Group:    "default",
		Status:   common.UserStatusEnabled,
	}).Error)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "default", Model: "zz-info-chat", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "zz-info-image", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "zz-info-video", ChannelId: 1, Enabled: true},
	}).Error)
	model.InvalidatePricingCache()
}

func newModelInfoContext(t *testing.T, method, target string, body any) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	payload := ""
	if body != nil {
		raw, err := common.Marshal(body)
		require.NoError(t, err)
		payload = string(raw)
	}
	ctx.Request = httptest.NewRequest(method, target, strings.NewReader(payload))
	if body != nil {
		ctx.Request.Header.Set("Content-Type", "application/json")
	}
	ctx.Set("id", 1001)
	return ctx, recorder
}

func decodeModelsInfoResponse(t *testing.T, recorder *httptest.ResponseRecorder) modelsInfoResponse {
	t.Helper()

	require.Equal(t, http.StatusOK, recorder.Code)
	var payload modelsInfoResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
	require.True(t, payload.Success)
	require.Equal(t, "list", payload.Object)
	return payload
}

func TestListModelsInfoTypeFilterAndLanguageOnlyFields(t *testing.T) {
	setupModelInfoControllerTest(t)
	require.NoError(t, model.SaveModelInfos([]model.ModelInfo{
		{ModelName: "zz-info-chat", ContextWindow: 131072, MaxOutputTokens: 16384},
		// 图片模型即使被配置，对外也不得携带这两个字段
		{ModelName: "zz-info-image", ContextWindow: 999, MaxOutputTokens: 999},
	}))

	ctx, recorder := newModelInfoContext(t, http.MethodGet, "/v1/modelsinfo?type=all", nil)
	ListModelsInfo(ctx)
	all := decodeModelsInfoResponse(t, recorder)
	require.Len(t, all.Data, 3)
	byName := make(map[string]dto.ModelsInfoItem, len(all.Data))
	for _, item := range all.Data {
		byName[item.Id] = item
	}
	assert.Equal(t, model.ModelCategoryText, byName["zz-info-chat"].Type)
	assert.Equal(t, 131072, byName["zz-info-chat"].ContextWindow)
	assert.Equal(t, 16384, byName["zz-info-chat"].MaxOutputTokens)
	assert.Equal(t, model.ModelCategoryImage, byName["zz-info-image"].Type)
	assert.Zero(t, byName["zz-info-image"].ContextWindow)
	assert.Zero(t, byName["zz-info-image"].MaxOutputTokens)
	assert.Equal(t, model.ModelCategoryVideo, byName["zz-info-video"].Type)
	assert.Zero(t, byName["zz-info-video"].ContextWindow)

	for _, tc := range []struct {
		typeParam string
		wantIds   []string
	}{
		{typeParam: "text", wantIds: []string{"zz-info-chat"}},
		{typeParam: "image", wantIds: []string{"zz-info-image"}},
		{typeParam: "video", wantIds: []string{"zz-info-video"}},
	} {
		t.Run(tc.typeParam, func(t *testing.T) {
			ctx, recorder := newModelInfoContext(t, http.MethodGet, "/v1/modelsinfo?type="+tc.typeParam, nil)
			ListModelsInfo(ctx)
			payload := decodeModelsInfoResponse(t, recorder)
			ids := make([]string, 0, len(payload.Data))
			for _, item := range payload.Data {
				ids = append(ids, item.Id)
			}
			assert.Equal(t, tc.wantIds, ids)
		})
	}

	// language 不是合法取值，与任意非法值一样拒绝
	for _, invalidType := range []string{"bogus", "language"} {
		ctx, recorder = newModelInfoContext(t, http.MethodGet, "/v1/modelsinfo?type="+invalidType, nil)
		ListModelsInfo(ctx)
		assert.Equal(t, http.StatusBadRequest, recorder.Code)
	}
}

func TestUpdateModelInfoSettingsRoundTripAndClear(t *testing.T) {
	setupModelInfoControllerTest(t)

	ctx, recorder := newModelInfoContext(t, http.MethodPut, "/api/model_info", map[string]any{
		"infos": []model.ModelInfo{
			{ModelName: "zz-info-chat", ContextWindow: 1048576, MaxOutputTokens: 131072},
			{ModelName: "zz-info-image", ContextWindow: 0, MaxOutputTokens: 0},
		},
	})
	UpdateModelInfoSettings(ctx)
	require.Equal(t, http.StatusOK, recorder.Code)

	infos, err := model.GetAllModelInfos()
	require.NoError(t, err)
	require.Len(t, infos, 1)
	assert.Equal(t, "zz-info-chat", infos[0].ModelName)
	assert.Equal(t, 1048576, infos[0].ContextWindow)
	assert.Equal(t, 131072, infos[0].MaxOutputTokens)
	assert.Positive(t, infos[0].UpdatedTime)

	ctx, recorder = newModelInfoContext(t, http.MethodGet, "/api/model_info", nil)
	GetModelInfoSettings(ctx)
	require.Equal(t, http.StatusOK, recorder.Code)
	var settings modelInfoSettingsResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &settings))
	require.True(t, settings.Success)
	assert.Contains(t, settings.Data.LanguageModels, "zz-info-chat")
	assert.NotContains(t, settings.Data.LanguageModels, "zz-info-image")
	assert.NotContains(t, settings.Data.LanguageModels, "zz-info-video")
	require.Len(t, settings.Data.Infos, 1)

	// 全量替换：两个值都清零的条目被删除
	ctx, recorder = newModelInfoContext(t, http.MethodPut, "/api/model_info", map[string]any{
		"infos": []model.ModelInfo{{ModelName: "zz-info-chat"}},
	})
	UpdateModelInfoSettings(ctx)
	require.Equal(t, http.StatusOK, recorder.Code)
	infos, err = model.GetAllModelInfos()
	require.NoError(t, err)
	assert.Empty(t, infos)
}

func TestUpdateModelInfoSettingsValidation(t *testing.T) {
	setupModelInfoControllerTest(t)
	require.NoError(t, model.SaveModelInfos([]model.ModelInfo{
		{ModelName: "zz-info-chat", ContextWindow: 131072, MaxOutputTokens: 16384},
	}))

	for _, tc := range []struct {
		name  string
		infos []model.ModelInfo
	}{
		{name: "negative", infos: []model.ModelInfo{{ModelName: "zz-info-chat", ContextWindow: -1}}},
		{name: "over bound", infos: []model.ModelInfo{{ModelName: "zz-info-chat", MaxOutputTokens: maxModelInfoTokens + 1}}},
		{name: "duplicate", infos: []model.ModelInfo{{ModelName: "zz-info-chat"}, {ModelName: "zz-info-chat"}}},
		{name: "empty name", infos: []model.ModelInfo{{ModelName: "  "}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, recorder := newModelInfoContext(t, http.MethodPut, "/api/model_info", map[string]any{"infos": tc.infos})
			UpdateModelInfoSettings(ctx)
			assert.Equal(t, http.StatusBadRequest, recorder.Code)
		})
	}

	// 校验失败不得破坏已有配置
	infos, err := model.GetAllModelInfos()
	require.NoError(t, err)
	require.Len(t, infos, 1)
	assert.Equal(t, 131072, infos[0].ContextWindow)
}
