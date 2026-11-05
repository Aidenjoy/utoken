package controller

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// 官方兼容素材库 API 的契约回归：聚焦不依赖真实上游的确定性路径——
// 官方信封字段、状态词表映射、多租户隔离（跨用户 Get→NotFound）、入参校验、
// 归属前置的 NotFound。Create/Update/Delete 的「成功」路径需真实 ark_official
// 上游，按计划验证第 3 步走端到端手测，此处不做网络依赖测试。

// setupArkAssetControllerDB 开一个独立内存库并迁移官方 API 用到的表。
func setupArkAssetControllerDB(t *testing.T) *gorm.DB {
	t.Helper()
	gin.SetMode(gin.TestMode)
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.RedisEnabled = false

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	model.LOG_DB = db
	require.NoError(t, db.AutoMigrate(&model.AssetGroup{}, &model.Asset{}, &model.Channel{}))

	t.Cleanup(func() {
		if sqlDB, e := db.DB(); e == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

// newArkAssetContext 构造一个已鉴权（userId 已写入）的 gin 上下文，
// body 同时写入 Request.Body 与中间件约定的 ArkRawBodyKey（分发器从后者取 body）。
func newArkAssetContext(t *testing.T, action string, userID int, body any) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	var raw []byte
	if body != nil {
		b, err := common.Marshal(body)
		require.NoError(t, err)
		raw = b
	}
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/?Action="+action+"&Version=2024-01-01", bytes.NewReader(raw))
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Set("id", userID)
	ctx.Set(middleware.ArkRegionKey, "cn-beijing")
	ctx.Set(middleware.ArkRawBodyKey, raw)
	return ctx, recorder
}

// arkEnvelope 官方响应信封；Error 为 nil 表示成功响应。
type arkEnvelope struct {
	ResponseMetadata struct {
		RequestId string `json:"RequestId"`
		Action    string `json:"Action"`
		Version   string `json:"Version"`
		Service   string `json:"Service"`
		Region    string `json:"Region"`
		Error     *struct {
			CodeN   int    `json:"CodeN"`
			Code    string `json:"Code"`
			Message string `json:"Message"`
		} `json:"Error"`
	} `json:"ResponseMetadata"`
	Result json.RawMessage `json:"Result"`
}

func decodeArkEnvelope(t *testing.T, recorder *httptest.ResponseRecorder) arkEnvelope {
	t.Helper()
	var env arkEnvelope
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &env))
	return env
}

type arkAssetResult struct {
	Id          string `json:"Id"`
	Name        string `json:"Name"`
	AssetType   string `json:"AssetType"`
	CreateTime  string `json:"CreateTime"`
	UpdateTime  string `json:"UpdateTime"`
	ProjectName string `json:"ProjectName"`
	URL         string `json:"URL"`
	GroupId     string `json:"GroupId"`
	Status      string `json:"Status"`
	Moderation  struct {
		Strategy string `json:"Strategy"`
	} `json:"Moderation"`
}

type arkGroupResult struct {
	Id          string `json:"Id"`
	Name        string `json:"Name"`
	Description string `json:"Description"`
	GroupType   string `json:"GroupType"`
	ProjectName string `json:"ProjectName"`
	CreateTime  string `json:"CreateTime"`
	UpdateTime  string `json:"UpdateTime"`
}

type arkListAssetsResult struct {
	Items     []arkAssetResult `json:"Items"`
	NextToken string           `json:"NextToken"`
}

type arkListGroupResult struct {
	Items     []arkGroupResult `json:"Items"`
	NextToken string           `json:"NextToken"`
}

// insertArkAsset 直接落一条本地素材记录（绕过上游），用于隔离/映射断言。
func insertArkAsset(t *testing.T, userID, channelID int, assetID, groupID, name, status string) {
	t.Helper()
	a := &model.Asset{
		UserID: userID, ChannelID: channelID, AssetID: assetID, GroupID: groupID,
		Name: name, AssetType: model.AssetTypeImage, Status: status,
		SourceURL: "https://cdn.example.com/" + assetID + ".png", ProjectName: model.AssetProjectNameDefault,
	}
	require.NoError(t, a.Insert())
}

func TestRelayArkAssetAction_InvalidAction(t *testing.T) {
	setupArkAssetControllerDB(t)
	ctx, rec := newArkAssetContext(t, "NotARealAction", 1, nil)
	RelayArkAssetAction(ctx)

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	env := decodeArkEnvelope(t, rec)
	require.NotNil(t, env.ResponseMetadata.Error)
	assert.Equal(t, "InvalidAction", env.ResponseMetadata.Error.Code)
	assert.Equal(t, "NotARealAction", env.ResponseMetadata.Action)
	assert.Nil(t, env.Result, "错误信封不得携带 Result")
}

func TestRelayArkAssetAction_ValidationError(t *testing.T) {
	setupArkAssetControllerDB(t)

	cases := []struct {
		name   string
		action string
		body   any
	}{
		{"CreateAssetGroup missing Name", arkActionCreateAssetGroup, map[string]any{}},
		{"CreateAsset missing GroupId", arkActionCreateAsset, map[string]any{"URL": "https://x/y.png", "AssetType": "Image"}},
		{"CreateAsset bad URL", arkActionCreateAsset, map[string]any{"GroupId": "g", "URL": "ftp://x/y.png", "AssetType": "Image"}},
		{"CreateAsset bad AssetType", arkActionCreateAsset, map[string]any{"GroupId": "g", "URL": "https://x/y.png", "AssetType": "Doc"}},
		{"GetAsset missing Id", arkActionGetAsset, map[string]any{}},
		{"GetAssetGroup missing Id", arkActionGetAssetGroup, map[string]any{}},
		{"UpdateAsset missing Id", arkActionUpdateAsset, map[string]any{}},
		{"DeleteAsset missing Id", arkActionDeleteAsset, map[string]any{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, rec := newArkAssetContext(t, tc.action, 1, tc.body)
			RelayArkAssetAction(ctx)
			assert.Equal(t, http.StatusBadRequest, rec.Code)
			env := decodeArkEnvelope(t, rec)
			require.NotNil(t, env.ResponseMetadata.Error)
			assert.Equal(t, "InvalidParameter", env.ResponseMetadata.Error.Code)
		})
	}
}

// TestRelayArkAssetAction_GetAssetIsolationAndMapping 本人 active 素材返回官方信封与
// Active 状态；跨用户查同一素材 ID 一律 NotFound（即使本地存在），杜绝跨租户读取。
func TestRelayArkAssetAction_GetAssetIsolationAndMapping(t *testing.T) {
	setupArkAssetControllerDB(t)

	const owner, other = 100, 200
	insertArkAsset(t, owner, 901, "asset-owner", "grp", "lion", model.AssetStatusActive)

	// 本人查询：200 + 字段正确 + 状态映射 active→Active + Moderation 固定 Default
	ctx, rec := newArkAssetContext(t, arkActionGetAsset, owner, map[string]any{"Id": "asset-owner"})
	RelayArkAssetAction(ctx)
	require.Equal(t, http.StatusOK, rec.Code)
	env := decodeArkEnvelope(t, rec)
	assert.Nil(t, env.ResponseMetadata.Error)
	assert.Equal(t, "2024-01-01", env.ResponseMetadata.Version)
	assert.Equal(t, "ark", env.ResponseMetadata.Service)
	assert.Equal(t, "cn-beijing", env.ResponseMetadata.Region)
	assert.NotEmpty(t, env.ResponseMetadata.RequestId)

	var got arkAssetResult
	require.NoError(t, common.Unmarshal(env.Result, &got))
	assert.Equal(t, "asset-owner", got.Id)
	assert.Equal(t, "lion", got.Name)
	assert.Equal(t, "grp", got.GroupId)
	assert.Equal(t, "Active", got.Status)
	assert.Equal(t, "Default", got.Moderation.Strategy)
	assert.NotEmpty(t, got.CreateTime)
	assert.NotEmpty(t, got.URL)

	// 跨用户查询：本地存在但归属他人 → 404 NotFound
	ctx2, rec2 := newArkAssetContext(t, arkActionGetAsset, other, map[string]any{"Id": "asset-owner"})
	RelayArkAssetAction(ctx2)
	assert.Equal(t, http.StatusNotFound, rec2.Code)
	env2 := decodeArkEnvelope(t, rec2)
	require.NotNil(t, env2.ResponseMetadata.Error)
	assert.Equal(t, "NotFound", env2.ResponseMetadata.Error.Code)

	// 不存在的 ID → 404 NotFound
	ctx3, rec3 := newArkAssetContext(t, arkActionGetAsset, owner, map[string]any{"Id": "asset-ghost"})
	RelayArkAssetAction(ctx3)
	assert.Equal(t, http.StatusNotFound, rec3.Code)
}

// TestRelayArkAssetAction_ListAssetsStatusMapping ListAssets 只返回本人素材，
// 本地三态映射到官方词表 active→Active / failed→Failed / pending→Processing。
func TestRelayArkAssetAction_ListAssetsStatusMapping(t *testing.T) {
	setupArkAssetControllerDB(t)

	const owner, other = 300, 400
	insertArkAsset(t, owner, 911, "asset-active", "grp", "a", model.AssetStatusActive)
	insertArkAsset(t, owner, 912, "asset-failed", "grp", "b", model.AssetStatusFailed)
	// pending 素材会触发 refreshPendingAssets，但渠道 913 不存在 → 刷新空转 → 仍为 Processing。
	insertArkAsset(t, owner, 913, "asset-pending", "grp", "c", model.AssetStatusPending)
	insertArkAsset(t, other, 914, "asset-other", "grp", "d", model.AssetStatusActive)

	ctx, rec := newArkAssetContext(t, arkActionListAssets, owner, map[string]any{})
	RelayArkAssetAction(ctx)
	require.Equal(t, http.StatusOK, rec.Code)
	env := decodeArkEnvelope(t, rec)
	require.Nil(t, env.ResponseMetadata.Error)

	var list arkListAssetsResult
	require.NoError(t, common.Unmarshal(env.Result, &list))
	require.Len(t, list.Items, 3, "只能看到本人素材，看不到 other 的")
	statusByID := map[string]string{}
	for _, it := range list.Items {
		statusByID[it.Id] = it.Status
	}
	assert.Equal(t, "Active", statusByID["asset-active"])
	assert.Equal(t, "Failed", statusByID["asset-failed"])
	assert.Equal(t, "Processing", statusByID["asset-pending"])
	assert.NotContains(t, statusByID, "asset-other")
}

// TestRelayArkAssetAction_ListAssetGroupsIsolation ListAssetGroups 只返回本人组。
func TestRelayArkAssetAction_ListAssetGroupsIsolation(t *testing.T) {
	setupArkAssetControllerDB(t)

	const owner, other = 500, 600
	require.NoError(t, (&model.AssetGroup{UserID: owner, ChannelID: 1, GroupID: "g-owner", Name: "我的组"}).Insert())
	require.NoError(t, (&model.AssetGroup{UserID: other, ChannelID: 2, GroupID: "g-other", Name: "他人组"}).Insert())

	ctx, rec := newArkAssetContext(t, arkActionListAssetGroups, owner, map[string]any{})
	RelayArkAssetAction(ctx)
	require.Equal(t, http.StatusOK, rec.Code)
	env := decodeArkEnvelope(t, rec)
	require.Nil(t, env.ResponseMetadata.Error)

	var list arkListGroupResult
	require.NoError(t, common.Unmarshal(env.Result, &list))
	require.Len(t, list.Items, 1)
	assert.Equal(t, "g-owner", list.Items[0].Id)
	assert.Equal(t, "我的组", list.Items[0].Name)
}

// TestRelayArkAssetAction_GetAssetGroupIsolation 本人组返回详情；跨用户查同 ID → NotFound。
func TestRelayArkAssetAction_GetAssetGroupIsolation(t *testing.T) {
	setupArkAssetControllerDB(t)

	const owner, other = 700, 800
	require.NoError(t, (&model.AssetGroup{UserID: owner, ChannelID: 1, GroupID: "g-x", Name: "组X", Description: "描述"}).Insert())

	ctx, rec := newArkAssetContext(t, arkActionGetAssetGroup, owner, map[string]any{"Id": "g-x"})
	RelayArkAssetAction(ctx)
	require.Equal(t, http.StatusOK, rec.Code)
	env := decodeArkEnvelope(t, rec)
	var g arkGroupResult
	require.NoError(t, common.Unmarshal(env.Result, &g))
	assert.Equal(t, "g-x", g.Id)
	assert.Equal(t, "组X", g.Name)
	assert.Equal(t, "描述", g.Description)
	assert.Equal(t, model.AssetGroupTypeDefault, g.GroupType)

	ctx2, rec2 := newArkAssetContext(t, arkActionGetAssetGroup, other, map[string]any{"Id": "g-x"})
	RelayArkAssetAction(ctx2)
	assert.Equal(t, http.StatusNotFound, rec2.Code)
}

// TestRelayArkAssetAction_CreateAssetGroupNotFound CreateAsset 引用不存在/他人组时，
// 在触达上游前即按归属返回 404（隔离铁律先于上游调用）。
func TestRelayArkAssetAction_CreateAssetGroupNotFound(t *testing.T) {
	setupArkAssetControllerDB(t)

	const owner, other = 900, 1000
	require.NoError(t, (&model.AssetGroup{UserID: other, ChannelID: 2, GroupID: "g-other", Name: "他人组"}).Insert())

	// 组不存在
	ctx, rec := newArkAssetContext(t, arkActionCreateAsset, owner, map[string]any{
		"GroupId": "g-ghost", "URL": "https://x/y.png", "AssetType": "Image",
	})
	RelayArkAssetAction(ctx)
	assert.Equal(t, http.StatusNotFound, rec.Code)

	// 组属于他人：即便 ID 真实存在也返回 NotFound
	ctx2, rec2 := newArkAssetContext(t, arkActionCreateAsset, owner, map[string]any{
		"GroupId": "g-other", "URL": "https://x/y.png", "AssetType": "Image",
	})
	RelayArkAssetAction(ctx2)
	assert.Equal(t, http.StatusNotFound, rec2.Code)
}

// TestRelayArkAssetAction_MutateNotFound Update/Delete 对不存在或他人资源一律 404，
// 且发生在任何上游调用之前。
func TestRelayArkAssetAction_MutateNotFound(t *testing.T) {
	setupArkAssetControllerDB(t)

	const owner, other = 1100, 1200
	insertArkAsset(t, other, 1301, "asset-other", "g-other", "x", model.AssetStatusActive)
	require.NoError(t, (&model.AssetGroup{UserID: other, ChannelID: 2, GroupID: "g-other", Name: "他人组"}).Insert())

	cases := []struct {
		name   string
		action string
		body   any
	}{
		{"UpdateAsset other's asset", arkActionUpdateAsset, map[string]any{"Id": "asset-other", "Name": "hack"}},
		{"UpdateAsset ghost", arkActionUpdateAsset, map[string]any{"Id": "asset-ghost", "Name": "n"}},
		{"DeleteAsset other's asset", arkActionDeleteAsset, map[string]any{"Id": "asset-other"}},
		{"DeleteAsset ghost", arkActionDeleteAsset, map[string]any{"Id": "asset-ghost"}},
		{"UpdateAssetGroup other's group", arkActionUpdateAssetGroup, map[string]any{"Id": "g-other", "Name": "hack"}},
		{"DeleteAssetGroup other's group", arkActionDeleteAssetGroup, map[string]any{"Id": "g-other"}},
		{"DeleteAssetGroup ghost", arkActionDeleteAssetGroup, map[string]any{"Id": "g-ghost"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, rec := newArkAssetContext(t, tc.action, owner, tc.body)
			RelayArkAssetAction(ctx)
			assert.Equal(t, http.StatusNotFound, rec.Code)
			env := decodeArkEnvelope(t, rec)
			require.NotNil(t, env.ResponseMetadata.Error)
			assert.Equal(t, "NotFound", env.ResponseMetadata.Error.Code)
		})
	}

	// other 的资源未被上述越权操作改动
	remain, _, err := model.GetUserAssetsFiltered(other, nil, nil, "", 0, "")
	require.NoError(t, err)
	assert.Len(t, remain, 1)
	remainGroups, _, err := model.GetUserAssetGroups(other, nil, "", 0, "")
	require.NoError(t, err)
	assert.Len(t, remainGroups, 1)
}
