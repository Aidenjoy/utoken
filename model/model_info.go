package model

import (
	"strings"
	"time"

	"gorm.io/gorm"
)

// ModelInfo 管理员按模型配置的上下文窗口与最大输出 token 数，仅语言模型有意义，
// 经 /v1/modelsinfo 对外暴露。全量替换式保存：管理页每次提交整份列表。
type ModelInfo struct {
	ModelName       string `json:"model_name" gorm:"primaryKey"`
	ContextWindow   int    `json:"context_window"`
	MaxOutputTokens int    `json:"max_output_tokens"`
	UpdatedTime     int64  `json:"updated_time"`
}

// 模态分类取值。/v1/modelsinfo 的 type 筛选与管理页语言模型列表共用同一口径。
const (
	ModelCategoryText  = "text"
	ModelCategoryImage = "image"
	ModelCategoryVideo = "video"
)

// 名字模式与 web/default/src/lib/model-category.ts 保持一致（模型广场/对话页
// 的模态计数同源），修改任一侧时必须同步另一侧。视频先于图片判定，
// 使同时带两类线索的名字（如 hunyuanvideo）保持视频归类。
var modelCategoryVideoHints = []string{
	"seedance", "sora", "hailuo", "vidu", "kling", "jimeng",
	"veo", "wan-", "hunyuanvideo", "pika", "video",
}

var modelCategoryImageHints = []string{
	"seedream", "dall-e", "gpt-image", "cogview", "flux", "imagen",
	"stable-diffusion", "sdxl", "kolors", "qwen-image", "hunyuan-image",
	"step-1x", "ideogram", "recraft", "t2i", "image",
}

func GetModelCategory(modelName string) string {
	lower := strings.ToLower(modelName)
	for _, hint := range modelCategoryVideoHints {
		if strings.Contains(lower, hint) {
			return ModelCategoryVideo
		}
	}
	for _, hint := range modelCategoryImageHints {
		if strings.Contains(lower, hint) {
			return ModelCategoryImage
		}
	}
	return ModelCategoryText
}

func GetAllModelInfos() ([]ModelInfo, error) {
	var infos []ModelInfo
	err := DB.Find(&infos).Error
	return infos, err
}

// SaveModelInfos 全量替换配置：两个值都为 0 的条目视为未配置并删除，
// 其余整表重写。管理页提交整份列表，故不做逐条 upsert。
func SaveModelInfos(infos []ModelInfo) error {
	kept := make([]ModelInfo, 0, len(infos))
	now := time.Now().Unix()
	for _, info := range infos {
		if info.ContextWindow == 0 && info.MaxOutputTokens == 0 {
			continue
		}
		info.UpdatedTime = now
		kept = append(kept, info)
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&ModelInfo{}).Error; err != nil {
			return err
		}
		if len(kept) == 0 {
			return nil
		}
		return tx.Create(&kept).Error
	})
}
