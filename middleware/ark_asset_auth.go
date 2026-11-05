package middleware

import (
	"bytes"
	"errors"
	"io"
	"net"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	asset "github.com/QuantumNous/new-api/relay/channel/asset"

	"github.com/gin-gonic/gin"
)

// Ark 官方兼容素材库 API 的 V4 签名鉴权中间件。
//
// 下游用火山官方 SDK/curl 把 endpoint 指向本站，请求形态为
// POST /?Action=<Action>&Version=2024-01-01，携带 AK/SK V4 签名。
// 本中间件负责：验签 → 令牌可用性校验 → IP 白名单 → 用户启用校验，
// 全部通过后把 userId/tokenId 写入 gin 上下文供控制器做归属过滤。
// 任一环节失败以官方错误信封（ResponseMetadata.Error）响应并 Abort。

// 上下文键与缺省值。控制器包会引用这些常量读取原始 body 与 region。
const (
	// ArkRawBodyKey 缓存已读取的请求 body，供控制器解析（避免重复读流）。
	ArkRawBodyKey = "ark_raw_body"
	// ArkRegionKey 保存从签名 scope 解析出的 region，供响应信封回填。
	ArkRegionKey = "ark_region"
	// ArkAccessKeyKey 保存验签解析出的 AK，供控制器日志/审计。
	ArkAccessKeyKey = "ark_access_key"
	// ArkDefaultRegion region 缺省值（签名头解析失败时使用）。
	ArkDefaultRegion = "cn-beijing"
)

// ArkAssetV4Auth 返回 Ark 官方素材库 API 的鉴权中间件。
func ArkAssetV4Auth() func(c *gin.Context) {
	return func(c *gin.Context) {
		action := c.Query("Action")
		region := asset.ParseAuthorizationRegion(c.Request.Header.Get("Authorization"))
		if region == "" {
			region = ArkDefaultRegion
		}
		c.Set(ArkRegionKey, region)

		// 读取并缓存 body：验签需要原始字节，控制器后续也要解析，故读一次存两处。
		body, err := c.GetRawData()
		if err != nil {
			common.SysError("ArkAssetV4Auth: failed to read request body: " + err.Error())
			abortArkAsset(c, action, region, http.StatusBadRequest, "InvalidRequest", "failed to read request body")
			return
		}
		c.Set(ArkRawBodyKey, body)
		c.Request.Body = io.NopCloser(bytes.NewReader(body))

		// Go 服务端把 Host 放在 Request.Host 而非 Header；验签重建规范头时需要它，
		// 故克隆 header 并显式补 Host（不污染原始请求头）。
		header := c.Request.Header.Clone()
		if header.Get("Host") == "" {
			header.Set("Host", c.Request.Host)
		}

		lookupSK := func(ak string) (string, bool) {
			tok, terr := model.GetTokenByAccessKey(ak, true)
			if terr != nil || tok == nil {
				return "", false
			}
			return tok.SecretKey, true
		}

		ak, verr := asset.VerifyV4Request(c.Request.Method, c.Request.URL.Path, c.Request.URL.RawQuery, header, body, lookupSK)
		if verr != nil {
			var ve *asset.VerifyError
			if errors.As(verr, &ve) {
				abortArkAsset(c, action, region, http.StatusForbidden, ve.Code, ve.Message)
			} else {
				abortArkAsset(c, action, region, http.StatusForbidden, "SignatureDoesNotMatch", verr.Error())
			}
			return
		}
		c.Set(ArkAccessKeyKey, ak)

		// 验签通过后复用令牌的状态/过期/额度校验。
		token, terr := model.ValidateTokenByAccessKey(ak)
		if terr != nil {
			if errors.Is(terr, model.ErrDatabase) {
				common.SysError("ArkAssetV4Auth: database error while validating token: " + terr.Error())
				abortArkAsset(c, action, region, http.StatusInternalServerError, "InternalError", "database error")
			} else {
				abortArkAsset(c, action, region, http.StatusForbidden, "InvalidAccessKeyId", "the token is invalid or has no remaining quota")
			}
			return
		}

		// IP 白名单校验，与 TokenAuth 一致。
		allowIps := token.GetIpLimits()
		if len(allowIps) > 0 {
			clientIp := c.ClientIP()
			ip := net.ParseIP(clientIp)
			if ip == nil {
				abortArkAsset(c, action, region, http.StatusForbidden, "AccessDenied", "unable to parse client IP address")
				return
			}
			if !common.IsIpInCIDRList(ip, allowIps) {
				abortArkAsset(c, action, region, http.StatusForbidden, "AccessDenied", "your IP address is not in the token's allow list")
				return
			}
		}

		// 用户启用校验。
		userCache, uerr := model.GetUserCache(token.UserId)
		if uerr != nil {
			common.SysError("ArkAssetV4Auth: failed to get user cache: " + uerr.Error())
			abortArkAsset(c, action, region, http.StatusInternalServerError, "InternalError", "database error")
			return
		}
		if userCache.Status != common.UserStatusEnabled {
			abortArkAsset(c, action, region, http.StatusForbidden, "UserDisabled", "the user account is disabled")
			return
		}

		c.Set("id", token.UserId)
		c.Set("token_id", token.Id)
		c.Set("token_name", token.Name)
		c.Next()
	}
}

// abortArkAsset 以官方错误信封响应并中止请求。CodeN 用 HTTP 状态码填充
// （本站无官方完整 CodeN 映射，下游 SDK 依据 Code 字符串判定错误类型）。
func abortArkAsset(c *gin.Context, action, region string, httpStatus int, code, message string) {
	c.Abort()
	c.JSON(httpStatus, asset.OfficialErrorEnvelope(action, region, httpStatus, code, message))
}
