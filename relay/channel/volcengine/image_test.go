package volcengine

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// convertArkImageBody feeds a raw client body through the adaptor exactly as the
// relay does: unmarshal into dto.ImageRequest, convert for Ark, marshal the
// outbound payload. Assertions run on the outbound JSON so a regression in either
// ImageRequest's unmarshal/marshal pair or the Ark whitelist is caught.
func convertArkImageBody(t *testing.T, relayMode int, clientBody string) map[string]any {
	t.Helper()

	gin.SetMode(gin.TestMode)

	var request dto.ImageRequest
	require.NoError(t, common.Unmarshal([]byte(clientBody), &request))

	adaptor := &Adaptor{}
	info := &relaycommon.RelayInfo{RelayMode: relayMode}
	converted, err := adaptor.ConvertImageRequest(gin.CreateTestContextOnly(httptest.NewRecorder(), gin.New()), info, request)
	require.NoError(t, err)

	outbound, err := common.Marshal(converted)
	require.NoError(t, err)

	var payload map[string]any
	require.NoError(t, common.Unmarshal(outbound, &payload))
	return payload
}

// Ark documents the official text-to-image and image-to-image bodies verbatim, and
// callers must be able to send them through this gateway unchanged. dto.ImageRequest
// drops every unmodelled key on marshal, so this pins the exact outbound field set.
func TestConvertImageRequestForwardsOfficialArkBodies(t *testing.T) {
	const officialPrompt = "充满活力的特写编辑肖像，模特眼神犀利，工作室灯光效果强烈。"

	textToImage := convertArkImageBody(t, constant.RelayModeImagesGenerations, `{
		"model": "doubao-seedream-5-0-pro-260628",
		"prompt": "`+officialPrompt+`",
		"size": "2K",
		"output_format": "png",
		"watermark": false
	}`)
	assert.Equal(t, map[string]any{
		"model":         "doubao-seedream-5-0-pro-260628",
		"prompt":        officialPrompt,
		"size":          "2K",
		"output_format": "png",
		"watermark":     false,
	}, textToImage)

	imageToImage := convertArkImageBody(t, constant.RelayModeImagesGenerations, `{
		"model": "doubao-seedream-5-0-pro-260628",
		"prompt": "`+officialPrompt+`",
		"image": "https://ark-project.tos-cn-beijing.volces.com/doc_image/seedream4_5_imageToimage.png",
		"size": "2K",
		"output_format": "png",
		"watermark": false
	}`)
	assert.Equal(t, "https://ark-project.tos-cn-beijing.volces.com/doc_image/seedream4_5_imageToimage.png", imageToImage["image"])
	assert.Equal(t, textToImage["model"], imageToImage["model"])
	assert.Equal(t, textToImage["size"], imageToImage["size"])

	// Ark serves image-to-image on /api/v3/images/generations, but a client may
	// still address /v1/images/edits; both relay modes must produce the same body.
	imageEdit := convertArkImageBody(t, constant.RelayModeImagesEdits, `{
		"model": "doubao-seedream-5-0-pro-260628",
		"prompt": "`+officialPrompt+`",
		"image": ["https://example.com/a.png", "https://example.com/b.png"],
		"size": "4K"
	}`)
	assert.Equal(t, []any{"https://example.com/a.png", "https://example.com/b.png"}, imageEdit["image"])
	assert.Equal(t, "4K", imageEdit["size"])

	// Seedream 4.5/5.0 documents the reference list as `images` instead of `image`.
	// Both spellings are modelled on ImageRequest and must survive untouched, so a
	// caller can follow whichever doc revision their model ships with.
	multiReference := convertArkImageBody(t, constant.RelayModeImagesGenerations, `{
		"model": "doubao-seedream-5-0-260128",
		"prompt": "`+officialPrompt+`",
		"images": ["https://example.com/a.png", "https://example.com/b.png", "data:image/png;base64,AAA"],
		"size": "2048x2048",
		"sequential_image_generation": "disabled"
	}`)
	assert.Equal(t, []any{"https://example.com/a.png", "https://example.com/b.png", "data:image/png;base64,AAA"}, multiReference["images"])
	assert.Equal(t, "2048x2048", multiReference["size"])
	assert.Equal(t, "disabled", multiReference["sequential_image_generation"])
}

// These Ark parameters have no dto.ImageRequest field, so they land in Extra and
// were silently discarded before the whitelist. Losing them changes generated
// output (seed reproducibility, sequential generation, web search grounding)
// without any error.
func TestConvertImageRequestKeepsArkNativeParams(t *testing.T) {
	payload := convertArkImageBody(t, constant.RelayModeImagesGenerations, `{
		"model": "doubao-seedream-5-0-pro-260628",
		"prompt": "a red fox",
		"seed": 42,
		"max_tokens": 2048,
		"guidance_scale": 7.5,
		"sequential_image_generation": "auto",
		"sequential_image_generation_options": {"max_images": 4},
		"optimize_prompt_options": {"enabled": true},
		"tools": [{"type": "web_search"}]
	}`)

	assert.EqualValues(t, 42, payload["seed"])
	assert.EqualValues(t, 2048, payload["max_tokens"])
	assert.EqualValues(t, 7.5, payload["guidance_scale"])
	assert.Equal(t, "auto", payload["sequential_image_generation"])
	assert.Equal(t, map[string]any{"max_images": float64(4)}, payload["sequential_image_generation_options"])
	assert.Equal(t, map[string]any{"enabled": true}, payload["optimize_prompt_options"])
	assert.Equal(t, []any{map[string]any{"type": "web_search"}}, payload["tools"])
}

// Only whitelisted extras reach Ark: an arbitrary client key (for example the
// playground body's group field) must not be forwarded, otherwise a typo turns
// into an Ark 400 and internal routing state leaks upstream.
func TestConvertImageRequestDropsUnknownClientKeys(t *testing.T) {
	payload := convertArkImageBody(t, constant.RelayModeImagesGenerations, `{
		"model": "doubao-seedream-5-0-pro-260628",
		"prompt": "a red fox",
		"group": "default",
		"not_an_ark_param": true
	}`)

	assert.NotContains(t, payload, "group")
	assert.NotContains(t, payload, "not_an_ark_param")
}

// Explicit zero values must survive the round trip, matching the OpenAI-compatible
// DTO rule: absent means omit, explicit 0/false means send.
func TestConvertImageRequestPreservesExplicitZeroValues(t *testing.T) {
	payload := convertArkImageBody(t, constant.RelayModeImagesGenerations, `{
		"model": "doubao-seedream-5-0-pro-260628",
		"prompt": "a red fox",
		"n": 0,
		"seed": 0,
		"watermark": false
	}`)

	assert.EqualValues(t, 0, payload["n"])
	assert.EqualValues(t, 0, payload["seed"])
	assert.Equal(t, false, payload["watermark"])
}

// Ark stamps a watermark onto generated images unless watermark is explicitly
// false, so an absent watermark must default to false on the outbound body;
// an explicit true must still pass through untouched.
func TestConvertImageRequestDefaultsWatermarkOff(t *testing.T) {
	absent := convertArkImageBody(t, constant.RelayModeImagesGenerations, `{
		"model": "doubao-seedream-5-0-pro-260628",
		"prompt": "a red fox"
	}`)
	assert.Equal(t, false, absent["watermark"])

	explicit := convertArkImageBody(t, constant.RelayModeImagesGenerations, `{
		"model": "doubao-seedream-5-0-pro-260628",
		"prompt": "a red fox",
		"watermark": true
	}`)
	assert.Equal(t, true, explicit["watermark"])
}
