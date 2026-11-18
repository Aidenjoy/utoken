package canvas

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Ark 图片生成 API 的请求体映射是与上游的硬契约：
// 单图下发字符串、多图下发数组、默认关闭水印、未设置的可选参数不得出现，
// 否则上游会按不同语义处理（例如 image 传数组被当成多图融合）。
func TestBuildArkBody(t *testing.T) {
	seed := 42
	guidance := 2.5

	t.Run("text to image omits image field", func(t *testing.T) {
		body := buildArkBody(arkImageRequest{
			Model: "doubao-seedream-4-0-250828", Prompt: "一只猫", Size: "2048x2048", Watermark: false,
		})
		assert.Equal(t, map[string]any{
			"model":           "doubao-seedream-4-0-250828",
			"prompt":          "一只猫",
			"size":            "2048x2048",
			"response_format": "url",
			"watermark":       false,
		}, body)
	})

	t.Run("single reference becomes string", func(t *testing.T) {
		body := buildArkBody(arkImageRequest{
			Model: "m", Prompt: "改背景", Images: []string{"https://x/a.png"},
		})
		assert.Equal(t, "https://x/a.png", body["image"])
	})

	t.Run("multi reference becomes array", func(t *testing.T) {
		body := buildArkBody(arkImageRequest{
			Model: "m", Prompt: "融合", Images: []string{"https://x/a.png", "https://x/b.png"},
		})
		assert.Equal(t, []string{"https://x/a.png", "https://x/b.png"}, body["image"])
	})

	t.Run("optional ark params only when set", func(t *testing.T) {
		body := buildArkBody(arkImageRequest{
			Model: "m", Prompt: "p", Images: []string{"https://x/a.png"},
			OutputFormat: "png", Background: "transparent", Seed: &seed, Guidance: &guidance,
		})
		assert.Equal(t, "png", body["output_format"])
		assert.Equal(t, "transparent", body["background"])
		assert.Equal(t, 42, body["seed"])
		assert.Equal(t, 2.5, body["guidance_scale"])
	})
}

// 尺寸解析：档位与 WxH 两种写法，超界必须本地拦下（错误的上限会直接变成上游 400）。
func TestValidateArkSize(t *testing.T) {
	profile, known := resolveImageModel("doubao-seedream-4-0-250828")
	require.True(t, known)

	require.NoError(t, validateArkSizeString("2048x2048", profile))
	require.Error(t, validateArkSizeString("512x512", profile), "低于总像素下限")
	require.Error(t, validateArkSizeString("8192x8192", profile), "超过总像素上限")
	require.Error(t, validateArkSizeString("4096x64", profile), "宽高比超界")
	require.Error(t, validateArkSizeString("2K", profile), "档位不是 WxH")
}

// 局部编辑类工具默认沿用原图尺寸，保证结果可以与原图逐像素对齐回贴画布；
// 原图尺寸不合规时回退到模型默认档位。
func TestResolveArkSizePrefersSourceSize(t *testing.T) {
	profile, _ := resolveImageModel("doubao-seedream-4-0-250828")
	spec, _ := GetToolSpec(ToolPromptInpaint)

	size, err := resolveArkSize(spec, "", profile, []ImageInfo{{Width: 2048, Height: 2048}})
	require.NoError(t, err)
	assert.Equal(t, "2048x2048", size)

	size, err = resolveArkSize(spec, "", profile, []ImageInfo{{Width: 256, Height: 256}})
	require.NoError(t, err)
	assert.Equal(t, "2K", size, "原图过小应回退到模型档位")

	size, err = resolveArkSize(spec, "4K", profile, nil)
	require.NoError(t, err)
	assert.Equal(t, "4K", size)

	_, err = resolveArkSize(spec, "100x100", profile, nil)
	require.Error(t, err)
}

// 智能扩图的四种模式都要落到官方四边比例（相对短边，[0, 0.4]）。
func TestExpandRatios(t *testing.T) {
	tests := []struct {
		name                string
		mode                string
		params              map[string]any
		width, height       int
		wantTop, wantBottom float64
		wantLeft, wantRight float64
		wantErr             string
	}{
		{
			name: "ratio 1.5 expands a quarter on every side", mode: "ratio",
			params: map[string]any{"ratio": 1.5}, width: 1024, height: 1024,
			wantTop: 0.25, wantBottom: 0.25, wantLeft: 0.25, wantRight: 0.25,
		},
		{
			name: "edges are passed through", mode: "edges",
			params: map[string]any{"top": 0.1, "bottom": 0.2, "left": 0.3, "right": 0.4},
			width:  1000, height: 800,
			wantTop: 0.1, wantBottom: 0.2, wantLeft: 0.3, wantRight: 0.4,
		},
		{
			name: "aspect 16:9 from square expands horizontally", mode: "aspect",
			params: map[string]any{"targetAspect": "16:9"}, width: 1024, height: 1024,
			wantTop: 0, wantBottom: 0, wantLeft: 0.3889, wantRight: 0.3889,
		},
		{
			name: "canvas 1536x1024 expands horizontally", mode: "canvas",
			params: map[string]any{"targetWidth": 1536, "targetHeight": 1024}, width: 1024, height: 1024,
			wantTop: 0, wantBottom: 0, wantLeft: 0.25, wantRight: 0.25,
		},
		{
			name: "canvas smaller than source rejected", mode: "canvas",
			params: map[string]any{"targetWidth": 512, "targetHeight": 512}, width: 1024, height: 1024,
			wantErr: "目标画布不能小于原图",
		},
		{
			name: "same aspect rejected", mode: "aspect",
			params: map[string]any{"targetAspect": "1:1"}, width: 1000, height: 1000,
			wantErr: "目标画幅与原图一致",
		},
		{
			name: "ratio beyond official 0.4 cap rejected", mode: "ratio",
			params: map[string]any{"ratio": 1.9}, width: 1024, height: 1024,
			wantErr: "超出官方 [0, 0.4] 上限",
		},
		{
			name: "extreme aspect rejected after conversion", mode: "aspect",
			params: map[string]any{"targetAspect": "1:1"}, width: 512, height: 1024,
			wantErr: "超出官方 [0, 0.4] 上限",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			top, bottom, left, right, err := expandRatios(tt.mode, tt.params, tt.width, tt.height)
			if tt.wantErr != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.InDelta(t, tt.wantTop, top, 1e-4)
			assert.InDelta(t, tt.wantBottom, bottom, 1e-4)
			assert.InDelta(t, tt.wantLeft, left, 1e-4)
			assert.InDelta(t, tt.wantRight, right, 1e-4)
		})
	}
}

// MediaKit 各工具的请求体字段名必须与官方一致。
func TestMediaKitRequestBodies(t *testing.T) {
	require.Equal(t, map[string]any{
		"image_url":      "https://x/a.png",
		"mask_url":       "https://x/m.png",
		"standard_scene": "selected_area_erase",
		"tool_version":   "standard",
	}, buildEraseBody("https://x/a.png", "https://x/m.png", nil))

	body, err := buildExpandBody("https://x/a.png", 0.1, 0.2, 0.30001, 0.4)
	require.NoError(t, err)
	assert.Equal(t, 0.1, body["expand_top"])
	assert.Equal(t, 0.2, body["expand_bottom"])
	assert.Equal(t, 0.3, body["expand_left"], "比例按四位小数下发")
	assert.Equal(t, 0.4, body["expand_right"])

	_, err = buildExpandBody("https://x/a.png", 0.5, 0, 0, 0)
	require.Error(t, err)

	general := buildMattingBody("https://x/a.png", nil)
	assert.Equal(t, "general", general["scene"])
	assert.NotContains(t, general, "need_contour")

	human := buildMattingBody("https://x/a.png", map[string]any{
		"scene": "human", "needContour": true, "contourColor": "#000000",
		"contourSize": float64(5), "cropBackground": true,
	})
	assert.Equal(t, true, human["need_contour"])
	assert.Equal(t, "#000000", human["contour_color"])
	assert.Equal(t, 5, human["contour_size"])
	assert.Equal(t, true, human["need_crop_background"])

	standard := buildEnhanceBody("https://x/a.png", map[string]any{"multiple": float64(2)}, false)
	assert.Equal(t, "standard", standard["tool_version"])
	assert.Equal(t, float64(2), standard["multiple"])
	assert.NotContains(t, standard, "generative_enhance_mode")

	generative := buildEnhanceBody("https://x/a.png", map[string]any{
		"generativeEnhanceMode": "generative_first", "enableCorrectColor": false,
	}, true)
	assert.Equal(t, "max", generative["tool_version"], "生成式超分固定使用大模型增强版")
	assert.Equal(t, "generative_first", generative["generative_enhance_mode"])
	assert.Equal(t, false, generative["enable_correct_color"])
}

// 能力表只登记文档中明确给出限制的模型家族；未知模型必须判为不可用而不是套用近似上限。
func TestResolveImageModel(t *testing.T) {
	_, ok := resolveImageModel("doubao-seedream-4-0-250828")
	assert.True(t, ok)

	profile, ok := resolveImageModel("doubao-seedream-5-0-pro-260628")
	assert.True(t, ok)
	assert.Equal(t, 4624220, profile.MaxPixels)

	_, ok = resolveImageModel("some-unknown-image-model")
	assert.False(t, ok)
}

// 参数解析：前端传来的 JSON 数字统一是 float64，必须能被安全读取。
func TestParamReaders(t *testing.T) {
	params := map[string]any{
		"scene": "human", "ratio": float64(1.5), "count": float64(3), "flag": true,
	}
	assert.Equal(t, "human", stringParam(params, "scene", "general"))
	assert.Equal(t, "general", stringParam(params, "missing", "general"))
	assert.Equal(t, 1.5, floatParam(params, "ratio", 0))
	assert.Equal(t, 3, intParam(params, "count", 0))
	assert.True(t, boolParam(params, "flag", false))
	assert.False(t, boolParam(nil, "flag", false))
}

// 参数哈希用于「同幂等键不同参数」判定，必须对字段顺序不敏感。
func TestHashCanvasParamsStable(t *testing.T) {
	a, err := common.Marshal(map[string]any{"a": 1, "b": "x"})
	require.NoError(t, err)
	b, err := common.Marshal(map[string]any{"b": "x", "a": 1})
	require.NoError(t, err)
	assert.Equal(t, model.HashCanvasParams(a), model.HashCanvasParams(b))
}
