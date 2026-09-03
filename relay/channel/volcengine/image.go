package volcengine

import (
	"encoding/json"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

// arkNativeImageParams are the Ark image-generation parameters that the
// OpenAI-compatible dto.ImageRequest does not model. Ark serves text-to-image,
// single-reference editing and multi-reference editing on one endpoint
// (/api/v3/images/generations) and documents these alongside the
// model/prompt/image/size/output_format/watermark/n fields that dto.ImageRequest
// already carries, so the outbound body must include them for callers to use the
// official API verbatim. ImageRequest collects unmodelled keys in Extra and its
// MarshalJSON deliberately drops them, which silently discarded these parameters.
//
// Only this whitelist is merged: unknown client keys stay out of the upstream body
// so a typo cannot turn into an Ark 400. Extend the set when Ark documents a new
// image parameter.
//
// None of these are billing multipliers. The image count still comes from n, and
// ImageRequest.GetTokenCountMeta hardcodes MaxTokens, so a client-supplied
// max_tokens cannot inflate pre-consume quota. sequential_image_generation can
// make Ark return more images than n asks for, which is settled after the fact:
// the openai image handler bills the number of images actually returned.
var arkNativeImageParams = []string{
	"seed",
	"max_tokens",
	"guidance_scale",
	"sequential_image_generation",
	"sequential_image_generation_options",
	"optimize_prompt_options",
	"tools",
}

// buildArkImagePayload renders the outbound Ark image body: the OpenAI-modelled
// fields first, then the Ark-native parameters recovered from Extra. Extra never
// holds a modelled field (ImageRequest.UnmarshalJSON splits known keys from unknown
// ones), so the merge cannot override a validated value such as n.
func buildArkImagePayload(request dto.ImageRequest) (map[string]json.RawMessage, error) {
	base, err := common.Marshal(request)
	if err != nil {
		return nil, err
	}
	payload := make(map[string]json.RawMessage)
	if err := common.Unmarshal(base, &payload); err != nil {
		return nil, err
	}
	for _, key := range arkNativeImageParams {
		if value, ok := request.Extra[key]; ok {
			payload[key] = value
		}
	}
	// Ark stamps a watermark onto generated images unless the caller asks
	// otherwise: an absent watermark defaults to false, while an explicit
	// client value (true included) is already marshalled into the base body.
	if request.Watermark == nil {
		payload["watermark"] = json.RawMessage("false")
	}
	return payload, nil
}
