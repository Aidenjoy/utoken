package controller

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// ---------- 模型设定与内部令牌 ----------

// DirectorGetSettings 获取当前用户的云导演模型设定（附带已绑定令牌详情）
func DirectorGetSettings(c *gin.Context) {
	userId := c.GetInt("id")
	settings, err := model.GetDirectorModelSettings(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var tokenInfo gin.H
	token, err := model.GetDirectorTokenInfo(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if token != nil {
		tokenInfo = gin.H{
			"tokenId": token.Id,
			"name":    token.Name,
		}
	}
	common.ApiSuccess(c, gin.H{
		"settings": settings,
		"token":    tokenInfo,
	})
}

// DirectorUpdateSettings 保存模型设定并绑定内部令牌（令牌从用户已有令牌中选择，可设限额）
func DirectorUpdateSettings(c *gin.Context) {
	userId := c.GetInt("id")
	var req struct {
		TextModel  string `json:"textModel"`
		ImageModel string `json:"imageModel"`
		VideoModel string `json:"videoModel"`
		TokenID    int    `json:"tokenId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}
	textModel := strings.TrimSpace(req.TextModel)
	imageModel := strings.TrimSpace(req.ImageModel)
	videoModel := strings.TrimSpace(req.VideoModel)
	if textModel == "" && imageModel == "" && videoModel == "" && req.TokenID <= 0 {
		common.ApiErrorMsg(c, "请至少选择一个模型或内部令牌")
		return
	}
	if req.TokenID > 0 {
		if err := model.BindDirectorToken(userId, req.TokenID); err != nil {
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
