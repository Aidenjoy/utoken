package model

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/bytedance/gopkg/util/gopool"
	"gorm.io/gorm"
)

const (
	TokenKeyTypeLanguage = "language"
	TokenKeyTypeImage    = "image"
	TokenKeyTypeVideo    = "video"
)

type Token struct {
	Id                 int     `json:"id"`
	UserId             int     `json:"user_id" gorm:"index"`
	Key                string  `json:"key" gorm:"type:varchar(128);uniqueIndex"`
	AccessKey          *string `json:"access_key,omitempty" gorm:"type:varchar(64);uniqueIndex"` // Ark 官方兼容 API 的 AK；用指针以允许存量/未签发令牌为 NULL，避免空串互撞唯一索引（SQLite 存量表由 ensureTokenArkColumnsSQLite 预加普通列后再建唯一索引）
	SecretKey          string  `json:"secret_key,omitempty" gorm:"type:varchar(128)"`            // Ark SK，明文入库供 HMAC V4 验签（与 Key 同安全模型）
	Status             int     `json:"status" gorm:"default:1"`
	Name               string  `json:"name" gorm:"index" `
	CreatedTime        int64   `json:"created_time" gorm:"bigint"`
	AccessedTime       int64   `json:"accessed_time" gorm:"bigint"`
	ExpiredTime        int64   `json:"expired_time" gorm:"bigint;default:-1"` // -1 means never expired
	RemainQuota        int     `json:"remain_quota" gorm:"default:0"`
	UnlimitedQuota     bool    `json:"unlimited_quota"`
	ModelLimitsEnabled bool    `json:"model_limits_enabled"`
	ModelLimits        string  `json:"model_limits" gorm:"type:text"`
	AllowIps           *string `json:"allow_ips" gorm:"default:''"`
	UsedQuota          int     `json:"used_quota" gorm:"default:0"` // used quota
	Group              string  `json:"group" gorm:"default:''"`
	// ChannelId 绑定渠道：>0 时该密钥的视频生成与素材上传强制走此渠道（B端可控路由），0=未绑定。
	// 视频 Key 在创建时自动写入最高优先级渠道，之后仅超管可改派；普通用户响应中隐藏该字段。
	ChannelId int `json:"channel_id" gorm:"default:0"`
	// KeyType 为空表示存量密钥，保持原有行为；新密钥分为语言、图片、视频三类。
	KeyType         string         `json:"key_type" gorm:"type:varchar(16);default:''"`
	VideoModel      string         `json:"video_model" gorm:"type:varchar(255);default:''"`
	Video4K         bool           `json:"video_4k" gorm:"column:video_4k"`
	CrossGroupRetry bool           `json:"cross_group_retry"` // 跨分组重试，仅auto分组有效
	DeletedAt       gorm.DeletedAt `gorm:"index" json:"deleted_at"`
}

func (token *Token) Clean() {
	token.Key = ""
}

func MaskTokenKey(key string) string {
	if key == "" {
		return ""
	}
	if len(key) <= 4 {
		return strings.Repeat("*", len(key))
	}
	if len(key) <= 8 {
		return key[:2] + "****" + key[len(key)-2:]
	}
	return key[:4] + "**********" + key[len(key)-4:]
}

func (token *Token) GetFullKey() string {
	return token.Key
}

func (token *Token) GetMaskedKey() string {
	return MaskTokenKey(token.Key)
}

// arkAccessKeyPrefix 本站签发的 Ark AccessKey 前缀，便于与火山官方 AK 区分。
const arkAccessKeyPrefix = "AKUT"

// GetAccessKey 返回令牌的 AccessKey；未签发时返回空串。
func (token *Token) GetAccessKey() string {
	if token.AccessKey == nil {
		return ""
	}
	return *token.AccessKey
}

// GetMaskedSecretKey 返回掩码后的 SecretKey，用于列表/详情展示（明文仅经专用接口返回）。
func (token *Token) GetMaskedSecretKey() string {
	return MaskTokenKey(token.SecretKey)
}

// generateArkAccessKey 生成一个当前库中尚未占用的 AccessKey（AKUT + 20 位随机字符）。
// 撞库则重试（≤16 次）；access_key 唯一索引是最终防线。
func generateArkAccessKey() (string, error) {
	for i := 0; i < 16; i++ {
		suffix, err := common.GenerateRandomCharsKey(20)
		if err != nil {
			return "", err
		}
		candidate := arkAccessKeyPrefix + suffix
		if _, err := GetTokenByAccessKey(candidate, true); errors.Is(err, gorm.ErrRecordNotFound) {
			return candidate, nil
		}
	}
	return "", errors.New("failed to generate unique access key")
}

// generateArkSecretKey 生成 40 位随机 SecretKey（明文入库，供 HMAC V4 验签）。
func generateArkSecretKey() (string, error) {
	return common.GenerateRandomCharsKey(40)
}

// GenerateArkCredentials 生成一对新的 AK/SK（AK 保证库内唯一）。供创建令牌时预填。
func GenerateArkCredentials() (string, string, error) {
	ak, err := generateArkAccessKey()
	if err != nil {
		return "", "", err
	}
	sk, err := generateArkSecretKey()
	if err != nil {
		return "", "", err
	}
	return ak, sk, nil
}

// EnsureAccessKey 为尚无 AK/SK 的令牌补发并落库，返回 (ak, sk)。
// 已有则原样返回，供存量令牌按需补发。
func (token *Token) EnsureAccessKey() (string, string, error) {
	if token.GetAccessKey() != "" && token.SecretKey != "" {
		return token.GetAccessKey(), token.SecretKey, nil
	}
	return token.resetAccessKey()
}

// ResetAccessKey 重新生成 AK/SK 并落库（旧值立即失效），返回新明文。
func (token *Token) ResetAccessKey() (string, string, error) {
	return token.resetAccessKey()
}

func (token *Token) resetAccessKey() (string, string, error) {
	ak, sk, err := GenerateArkCredentials()
	if err != nil {
		return "", "", err
	}
	token.AccessKey = &ak
	token.SecretKey = sk
	if err := token.updateAccessKey(); err != nil {
		return "", "", err
	}
	return ak, sk, nil
}

// updateAccessKey 持久化 AK/SK 两列。AK 查询走 DB、不引入独立缓存，故无需失效 Redis。
func (token *Token) updateAccessKey() error {
	if token.Id == 0 {
		return errors.New("token id is required")
	}
	return DB.Model(&Token{}).Where("id = ?", token.Id).Updates(map[string]any{
		"access_key": token.AccessKey,
		"secret_key": token.SecretKey,
	}).Error
}

func (token *Token) GetIpLimits() []string {
	// delete empty spaces
	//split with \n
	ipLimits := make([]string, 0)
	if token.AllowIps == nil {
		return ipLimits
	}
	cleanIps := strings.ReplaceAll(*token.AllowIps, " ", "")
	if cleanIps == "" {
		return ipLimits
	}
	ips := strings.Split(cleanIps, "\n")
	for _, ip := range ips {
		ip = strings.TrimSpace(ip)
		ip = strings.ReplaceAll(ip, ",", "")
		if ip != "" {
			ipLimits = append(ipLimits, ip)
		}
	}
	return ipLimits
}

// tokenScopeQuery 构造令牌列表查询基底：userId>0 限定该用户；
// userId<=0（仅管理员全部用户视角）不限归属，但排除归属用户已注销的令牌：
// 用户软删或硬删后，relay 鉴权取不到用户缓存会直接拒绝，这些密钥已不可用。
// 子查询依赖 User 的软删默认作用域，同时覆盖已硬删的用户。
// includeDeleted 为真时连同已软删的令牌一起返回（仅管理员排查用）；
// 不限归属视角仍沿用上面的用户存在性过滤，不因该开关放大范围。
func tokenScopeQuery(userId int, includeDeleted bool) *gorm.DB {
	query := DB.Model(&Token{})
	if includeDeleted {
		query = DB.Unscoped().Model(&Token{})
	}
	if userId > 0 {
		return query.Where("user_id = ?", userId)
	}
	return query.Where("user_id IN (?)", DB.Model(&User{}).Select("id"))
}

// GetAllUserTokens 分页查询令牌；userId>0 限定该用户，userId<=0 表示不限用户。
// 不限用户仅服务于管理员归属过滤，调用方必须先行完成管理员鉴权。
func GetAllUserTokens(userId int, startIdx int, num int, includeDeleted bool) ([]*Token, error) {
	var tokens []*Token
	query := tokenScopeQuery(userId, includeDeleted)
	err := query.Order("id desc").Limit(num).Offset(startIdx).Find(&tokens).Error
	return tokens, err
}

// sanitizeLikePattern 校验并清洗用户输入的 LIKE 搜索模式。
// 规则：
//  1. 转义 ! 和 _（使用 ! 作为 ESCAPE 字符，兼容 MySQL/PostgreSQL/SQLite）
//  2. 连续的 % 合并为单个 %
//  3. 最多允许 2 个 %
//  4. 含 % 时（模糊搜索），去掉 % 后关键词长度必须 >= 2
//  5. 不含 % 时按精确匹配
func sanitizeLikePattern(input string) (string, error) {
	// 1. 先转义 ESCAPE 字符 ! 自身，再转义 _
	//    使用 ! 而非 \ 作为 ESCAPE 字符，避免 MySQL 中反斜杠的字符串转义问题
	input = strings.ReplaceAll(input, "!", "!!")
	input = strings.ReplaceAll(input, `_`, `!_`)

	if err := validateLikePattern(input); err != nil {
		return "", err
	}

	// 5. 无 % 时，精确全匹配
	return input, nil
}

func validateLikePattern(input string) error {
	// 1. 连续的 % 直接拒绝
	if strings.Contains(input, "%%") {
		return errors.New("搜索模式中不允许包含连续的 % 通配符")
	}

	// 2. 统计 % 数量，不得超过 2
	count := strings.Count(input, "%")
	if count > 2 {
		return errors.New("搜索模式中最多允许包含 2 个 % 通配符")
	}

	// 3. 含 % 时，去掉 % 后关键词长度必须 >= 2
	if count > 0 {
		stripped := strings.ReplaceAll(input, "%", "")
		if len(stripped) < 2 {
			return errors.New("使用模糊搜索时，关键词长度至少为 2 个字符")
		}
	}

	return nil
}

const searchHardLimit = 100

// searchAllUsersHardCap 管理员跨用户模糊搜索的 COUNT 截断上限，
// 避免对全表 LIKE 做无界 COUNT。
const searchAllUsersHardCap = 5000

func SearchUserTokens(userId int, keyword string, token string, offset int, limit int) (tokens []*Token, total int64, err error) {
	// model 层强制截断
	if limit <= 0 || limit > searchHardLimit {
		limit = searchHardLimit
	}
	if offset < 0 {
		offset = 0
	}

	if token != "" {
		token = strings.TrimPrefix(token, "sk-")
	}

	// 超量用户（令牌数超过上限）只允许精确搜索，禁止模糊搜索；
	// userId<=0 为管理员跨用户搜索，不受单用户令牌数限制，改用全局上限截断 COUNT
	maxTokens := operation_setting.GetMaxUserTokens()
	countCap := maxTokens
	hasFuzzy := strings.Contains(keyword, "%") || strings.Contains(token, "%")
	if userId > 0 && hasFuzzy {
		count, err := CountUserTokens(userId, false)
		if err != nil {
			common.SysLog("failed to count user tokens: " + err.Error())
			return nil, 0, errors.New("获取令牌数量失败")
		}
		if int(count) > maxTokens {
			return nil, 0, errors.New("令牌数量超过上限，仅允许精确搜索，请勿使用 % 通配符")
		}
	} else if userId <= 0 {
		countCap = searchAllUsersHardCap
	}

	baseQuery := tokenScopeQuery(userId, false)

	// 非空才加 LIKE 条件，空则跳过（不过滤该字段）
	if keyword != "" {
		keywordPattern, err := sanitizeLikePattern(keyword)
		if err != nil {
			return nil, 0, err
		}
		baseQuery = baseQuery.Where("name LIKE ? ESCAPE '!'", keywordPattern)
	}
	if token != "" {
		tokenPattern, err := sanitizeLikePattern(token)
		if err != nil {
			return nil, 0, err
		}
		baseQuery = baseQuery.Where(commonKeyCol+" LIKE ? ESCAPE '!'", tokenPattern)
	}

	// 先查匹配总数（用于分页，受上限保护，避免全表 COUNT）
	err = baseQuery.Limit(countCap).Count(&total).Error
	if err != nil {
		common.SysError("failed to count search tokens: " + err.Error())
		return nil, 0, errors.New("搜索令牌失败")
	}

	// 再分页查数据
	err = baseQuery.Order("id desc").Offset(offset).Limit(limit).Find(&tokens).Error
	if err != nil {
		common.SysError("failed to search tokens: " + err.Error())
		return nil, 0, errors.New("搜索令牌失败")
	}
	return tokens, total, nil
}

// checkTokenUsable 校验令牌可用性（状态/过期/额度）。返回 ErrTokenInvalid 表示不可用。
// 非 Redis 模式下顺带把过期/耗尽状态落库，与既有 ValidateUserToken 行为一致。
// ValidateUserToken（sk- 密钥）与 ValidateTokenByAccessKey（Ark AK）共用本校验，避免重复。
func checkTokenUsable(token *Token) error {
	if token.Status == common.TokenStatusExhausted ||
		token.Status == common.TokenStatusExpired ||
		token.Status != common.TokenStatusEnabled {
		return ErrTokenInvalid
	}
	if token.ExpiredTime != -1 && token.ExpiredTime < common.GetTimestamp() {
		if !common.RedisEnabled {
			token.Status = common.TokenStatusExpired
			if err := token.SelectUpdate(); err != nil {
				common.SysLog("failed to update token status" + err.Error())
			}
		}
		return ErrTokenInvalid
	}
	if !token.UnlimitedQuota && token.RemainQuota <= 0 {
		if !common.RedisEnabled {
			token.Status = common.TokenStatusExhausted
			if err := token.SelectUpdate(); err != nil {
				common.SysLog("failed to update token status" + err.Error())
			}
		}
		return ErrTokenInvalid
	}
	return nil
}

func ValidateUserToken(key string) (token *Token, err error) {
	if key == "" {
		return nil, ErrTokenNotProvided
	}
	token, err = GetTokenByKey(key, false)
	if err == nil {
		if uerr := checkTokenUsable(token); uerr != nil {
			return token, uerr
		}
		return token, nil
	}
	common.SysLog("ValidateUserToken: failed to get token: " + err.Error())
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrTokenInvalid
	}
	return nil, fmt.Errorf("%w: %v", ErrDatabase, err)
}

// GetTokenByAccessKey 按 AccessKey（Ark 官方兼容 API 的 AK）查令牌。
// AK 调用量小，本期直接查库；保留 fromDB 形参与 GetTokenByKey 同构，便于后续加缓存。
func GetTokenByAccessKey(ak string, fromDB bool) (*Token, error) {
	if ak == "" {
		return nil, gorm.ErrRecordNotFound
	}
	token := Token{}
	err := DB.Where("access_key = ?", ak).First(&token).Error
	return &token, err
}

// ValidateTokenByAccessKey 按 AccessKey 校验令牌可用性，复用 checkTokenUsable。
// 供 Ark 官方兼容 API 的 V4 鉴权中间件在验签通过后做令牌状态/过期/额度校验。
func ValidateTokenByAccessKey(ak string) (*Token, error) {
	if ak == "" {
		return nil, ErrTokenNotProvided
	}
	token, err := GetTokenByAccessKey(ak, true)
	if err != nil {
		common.SysLog("ValidateTokenByAccessKey: failed to get token: " + err.Error())
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrTokenInvalid
		}
		return nil, fmt.Errorf("%w: %v", ErrDatabase, err)
	}
	if uerr := checkTokenUsable(token); uerr != nil {
		return token, uerr
	}
	return token, nil
}

func GetTokenByIds(id int, userId int) (*Token, error) {
	if id == 0 || userId == 0 {
		return nil, errors.New("id 或 userId 为空！")
	}
	token := Token{Id: id, UserId: userId}
	var err error = nil
	err = DB.First(&token, "id = ? and user_id = ?", id, userId).Error
	return &token, err
}

func GetTokenById(id int) (*Token, error) {
	if id == 0 {
		return nil, errors.New("id 为空！")
	}
	token := Token{Id: id}
	var err error = nil
	err = DB.First(&token, "id = ?", id).Error
	if shouldUpdateRedis(true, err) {
		gopool.Go(func() {
			if err := cacheSetToken(token); err != nil {
				common.SysLog("failed to update user status cache: " + err.Error())
			}
		})
	}
	return &token, err
}

// GetTokenByIdIncludeDeleted 按 ID 读取令牌，包含已软删的行，仅供管理员排查与
// 复制历史密钥使用。刻意不写 Redis 缓存：已删除的令牌不可用于鉴权，
// 若被写入缓存会让它在缓存有效期内重新变成可用密钥。
func GetTokenByIdIncludeDeleted(id int) (*Token, error) {
	if id == 0 {
		return nil, errors.New("id 为空！")
	}
	token := Token{Id: id}
	err := DB.Unscoped().First(&token, "id = ?", id).Error
	return &token, err
}

func GetTokenByKey(key string, fromDB bool) (token *Token, err error) {
	defer func() {
		// Update Redis cache asynchronously on successful DB read
		if shouldUpdateRedis(fromDB, err) && token != nil {
			gopool.Go(func() {
				if err := cacheSetToken(*token); err != nil {
					common.SysLog("failed to update user status cache: " + err.Error())
				}
			})
		}
	}()
	if !fromDB && common.RedisEnabled {
		// Try Redis first
		token, err := cacheGetTokenByKey(key)
		if err == nil {
			return token, nil
		}
		// Don't return error - fall through to DB
	}
	fromDB = true
	err = DB.Where(commonKeyCol+" = ?", key).First(&token).Error
	return token, err
}

func (token *Token) Insert() error {
	var err error
	err = DB.Create(token).Error
	return err
}

// Update Make sure your token's fields is completed, because this will update non-zero values
func (token *Token) Update() (err error) {
	defer func() {
		if shouldUpdateRedis(true, err) {
			gopool.Go(func() {
				err := cacheSetToken(*token)
				if err != nil {
					common.SysLog("failed to update token cache: " + err.Error())
				}
			})
		}
	}()
	err = DB.Model(token).Select("name", "status", "expired_time", "remain_quota", "unlimited_quota",
		"model_limits_enabled", "model_limits", "allow_ips", "group", "channel_id", "cross_group_retry").Updates(token).Error
	return err
}

func (token *Token) SelectUpdate() (err error) {
	defer func() {
		if shouldUpdateRedis(true, err) {
			gopool.Go(func() {
				err := cacheSetToken(*token)
				if err != nil {
					common.SysLog("failed to update token cache: " + err.Error())
				}
			})
		}
	}()
	// This can update zero values
	return DB.Model(token).Select("accessed_time", "status").Updates(token).Error
}

func (token *Token) Delete() (err error) {
	defer func() {
		if shouldUpdateRedis(true, err) {
			gopool.Go(func() {
				err := cacheDeleteToken(token.Key)
				if err != nil {
					common.SysLog("failed to delete token cache: " + err.Error())
				}
			})
		}
	}()
	err = DB.Delete(token).Error
	return err
}

func (token *Token) IsModelLimitsEnabled() bool {
	return token.ModelLimitsEnabled
}

func (token *Token) GetModelLimits() []string {
	if token.ModelLimits == "" {
		return []string{}
	}
	return strings.Split(token.ModelLimits, ",")
}

func (token *Token) GetModelLimitsMap() map[string]bool {
	limits := token.GetModelLimits()
	limitsMap := make(map[string]bool)
	for _, limit := range limits {
		limitsMap[limit] = true
	}
	return limitsMap
}

func DisableModelLimits(tokenId int) error {
	token, err := GetTokenById(tokenId)
	if err != nil {
		return err
	}
	token.ModelLimitsEnabled = false
	token.ModelLimits = ""
	return token.Update()
}

func DeleteTokenById(id int, userId int) (err error) {
	// Why we need userId here? In case user want to delete other's token.
	if id == 0 || userId == 0 {
		return errors.New("id 或 userId 为空！")
	}
	token := Token{Id: id, UserId: userId}
	err = DB.Where(token).First(&token).Error
	if err != nil {
		return err
	}
	return token.Delete()
}

func IncreaseTokenQuota(tokenId int, key string, quota int) (err error) {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	if common.RedisEnabled {
		gopool.Go(func() {
			err := cacheIncrTokenQuota(key, int64(quota))
			if err != nil {
				common.SysLog("failed to increase token quota: " + err.Error())
			}
		})
	}
	if common.BatchUpdateEnabled {
		addNewRecord(BatchUpdateTypeTokenQuota, tokenId, quota)
		return nil
	}
	return increaseTokenQuota(tokenId, quota)
}

func increaseTokenQuota(id int, quota int) (err error) {
	err = DB.Model(&Token{}).Where("id = ?", id).Updates(
		map[string]interface{}{
			"remain_quota":  gorm.Expr("remain_quota + ?", quota),
			"used_quota":    gorm.Expr("used_quota - ?", quota),
			"accessed_time": common.GetTimestamp(),
		},
	).Error
	return err
}

func DecreaseTokenQuota(id int, key string, quota int) (err error) {
	if quota < 0 {
		return errors.New("quota 不能为负数！")
	}
	if common.BatchUpdateEnabled {
		// 批量模式：原子地检查余额并排队扣减（计入已排队的 delta）
		if !tryQueueTokenQuotaDecrease(id, quota) {
			return ErrInsufficientTokenQuota
		}
		// 缓存必须同步更新：DB 要等下次刷写才变化，若缓存不同步，
		// 后续读取令牌余额会拿到扣减前的旧值。
		if common.RedisEnabled {
			gopool.Go(func() {
				if err := cacheDecrTokenQuota(key, int64(quota)); err != nil {
					common.SysLog("failed to decrease token quota cache: " + err.Error())
				}
			})
		}
		return nil
	}
	if err := decreaseTokenQuota(id, quota); err != nil {
		return err
	}
	// DB 扣减成功后才更新 Redis 缓存
	if common.RedisEnabled {
		gopool.Go(func() {
			if err := cacheDecrTokenQuota(key, int64(quota)); err != nil {
				common.SysLog("failed to decrease token quota cache: " + err.Error())
			}
		})
	}
	return nil
}

// decreaseTokenQuota 原子扣减令牌余额。
// WHERE remain_quota >= quota 保证并发安全：余额不足时返回 ErrInsufficientTokenQuota。
func decreaseTokenQuota(id int, quota int) error {
	result := DB.Model(&Token{}).
		Where("id = ? AND remain_quota >= ?", id, quota).
		Updates(map[string]interface{}{
			"remain_quota":  gorm.Expr("remain_quota - ?", quota),
			"used_quota":    gorm.Expr("used_quota + ?", quota),
			"accessed_time": common.GetTimestamp(),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrInsufficientTokenQuota
	}
	return nil
}

// CountUserTokens 统计令牌数；userId>0 限定该用户，userId<=0 表示全部用户
// （仅管理员归属过滤路径可传 0），用于分页。includeDeleted 需与配对的
// GetAllUserTokens 一致，否则分页总数与列表口径不符；令牌数量上限校验恒传 false，
// 已删除的令牌不占用用户可创建数量。
func CountUserTokens(userId int, includeDeleted bool) (int64, error) {
	var total int64
	query := tokenScopeQuery(userId, includeDeleted)
	err := query.Count(&total).Error
	return total, err
}

// BatchDeleteTokens 删除一组令牌并返回数量。userId>0 限定本人；userId=0 不限归属，
// 仅供已完成管理员鉴权的代管入口使用，负值直接拒绝，避免误放大删除范围。
func BatchDeleteTokens(ids []int, userId int) (int, error) {
	if len(ids) == 0 {
		return 0, errors.New("ids 不能为空！")
	}
	if userId < 0 {
		return 0, errors.New("userId 不能为负数！")
	}

	tx := DB.Begin()
	where := "id IN (?)"
	args := []any{ids}
	if userId > 0 {
		where = "user_id = ? AND id IN (?)"
		args = []any{userId, ids}
	}

	var tokens []Token
	if err := tx.Where(where, args...).Find(&tokens).Error; err != nil {
		tx.Rollback()
		return 0, err
	}

	if err := tx.Where(where, args...).Delete(&Token{}).Error; err != nil {
		tx.Rollback()
		return 0, err
	}

	if err := tx.Commit().Error; err != nil {
		return 0, err
	}

	if common.RedisEnabled {
		gopool.Go(func() {
			for _, t := range tokens {
				_ = cacheDeleteToken(t.Key)
			}
		})
	}

	return len(tokens), nil
}

// GetTokenKeysByIds 批量取密钥明文：userId > 0 时限定归属用户，
// userId <= 0 表示不限归属（仅管理员批量查看/复制他人密钥使用）
func GetTokenKeysByIds(ids []int, userId int) ([]Token, error) {
	var tokens []Token
	query := DB.Select("id", commonKeyCol).Where("id IN (?)", ids)
	if userId > 0 {
		query = query.Where("user_id = ?", userId)
	}
	err := query.Find(&tokens).Error
	return tokens, err
}

// InvalidateUserTokensCache 清理指定用户所有令牌在 Redis 中的缓存，
// 配合 InvalidateUserCache 使用，可在用户被禁用/删除时立即阻断其令牌的请求。
// 下一次请求将从数据库重新加载令牌及用户状态，从而立即识别出被禁用的用户。
func InvalidateUserTokensCache(userId int) error {
	if !common.RedisEnabled {
		return nil
	}
	if userId <= 0 {
		return errors.New("userId 无效")
	}
	var tokens []Token
	if err := DB.Unscoped().
		Select("id", commonKeyCol).
		Where("user_id = ?", userId).
		Find(&tokens).Error; err != nil {
		return err
	}
	var firstErr error
	for _, t := range tokens {
		if t.Key == "" {
			continue
		}
		if err := cacheDeleteToken(t.Key); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}
