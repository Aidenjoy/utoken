/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package dto

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// Opus 4.7+ 与 Sonnet/Haiku 5 世代拒收非默认采样参数，检测必须命中这些世代，
// 同时不得误伤仍支持 temperature 的 4.x 及更早模型（含旧命名 claude-3-5-sonnet）。
func TestIsClaudeSamplingRestrictedModel(t *testing.T) {
	tests := []struct {
		model string
		want  bool
	}{
		// Sonnet 5 世代：受限
		{model: "claude-sonnet-5", want: true},
		{model: "claude-sonnet-5-5", want: true},
		{model: "claude-sonnet-5-5-20260101", want: true},
		{model: "claude-sonnet-5-5-thinking", want: true},
		// Opus 4.7+：受限
		{model: "claude-opus-4-7", want: true},
		{model: "claude-opus-4-8", want: true},
		{model: "claude-opus-4-8-high", want: true},
		{model: "claude-opus-5", want: true},
		{model: "claude-opus-5-1", want: true},
		// Haiku 5 世代：受限
		{model: "claude-haiku-5", want: true},
		{model: "claude-haiku-5-5", want: true},
		// 仍支持采样参数：不受限
		{model: "claude-sonnet-4-5", want: false},
		{model: "claude-sonnet-4-5-20250929", want: false},
		{model: "claude-sonnet-4-20250514", want: false},
		{model: "claude-opus-4-5-20251101", want: false},
		{model: "claude-opus-4-6", want: false},
		{model: "claude-opus-4-6-max", want: false},
		{model: "claude-haiku-4-5-20251001", want: false},
		// 旧命名（主版本恒为 3）：不受限
		{model: "claude-3-5-sonnet-20240620", want: false},
		{model: "claude-3-7-sonnet-20250219-thinking", want: false},
		{model: "claude-3-opus-20240229", want: false},
		{model: "claude-3-haiku-20240307", want: false},
		// 非 Claude / 异常名：不受限
		{model: "gpt-6-luna", want: false},
		{model: "claude-", want: false},
		{model: "", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.model, func(t *testing.T) {
			assert.Equal(t, tt.want, IsClaudeSamplingRestrictedModel(tt.model))
		})
	}
}
