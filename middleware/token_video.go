package middleware

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// validateVideoTokenRequest 保证视频 Key 的模型和 4K 档位不能在调用时被绕过。
// 存量空类型 Key 返回 nil，继续沿用原有锁渠道行为。
func validateVideoTokenRequest(c *gin.Context, modelName, resolution string) error {
	keyType := c.GetString("token_key_type")
	if keyType == "" {
		return nil
	}
	if keyType != model.TokenKeyTypeVideo {
		return errors.New("当前密钥不能用于视频生成，请使用视频模型 Key")
	}
	if modelName != c.GetString("token_video_model") {
		return fmt.Errorf("当前密钥仅允许调用模型 %s", c.GetString("token_video_model"))
	}
	is4K := strings.EqualFold(strings.TrimSpace(resolution), "4k")
	if c.GetBool("token_video_4k") && !is4K {
		return errors.New("当前密钥仅允许 4K 视频请求，请显式设置 resolution 为 4k")
	}
	if !c.GetBool("token_video_4k") && is4K {
		return errors.New("当前密钥不支持 4K 视频请求，请使用已选择 4K 的视频模型 Key")
	}
	return nil
}
