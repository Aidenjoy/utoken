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
package director

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 渲染提交前的时间轴校验是与前端约定的契约：
// 片段非空、素材地址存在、出点必须大于入点（出点为 0 会产生零时长片段并被丢弃）。
func TestValidateRenderTimeline(t *testing.T) {
	validClip := editClip{SrcURL: "https://example.com/a.mp4", Start: 0, End: 5}

	tests := []struct {
		name    string
		clips   []editClip
		wantErr string
	}{
		{
			name:    "empty clips rejected",
			clips:   nil,
			wantErr: "时间轴上没有视频片段，无法渲染",
		},
		{
			name:    "missing source url rejected",
			clips:   []editClip{{SrcURL: "", Start: 0, End: 5}},
			wantErr: "第 1 个片段缺少源视频地址",
		},
		{
			name:    "zero end point rejected",
			clips:   []editClip{{SrcURL: "https://example.com/a.mp4", Start: 0, End: 0}},
			wantErr: "第 1 个片段的出点必须大于入点",
		},
		{
			name:    "end equal to start rejected",
			clips:   []editClip{{SrcURL: "https://example.com/a.mp4", Start: 3, End: 3}},
			wantErr: "第 1 个片段的出点必须大于入点",
		},
		{
			name: "later invalid clip reports its position",
			clips: []editClip{
				validClip,
				{SrcURL: "https://example.com/b.mp4", Start: 6, End: 2},
			},
			wantErr: "第 2 个片段的出点必须大于入点",
		},
		{
			name:    "valid timeline accepted",
			clips:   []editClip{validClip},
			wantErr: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateRenderTimeline(editTimeline{Clips: tt.clips})
			if tt.wantErr == "" {
				require.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.Equal(t, tt.wantErr, err.Error())
		})
	}
}

// 片段时长 = (出点-入点)/变速倍率：非法倍率按 1 处理，负时长按 0 截断，
// 这是渲染总时长与进度计算的基础。
func TestClipDuration(t *testing.T) {
	tests := []struct {
		name string
		clip editClip
		want float64
	}{
		{
			name: "plain duration",
			clip: editClip{Start: 0, End: 5, Speed: 1},
			want: 5,
		},
		{
			name: "offset range",
			clip: editClip{Start: 2, End: 5, Speed: 1},
			want: 3,
		},
		{
			name: "slow motion doubles duration",
			clip: editClip{Start: 0, End: 5, Speed: 0.5},
			want: 10,
		},
		{
			name: "zero speed falls back to 1",
			clip: editClip{Start: 0, End: 5, Speed: 0},
			want: 5,
		},
		{
			name: "negative speed falls back to 1",
			clip: editClip{Start: 0, End: 5, Speed: -2},
			want: 5,
		},
		{
			name: "inverted range clamps to zero",
			clip: editClip{Start: 5, End: 2, Speed: 1},
			want: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.InDelta(t, tt.want, tt.clip.clipDuration(), 1e-9)
		})
	}
}

func TestTimelineTotalDuration(t *testing.T) {
	tl := editTimeline{
		Clips: []editClip{
			{Start: 0, End: 5, Speed: 1},
			{Start: 0, End: 4, Speed: 2},
			{Start: 0, End: 0, Speed: 1},
		},
	}
	assert.InDelta(t, 7.0, tl.totalDuration(), 1e-9)
}
