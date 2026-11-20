package ali

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// wanSettleFixture 注入 wan 按秒计费配置：1080p 档 $0.25/s，480p 档 $0.1/s，720p 未配置。
func wanSettleFixture(t *testing.T) {
	t.Helper()
	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		saved[key] = value
		return nil
	}))
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
	})
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode":    `{"wan-settle-model":"wan"}`,
		"billing_setting.wan_config":      `{"wan-settle-model":"{\"1080p\":0.25,\"480p\":0.1}"}`,
		"group_ratio_setting.group_ratio": `{"default":1}`,
	}))
}

func wanSettleTask() *model.Task {
	return &model.Task{
		Group: "default",
		Properties: model.Properties{
			OriginModelName: "wan-settle-model",
		},
		PrivateData: model.TaskPrivateData{
			BillingContext: &model.TaskBillingContext{
				OriginModelName: "wan-settle-model",
			},
		},
	}
}

// TestAdjustBillingOnCompleteWan 锁定 wan 结算边界：成功任务按上游真实
// duration × 实际分辨率档价重算；非 wan 模式/缺结算依据/档未配置时返回 0 保持预扣。
func TestAdjustBillingOnCompleteWan(t *testing.T) {
	wanSettleFixture(t)
	adaptor := &TaskAdaptor{}

	t.Run("按真实时长与分辨率档价重算", func(t *testing.T) {
		taskResult := &relaycommon.TaskInfo{
			Status:     model.TaskStatusSuccess,
			Resolution: "1080p",
			Duration:   5,
		}
		// 5s × $0.25/s × 500000 = 625000
		assert.Equal(t, 625_000, adaptor.AdjustBillingOnComplete(wanSettleTask(), taskResult))
	})

	t.Run("浮点时长", func(t *testing.T) {
		taskResult := &relaycommon.TaskInfo{
			Status:     model.TaskStatusSuccess,
			Resolution: "480p",
			Duration:   5.5,
		}
		// 5.5s × $0.1/s × 500000 = 275000
		assert.Equal(t, 275_000, adaptor.AdjustBillingOnComplete(wanSettleTask(), taskResult))
	})

	t.Run("非wan模式保持预扣", func(t *testing.T) {
		task := wanSettleTask()
		task.PrivateData.BillingContext.OriginModelName = "other-model"
		taskResult := &relaycommon.TaskInfo{
			Status:     model.TaskStatusSuccess,
			Resolution: "1080p",
			Duration:   5,
		}
		assert.Equal(t, 0, adaptor.AdjustBillingOnComplete(task, taskResult))
	})

	t.Run("缺结算依据保持预扣", func(t *testing.T) {
		cases := []*relaycommon.TaskInfo{
			{Status: model.TaskStatusSuccess, Resolution: "", Duration: 5},
			{Status: model.TaskStatusSuccess, Resolution: "1080p", Duration: 0},
			{Status: model.TaskStatusFailure, Resolution: "1080p", Duration: 5},
		}
		for _, taskResult := range cases {
			assert.Equal(t, 0, adaptor.AdjustBillingOnComplete(wanSettleTask(), taskResult))
		}
	})

	t.Run("档未配置保持预扣", func(t *testing.T) {
		taskResult := &relaycommon.TaskInfo{
			Status:     model.TaskStatusSuccess,
			Resolution: "720p",
			Duration:   5,
		}
		assert.Equal(t, 0, adaptor.AdjustBillingOnComplete(wanSettleTask(), taskResult))
	})
}

// TestParseTaskResultWanUsage 锁定 wan3.0 结算依据解析：usage.duration 可为浮点/
// 字符串（FloatValue 容忍），SR 映射为分辨率档（>=2160 归入 4k）。
func TestParseTaskResultWanUsage(t *testing.T) {
	adaptor := &TaskAdaptor{}

	tests := []struct {
		name           string
		usage          string
		wantResolution string
		wantDuration   float64
	}{
		{
			name:           "浮点时长与1080p",
			usage:          `"usage":{"duration":5.0,"video_count":1,"SR":1080}`,
			wantResolution: "1080p",
			wantDuration:   5,
		},
		{
			name:           "字符串时长",
			usage:          `"usage":{"duration":"5.5","video_count":1,"SR":720}`,
			wantResolution: "720p",
			wantDuration:   5.5,
		},
		{
			name:           "SR大于等于2160归入4k",
			usage:          `"usage":{"duration":5,"video_count":1,"SR":2160}`,
			wantResolution: "4k",
			wantDuration:   5,
		},
		{
			name:           "缺usage不产生结算依据",
			usage:          `"request_id":"req-1"`,
			wantResolution: "",
			wantDuration:   0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body := `{"output":{"task_id":"t-1","task_status":"SUCCEEDED","video_url":"https://example.com/v.mp4"},` + tt.usage + `}`
			taskResult, err := adaptor.ParseTaskResult([]byte(body))
			require.NoError(t, err)
			require.Equal(t, model.TaskStatusSuccess, taskResult.Status)
			assert.Equal(t, tt.wantResolution, taskResult.Resolution)
			assert.InDelta(t, tt.wantDuration, taskResult.Duration, 1e-9)
		})
	}
}
