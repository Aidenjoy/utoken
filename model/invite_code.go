package model

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// 邀请码归属类型
const (
	OwnerTypeAgent = "agent"
	OwnerTypeAdmin = "admin"
)

// 邀请码状态
const (
	InviteCodeStatusEnabled  = 1
	InviteCodeStatusDisabled = 2
)

var (
	ErrInviteCodeNotFound  = errors.New("invite code not found")
	ErrInviteCodeDisabled  = errors.New("invite code disabled")
	ErrInviteCodeExpired   = errors.New("invite code expired")
	ErrInviteCodeExhausted = errors.New("invite code exhausted")
	ErrInviteCodeStatus    = errors.New("invalid invite code status")
	ErrInviteCodeGenerate  = errors.New("failed to generate unique invite code")
)

// InviteCode 邀请码。码本身不携带任何折扣，只做「用户 ↔ 代理商」的绑定凭据：
// 注册时消费一次，若码归属代理商则把 users.agent_id 绑到该代理商，此后该用户
// 能访问哪些模型、能享多少折扣，全部由代理商的授权配置与代理商为其单独设置的
// 按模型折扣决定。归属管理员的码只做引流记录，绑定后用户不受模型限制。
//
// 码可被多人复用（MaxUses=0 表示不限次）。UsedCount 即"通过该码注册成功的用户数"，
// 注册最终失败时由 ReleaseInviteCode 补偿回滚，因此无需再在 users 上冗余存码。
type InviteCode struct {
	Id          int    `json:"id"`
	Code        string `json:"code" gorm:"type:varchar(32);uniqueIndex;column:code"`
	OwnerType   string `json:"owner_type" gorm:"type:varchar(16);column:owner_type"`
	OwnerUserId int    `json:"owner_user_id" gorm:"type:int;index;column:owner_user_id"`
	MaxUses     int    `json:"max_uses" gorm:"type:int;default:0;column:max_uses"`
	UsedCount   int    `json:"used_count" gorm:"type:int;default:0;column:used_count"`
	ExpiresAt   int64  `json:"expires_at" gorm:"default:0;column:expires_at"`
	Status      int    `json:"status" gorm:"type:int;default:1;column:status"`
	Remark      string `json:"remark" gorm:"type:varchar(255);column:remark" validate:"max=255"`
	CreatedAt   int64  `json:"created_at" gorm:"autoCreateTime;column:created_at"`
	UpdatedAt   int64  `json:"updated_at" gorm:"autoUpdateTime;column:updated_at"`

	// 列表返回时回填，不落库
	OwnerUsername string `json:"owner_username" gorm:"-"`
	OwnerEmail    string `json:"owner_email" gorm:"-"`
}

// CheckUsable 只读校验码当前是否可用（不消费），返回类型化错误。
func (ic *InviteCode) CheckUsable(now int64) error {
	if ic.Status != InviteCodeStatusEnabled {
		return ErrInviteCodeDisabled
	}
	if ic.ExpiresAt > 0 && ic.ExpiresAt <= now {
		return ErrInviteCodeExpired
	}
	if ic.MaxUses > 0 && ic.UsedCount >= ic.MaxUses {
		return ErrInviteCodeExhausted
	}
	return nil
}

// generateUniqueInviteCode 生成全局唯一的大写 8 位字母数字邀请码。
func generateUniqueInviteCode() (string, error) {
	for i := 0; i < 10; i++ {
		code := strings.ToUpper(common.GetRandomString(8))
		var count int64
		if err := DB.Model(&InviteCode{}).Where("code = ?", code).Count(&count).Error; err != nil {
			return "", err
		}
		if count == 0 {
			return code, nil
		}
	}
	return "", ErrInviteCodeGenerate
}

// CreateInviteCode 创建邀请码。码不携带折扣，因此没有折扣边界需要校验。
func CreateInviteCode(ic *InviteCode) error {
	if ic == nil {
		return ErrInviteCodeNotFound
	}
	if strings.TrimSpace(ic.Code) == "" {
		code, err := generateUniqueInviteCode()
		if err != nil {
			return err
		}
		ic.Code = code
	}
	if ic.MaxUses < 0 {
		ic.MaxUses = 0
	}
	if ic.ExpiresAt < 0 {
		ic.ExpiresAt = 0
	}
	if ic.Status == 0 {
		ic.Status = InviteCodeStatusEnabled
	}
	return DB.Create(ic).Error
}

// GetInviteCodeById 按主键读取邀请码，未找到返回 ErrInviteCodeNotFound。
func GetInviteCodeById(id int) (*InviteCode, error) {
	if id <= 0 {
		return nil, ErrInviteCodeNotFound
	}
	var ic InviteCode
	if err := DB.Where("id = ?", id).First(&ic).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInviteCodeNotFound
		}
		return nil, err
	}
	return &ic, nil
}

// GetInviteCodeByCode 按码读取邀请码（只读，不消费），未找到返回 ErrInviteCodeNotFound。
func GetInviteCodeByCode(code string) (*InviteCode, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return nil, ErrInviteCodeNotFound
	}
	var ic InviteCode
	if err := DB.Where("code = ?", code).First(&ic).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInviteCodeNotFound
		}
		return nil, err
	}
	return &ic, nil
}

// ConsumeInviteCode 注册时原子消费邀请码：先只读校验返回明确错误，
// 再用带条件的原子自增确保并发下不超发（max_uses=0 表示不限次）。
func ConsumeInviteCode(code string) (*InviteCode, error) {
	ic, err := GetInviteCodeByCode(code)
	if err != nil {
		return nil, err
	}
	now := common.GetTimestamp()
	if err := ic.CheckUsable(now); err != nil {
		return nil, err
	}
	res := DB.Model(&InviteCode{}).
		Where("id = ? AND status = ? AND (max_uses = 0 OR used_count < max_uses) AND (expires_at = 0 OR expires_at > ?)",
			ic.Id, InviteCodeStatusEnabled, now).
		Update("used_count", gorm.Expr("used_count + 1"))
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return nil, ErrInviteCodeExhausted
	}
	ic.UsedCount++
	return ic, nil
}

// ReleaseInviteCode 补偿回滚：注册最终失败时把已自增的次数减回。
func ReleaseInviteCode(id int) {
	if id <= 0 {
		return
	}
	DB.Model(&InviteCode{}).
		Where("id = ? AND used_count > 0", id).
		Update("used_count", gorm.Expr("used_count - 1"))
}

// ListInviteCodes 分页返回邀请码。ownerUserId>0 时只看该用户名下的码（代理商），
// ownerType 非空时按归属类型过滤；ownerUserId=0 且 ownerType 空表示管理员查看全部。
func ListInviteCodes(pageInfo *common.PageInfo, ownerUserId int, ownerType string) (codes []*InviteCode, total int64, err error) {
	q := DB.Model(&InviteCode{})
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

// GetAgentInviteSummary 聚合代理商名下邀请码的数量与累计使用次数，
// 供代理商控制台概览使用（一次聚合查询，不把码全量捞进内存）。
func GetAgentInviteSummary(ownerUserId int) (codeCount int64, totalUsed int64, err error) {
	if ownerUserId <= 0 {
		return 0, 0, nil
	}
	var row struct {
		Cnt  int64 `gorm:"column:cnt"`
		Used int64 `gorm:"column:used"`
	}
	if err = DB.Model(&InviteCode{}).
		Select("COUNT(*) as cnt, COALESCE(SUM(used_count), 0) as used").
		Where("owner_user_id = ? AND owner_type = ?", ownerUserId, OwnerTypeAgent).
		Scan(&row).Error; err != nil {
		return 0, 0, err
	}
	return row.Cnt, row.Used, nil
}

// backfillCodeOwnerInfo 批量回填邀请码归属用户的展示名，避免 N+1 查询。
func backfillCodeOwnerInfo(codes []*InviteCode) {
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

// UpdateInviteCodeFields 按字段白名单更新邀请码。
func UpdateInviteCodeFields(id int, fields map[string]interface{}) error {
	if id <= 0 {
		return ErrInviteCodeNotFound
	}
	if len(fields) == 0 {
		return nil
	}
	res := DB.Model(&InviteCode{}).Where("id = ?", id).Updates(fields)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrInviteCodeNotFound
	}
	return nil
}

// AgentStats 代理商导流概览：成员数与成员的成功充值面值总额。
type AgentStats struct {
	MemberCount   int64 `json:"member_count"`
	TotalRecharge int64 `json:"total_recharge"`
}

// GetAgentStats 聚合某代理商名下成员数与这些成员的成功充值面值总额。
// 沿用两段式无 JOIN 模式（先查成员再按成员聚合充值）以保持三库兼容。
func GetAgentStats(agentId int) (*AgentStats, error) {
	stats := &AgentStats{}
	if agentId <= 0 {
		return stats, nil
	}
	var userIds []int
	if err := DB.Model(&User{}).Where("agent_id = ?", agentId).Pluck("id", &userIds).Error; err != nil {
		return nil, err
	}
	stats.MemberCount = int64(len(userIds))
	if len(userIds) == 0 {
		return stats, nil
	}
	var total int64
	if err := DB.Model(&TopUp{}).
		Select("COALESCE(SUM(amount), 0) as total").
		Where("user_id IN ? AND status = ?", userIds, common.TopUpStatusSuccess).
		Scan(&total).Error; err != nil {
		return nil, err
	}
	stats.TotalRecharge = total
	return stats, nil
}

// AgentMember 代理商成员视图行：注册时绑定该代理商的用户及其累计成功充值面值。
// 仅用于代理商自助端展示，不落库。ModelDiscounts 是该成员当前的按模型折扣，
// 代理商可在授权下限之上修改。
type AgentMember struct {
	UserId         int                `json:"user_id"`
	Username       string             `json:"username"`
	DisplayName    string             `json:"display_name"`
	ModelDiscounts map[string]float64 `json:"model_discounts"`
	CreatedAt      int64              `json:"created_at"`
	TotalRecharge  int64              `json:"total_recharge"`
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

// agentMemberIds 返回该代理商名下全部成员的用户 ID，供成员/充值两个自助查询共用。
func agentMemberIds(agentId int) ([]int, error) {
	if agentId <= 0 {
		return nil, nil
	}
	var userIds []int
	if err := DB.Model(&User{}).Where("agent_id = ?", agentId).Pluck("id", &userIds).Error; err != nil {
		return nil, err
	}
	return userIds, nil
}

// ListAgentMembers 分页返回绑定该代理商的用户（成员），并回填各自的成功充值面值总额
// 与当前按模型折扣。
func ListAgentMembers(agentId int, pageInfo *common.PageInfo) (members []*AgentMember, total int64, err error) {
	if agentId <= 0 {
		return nil, 0, nil
	}
	q := DB.Model(&User{}).Where("agent_id = ?", agentId)
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
		discounts := common.ParseModelDiscounts(u.ModelDiscounts)
		if discounts == nil {
			discounts = map[string]float64{}
		}
		members = append(members, &AgentMember{
			UserId:         u.Id,
			Username:       u.Username,
			DisplayName:    u.DisplayName,
			ModelDiscounts: discounts,
			CreatedAt:      u.CreatedAt,
			TotalRecharge:  rechargeByUser[u.Id],
		})
	}
	return members, total, nil
}

// ListAgentRechargeRecords 分页返回该代理商成员的成功充值流水，并回填用户名。
// 先解析成员 id 集合再查充值表，避免跨表 JOIN 以保持三库兼容。
func ListAgentRechargeRecords(agentId int, pageInfo *common.PageInfo) (records []*AgentRechargeRecord, total int64, err error) {
	userIds, err := agentMemberIds(agentId)
	if err != nil {
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
