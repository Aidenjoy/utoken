package controller

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// tokenApiError 统一“按 ID+归属查令牌”未命中的响应：转为友好提示，
// 避免把 gorm 的 record not found 原样暴露给前端，
// 也避免通过错误差异探测他人令牌 ID。
func tokenApiError(c *gin.Context, err error) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiErrorI18n(c, i18n.MsgTokenNotFoundOrForbidden)
		return
	}
	common.ApiError(c, err)
}

func buildMaskedTokenResponse(c *gin.Context, token *model.Token) *model.Token {
	if token == nil {
		return nil
	}
	maskedToken := *token
	maskedToken.Key = token.GetMaskedKey()
	// SecretKey 掩码输出（明文仅经 /api/token/:id/access-key 返回）；AccessKey 是标识符，原样展示。
	maskedToken.SecretKey = token.GetMaskedSecretKey()
	if !model.IsAdmin(c.GetInt("id")) {
		maskedToken.ChannelId = 0
	}
	return &maskedToken
}

func buildMaskedTokenResponses(c *gin.Context, tokens []*model.Token) []*model.Token {
	maskedTokens := make([]*model.Token, 0, len(tokens))
	for _, token := range tokens {
		maskedTokens = append(maskedTokens, buildMaskedTokenResponse(c, token))
	}
	return maskedTokens
}

// tokenOwnerResponse 在脱敏令牌基础上附加归属用户名，仅管理员跨用户查看时填充。
type tokenOwnerResponse struct {
	*model.Token
	Username string `json:"username,omitempty"`
}

// tokenOwnerScope 解析令牌列表的归属用户：仅管理员生效，缺省只看自己；
// 显式传 userId=0 查看全部用户，userId=N 查看指定用户。
// 非管理员恒返回会话用户 ID，忽略任何越权参数。
func tokenOwnerScope(c *gin.Context) int {
	sessionID := c.GetInt("id")
	if !model.IsAdmin(sessionID) {
		return sessionID
	}
	raw := c.Query("userId")
	if raw == "" {
		return sessionID
	}
	scope, err := strconv.Atoi(raw)
	if err != nil || scope < 0 {
		return sessionID
	}
	return scope
}

// buildMaskedTokenResponsesWithOwner 脱敏并按需附加归属用户名：
// 仅当管理员查看非本人范围（全部/指定用户）时批量补用户名，自己视角不额外查询。
func buildMaskedTokenResponsesWithOwner(c *gin.Context, tokens []*model.Token, scopeUserID int) any {
	if scopeUserID == c.GetInt("id") {
		return buildMaskedTokenResponses(c, tokens)
	}
	ids := make([]int, 0, len(tokens))
	seen := make(map[int]bool, len(tokens))
	for _, token := range tokens {
		if !seen[token.UserId] {
			seen[token.UserId] = true
			ids = append(ids, token.UserId)
		}
	}
	names := map[int]string{}
	if fetched, err := model.GetUserNamesByIds(ids); err != nil {
		common.SysLog("failed to load token owner names: " + err.Error())
	} else {
		names = fetched
	}
	items := make([]*tokenOwnerResponse, 0, len(tokens))
	for _, token := range tokens {
		items = append(items, &tokenOwnerResponse{
			Token:    buildMaskedTokenResponse(c, token),
			Username: names[token.UserId],
		})
	}
	return items
}

func resolveTokenTargetUser(c *gin.Context, requestedUserId int) (int, error) {
	ownerId := c.GetInt("id")
	if requestedUserId == 0 || requestedUserId == ownerId {
		return ownerId, nil
	}
	if !model.IsAdmin(ownerId) {
		return 0, errors.New("无权代其他用户管理密钥")
	}
	if _, err := model.GetUserById(requestedUserId, false); err != nil {
		return 0, errors.New("目标用户不存在")
	}
	return requestedUserId, nil
}

// GetVideoKeyOptions 返回可创建的视频模型及 4K 能力，不泄露内部渠道和折扣。
func GetVideoKeyOptions(c *gin.Context) {
	requestedUserId := 0
	if raw := c.Query("user_id"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			common.ApiErrorI18n(c, i18n.MsgInvalidParams)
			return
		}
		requestedUserId = parsed
	}
	ownerId, err := resolveTokenTargetUser(c, requestedUserId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	options, err := service.ListVideoKeyOptions(ownerId, c.Query("group"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, options)
}

func GetAllTokens(c *gin.Context) {
	scopeUserID := tokenOwnerScope(c)
	// 已软删的令牌只对管理员可见：运营需要在页面上核对客户「删掉」的密钥（明文仍在库里），
	// 而不是去查数据库。普通用户恒为 false，忽略越权参数。
	includeDeleted, _ := strconv.ParseBool(c.Query("includeDeleted"))
	includeDeleted = includeDeleted && model.IsAdmin(c.GetInt("id"))
	pageInfo := common.GetPageQuery(c)
	tokens, err := model.GetAllUserTokens(scopeUserID, pageInfo.GetStartIdx(), pageInfo.GetPageSize(), includeDeleted)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	total, _ := model.CountUserTokens(scopeUserID, includeDeleted)
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(buildMaskedTokenResponsesWithOwner(c, tokens, scopeUserID))
	common.ApiSuccess(c, pageInfo)
}

func SearchTokens(c *gin.Context) {
	scopeUserID := tokenOwnerScope(c)
	keyword := c.Query("keyword")
	token := c.Query("token")

	pageInfo := common.GetPageQuery(c)

	tokens, total, err := model.SearchUserTokens(scopeUserID, keyword, token, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(buildMaskedTokenResponsesWithOwner(c, tokens, scopeUserID))
	common.ApiSuccess(c, pageInfo)
}

// readableToken 读取用于展示的令牌：管理员可读取任意用户的令牌（跨用户查看与复制密钥，
// 含已软删的历史令牌，客户删掉密钥后运营仍需在页面上取回明文），
// 普通用户仅能读取自己的。
func readableToken(c *gin.Context, id int) (*model.Token, error) {
	userId := c.GetInt("id")
	if model.IsAdmin(userId) {
		return model.GetTokenByIdIncludeDeleted(id)
	}
	return model.GetTokenByIds(id, userId)
}

// manageableToken 校验令牌写权限：本人或管理员可代管；不包含已软删令牌。
func manageableToken(c *gin.Context, id int) (*model.Token, error) {
	userId := c.GetInt("id")
	if model.IsAdmin(userId) {
		return model.GetTokenById(id)
	}
	return model.GetTokenByIds(id, userId)
}

func GetToken(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	token, err := readableToken(c, id)
	if err != nil {
		tokenApiError(c, err)
		return
	}
	common.ApiSuccess(c, buildMaskedTokenResponse(c, token))
}

func GetTokenKey(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	token, err := readableToken(c, id)
	if err != nil {
		tokenApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"key": token.GetFullKey(),
	})
}

// GetTokenAccessKey 返回令牌的 Ark AK/SK 明文（与 GetTokenKey 同安全级别，owner/admin 可读取）。
// 存量令牌尚无 AK/SK 时先补发（EnsureAccessKey）再返回，作为补发入口。
func GetTokenAccessKey(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	token, err := readableToken(c, id)
	if err != nil {
		tokenApiError(c, err)
		return
	}
	accessKey, secretKey, err := token.EnsureAccessKey()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"access_key": accessKey,
		"secret_key": secretKey,
	})
}

// ResetTokenAccessKey 重新生成令牌的 Ark AK/SK 并落库（旧值立即失效），返回新明文。
// 本人或管理员可重置，供用户密钥页与管理员代管弹窗共用。
func ResetTokenAccessKey(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	token, err := manageableToken(c, id)
	if err != nil {
		tokenApiError(c, err)
		return
	}
	accessKey, secretKey, err := token.ResetAccessKey()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if token.UserId != c.GetInt("id") {
		common.SysLog(fmt.Sprintf("admin %d reset AK/SK for token %d of user %d", c.GetInt("id"), token.Id, token.UserId))
	}
	common.ApiSuccess(c, gin.H{
		"access_key": accessKey,
		"secret_key": secretKey,
	})
}

func GetTokenStatus(c *gin.Context) {
	tokenId := c.GetInt("token_id")
	userId := c.GetInt("id")
	token, err := model.GetTokenByIds(tokenId, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	expiredAt := token.ExpiredTime
	if expiredAt == -1 {
		expiredAt = 0
	}
	c.JSON(http.StatusOK, gin.H{
		"object":          "credit_summary",
		"total_granted":   token.RemainQuota,
		"total_used":      0, // not supported currently
		"total_available": token.RemainQuota,
		"expires_at":      expiredAt * 1000,
	})
}

func GetTokenUsage(c *gin.Context) {
	authHeader := c.GetHeader("Authorization")
	if authHeader == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "No Authorization header",
		})
		return
	}

	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "Invalid Bearer token",
		})
		return
	}
	tokenKey := parts[1]

	token, err := model.GetTokenByKey(strings.TrimPrefix(tokenKey, "sk-"), false)
	if err != nil {
		common.SysError("failed to get token by key: " + err.Error())
		common.ApiErrorI18n(c, i18n.MsgTokenGetInfoFailed)
		return
	}

	expiredAt := token.ExpiredTime
	if expiredAt == -1 {
		expiredAt = 0
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    true,
		"message": "ok",
		"data": gin.H{
			"object":               "token_usage",
			"name":                 token.Name,
			"total_granted":        token.RemainQuota + token.UsedQuota,
			"total_used":           token.UsedQuota,
			"total_available":      token.RemainQuota,
			"unlimited_quota":      token.UnlimitedQuota,
			"model_limits":         token.GetModelLimitsMap(),
			"model_limits_enabled": token.ModelLimitsEnabled,
			"expires_at":           expiredAt,
		},
	})
}

func AddToken(c *gin.Context) {
	token := model.Token{}
	err := c.ShouldBindJSON(&token)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(token.Name) > 50 {
		common.ApiErrorI18n(c, i18n.MsgTokenNameTooLong)
		return
	}
	ownerId, err := resolveTokenTargetUser(c, token.UserId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	token.KeyType = strings.TrimSpace(token.KeyType)
	switch token.KeyType {
	case "", model.TokenKeyTypeLanguage, model.TokenKeyTypeImage, model.TokenKeyTypeVideo:
	default:
		common.ApiError(c, errors.New("不支持的密钥类型"))
		return
	}
	if token.KeyType == model.TokenKeyTypeVideo {
		token.VideoModel = strings.TrimSpace(token.VideoModel)
		if token.VideoModel == "" {
			common.ApiError(c, errors.New("视频模型 Key 必须选择模型"))
			return
		}
		token.ModelLimitsEnabled = true
		token.ModelLimits = token.VideoModel
	} else {
		token.VideoModel = ""
		token.Video4K = false
	}
	// 非无限额度时，检查额度值是否超出有效范围
	if !token.UnlimitedQuota {
		if token.RemainQuota < 0 {
			common.ApiErrorI18n(c, i18n.MsgTokenQuotaNegative)
			return
		}
		maxQuotaValue := int((1000000000 * common.QuotaPerUnit))
		if token.RemainQuota > maxQuotaValue {
			common.ApiErrorI18n(c, i18n.MsgTokenQuotaExceedMax, map[string]any{"Max": maxQuotaValue})
			return
		}
	}
	// 检查用户令牌数量是否已达上限
	maxTokens := operation_setting.GetMaxUserTokens()
	count, err := model.CountUserTokens(ownerId, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if int(count) >= maxTokens {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": fmt.Sprintf("已达到最大令牌数量限制 (%d)", maxTokens),
		})
		return
	}
	// 视频 Key 仅在创建时匹配一次最低折扣渠道；存量类型保留管理员手动绑定能力。
	bindChannelId := 0
	if token.KeyType == model.TokenKeyTypeVideo {
		channel, matchErr := service.MatchVideoKeyChannel(ownerId, token.Group, token.VideoModel, token.Video4K)
		if matchErr != nil {
			common.ApiError(c, matchErr)
			return
		}
		bindChannelId = channel.Id
	} else if token.KeyType == "" && token.ChannelId > 0 && model.IsAdmin(c.GetInt("id")) {
		if verr := service.ValidateTokenBindChannel(token.ChannelId); verr != nil {
			common.ApiError(c, verr)
			return
		}
		bindChannelId = token.ChannelId
	}
	key, err := common.GenerateKey()
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgTokenGenerateFailed)
		common.SysLog("failed to generate token key: " + err.Error())
		return
	}
	// 每个令牌同时签发一对 Ark AK/SK，供官方兼容素材库 API 的 V4 签名鉴权使用。
	accessKey, secretKey, err := model.GenerateArkCredentials()
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgTokenGenerateFailed)
		common.SysLog("failed to generate ark credentials: " + err.Error())
		return
	}
	cleanToken := model.Token{
		UserId:             ownerId,
		Name:               token.Name,
		Key:                key,
		AccessKey:          &accessKey,
		SecretKey:          secretKey,
		CreatedTime:        common.GetTimestamp(),
		AccessedTime:       common.GetTimestamp(),
		ExpiredTime:        token.ExpiredTime,
		RemainQuota:        token.RemainQuota,
		UnlimitedQuota:     token.UnlimitedQuota,
		ModelLimitsEnabled: token.ModelLimitsEnabled,
		ModelLimits:        token.ModelLimits,
		AllowIps:           token.AllowIps,
		Group:              token.Group,
		ChannelId:          bindChannelId,
		KeyType:            token.KeyType,
		VideoModel:         token.VideoModel,
		Video4K:            token.Video4K,
		CrossGroupRetry:    token.CrossGroupRetry,
	}
	err = cleanToken.Insert()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 返回脱敏令牌（含 ID），创建方可据此经 /api/token/:id/key 换取完整密钥
	common.ApiSuccess(c, buildMaskedTokenResponse(c, &cleanToken))
}

func DeleteToken(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	token, err := manageableToken(c, id)
	if err != nil {
		tokenApiError(c, err)
		return
	}
	if err = token.Delete(); err != nil {
		common.ApiError(c, err)
		return
	}
	if token.UserId != c.GetInt("id") {
		common.SysLog(fmt.Sprintf("admin %d deleted token %d of user %d", c.GetInt("id"), token.Id, token.UserId))
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

func UpdateToken(c *gin.Context) {
	userId := c.GetInt("id")
	statusOnly := c.Query("status_only")
	token := model.Token{}
	err := c.ShouldBindJSON(&token)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(token.Name) > 50 {
		common.ApiErrorI18n(c, i18n.MsgTokenNameTooLong)
		return
	}
	if !token.UnlimitedQuota {
		if token.RemainQuota < 0 {
			common.ApiErrorI18n(c, i18n.MsgTokenQuotaNegative)
			return
		}
		maxQuotaValue := int((1000000000 * common.QuotaPerUnit))
		if token.RemainQuota > maxQuotaValue {
			common.ApiErrorI18n(c, i18n.MsgTokenQuotaExceedMax, map[string]any{"Max": maxQuotaValue})
			return
		}
	}
	cleanToken, err := manageableToken(c, token.Id)
	if err != nil {
		tokenApiError(c, err)
		return
	}
	if token.Status == common.TokenStatusEnabled {
		if cleanToken.Status == common.TokenStatusExpired && cleanToken.ExpiredTime <= common.GetTimestamp() && cleanToken.ExpiredTime != -1 {
			common.ApiErrorI18n(c, i18n.MsgTokenExpiredCannotEnable)
			return
		}
		if cleanToken.Status == common.TokenStatusExhausted && cleanToken.RemainQuota <= 0 && !cleanToken.UnlimitedQuota {
			common.ApiErrorI18n(c, i18n.MsgTokenExhaustedCannotEable)
			return
		}
	}
	if statusOnly != "" {
		cleanToken.Status = token.Status
	} else if c.Query("channel_only") != "" {
		// 列表行内绑定渠道：仅超管可改，部分更新，其余字段保持原值。置 0 即解绑。
		if !model.IsAdmin(userId) {
			common.ApiError(c, errors.New("仅管理员可绑定渠道"))
			return
		}
		if verr := service.ValidateVideoTokenChannel(cleanToken, token.ChannelId); verr != nil {
			common.ApiError(c, verr)
			return
		}
		cleanToken.ChannelId = token.ChannelId
	} else {
		// If you add more fields, please also update token.Update()
		cleanToken.Name = token.Name
		cleanToken.ExpiredTime = token.ExpiredTime
		cleanToken.RemainQuota = token.RemainQuota
		cleanToken.UnlimitedQuota = token.UnlimitedQuota
		cleanToken.AllowIps = token.AllowIps
		if cleanToken.KeyType == model.TokenKeyTypeVideo {
			// 视频 Key 的模型、4K、分组与渠道快照在创建后保持固定，仅渠道可由管理员改派。
			cleanToken.ModelLimitsEnabled = true
			cleanToken.ModelLimits = cleanToken.VideoModel
		} else {
			cleanToken.ModelLimitsEnabled = token.ModelLimitsEnabled
			cleanToken.ModelLimits = token.ModelLimits
			cleanToken.Group = token.Group
			cleanToken.CrossGroupRetry = token.CrossGroupRetry
		}
		// 绑定渠道仅超管可改；普通用户保持原值（路由/进价对下游保密）。置 0 即解绑。
		if model.IsAdmin(userId) && token.ChannelId != cleanToken.ChannelId {
			if verr := service.ValidateVideoTokenChannel(cleanToken, token.ChannelId); verr != nil {
				common.ApiError(c, verr)
				return
			}
			cleanToken.ChannelId = token.ChannelId
		}
	}
	err = cleanToken.Update()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if cleanToken.UserId != userId {
		common.SysLog(fmt.Sprintf("admin %d updated token %d of user %d", userId, cleanToken.Id, cleanToken.UserId))
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    buildMaskedTokenResponse(c, cleanToken),
	})
}

type TokenBatch struct {
	Ids []int `json:"ids"`
}

func DeleteTokenBatch(c *gin.Context) {
	tokenBatch := TokenBatch{}
	if err := c.ShouldBindJSON(&tokenBatch); err != nil || len(tokenBatch.Ids) == 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	userId := c.GetInt("id")
	if model.IsAdmin(userId) {
		// 管理员代管指定用户的密钥时，批量删除与单条编辑使用相同的跨用户权限。
		userId = 0
	}
	count, err := model.BatchDeleteTokens(tokenBatch.Ids, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if userId == 0 {
		common.SysLog(fmt.Sprintf("admin %d batch deleted %d tokens", c.GetInt("id"), count))
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    count,
	})
}

func GetTokenKeysBatch(c *gin.Context) {
	tokenBatch := TokenBatch{}
	if err := c.ShouldBindJSON(&tokenBatch); err != nil || len(tokenBatch.Ids) == 0 {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	if len(tokenBatch.Ids) > 100 {
		common.ApiErrorI18n(c, i18n.MsgBatchTooMany, map[string]any{"Max": 100})
		return
	}
	userId := c.GetInt("id")
	if model.IsAdmin(userId) {
		// 管理员批量复制他人密钥时不限归属
		userId = 0
	}
	tokens, err := model.GetTokenKeysByIds(tokenBatch.Ids, userId)
	if err != nil {
		tokenApiError(c, err)
		return
	}
	keysMap := make(map[int]string)
	for _, t := range tokens {
		keysMap[t.Id] = t.GetFullKey()
	}
	common.ApiSuccess(c, gin.H{"keys": keysMap})
}
