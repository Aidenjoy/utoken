package controller

import (
	"math"
	"testing"

	"github.com/QuantumNous/new-api/model"

	"github.com/stretchr/testify/assert"
)

// TestValidateChannelUpstreamPrices locks the rate-card entry guard: prices must
// be non-negative finite numbers (a negative price would make the cost estimate
// negative, NaN/Inf would poison the row totals), model names must be non-empty,
// and an empty/nil card is legal (it clears the config back to token-only).
func TestValidateChannelUpstreamPrices(t *testing.T) {
	tests := []struct {
		name    string
		prices  model.ChannelUpstreamPrices
		wantErr bool
	}{
		{name: "nil card is valid", prices: nil, wantErr: false},
		{name: "empty card is valid", prices: model.ChannelUpstreamPrices{}, wantErr: false},
		{
			name:    "non-negative prices are valid",
			prices:  model.ChannelUpstreamPrices{"gpt-a": {Input: 3, Output: 15}},
			wantErr: false,
		},
		{
			name:    "zero prices are valid",
			prices:  model.ChannelUpstreamPrices{"gpt-a": {Input: 0, Output: 0}},
			wantErr: false,
		},
		{
			name:    "negative input is rejected",
			prices:  model.ChannelUpstreamPrices{"gpt-a": {Input: -1, Output: 15}},
			wantErr: true,
		},
		{
			name:    "negative output is rejected",
			prices:  model.ChannelUpstreamPrices{"gpt-a": {Input: 3, Output: -0.5}},
			wantErr: true,
		},
		{
			name:    "NaN is rejected",
			prices:  model.ChannelUpstreamPrices{"gpt-a": {Input: math.NaN(), Output: 15}},
			wantErr: true,
		},
		{
			name:    "positive infinity is rejected",
			prices:  model.ChannelUpstreamPrices{"gpt-a": {Input: 3, Output: math.Inf(1)}},
			wantErr: true,
		},
		{
			name:    "negative infinity is rejected",
			prices:  model.ChannelUpstreamPrices{"gpt-a": {Input: math.Inf(-1), Output: 15}},
			wantErr: true,
		},
		{
			name:    "empty model name is rejected",
			prices:  model.ChannelUpstreamPrices{"": {Input: 3, Output: 15}},
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateChannelUpstreamPrices(tt.prices)
			if tt.wantErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

// TestChannelDisplayName covers the CSV/label fallback: a named channel renders
// as "name(#id)", an unnamed one falls back to a bare "渠道 #id" so exports never
// show a blank channel column.
func TestChannelDisplayName(t *testing.T) {
	assert.Equal(t, "east(#1)", channelDisplayName(1, "east"))
	assert.Equal(t, "渠道 #2", channelDisplayName(2, ""))
}
