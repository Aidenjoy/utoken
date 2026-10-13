package model

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// 折扣邀请码归属类型
const (
	OwnerTypeAgent = "agent"
	OwnerTypeAdmin = "admin"
)

// 折扣邀请码状态
const (
	DiscountCodeStatusEnabled  = 1
	DiscountCodeStatusDisabled = 2
)

var (
	ErrDiscountCodeNotFound  = errors.New("discount code not found")
	ErrDiscountCodeDisabled  = errors.New("discount code disabled")
	ErrDiscountCodeExpired   = errors.New("discount code expired")
	ErrDiscountCodeExhausted = errors.New("discount code exhausted")
	ErrDiscountInvalid       = errors.New("invalid discount value")
	ErrDiscountOutOfRange    = errors.New("discount out of allowed range")
	ErrDiscountCodeGenerate  = errors.New("failed to generate unique discount code")
)

// DiscountInviteCode 折扣邀请码。Discount 为支付乘数 (0,1]（0.6=6折=支付60%）。
// 码可被多人复用（MaxUses=0 表示不限次），用户注册时消费一次并永久绑定该折扣。
type DiscountInviteCode struct {
	Id          int     `json:"id"`
	Code        string  `json:"code" gorm:"type:varchar(32);uniqueIndex;column:code"`
	OwnerType   string  `json:"owner_type" gorm:"type:varchar(16);column:owner_type"`
	OwnerUserId int     `json:"owner_user_id" gorm:"type:int;index;column:owner_user_id"`
	Discount    float64 `json:"discount" gorm:"column:discount"`
	MaxUses     int     `json:"max_uses" gorm:"type:int;default:0;column:max_uses"`
	UsedCount   int     `json:"used_count" gorm:"type:int;default:0;column:used_count"`
	ExpiresAt   int64   `json:"expires_at" gorm:"default:0;column:expires_at"`
	Status      int     `json:"status" gorm:"type:int;default:1;column:status"`
	Remark      string  `json:"remark" gorm:"type:varchar(255);column:remark" validate:"max=255"`
	CreatedAt   int64   `json:"created_at" gorm:"autoCreateTime;column:created_at"`
	UpdatedAt   int64   `json:"updated_at" gorm:"autoUpdateTime;column:updated_at"`

	// 列表返回时回填，不落库
	OwnerUsername string `json:"owner_username" gorm:"-"`
	OwnerEmail    string `json:"owner_email" gorm:"-"`
	// 导流统计回填，不落库：绑定用户数与其成功充值面值总额
	InvitedUserCount int64 `json:"invited_user_count" gorm:"-"`
	InvitedRecharge  int64 `json:"invited_recharge" gorm:"-"`
}

// ValidateDiscountValue 校验折扣绝对边界：0 < discount <= 1。
func ValidateDiscountValue(discount float64) error {
	if !(discount > 0) || discount > 1 {
		return ErrDiscountInvalid
	}
	return nil
}

// ValidateDiscountInRange 校验折扣落在代理商允许区间 [min, max] 内。
func ValidateDiscountInRange(discount, min, max float64) error {
	if err := ValidateDiscountValue(discount); err != nil {
		return err
	}
	if discount < min || discount > max {
		return ErrDiscountOutOfRange
	}
	return nil
}

// CheckUsable 只读校验码当前是否可用（不消费），返回类型化错误。
func (dc *DiscountInviteCode) CheckUsable(now int64) error {
	if dc.Status != DiscountCodeStatusEnabled {
		return ErrDiscountCodeDisabled
	}
	if dc.ExpiresAt > 0 && dc.ExpiresAt <= now {
		return ErrDiscountCodeExpired
	}
	if dc.MaxUses > 0 && dc.UsedCount >= dc.MaxUses {
		return ErrDiscountCodeExhausted
	}
	return nil
}

// generateUniqueDiscountCode 生成全局唯一的大写 8 位字母数字邀请码。
func generateUniqueDiscountCode() (string, error) {
	for i := 0; i < 10; i++ {
		code := strings.ToUpper(common.GetRandomString(8))
		var count int64
		if err := DB.Model(&DiscountInviteCode{}).Where("code = ?", code).Count(&count).Error; err != nil {
			return "", err
		}
		if count == 0 {
			return code, nil
		}
	}
	return "", ErrDiscountCodeGenerate
}

// CreateDiscountCode 创建折扣码。折扣绝对边界在此校验；代理商区间由调用方（controller）强制。
func CreateDiscountCode(dc *DiscountInviteCode) error {
	if dc == nil {
		return ErrDiscountCodeNotFound
	}
	if err := ValidateDiscountValue(dc.Discount); err != nil {
		return err
	}
	if strings.TrimSpace(dc.Code) == "" {
		code, err := generateUniqueDiscountCode()
		if err != nil {
			return err
		}
		dc.Code = code
	}
	if dc.MaxUses < 0 {
		dc.MaxUses = 0
	}
	if dc.ExpiresAt < 0 {
		dc.ExpiresAt = 0
	}
	if dc.Status == 0 {
		dc.Status = DiscountCodeStatusEnabled
	}
	return DB.Create(dc).Error
}

// GetDiscountCodeById 按主键读取折扣码，未找到返回 ErrDiscountCodeNotFound。
func GetDiscountCodeById(id int) (*DiscountInviteCode, error) {
	if id <= 0 {
		return nil, ErrDiscountCodeNotFound
	}
	var dc DiscountInviteCode
	if err := DB.Where("id = ?", id).First(&dc).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrDiscountCodeNotFound
		}
		return nil, err
	}
	return &dc, nil
}

// GetDiscountCodeByCode 按码读取折扣码（只读，不消费），未找到返回 ErrDiscountCodeNotFound。
func GetDiscountCodeByCode(code string) (*DiscountInviteCode, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return nil, ErrDiscountCodeNotFound
	}
	var dc DiscountInviteCode
	if err := DB.Where("code = ?", code).First(&dc).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrDiscountCodeNotFound
		}
		return nil, err
	}
	return &dc, nil
}

// ConsumeDiscountInviteCode 注册时原子消费折扣码：先只读校验返回明确错误，
// 再用带条件的原子自增确保并发下不超发（max_uses=0 表示不限次）。
func ConsumeDiscountInviteCode(code string) (*DiscountInviteCode, error) {
	dc, err := GetDiscountCodeByCode(code)
	if err != nil {
		return nil, err
	}
	now := common.GetTimestamp()
	if err := dc.CheckUsable(now); err != nil {
		return nil, err
	}
	res := DB.Model(&DiscountInviteCode{}).
		Where("id = ? AND status = ? AND (max_uses = 0 OR used_count < max_uses) AND (expires_at = 0 OR expires_at > ?)",
			dc.Id, DiscountCodeStatusEnabled, now).
		Update("used_count", gorm.Expr("used_count + 1"))
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return nil, ErrDiscountCodeExhausted
	}
	dc.UsedCount++
	return dc, nil
}

// ReleaseDiscountInviteCode 补偿回滚：注册最终失败时把已自增的次数减回。
func ReleaseDiscountInviteCode(id int) {
	if id <= 0 {
		return
	}
	DB.Model(&DiscountInviteCode{}).
		Where("id = ? AND used_count > 0", id).
		Update("used_count", gorm.Expr("used_count - 1"))
}

// ListDiscountCodes 分页返回折扣码。ownerUserId>0 时只看该用户名下的码（代理商），
// ownerType 非空时按归属类型过滤；ownerUserId=0 且 ownerType 空表示管理员查看全部。
func ListDiscountCodes(pageInfo *common.PageInfo, ownerUserId int, ownerType string) (codes []*DiscountInviteCode, total int64, err error) {
	q := DB.Model(&DiscountInviteCode{})
	if ownerUserId > 0 {
		q = q.Where("owner_user_id = ?", ownerUserId)
	}
	if ownerType != "" {
		q = q.Where("owner_type = ?", ownerType)
	}
	if err = q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err = q.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&codes).Error; err != nil {
		return nil, 0, err
	}
	backfillCodeOwnerInfo(codes)
	return codes, total, nil
}

// GetDiscountCodesByOwner 返回某用户名下指定归属类型的全部折扣码（不分页），
// 用于代理商控制台概览的聚合统计。
func GetDiscountCodesByOwner(ownerUserId int, ownerType string) ([]*DiscountInviteCode, error) {
	if ownerUserId <= 0 {
		return nil, nil
	}
	var codes []*DiscountInviteCode
	if err := DB.Where("owner_user_id = ? AND owner_type = ?", ownerUserId, ownerType).
		Order("id desc").Find(&codes).Error; err != nil {
		return nil, err
	}
	return codes, nil
}

// backfillCodeOwnerInfo 批量回填折扣码归属用户的展示名，避免 N+1 查询。
func backfillCodeOwnerInfo(codes []*DiscountInviteCode) {
	if len(codes) == 0 {
		return
	}
	idSet := make(map[int]struct{}, len(codes))
	ids := make([]int, 0, len(codes))
	for _, c := range codes {
		if _, ok := idSet[c.OwnerUserId]; !ok {
			idSet[c.OwnerUserId] = struct{}{}
			ids = append(ids, c.OwnerUserId)
		}
	}
	var users []User
	if err := DB.Model(&User{}).Where("id IN ?", ids).Find(&users).Error; err != nil {
		return
	}
	byId := make(map[int]*User, len(users))
	for i := range users {
		byId[users[i].Id] = &users[i]
	}
	for _, c := range codes {
		if u, ok := byId[c.OwnerUserId]; ok {
			c.OwnerUsername = u.Username
			c.OwnerEmail = u.Email
		}
	}
}

// UpdateDiscountCodeFields 按字段白名单更新折扣码。
func UpdateDiscountCodeFields(id int, fields map[string]interface{}) error {
	if id <= 0 {
		return ErrDiscountCodeNotFound
	}
	if len(fields) == 0 {
		return nil
	}
	res := DB.Model(&DiscountInviteCode{}).Where("id = ?", id).Updates(fields)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrDiscountCodeNotFound
	}
	return nil
}

// DeleteDiscountCode 删除折扣码（不影响已绑定用户已享受的折扣）。
func DeleteDiscountCode(id int) error {
	if id <= 0 {
		return ErrDiscountCodeNotFound
	}
	res := DB.Where("id = ?", id).Delete(&DiscountInviteCode{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrDiscountCodeNotFound
	}
	return nil
}

// DiscountCodeStat 折扣码导流统计：绑定用户数与其成功充值面值总额。
type DiscountCodeStat struct {
	UserCount     int64 `json:"user_count"`
	TotalRecharge int64 `json:"total_recharge"`
}

// GetDiscountCodeStats 聚合若干折扣码各自绑定的用户数与这些用户的成功充值面值总额。
// 用两条分组查询（用户表 + 充值表）在内存归并，避免跨表 JOIN 以保持三库兼容。
func GetDiscountCodeStats(codes []string) (map[string]DiscountCodeStat, error) {
	stats := make(map[string]DiscountCodeStat, len(codes))
	if len(codes) == 0 {
		return stats, nil
	}

	type userRow struct {
		Id   int    `gorm:"column:id"`
		Code string `gorm:"column:recharge_discount_code"`
	}
	var userRows []userRow
	if err := DB.Model(&User{}).
		Select("id", "recharge_discount_code").
		Where("recharge_discount_code IN ?", codes).
		Find(&userRows).Error; err != nil {
		return nil, err
	}

	codeByUser := make(map[int]string, len(userRows))
	for _, r := range userRows {
		s := stats[r.Code]
		s.UserCount++
		stats[r.Code] = s
		codeByUser[r.Id] = r.Code
	}
	if len(codeByUser) == 0 {
		return stats, nil
	}

	userIds := make([]int, 0, len(codeByUser))
	for id := range codeByUser {
		userIds = append(userIds, id)
	}

	type topupRow struct {
		UserId int   `gorm:"column:user_id"`
		Total  int64 `gorm:"column:total"`
	}
	var topupRows []topupRow
	if err := DB.Model(&TopUp{}).
		Select("user_id", "COALESCE(SUM(amount), 0) as total").
		Where("user_id IN ? AND status = ?", userIds, common.TopUpStatusSuccess).
		Group("user_id").
		Find(&topupRows).Error; err != nil {
		return nil, err
	}
	for _, r := range topupRows {
		code := codeByUser[r.UserId]
		s := stats[code]
		s.TotalRecharge += r.Total
		stats[code] = s
	}
	return stats, nil
}

// AgentMember 代理商成员视图行：注册时绑定该代理商邀请码的用户及其累计成功充值面值。
// 仅用于代理商自助端展示，不落库。
type AgentMember struct {
	UserId        int     `json:"user_id"`
	Username      string  `json:"username"`
	DisplayName   string  `json:"display_name"`
	Discount      float64 `json:"discount"`
	Code          string  `json:"code"`
	CreatedAt     int64   `json:"created_at"`
	TotalRecharge int64   `json:"total_recharge"`
}

// AgentRechargeRecord 代理商成员充值视图行：成员的成功充值流水。
// 仅用于代理商自助端展示，不落库。
type AgentRechargeRecord struct {
	CreatedAt     int64   `json:"created_at"`
	UserId        int     `json:"user_id"`
	Username      string  `json:"username"`
	DisplayName   string  `json:"display_name"`
	Amount        int64   `json:"amount"`
	Money         float64 `json:"money"`
	PaymentMethod string  `json:"payment_method"`
	TradeNo       string  `json:"trade_no"`
}

// agentOwnedCodeStrings 返回该代理商名下全部邀请码字符串，供成员/充值两个自助查询共用。
func agentOwnedCodeStrings(ownerUserId int) ([]string, error) {
	codes, err := GetDiscountCodesByOwner(ownerUserId, OwnerTypeAgent)
	if err != nil {
		return nil, err
	}
	codeStrs := make([]string, 0, len(codes))
	for _, dc := range codes {
		codeStrs = append(codeStrs, dc.Code)
	}
	return codeStrs, nil
}

// ListAgentMembers 分页返回绑定该代理商邀请码的用户（成员），并回填各自的成功充值面值总额。
// 沿用 GetDiscountCodeStats 的两段式无 JOIN 模式（先查用户再按用户聚合充值）以保持三库兼容。
func ListAgentMembers(ownerUserId int, pageInfo *common.PageInfo) (members []*AgentMember, total int64, err error) {
	codeStrs, err := agentOwnedCodeStrings(ownerUserId)
	if err != nil {
		return nil, 0, err
	}
	if len(codeStrs) == 0 {
		return nil, 0, nil
	}
	q := DB.Model(&User{}).Where("recharge_discount_code IN ?", codeStrs)
	if err = q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var users []User
	if err = q.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&users).Error; err != nil {
		return nil, 0, err
	}
	if len(users) == 0 {
		return nil, total, nil
	}
	ids := make([]int, 0, len(users))
	for i := range users {
		ids = append(ids, users[i].Id)
	}
	type rechargeRow struct {
		UserId int   `gorm:"column:user_id"`
		Total  int64 `gorm:"column:total"`
	}
	var rechargeRows []rechargeRow
	if err = DB.Model(&TopUp{}).
		Select("user_id", "COALESCE(SUM(amount), 0) as total").
		Where("user_id IN ? AND status = ?", ids, common.TopUpStatusSuccess).
		Group("user_id").
		Find(&rechargeRows).Error; err != nil {
		return nil, 0, err
	}
	rechargeByUser := make(map[int]int64, len(rechargeRows))
	for _, r := range rechargeRows {
		rechargeByUser[r.UserId] = r.Total
	}
	for i := range users {
		u := &users[i]
		members = append(members, &AgentMember{
			UserId:        u.Id,
			Username:      u.Username,
			DisplayName:   u.DisplayName,
			Discount:      u.RechargeDiscount,
			Code:          u.RechargeDiscountCode,
			CreatedAt:     u.CreatedAt,
			TotalRecharge: rechargeByUser[u.Id],
		})
	}
	return members, total, nil
}

// ListAgentRechargeRecords 分页返回该代理商成员（绑定其邀请码的用户）的成功充值流水，
// 并回填用户名。先解析成员 id 集合再查充值表，避免跨表 JOIN 以保持三库兼容。
func ListAgentRechargeRecords(ownerUserId int, pageInfo *common.PageInfo) (records []*AgentRechargeRecord, total int64, err error) {
	codeStrs, err := agentOwnedCodeStrings(ownerUserId)
	if err != nil {
		return nil, 0, err
	}
	if len(codeStrs) == 0 {
		return nil, 0, nil
	}
	var userIds []int
	if err = DB.Model(&User{}).
		Select("id").
		Where("recharge_discount_code IN ?", codeStrs).
		Pluck("id", &userIds).Error; err != nil {
		return nil, 0, err
	}
	if len(userIds) == 0 {
		return nil, 0, nil
	}
	q := DB.Model(&TopUp{}).Where("user_id IN ? AND status = ?", userIds, common.TopUpStatusSuccess)
	if err = q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var topUps []TopUp
	if err = q.Order("create_time desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&topUps).Error; err != nil {
		return nil, 0, err
	}
	if len(topUps) == 0 {
		return nil, total, nil
	}
	pageUserIds := make([]int, 0, len(topUps))
	seen := make(map[int]struct{}, len(topUps))
	for i := range topUps {
		if _, ok := seen[topUps[i].UserId]; !ok {
			seen[topUps[i].UserId] = struct{}{}
			pageUserIds = append(pageUserIds, topUps[i].UserId)
		}
	}
	var users []User
	if err = DB.Model(&User{}).Where("id IN ?", pageUserIds).Find(&users).Error; err != nil {
		return nil, 0, err
	}
	userById := make(map[int]User, len(users))
	for i := range users {
		userById[users[i].Id] = users[i]
	}
	for i := range topUps {
		tu := &topUps[i]
		u := userById[tu.UserId]
		records = append(records, &AgentRechargeRecord{
			CreatedAt:     tu.CreateTime,
			UserId:        tu.UserId,
			Username:      u.Username,
			DisplayName:   u.DisplayName,
			Amount:        tu.Amount,
			Money:         tu.Money,
			PaymentMethod: tu.PaymentMethod,
			TradeNo:       tu.TradeNo,
		})
	}
	return records, total, nil
}
