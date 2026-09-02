package director

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"os"
	"time"
)

// SplitGridImage 将九宫格图片拆分为 9 张子图并转存 TOS，返回子图访问地址
// rawURL 支持远程链接；outPrefix 用于命名子图文件
func SplitGridImage(rawURL, outPrefix string, userID, projectID int) ([]string, error) {
	workDir, err := os.MkdirTemp("", "director-grid-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(workDir)

	localPath, err := materializeToLocal(rawURL, workDir, "grid_source")
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(localPath)
	if err != nil {
		return nil, fmt.Errorf("读取原图失败: %w", err)
	}
	src, err := decodeImage(data)
	if err != nil {
		return nil, err
	}

	bounds := src.Bounds()
	cellW := bounds.Dx() / 3
	cellH := bounds.Dy() / 3
	if cellW == 0 || cellH == 0 {
		return nil, fmt.Errorf("图片尺寸过小（%dx%d），无法拆分九宫格", bounds.Dx(), bounds.Dy())
	}

	if outPrefix == "" {
		outPrefix = fmt.Sprintf("grid_%d", time.Now().UnixNano())
	}
	urls := make([]string, 0, 9)
	for row := 0; row < 3; row++ {
		for col := 0; col < 3; col++ {
			rect := image.Rect(bounds.Min.X+col*cellW, bounds.Min.Y+row*cellH, bounds.Min.X+(col+1)*cellW, bounds.Min.Y+(row+1)*cellH)
			cell := image.NewRGBA(image.Rect(0, 0, cellW, cellH))
			for y := 0; y < cellH; y++ {
				for x := 0; x < cellW; x++ {
					cell.Set(x, y, src.At(rect.Min.X+x, rect.Min.Y+y))
				}
			}
			var buf bytes.Buffer
			if err = png.Encode(&buf, cell); err != nil {
				return nil, err
			}
			url, err := storeBytesToTOS(buf.Bytes(), fmt.Sprintf("%s_%d.png", outPrefix, row*3+col+1), userID, projectID)
			if err != nil {
				return nil, err
			}
			urls = append(urls, url)
		}
	}
	return urls, nil
}

// decodeImage 按格式解码图片（png/jpeg）
func decodeImage(data []byte) (image.Image, error) {
	img, err := png.Decode(bytes.NewReader(data))
	if err == nil {
		return img, nil
	}
	img, err = jpeg.Decode(bytes.NewReader(data))
	if err == nil {
		return img, nil
	}
	return nil, fmt.Errorf("不支持的图片格式（仅支持 png/jpeg）: %w", err)
}
