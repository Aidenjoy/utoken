package controller

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/QuantumNous/new-api/model"
)

func TestIsOwnTOSURL(t *testing.T) {
	t.Setenv("TOS_ACCESS_KEY", "ak")
	t.Setenv("TOS_SECRET_KEY", "sk")
	t.Setenv("TOS_BUCKET", "my-bucket")
	t.Setenv("TOS_ENDPOINT", "https://tos-cn-beijing.volces.com")

	tests := []struct {
		name string
		url  string
		want bool
	}{
		{
			name: "own bucket object",
			url:  "https://my-bucket.tos-cn-beijing.volces.com/2026-09-03/1_assets/asset1.png",
			want: true,
		},
		{
			name: "upstream signed bucket",
			url:  "https://upstream-bucket.tos-1az-front.example.com/x.png?Signature=abc",
			want: false,
		},
		{
			name: "bucket name as path prefix only",
			url:  "https://other-host.example.com/my-bucket.tos-cn-beijing.volces.com/x.png",
			want: false,
		},
		{
			name: "empty url",
			url:  "",
			want: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, isOwnTOSURL(tt.url))
		})
	}
}

func TestIsOwnTOSURLUnconfigured(t *testing.T) {
	t.Setenv("TOS_ACCESS_KEY", "")
	t.Setenv("TOS_SECRET_KEY", "")
	t.Setenv("TOS_BUCKET", "")
	// 未配置 TOS 时任何地址都不算自有地址（mirror 会直接跳过）
	assert.False(t, isOwnTOSURL("https://my-bucket.tos-cn-beijing.volces.com/x.png"))
}

func TestAssetPreviewExt(t *testing.T) {
	tests := []struct {
		name      string
		assetType string
		remoteURL string
		want      string
	}{
		{
			name:      "path extension wins",
			assetType: model.AssetTypeImage,
			remoteURL: "https://cdn.example.com/dir/face.webp?X-Expires=1",
			want:      ".webp",
		},
		{
			name:      "video fallback",
			assetType: model.AssetTypeVideo,
			remoteURL: "https://cdn.example.com/dir/signed",
			want:      ".mp4",
		},
		{
			name:      "audio fallback",
			assetType: model.AssetTypeAudio,
			remoteURL: "https://cdn.example.com/dir/signed",
			want:      ".mp3",
		},
		{
			name:      "image fallback",
			assetType: model.AssetTypeImage,
			remoteURL: "https://cdn.example.com/dir/signed",
			want:      ".png",
		},
		{
			name:      "oversized extension ignored",
			assetType: model.AssetTypeImage,
			remoteURL: "https://cdn.example.com/dir/file.abcdefghi",
			want:      ".png",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			a := &model.Asset{AssetType: tt.assetType}
			got := assetPreviewExt(a, tt.remoteURL)
			require.Equal(t, tt.want, got)
		})
	}
}
