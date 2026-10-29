package dto

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolutionSupported(t *testing.T) {
	blacklist := map[string][]string{
		"seedance-2-0": {"4k", " 1080P "},
		"seedance-2-5": {},
	}

	tests := []struct {
		name       string
		model      string
		resolution string
		want       bool
	}{
		{name: "blacklisted 4k exact", model: "seedance-2-0", resolution: "4k", want: false},
		{name: "blacklisted 4k uppercase", model: "seedance-2-0", resolution: "4K", want: false},
		{name: "blacklisted with surrounding space", model: "seedance-2-0", resolution: "  4k  ", want: false},
		{name: "blacklist entry normalized case/space", model: "seedance-2-0", resolution: "1080p", want: false},
		{name: "non-blacklisted resolution", model: "seedance-2-0", resolution: "720p", want: true},
		{name: "model with empty blacklist", model: "seedance-2-5", resolution: "4k", want: true},
		{name: "model not listed is fully supported", model: "seedance-3-0", resolution: "4k", want: true},
		{name: "empty resolution skips filtering", model: "seedance-2-0", resolution: "", want: true},
		{name: "whitespace resolution skips filtering", model: "seedance-2-0", resolution: "   ", want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, ResolutionSupported(blacklist, tt.model, tt.resolution))
		})
	}

	// 空黑名单（nil / 空表）恒为支持，保证未配置渠道向后兼容。
	assert.True(t, ResolutionSupported(nil, "seedance-2-0", "4k"))
	assert.True(t, ResolutionSupported(map[string][]string{}, "seedance-2-0", "4k"))
}

func TestChannelSettingsSupportsResolution(t *testing.T) {
	settings := ChannelSettings{
		ResolutionBlacklist: map[string][]string{"seedance-2-0": {"4k"}},
	}
	assert.False(t, settings.SupportsResolution("seedance-2-0", "4k"))
	assert.True(t, settings.SupportsResolution("seedance-2-0", "720p"))
	assert.True(t, settings.SupportsResolution("seedance-2-5", "4k"))
}

func TestAdvancedCustomValidateResponsesToChatConverterPath(t *testing.T) {
	valid := &AdvancedCustomConfig{
		Routes: []AdvancedCustomRoute{
			{
				IncomingPath: "/v1/responses",
				UpstreamPath: "/v1/chat/completions",
				Converter:    AdvancedCustomConverterOpenAIResponsesToOpenAIChatCompletions,
			},
		},
	}
	require.NoError(t, valid.Validate())

	tests := []struct {
		name         string
		incomingPath string
	}{
		{name: "chat completions", incomingPath: "/v1/chat/completions"},
		{name: "responses compact", incomingPath: "/v1/responses/compact"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := &AdvancedCustomConfig{
				Routes: []AdvancedCustomRoute{
					{
						IncomingPath: tt.incomingPath,
						UpstreamPath: "/v1/chat/completions",
						Converter:    AdvancedCustomConverterOpenAIResponsesToOpenAIChatCompletions,
					},
				},
			}
			err := config.Validate()
			require.Error(t, err)
			assert.Contains(t, err.Error(), "converter does not match incoming_path")
		})
	}
}
