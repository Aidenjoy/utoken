package controller

import (
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

// maxModelInfoTokens 上下文窗口/最大输出的 sanity 上限：纯展示元数据，
// 但仍拒绝荒谬值，避免管理页误填（如把字节数当 token 数）污染对外接口。
const maxModelInfoTokens = 100_000_000

// ListModelsInfo GET /v1/modelsinfo?type=all|text|image|video
// 基于 /v1/models 的可见范围，额外过滤仅针对本接口禁用的模型并返回模态分类；
// 上下文窗口与最大输出 token 数仅语言模型携带，且仅管理员配置过的模型才有。
func ListModelsInfo(c *gin.Context) {
	typeParam := strings.ToLower(strings.TrimSpace(c.DefaultQuery("type", "all")))
	switch typeParam {
	case "all", model.ModelCategoryText, model.ModelCategoryImage, model.ModelCategoryVideo:
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": types.OpenAIError{
			Message: fmt.Sprintf("Invalid type '%s': must be one of all, text, image, video", typeParam),
			Type:    "invalid_request_error",
			Param:   "type",
			Code:    "invalid_type",
		}})
		return
	}

	userModelNames, groups, err := listUserModelNames(c)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "get user group failed",
		})
		return
	}
	infos, err := model.GetAllModelInfos()
	if err != nil {
		common.SysError("list models info: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "get model info failed",
		})
		return
	}
	infoMap := make(map[string]model.ModelInfo, len(infos))
	for _, info := range infos {
		infoMap[info.ModelName] = info
	}

	ownerByModel := map[string]string{}
	if len(groups.ownerGroups) > 0 {
		ownerByModel = getPreferredModelOwners(userModelNames, groups.ownerGroups)
	}
	data := make([]dto.ModelsInfoItem, 0, len(userModelNames))
	for _, modelName := range userModelNames {
		// 仅在信息接口过滤，不修改共用模型清单和渠道路由状态。
		if info, ok := infoMap[modelName]; ok && info.Enabled != nil && !*info.Enabled {
			continue
		}
		category := model.GetModelCategory(modelName)
		if typeParam != "all" && category != typeParam {
			continue
		}
		base := buildOpenAIModel(modelName, ownerByModel)
		item := dto.ModelsInfoItem{
			Id:      base.Id,
			Object:  base.Object,
			Created: base.Created,
			OwnedBy: base.OwnedBy,
			Type:    category,
		}
		if category == model.ModelCategoryText {
			if info, ok := infoMap[modelName]; ok {
				item.ContextWindow = info.ContextWindow
				item.MaxOutputTokens = info.MaxOutputTokens
			}
		}
		data = append(data, item)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"object":  "list",
		"data":    data,
	})
}

// GetModelInfoSettings 管理页数据源：平台全部语言模型名单 + 已配置值。
func GetModelInfoSettings(c *gin.Context) {
	infos, err := model.GetAllModelInfos()
	if err != nil {
		common.SysError("get model info settings: " + err.Error())
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "get model info failed",
		})
		return
	}
	languageModels := make([]string, 0)
	for _, pricing := range model.GetPricing() {
		if model.GetModelCategory(pricing.ModelName) == model.ModelCategoryText {
			languageModels = append(languageModels, pricing.ModelName)
		}
	}
	sort.Strings(languageModels)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"language_models": languageModels,
			"infos":           infos,
		},
	})
}

// UpdateModelInfoSettings 全量保存管理页提交的配置列表。
func UpdateModelInfoSettings(c *gin.Context) {
	var req struct {
		Infos []model.ModelInfo `json:"infos"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "Invalid request: " + err.Error(),
		})
		return
	}
	seen := make(map[string]bool, len(req.Infos))
	disabledModels := make([]string, 0)
	for i := range req.Infos {
		info := &req.Infos[i]
		info.ModelName = strings.TrimSpace(info.ModelName)
		if info.ModelName == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false,
				"message": "model_name cannot be empty",
			})
			return
		}
		if seen[info.ModelName] {
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false,
				"message": fmt.Sprintf("duplicate model_name: %s", info.ModelName),
			})
			return
		}
		seen[info.ModelName] = true
		if info.Enabled != nil && !*info.Enabled {
			disabledModels = append(disabledModels, info.ModelName)
		}
		if info.ContextWindow < 0 || info.ContextWindow > maxModelInfoTokens ||
			info.MaxOutputTokens < 0 || info.MaxOutputTokens > maxModelInfoTokens {
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false,
				"message": fmt.Sprintf("model %s: token counts must be between 0 and %d", info.ModelName, maxModelInfoTokens),
			})
			return
		}
	}
	if err := model.SaveModelInfos(req.Infos); err != nil {
		common.SysError("save model info settings: " + err.Error())
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "save model info failed",
		})
		return
	}
	common.SysLog(fmt.Sprintf("model info settings saved: admin_id=%d, models=%d, modelsinfo_disabled=%v", c.GetInt("id"), len(req.Infos), disabledModels))
	c.JSON(http.StatusOK, gin.H{"success": true})
}
