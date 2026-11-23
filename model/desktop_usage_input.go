package model

import (
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
)

// usageInputMessage reads only user-authored text fields across the existing
// OpenAI/Claude messages and Gemini contents formats. Media/tool fields stay opaque.
type usageInputMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
	Parts   []struct {
		Text *string `json:"text"`
	} `json:"parts"`
}

// extractDesktopUsageInput extracts the most recent user turn, never the full
// privileged snapshot. Unknown/malformed formats are unavailable, not guessed.
// The boolean records preview truncation at 4096 Unicode characters.
func extractDesktopUsageInput(raw string) (*string, bool) {
	var request struct {
		Messages []usageInputMessage `json:"messages"`
		Contents []usageInputMessage `json:"contents"`
		Input    json.RawMessage     `json:"input"`
		Prompt   *string             `json:"prompt"`
	}
	if common.UnmarshalJsonStr(raw, &request) != nil {
		return nil, false
	}
	var selected *usageInputMessage
	var text *string
	switch {
	case len(request.Messages) > 0:
		for i := len(request.Messages) - 1; i >= 0; i-- {
			if request.Messages[i].Role == "user" {
				selected = &request.Messages[i]
				break
			}
		}
	case len(request.Contents) > 0:
		for i := len(request.Contents) - 1; i >= 0; i-- {
			if request.Contents[i].Role == "user" {
				selected = &request.Contents[i]
				break
			}
		}
	case len(request.Input) > 0:
		var value string
		if common.GetJsonType(request.Input) == "string" && common.Unmarshal(request.Input, &value) == nil {
			text = &value
			break
		}
		var messages []usageInputMessage
		if common.Unmarshal(request.Input, &messages) != nil {
			return nil, false
		}
		for i := len(messages) - 1; i >= 0; i-- {
			if messages[i].Role == "user" {
				selected = &messages[i]
				break
			}
		}
	default:
		text = request.Prompt
	}
	if selected != nil {
		if selected.Content != nil {
			var value string
			if common.GetJsonType(selected.Content) == "string" && common.Unmarshal(selected.Content, &value) == nil {
				text = &value
			} else {
				var blocks []struct {
					Type string  `json:"type"`
					Text *string `json:"text"`
				}
				if common.Unmarshal(selected.Content, &blocks) != nil {
					return nil, false
				}
				parts := make([]string, 0, len(blocks))
				for _, block := range blocks {
					if (block.Type == "text" || block.Type == "input_text") && block.Text != nil {
						parts = append(parts, *block.Text)
					}
				}
				if len(parts) > 0 {
					value = strings.Join(parts, "\n")
					text = &value
				}
			}
		} else {
			parts := make([]string, 0, len(selected.Parts))
			for _, part := range selected.Parts {
				if part.Text != nil {
					parts = append(parts, *part.Text)
				}
			}
			if len(parts) > 0 {
				value := strings.Join(parts, "\n")
				text = &value
			}
		}
	}
	if text == nil {
		return nil, false
	}
	if utf8.RuneCountInString(*text) <= 4096 {
		return text, false
	}
	runes := []rune(*text)
	value := string(runes[:4096])
	return &value, true
}
