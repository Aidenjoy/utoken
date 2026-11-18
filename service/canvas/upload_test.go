package canvas

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// 上传接口：格式、体积与像素校验必须与任务提交时的输入校验一致，
// 否则会出现「能上传、提交任务却被拒」的割裂。
func TestUploadImageValidates(t *testing.T) {
	setupCanvasTest(t)
	const userID = 9101
	seedUser(t, userID, 1_000_000)
	project := newProject(t, userID)

	t.Run("合法 PNG 返回原始像素尺寸", func(t *testing.T) {
		upload, err := UploadImage(userID, project.ID, "my photo.png", testPNG(t, 320, 240))
		require.NoError(t, err)
		require.Equal(t, 320, upload.Width)
		require.Equal(t, 240, upload.Height)
		require.Equal(t, "png", upload.Format)
		require.True(t, strings.HasSuffix(upload.URL, "/stored/my photo.png"),
			"对象键应沿用原文件名（扩展名按真实格式纠正）: %s", upload.URL)
	})

	t.Run("扩展名按真实格式纠正", func(t *testing.T) {
		upload, err := UploadImage(userID, project.ID, "fake.jpg", testPNG(t, 64, 64))
		require.NoError(t, err)
		require.True(t, strings.HasSuffix(upload.URL, ".png"), upload.URL)
	})

	t.Run("文件名为空时兜底", func(t *testing.T) {
		upload, err := UploadImage(userID, project.ID, "", testPNG(t, 32, 32))
		require.NoError(t, err)
		require.Equal(t, "canvas_upload.png", upload.Name)
	})

	t.Run("空文件被拒", func(t *testing.T) {
		_, err := UploadImage(userID, project.ID, "empty.png", nil)
		require.Error(t, err)
	})

	t.Run("非图片被拒", func(t *testing.T) {
		_, err := UploadImage(userID, project.ID, "note.txt", []byte("hello world"))
		require.ErrorIs(t, err, ErrUnsupportedImage)
	})

	t.Run("超过体积上限被拒", func(t *testing.T) {
		oversize := bytes.Repeat([]byte{0}, int(maxUploadBytes())+1)
		_, err := UploadImage(userID, project.ID, "big.png", oversize)
		require.Error(t, err)
		require.Contains(t, err.Error(), "体积上限")
	})

	t.Run("单边超限被拒", func(t *testing.T) {
		img := image.NewRGBA(image.Rect(0, 0, maxCanvasSide+1, 8))
		img.Set(0, 0, color.RGBA{R: 255, A: 255})
		var buf bytes.Buffer
		require.NoError(t, png.Encode(&buf, img))
		_, err := UploadImage(userID, project.ID, "wide.png", buf.Bytes())
		require.Error(t, err)
		require.Contains(t, err.Error(), "单边上限")
	})
}
