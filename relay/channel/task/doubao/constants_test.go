package doubao

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestValidateResolutionSupported 锁定「管理员配置 seedance_config 后以配置为准」的边界：
// 只配 1080p 时，480p 必须报「此模型暂不支持该参数」，1080p 放行，空分辨率不拦截。
func TestValidateResolutionSupported(t *testing.T) {
	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		saved[key] = value
		return nil
	}))
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
	})
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.seedance_config": `{"cfg-model":"{\"1080p\":{\"with_video\":33.12,\"without_video\":55.44}}","zero-variant-model":"{\"1080p\":{\"with_video\":0,\"without_video\":55.44}}"}`,
	}))

	tests := []struct {
		name       string
		model      string
		resolution string
		hasVideo   bool
		wantErr    string
	}{
		{name: "已配置档-不含视频", model: "cfg-model", resolution: "1080p"},
		{name: "已配置档-含视频", model: "cfg-model", resolution: "1080p", hasVideo: true},
		{name: "未配置档报错", model: "cfg-model", resolution: "480p", wantErr: "此模型暂不支持该参数: 480p"},
		{name: "变体零价视为不支持", model: "zero-variant-model", resolution: "1080p", hasVideo: true, wantErr: "此模型暂不支持该参数: 1080p"},
		{name: "空分辨率不拦截", model: "cfg-model", resolution: ""},
		{name: "未配置管理员单价的模型不拦截", model: "doubao-seedance-2-0-260128", resolution: "480p"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateResolutionSupported(tt.model, tt.resolution, tt.hasVideo)
			if tt.wantErr == "" {
				assert.NoError(t, err)
			} else {
				require.Error(t, err)
				assert.Equal(t, tt.wantErr, err.Error())
			}
		})
	}
}
