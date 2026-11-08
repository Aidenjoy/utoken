package controller

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// 官方兼容素材库 API 的确定性契约回归，上游均用 httptest 模拟。

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
	Error             *arkAssetError `json:"Error"`
	LastInferenceTime string         `json:"LastInferenceTime"`
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
	Items      []arkAssetResult `json:"Items"`
	NextToken  string           `json:"NextToken"`
	PageNumber int              `json:"PageNumber"`
	PageSize   int              `json:"PageSize"`
	TotalCount int64            `json:"TotalCount"`
}

type arkListGroupResult struct {
	Items      []arkGroupResult `json:"Items"`
	NextToken  string           `json:"NextToken"`
	PageNumber int              `json:"PageNumber"`
	PageSize   int              `json:"PageSize"`
	TotalCount int64            `json:"TotalCount"`
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

type arkAssetRoundTripFunc func(*http.Request) (*http.Response, error)

func (f arkAssetRoundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestRelayArkAssetActionEcloudProtocolCompatibility(t *testing.T) {
	db := setupArkAssetControllerDB(t)
	t.Setenv("TOS_ACCESS_KEY", "")
	t.Setenv("TOS_SECRET_KEY", "")
	t.Setenv("TOS_BUCKET", "")

	type requestRecord struct {
		method string
		path   string
		body   string
	}
	var requests []requestRecord
	const (
		assetPath   = "/api/openapi-maas/exp/aicc/v2/asset"
		groupPath   = "/api/openapi-maas/exp/aicc/v2/asset-group"
		channelID   = 42
		projectName = "project-x"
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		requests = append(requests, requestRecord{method: r.Method, path: r.URL.Path, body: string(body)})
		switch r.Method + " " + r.URL.Path {
		case "POST " + groupPath:
			_, _ = w.Write([]byte(`{"state":"OK","body":{"groupId":"group-mobile"}}`))
		case "POST " + assetPath:
			_, _ = w.Write([]byte(`{"state":"OK","body":"asset-mobile"}`))
		case "GET " + assetPath + "/asset-mobile":
			_, _ = w.Write([]byte(`{"state":"OK","body":{"assetId":"asset-mobile","assetUrl":"https://cdn.example.com/mobile.png","status":"ACTIVE"}}`))
		default:
			_, _ = w.Write([]byte(`{"state":"OK","body":null}`))
		}
	}))
	defer srv.Close()

	target, err := url.Parse(srv.URL)
	require.NoError(t, err)
	client := service.GetHttpClient()
	if client == nil {
		client = http.DefaultClient
	}
	originalTransport := client.Transport
	baseTransport := originalTransport
	if baseTransport == nil {
		baseTransport = http.DefaultTransport
	}
	client.Transport = arkAssetRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host != "ecloud.10086.cn" {
			return baseTransport.RoundTrip(req)
		}
		clone := req.Clone(req.Context())
		clone.URL.Scheme = target.Scheme
		clone.URL.Host = target.Host
		clone.Host = target.Host
		return baseTransport.RoundTrip(clone)
	})
	t.Cleanup(func() { client.Transport = originalTransport })

	settings, err := common.Marshal(dto.ChannelOtherSettings{
		AssetUploadProtocol: dto.AssetUploadProtocolEcloud,
		AssetAK:             "mobile-ak",
		AssetSK:             "mobile-sk",
	})
	require.NoError(t, err)
	require.NoError(t, db.Create(&model.Channel{
		Id: channelID, Name: "mobile", Status: common.ChannelStatusEnabled, OtherSettings: string(settings),
	}).Error)

	invoke := func(action string, body any) arkEnvelope {
		ctx, rec := newArkAssetContext(t, action, 10, body)
		ctx.Set("token_channel_id", channelID)
		RelayArkAssetAction(ctx)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		env := decodeArkEnvelope(t, rec)
		require.Nil(t, env.ResponseMetadata.Error)
		assert.Equal(t, action, env.ResponseMetadata.Action)
		assert.Equal(t, "ark", env.ResponseMetadata.Service)
		assert.Equal(t, "2024-01-01", env.ResponseMetadata.Version)
		return env
	}

	env := invoke(arkActionCreateAssetGroup, map[string]any{
		"Name": "group-name", "Description": "group-description", "GroupType": "AIGC", "ProjectName": projectName,
	})
	var createdGroup struct {
		Id string `json:"Id"`
	}
	require.NoError(t, common.Unmarshal(env.Result, &createdGroup))
	assert.Equal(t, "group-mobile", createdGroup.Id)

	env = invoke(arkActionCreateAsset, map[string]any{
		"GroupId": createdGroup.Id, "URL": "https://example.com/a.jpg", "AssetType": "Image",
		"Name": "asset-name", "ProjectName": projectName,
	})
	var createdAsset struct {
		Id string `json:"Id"`
	}
	require.NoError(t, common.Unmarshal(env.Result, &createdAsset))
	assert.Equal(t, "asset-mobile", createdAsset.Id)

	env = invoke(arkActionUpdateAsset, map[string]any{"Id": createdAsset.Id, "Name": "asset-renamed", "ProjectName": projectName})
	assert.JSONEq(t, `{"Id":"asset-mobile"}`, string(env.Result))
	env = invoke(arkActionUpdateAssetGroup, map[string]any{
		"Id": createdGroup.Id, "Name": "group-renamed", "Description": "description-renamed", "ProjectName": projectName,
	})
	assert.JSONEq(t, `{"Id":"group-mobile"}`, string(env.Result))

	env = invoke(arkActionListAssetGroups, map[string]any{
		"Filter": map[string]any{"GroupType": "AIGC"}, "ProjectName": projectName,
	})
	var groups arkListGroupResult
	require.NoError(t, common.Unmarshal(env.Result, &groups))
	require.Len(t, groups.Items, 1)
	assert.Equal(t, "group-renamed", groups.Items[0].Name)
	assert.Equal(t, "description-renamed", groups.Items[0].Description)
	assert.Equal(t, projectName, groups.Items[0].ProjectName)

	env = invoke(arkActionListAssets, map[string]any{
		"Filter": map[string]any{"GroupType": "AIGC"}, "ProjectName": projectName,
	})
	var assets arkListAssetsResult
	require.NoError(t, common.Unmarshal(env.Result, &assets))
	require.Len(t, assets.Items, 1)
	assert.Equal(t, "asset-renamed", assets.Items[0].Name)
	assert.Equal(t, "Active", assets.Items[0].Status)
	assert.Equal(t, "https://cdn.example.com/mobile.png", assets.Items[0].URL)
	assert.Equal(t, projectName, assets.Items[0].ProjectName)

	env = invoke(arkActionGetAssetGroup, map[string]any{"Id": createdGroup.Id})
	var group arkGroupResult
	require.NoError(t, common.Unmarshal(env.Result, &group))
	assert.Equal(t, createdGroup.Id, group.Id)
	assert.Equal(t, "group-renamed", group.Name)

	env = invoke(arkActionGetAsset, map[string]any{"Id": createdAsset.Id})
	var asset arkAssetResult
	require.NoError(t, common.Unmarshal(env.Result, &asset))
	assert.Equal(t, createdAsset.Id, asset.Id)
	assert.Equal(t, "Active", asset.Status)
	assert.Equal(t, "Default", asset.Moderation.Strategy)

	invoke(arkActionDeleteAsset, map[string]any{"Id": createdAsset.Id, "ProjectName": projectName})
	invoke(arkActionDeleteAssetGroup, map[string]any{"Id": createdGroup.Id, "ProjectName": projectName})

	require.Len(t, requests, 7)
	gotRequests := make([]string, 0, len(requests))
	for _, req := range requests {
		gotRequests = append(gotRequests, req.method+" "+req.path)
		assert.NotContains(t, req.body, "ProjectName")
	}
	assert.Equal(t, []string{
		"POST " + groupPath,
		"POST " + assetPath,
		"PUT " + assetPath + "/asset-mobile",
		"PUT " + groupPath + "/group-mobile",
		"GET " + assetPath + "/asset-mobile",
		"DELETE " + assetPath + "/asset-mobile",
		"DELETE " + groupPath + "/group-mobile",
	}, gotRequests)
	assert.JSONEq(t, `{"groupType":"AIGC","groupName":"group-name","description":"group-description"}`, requests[0].body)
	assert.JSONEq(t, `{"groupId":"group-mobile","assetName":"asset-name","assetUrl":"https://example.com/a.jpg","assetType":"Image"}`, requests[1].body)
	assert.JSONEq(t, `{"assetName":"asset-renamed"}`, requests[2].body)
	assert.JSONEq(t, `{"groupName":"group-renamed","description":"description-renamed"}`, requests[3].body)
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

func TestRelayArkAssetActionListOfficialValidation(t *testing.T) {
	setupArkAssetControllerDB(t)
	filter := map[string]any{"GroupType": "AIGC"}
	cases := []struct {
		name   string
		action string
		body   any
	}{
		{"groups missing Filter", arkActionListAssetGroups, map[string]any{}},
		{"assets missing Filter", arkActionListAssets, nil},
		{"missing GroupType", arkActionListAssets, map[string]any{"Filter": map[string]any{}}},
		{"invalid GroupType", arkActionListAssetGroups, map[string]any{"Filter": map[string]any{"GroupType": "Other"}}},
		{"zero MaxResults", arkActionListAssets, map[string]any{"Filter": filter, "MaxResults": 0}},
		{"large MaxResults", arkActionListAssetGroups, map[string]any{"Filter": filter, "MaxResults": 101}},
		{"PageNumber without PageSize", arkActionListAssets, map[string]any{"Filter": filter, "PageNumber": 1}},
		{"PageSize without PageNumber", arkActionListAssetGroups, map[string]any{"Filter": filter, "PageSize": 10}},
		{"invalid PageNumber", arkActionListAssets, map[string]any{"Filter": filter, "PageNumber": 0, "PageSize": 10}},
		{"invalid PageSize", arkActionListAssetGroups, map[string]any{"Filter": filter, "PageNumber": 1, "PageSize": 101}},
		{"mixed pagination", arkActionListAssets, map[string]any{"Filter": filter, "PageNumber": 1, "PageSize": 10, "MaxResults": 10}},
		{"mixed token and page", arkActionListAssetGroups, map[string]any{"Filter": filter, "PageNumber": 1, "PageSize": 10, "NextToken": "MA=="}},
		{"groups sort by GroupId", arkActionListAssetGroups, map[string]any{"Filter": filter, "SortBy": "GroupId"}},
		{"assets sort by UpdateTime", arkActionListAssets, map[string]any{"Filter": filter, "SortBy": "UpdateTime"}},
		{"invalid SortOrder", arkActionListAssets, map[string]any{"Filter": filter, "SortOrder": "ascending"}},
		{"groups deep paging", arkActionListAssetGroups, map[string]any{"Filter": filter, "PageNumber": 1001, "PageSize": 10}},
		{"assets deep paging", arkActionListAssets, map[string]any{"Filter": filter, "PageNumber": 2001, "PageSize": 10}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, rec := newArkAssetContext(t, tc.action, 1, tc.body)
			RelayArkAssetAction(ctx)
			require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
			env := decodeArkEnvelope(t, rec)
			require.NotNil(t, env.ResponseMetadata.Error)
			assert.Equal(t, "InvalidParameter", env.ResponseMetadata.Error.Code)
		})
	}
}

func TestRelayArkAssetActionListAssetGroupsOfficialPagination(t *testing.T) {
	db := setupArkAssetControllerDB(t)
	const userID = 71
	for i := 1; i <= 12; i++ {
		require.NoError(t, db.Create(&model.AssetGroup{
			UserID: userID, ChannelID: 1, GroupID: fmt.Sprintf("g-%02d", i), Name: fmt.Sprintf("group-%02d", i),
			GroupType: model.AssetGroupTypeDefault, ProjectName: model.AssetProjectNameDefault,
			CreatedAt: int64(i), UpdatedAt: int64(i),
		}).Error)
	}
	require.NoError(t, db.Create(&model.AssetGroup{
		UserID: userID, ChannelID: 1, GroupID: "g-other-project", Name: "other-project",
		GroupType: model.AssetGroupTypeDefault, ProjectName: "project-x",
	}).Error)
	require.NoError(t, db.Create(&model.AssetGroup{
		UserID: userID, ChannelID: 1, GroupID: "g-live", Name: "live",
		GroupType: model.AssetGroupTypeLivenessFace, ProjectName: model.AssetProjectNameDefault,
	}).Error)

	invoke := func(body any) (arkEnvelope, *httptest.ResponseRecorder) {
		ctx, rec := newArkAssetContext(t, arkActionListAssetGroups, userID, body)
		RelayArkAssetAction(ctx)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		return decodeArkEnvelope(t, rec), rec
	}

	env, rec := invoke(map[string]any{"Filter": map[string]any{"GroupType": "AIGC"}})
	var first arkListGroupResult
	require.NoError(t, common.Unmarshal(env.Result, &first))
	require.Len(t, first.Items, 10, "游标分页默认 MaxResults 应为 10")
	assert.Equal(t, "g-12", first.Items[0].Id)
	assert.Equal(t, "g-03", first.Items[9].Id)
	assert.NotEmpty(t, first.NextToken)
	assert.NotContains(t, rec.Body.String(), `"PageNumber"`)
	assert.NotContains(t, rec.Body.String(), `"TotalCount"`)

	env, rec = invoke(map[string]any{
		"Filter": map[string]any{"GroupType": "AIGC"}, "NextToken": first.NextToken,
	})
	var second arkListGroupResult
	require.NoError(t, common.Unmarshal(env.Result, &second))
	require.Len(t, second.Items, 2)
	assert.Equal(t, "g-02", second.Items[0].Id)
	assert.Equal(t, "g-01", second.Items[1].Id)
	assert.Empty(t, second.NextToken)
	assert.NotContains(t, rec.Body.String(), `"NextToken"`)

	env, rec = invoke(map[string]any{
		"Filter": map[string]any{"GroupType": "AIGC"}, "PageNumber": 2, "PageSize": 5, "SortOrder": "Asc",
	})
	var paged arkListGroupResult
	require.NoError(t, common.Unmarshal(env.Result, &paged))
	require.Len(t, paged.Items, 5)
	assert.Equal(t, "g-06", paged.Items[0].Id)
	assert.Equal(t, "g-10", paged.Items[4].Id)
	assert.Equal(t, 2, paged.PageNumber)
	assert.Equal(t, 5, paged.PageSize)
	assert.EqualValues(t, 12, paged.TotalCount)
	assert.NotContains(t, rec.Body.String(), `"NextToken"`)

	env, _ = invoke(map[string]any{
		"Filter": map[string]any{"GroupType": "AIGC"}, "ProjectName": "project-x",
	})
	var projectGroups arkListGroupResult
	require.NoError(t, common.Unmarshal(env.Result, &projectGroups))
	require.Len(t, projectGroups.Items, 1)
	assert.Equal(t, "g-other-project", projectGroups.Items[0].Id)

	env, _ = invoke(map[string]any{"Filter": map[string]any{"GroupType": "LivenessFace"}})
	var liveGroups arkListGroupResult
	require.NoError(t, common.Unmarshal(env.Result, &liveGroups))
	require.Len(t, liveGroups.Items, 1)
	assert.Equal(t, "g-live", liveGroups.Items[0].Id)
}

func TestRelayArkAssetActionListAssetsOfficialFiltersAndSorting(t *testing.T) {
	db := setupArkAssetControllerDB(t)
	const userID = 72
	groups := []model.AssetGroup{
		{UserID: userID, ChannelID: 1, GroupID: "g-a", Name: "a", GroupType: model.AssetGroupTypeDefault, ProjectName: model.AssetProjectNameDefault},
		{UserID: userID, ChannelID: 1, GroupID: "g-b", Name: "b", GroupType: model.AssetGroupTypeDefault, ProjectName: model.AssetProjectNameDefault},
		{UserID: userID, ChannelID: 1, GroupID: "g-live", Name: "live", GroupType: model.AssetGroupTypeLivenessFace, ProjectName: model.AssetProjectNameDefault},
		{UserID: userID, ChannelID: 1, GroupID: "g-other", Name: "other", GroupType: model.AssetGroupTypeDefault, ProjectName: "project-x"},
	}
	for i := range groups {
		require.NoError(t, db.Create(&groups[i]).Error)
	}
	assets := []model.Asset{
		{UserID: userID, ChannelID: 1, AssetID: "asset-b", GroupID: "g-b", Name: "b", AssetType: model.AssetTypeImage, Status: model.AssetStatusActive, ProjectName: model.AssetProjectNameDefault, CreatedAt: 1},
		{UserID: userID, ChannelID: 1, AssetID: "asset-a", GroupID: "g-a", Name: "a", AssetType: model.AssetTypeImage, Status: model.AssetStatusActive, ProjectName: model.AssetProjectNameDefault, CreatedAt: 2},
		{UserID: userID, ChannelID: 1, AssetID: "asset-live", GroupID: "g-live", Name: "live", AssetType: model.AssetTypeImage, Status: model.AssetStatusActive, ProjectName: model.AssetProjectNameDefault, CreatedAt: 3},
		{UserID: userID, ChannelID: 1, AssetID: "asset-other", GroupID: "g-other", Name: "other", AssetType: model.AssetTypeImage, Status: model.AssetStatusActive, ProjectName: "project-x", CreatedAt: 4},
	}
	for i := range assets {
		require.NoError(t, db.Create(&assets[i]).Error)
	}

	invoke := func(body any) arkListAssetsResult {
		ctx, rec := newArkAssetContext(t, arkActionListAssets, userID, body)
		RelayArkAssetAction(ctx)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		env := decodeArkEnvelope(t, rec)
		var result arkListAssetsResult
		require.NoError(t, common.Unmarshal(env.Result, &result))
		return result
	}

	sorted := invoke(map[string]any{
		"Filter": map[string]any{"GroupType": "AIGC"}, "SortBy": "GroupId", "SortOrder": "Asc",
	})
	require.Len(t, sorted.Items, 2)
	assert.Equal(t, "asset-a", sorted.Items[0].Id)
	assert.Equal(t, "asset-b", sorted.Items[1].Id)

	live := invoke(map[string]any{"Filter": map[string]any{"GroupType": "LivenessFace"}})
	require.Len(t, live.Items, 1)
	assert.Equal(t, "asset-live", live.Items[0].Id)

	project := invoke(map[string]any{
		"Filter": map[string]any{"GroupType": "AIGC"}, "ProjectName": "project-x",
	})
	require.Len(t, project.Items, 1)
	assert.Equal(t, "asset-other", project.Items[0].Id)
}

func TestRelayArkAssetActionGetAssetErrorAndLastInferenceTime(t *testing.T) {
	setupArkAssetControllerDB(t)
	const userID = 73
	asset := &model.Asset{
		UserID: userID, ChannelID: 1, AssetID: "asset-failed", GroupID: "g", Name: "failed",
		AssetType: model.AssetTypeImage, Status: model.AssetStatusFailed, ProjectName: model.AssetProjectNameDefault,
		ErrorCode: "InvalidAsset", ErrorMsg: "unsupported frame rate", LastInferenceAt: 1700000000,
	}
	require.NoError(t, asset.Insert())

	ctx, rec := newArkAssetContext(t, arkActionGetAsset, userID, map[string]any{"Id": asset.AssetID})
	RelayArkAssetAction(ctx)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	env := decodeArkEnvelope(t, rec)
	var got arkAssetResult
	require.NoError(t, common.Unmarshal(env.Result, &got))
	require.NotNil(t, got.Error)
	assert.Equal(t, "InvalidAsset", got.Error.Code)
	assert.Equal(t, "unsupported frame rate", got.Error.Message)
	assert.Equal(t, "2023-11-14T22:13:20Z", got.LastInferenceTime)
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
	require.NoError(t, (&model.AssetGroup{UserID: owner, ChannelID: 911, GroupID: "grp", Name: "grp"}).Insert())

	ctx, rec := newArkAssetContext(t, arkActionListAssets, owner, map[string]any{
		"Filter": map[string]any{"GroupType": "AIGC"},
	})
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

	ctx, rec := newArkAssetContext(t, arkActionListAssetGroups, owner, map[string]any{
		"Filter": map[string]any{"GroupType": "AIGC"},
	})
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
	remain, _, err := model.GetUserAssetsFiltered(other, model.AssetListQuery{})
	require.NoError(t, err)
	assert.Len(t, remain, 1)
	remainGroups, _, err := model.GetUserAssetGroups(other, model.AssetListQuery{})
	require.NoError(t, err)
	assert.Len(t, remainGroups, 1)
}

func TestBestEffortDeleteUpstreamAssetRelay(t *testing.T) {
	db := setupArkAssetControllerDB(t)
	var gotMethod, gotPath, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		_, _ = w.Write([]byte(`{"code":0,"message":"ok"}`))
	}))
	defer srv.Close()

	settings, err := common.Marshal(dto.ChannelOtherSettings{AssetUploadProtocol: dto.AssetUploadProtocolRelay})
	require.NoError(t, err)
	require.NoError(t, db.Create(&model.Channel{
		Id: 41, Name: "relay", Key: "relay-secret", Status: common.ChannelStatusEnabled,
		BaseURL: &srv.URL, OtherSettings: string(settings),
	}).Error)

	bestEffortDeleteUpstreamAsset(&model.Asset{ID: 9, ChannelID: 41, AssetID: "asset-relay"})
	assert.Equal(t, http.MethodDelete, gotMethod)
	assert.Equal(t, "/api/assets/asset-relay", gotPath)
	assert.Equal(t, "Bearer relay-secret", gotAuth)
}
