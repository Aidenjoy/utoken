package model

import (
	"strings"
	"time"

	"gorm.io/gorm"
)

// ModelInfo 管理 /v1/modelsinfo 的展示状态与语言模型 token 元数据，
// 不影响模型调用或 /v1/models。管理页每次提交整份列表。
type ModelInfo struct {
	ModelName       string `json:"model_name" gorm:"primaryKey"`
	ContextWindow   int    `json:"context_window"`
	MaxOutputTokens int    `json:"max_output_tokens"`
	UpdatedTime     int64  `json:"updated_time"`
	// nil 兼容存量配置和旧客户端，表示启用；不使用数据库布尔默认值。
	Enabled *bool `json:"enabled" gorm:"column:is_enabled"`
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

// SaveModelInfos 全量替换配置：token 值均为 0 且启用的条目可删除，
// 禁用条目必须保留，以免清空 token 配置时丢失禁用状态。
func SaveModelInfos(infos []ModelInfo) error {
	kept := make([]ModelInfo, 0, len(infos))
	now := time.Now().Unix()
	for _, info := range infos {
		if info.ContextWindow == 0 && info.MaxOutputTokens == 0 && (info.Enabled == nil || *info.Enabled) {
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
