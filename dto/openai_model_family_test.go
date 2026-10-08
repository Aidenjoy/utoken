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

// gpt-5 及之后世代拒收采样参数，检测必须按主版本命中后续世代（gpt-6-luna 等），
// 同时不得误伤 gpt-4o / gpt-4.1 / gpt-oss 等经典 chat 模型名。
func TestIsOpenAIGPT5ModelMajorVersionDetection(t *testing.T) {
	tests := []struct {
		model string
		want  bool
	}{
		{model: "gpt-5", want: true},
		{model: "gpt-5.6-luna", want: true},
		{model: "gpt-5-chat-latest", want: true},
		{model: "gpt-6", want: true},
		{model: "gpt-6-luna", want: true},
		{model: "gpt-6.1-sol", want: true},
		{model: "gpt-4", want: false},
		{model: "gpt-4.1", want: false},
		{model: "gpt-4o-mini", want: false},
		{model: "gpt-3.5-turbo", want: false},
		{model: "gpt-oss-120", want: false},
		{model: "gpt-image-1", want: false},
		{model: "gpt-realtime", want: false},
		{model: "claude-opus-4-8", want: false},
		{model: "", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.model, func(t *testing.T) {
			assert.Equal(t, tt.want, IsOpenAIGPT5Model(tt.model))
		})
	}
}
