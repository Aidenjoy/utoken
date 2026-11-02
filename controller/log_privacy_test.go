package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUserLogResponseStripsUpstreamAndChannelFields(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Log{}))
	require.NoError(t, db.Create(&model.Log{
		UserId: 119, Type: model.LogTypeConsume, Username: "member", ModelName: "public-model",
		Quota: 100, PromptTokens: 10, CompletionTokens: 20, ChannelId: 14, ChannelName: "internal-channel",
		TokenId: 23, RequestId: "public-request", UpstreamRequestId: "upstream-request",
		UpstreamPromptTokens: 100, UpstreamCompletionTokens: 200,
		Other: common.MapToJsonStr(map[string]any{
			"task_id":             "public-task",
			"model_price":         0.004,
			"model_ratio":         15.0,
			"group_ratio":         2.0,
			"discount":            0.8,
			"channel_id":          14,
			"channel_name":        "internal-channel",
			"channel_type":        59,
			"request_url":         "https://internal-upstream.example.com/tasks",
			"request_conversion":  []string{"openai -> ark"},
			"is_model_mapped":     true,
			"upstream_model_name": "internal-model",
		}),
	}).Error)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/log/self?p=1&page_size=100", nil)
	c.Set("id", 119)
	GetUserLogs(c)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Items []map[string]any `json:"items"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	require.Len(t, response.Data.Items, 1)
	item := response.Data.Items[0]
	assert.Equal(t, float64(0), item["channel"])
	assert.Equal(t, "", item["channel_name"])
	assert.Equal(t, float64(0), item["token_id"])
	assert.Equal(t, float64(0), item["upstream_prompt_tokens"])
	assert.Equal(t, float64(0), item["upstream_completion_tokens"])
	assert.NotContains(t, item, "upstream_request_id")
	assert.Equal(t, float64(100), item["quota"])
	assert.Equal(t, "public-request", item["request_id"])

	other, ok := item["other"].(string)
	require.True(t, ok)
	otherMap, err := common.StrToMap(other)
	require.NoError(t, err)
	for _, key := range []string{"channel_id", "channel_name", "channel_type", "request_url", "request_conversion", "is_model_mapped", "upstream_model_name", "model_price", "model_ratio", "group_ratio", "discount"} {
		assert.NotContains(t, otherMap, key)
	}
	assert.Equal(t, "public-task", otherMap["task_id"])
	assert.NotContains(t, recorder.Body.String(), "internal-upstream.example.com")
	assert.NotContains(t, recorder.Body.String(), "internal-channel")
}
