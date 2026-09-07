package billing_setting

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// seedanceTierFixture 覆盖：多档分辨率、含/不含视频输入变体、零价档、大写分辨率键归一化。
func loadSeedanceTierFixture(t *testing.T) {
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
		"billing_setting.seedance_config": `{"abs-model":"{\"1080P\":{\"with_video\":33.12,\"without_video\":55.44},\"480p\":{\"with_video\":0,\"without_video\":10}}","empty-model":"{}"}`,
	}))
}

func TestGetSeedanceTierPrice(t *testing.T) {
	loadSeedanceTierFixture(t)

	tests := []struct {
		name       string
		model      string
		resolution string
		hasVideo   bool
		wantPrice  float64
		wantOK     bool
	}{
		{name: "命中档-不含视频", model: "abs-model", resolution: "1080p", hasVideo: false, wantPrice: 55.44, wantOK: true},
		{name: "命中档-含视频", model: "abs-model", resolution: "1080p", hasVideo: true, wantPrice: 33.12, wantOK: true},
		{name: "命中低档", model: "abs-model", resolution: "480p", hasVideo: false, wantPrice: 10, wantOK: true},
		{name: "变体零价视为未配置", model: "abs-model", resolution: "480p", hasVideo: true, wantOK: false},
		{name: "分辨率不在配置内", model: "abs-model", resolution: "720p", hasVideo: false, wantOK: false},
		{name: "空分辨率取不含视频最高档", model: "abs-model", resolution: "", hasVideo: false, wantPrice: 55.44, wantOK: true},
		{name: "空分辨率取含视频最高档", model: "abs-model", resolution: "", hasVideo: true, wantPrice: 33.12, wantOK: true},
		{name: "模型未配置", model: "other-model", resolution: "1080p", wantOK: false},
		{name: "模型配置为空", model: "empty-model", resolution: "1080p", wantOK: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			price, ok := GetSeedanceTierPrice(tt.model, tt.resolution, tt.hasVideo)
			assert.Equal(t, tt.wantOK, ok)
			if tt.wantOK {
				assert.InDelta(t, tt.wantPrice, price, 1e-9)
			}
		})
	}
}

func TestGetSeedanceConfigNormalizesResolutionKeys(t *testing.T) {
	loadSeedanceTierFixture(t)

	cfg, ok := GetSeedanceConfig("abs-model")
	require.True(t, ok)
	// 配置键 "1080P" 归一化为小写
	tier, found := cfg["1080p"]
	require.True(t, found)
	assert.InDelta(t, 55.44, tier.WithoutVideo, 1e-9)
}
