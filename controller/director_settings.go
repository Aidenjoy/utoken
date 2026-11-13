package controller

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// ---------- 模型设定与内部令牌 ----------

// DirectorGetSettings 获取当前用户的云导演模型设定（附带各能力已绑定令牌详情）
func DirectorGetSettings(c *gin.Context) {
	userId := c.GetInt("id")
	settings, err := model.GetDirectorModelSettings(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	tokens := gin.H{}
	for _, serviceType := range []string{"text", "image", "video"} {
		token, err := model.GetDirectorTokenInfo(userId, serviceType)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if token != nil {
			tokens[serviceType] = gin.H{
				"tokenId": token.Id,
				"name":    token.Name,
			}
		} else {
			tokens[serviceType] = nil
		}
	}
	common.ApiSuccess(c, gin.H{
		"settings": settings,
		"tokens":   tokens,
	})
}

// DirectorUpdateSettings 保存模型设定并按能力绑定内部令牌（语言/图片/视频 Key 各自独立）
func DirectorUpdateSettings(c *gin.Context) {
	userId := c.GetInt("id")
	var req struct {
		TextModel    string `json:"textModel"`
		ImageModel   string `json:"imageModel"`
		VideoModel   string `json:"videoModel"`
		TextTokenID  int    `json:"textTokenId"`
		ImageTokenID int    `json:"imageTokenId"`
		VideoTokenID int    `json:"videoTokenId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	textModel := strings.TrimSpace(req.TextModel)
	imageModel := strings.TrimSpace(req.ImageModel)
	videoModel := strings.TrimSpace(req.VideoModel)
	if textModel == "" && imageModel == "" && videoModel == "" &&
		req.TextTokenID <= 0 && req.ImageTokenID <= 0 && req.VideoTokenID <= 0 {
		common.ApiErrorMsg(c, "请至少选择一个模型或模型 Key")
		return
	}
	// 视频 Key 锁定单一视频模型：保存前校验所选视频模型与 Key 绑定模型一致，
	// 避免保存后调用才被网关拒绝（存量空类型 Key 无绑定模型，不受此限）
	if req.VideoTokenID > 0 && videoModel != "" {
		videoToken, err := model.GetTokenByIds(req.VideoTokenID, userId)
		if err == nil && videoToken.VideoModel != "" && videoToken.VideoModel != videoModel {
			common.ApiErrorMsg(c, "视频模型与视频模型 Key 绑定的模型不一致，请重新选择")
			return
		}
	}
	for _, binding := range []struct {
		tokenID     int
		serviceType string
	}{
		{req.TextTokenID, "text"},
		{req.ImageTokenID, "image"},
		{req.VideoTokenID, "video"},
	} {
		if binding.tokenID <= 0 {
			continue
		}
		if err := model.BindDirectorToken(userId, binding.tokenID, binding.serviceType); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if err := model.UpsertDirectorModelSettings(userId, textModel, imageModel, videoModel); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
