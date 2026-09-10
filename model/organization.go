package model

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// 企业（组织）状态
const (
	OrgStatusEnabled  = 1
	OrgStatusDisabled = 2
)

// 企业成员角色。
// 企业管理员不是系统角色（common.RoleXxx）：其权限仅在本企业范围内生效，
// 与系统管理员完全分离，系统管理员可代管所有企业。
const (
	OrgRoleAdmin  = "admin"
	OrgRoleMember = "member"
)

// 企业成员状态
const (
	OrgMemberStatusEnabled  = 1
	OrgMemberStatusDisabled = 2
)

// 企业响应缓存 TTL（秒）的默认值与上限
const (
	OrgCacheTTLDefault = 300
	OrgCacheTTLMax     = 86400
)

// DefaultUserGroup 是用户脱离企业后回落的系统默认分组，
// 与 User.Group 的 gorm 默认值保持一致。
const DefaultUserGroup = "default"

// orgMemberListLimit 是一次性拉取企业全部成员的上限，
// 供用量报表回填成员角色与子额度使用（成员列表接口本身走分页，不受此限）。
const orgMemberListLimit = 1000

var (
	ErrOrgNotFound            = errors.New("organization not found")
	ErrOrgDisabled            = errors.New("organization is disabled")
	ErrOrgNameTaken           = errors.New("organization name already exists")
	ErrOrgMemberNotFound      = errors.New("organization member not found")
	ErrOrgMemberDisabled      = errors.New("organization member is disabled")
	ErrOrgUserAlreadyInOrg    = errors.New("user already belongs to an organization")
	ErrOrgUserNotFound        = errors.New("organization owner user not found")
	ErrOrgQuotaInsufficient   = errors.New("organization quota insufficient")
	ErrOrgMemberQuotaExceeded = errors.New("organization member quota limit exceeded")
	ErrOrgNotEmpty            = errors.New("organization still has members")
)

// Organization 企业（组织）。
// 企业持有统一额度池，成员消费从池中扣减并受成员子额度约束；
// Group 绑定用户分组决定计费倍率，成员加入企业时同步继承该分组。
// 布尔字段的默认值不写 gorm default:true（三库兼容），由 normalize 归一化。
type Organization struct {
	Id          int    `json:"id"`
	Name        string `json:"name" gorm:"uniqueIndex;size:128;not null"`
	DisplayName string `json:"display_name" gorm:"size:128"`
	Group       string `json:"group" gorm:"size:64"`
	Status      int    `json:"status" gorm:"type:int;default:1"`
	OwnerUserId int    `json:"owner_user_id" gorm:"type:int;index;default:0"`

	Quota     int `json:"quota" gorm:"type:int;default:0"`      // 企业额度池余额
	UsedQuota int `json:"used_quota" gorm:"type:int;default:0"` // 企业额度池累计消耗

	WarningThreshold int    `json:"warning_threshold" gorm:"type:int;default:0"` // 企业级额度预警阈值，0=关闭
	NotifyType       string `json:"notify_type" gorm:"size:32"`                  // 复用 dto.NotifyType*
	NotifyTarget     string `json:"notify_target" gorm:"size:512"`               // 空=发给全部企业管理员
	DailyUsageAlert  int    `json:"daily_usage_alert" gorm:"type:int;default:0"` // 日用量告警阈值，0=关闭
	LastAlertAt      int64  `json:"last_alert_at" gorm:"bigint;default:0"`
	LastDailyAlertAt int64  `json:"last_daily_alert_at" gorm:"bigint;default:0"`

	CacheEnabled        bool `json:"cache_enabled" gorm:"type:bool"` // 企业级响应缓存开关
	CacheTTL            int  `json:"cache_ttl" gorm:"type:int;default:300"`
	AllowWalletFallback bool `json:"allow_wallet_fallback" gorm:"type:bool"` // 企业池不足时是否回落成员个人钱包
	HidePoolQuota       bool `json:"hide_pool_quota" gorm:"type:bool"`       // 对成员隐藏企业池余额

	CreatedAt int64 `json:"created_at" gorm:"autoCreateTime;column:created_at"`
	UpdatedAt int64 `json:"updated_at" gorm:"autoUpdateTime;column:updated_at"`
}

func (Organization) TableName() string {
	return "organizations"
}

// OrgMember 企业成员。QuotaLimit 为成员子额度（0=不限），消费时累加 QuotaUsed。
type OrgMember struct {
	Id         int    `json:"id"`
	OrgId      int    `json:"org_id" gorm:"type:int;uniqueIndex:idx_org_user,priority:1;index"`
	UserId     int    `json:"user_id" gorm:"type:int;uniqueIndex:idx_org_user,priority:2;index"`
	OrgRole    string `json:"org_role" gorm:"size:16"`
	QuotaLimit int    `json:"quota_limit" gorm:"type:int;default:0"`
	QuotaUsed  int    `json:"quota_used" gorm:"type:int;default:0"`
	Status     int    `json:"status" gorm:"type:int;default:1"`
	JoinedAt   int64  `json:"joined_at" gorm:"bigint;default:0"`
}

func (OrgMember) TableName() string {
	return "org_members"
}

// IsAdmin 是否为企业管理员（仅企业内语义，与系统角色无关）
func (m *OrgMember) IsAdmin() bool {
	return m != nil && m.OrgRole == OrgRoleAdmin
}

// IsEnabled 成员是否处于启用状态
func (m *OrgMember) IsEnabled() bool {
	return m != nil && m.Status == OrgMemberStatusEnabled
}

// RemainQuota 成员子额度剩余；QuotaLimit<=0 表示不限，返回 -1
func (m *OrgMember) RemainQuota() int {
	if m == nil || m.QuotaLimit <= 0 {
		return -1
	}
	remain := m.QuotaLimit - m.QuotaUsed
	if remain < 0 {
		return 0
	}
	return remain
}

// OrgMemberDetail 成员列表展示用的联表结果
type OrgMemberDetail struct {
	OrgMember
	Username    string `json:"username" gorm:"column:username"`
	DisplayName string `json:"display_name" gorm:"column:display_name"`
	Email       string `json:"email" gorm:"column:email"`
	UserStatus  int    `json:"user_status" gorm:"column:user_status"`
	UserQuota   int    `json:"user_quota" gorm:"column:user_quota"`
	UsedQuota   int    `json:"used_quota" gorm:"column:used_quota"`
}

// NormalizeOrgName 归一化企业标识：去空白并转小写，作为全局唯一键
func NormalizeOrgName(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

// IsValidOrgName 企业标识只允许字母、数字、下划线与连字符，长度 2-64
func IsValidOrgName(name string) bool {
	if len(name) < 2 || len(name) > 64 {
		return false
	}
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '_', r == '-':
		default:
			return false
		}
	}
	return true
}

// IsValidOrgRole 校验企业成员角色取值
func IsValidOrgRole(role string) bool {
	return role == OrgRoleAdmin || role == OrgRoleMember
}

// normalizeOrganization 归一化企业字段：状态、缓存 TTL、显示名兜底。
// 布尔字段的默认值由代码归一化而非 gorm default，保证三库行为一致。
func normalizeOrganization(org *Organization) {
	org.Name = NormalizeOrgName(org.Name)
	if org.DisplayName == "" {
		org.DisplayName = org.Name
	}
	if org.Status != OrgStatusDisabled {
		org.Status = OrgStatusEnabled
	}
	if org.CacheTTL <= 0 {
		org.CacheTTL = OrgCacheTTLDefault
	}
	if org.CacheTTL > OrgCacheTTLMax {
		org.CacheTTL = OrgCacheTTLMax
	}
	if org.WarningThreshold < 0 {
		org.WarningThreshold = 0
	}
	if org.DailyUsageAlert < 0 {
		org.DailyUsageAlert = 0
	}
	org.NotifyType = strings.TrimSpace(org.NotifyType)
	org.NotifyTarget = strings.TrimSpace(org.NotifyTarget)
	org.Group = strings.TrimSpace(org.Group)
	if org.Group == "" {
		org.Group = DefaultUserGroup
	}
}

// CreateOrganization 创建企业
func CreateOrganization(org *Organization) error {
	if org == nil {
		return errors.New("organization is nil")
	}
	normalizeOrganization(org)
	if !IsValidOrgName(org.Name) {
		return errors.New("invalid organization name")
	}
	var count int64
	if err := DB.Model(&Organization{}).Where("name = ?", org.Name).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return ErrOrgNameTaken
	}
	return DB.Create(org).Error
}

// CreateOrganizationWithSetup 在单个事务里创建企业、写入初始额度池并（可选）
// 任命首位企业管理员。任一步失败整体回滚，避免留下"企业已创建但管理员缺失或
// 额度未到账"的半成品：调用方（管理员建企业）先前是先落库再校验管理员用户名，
// 用户名不存在时企业已经提交，重试即报标识被占用且列表多出无主企业。
// ownerUserId <= 0 表示暂不任命管理员；initialQuota < 0 视为非法参数。
func CreateOrganizationWithSetup(org *Organization, initialQuota int, ownerUserId int) error {
	if org == nil {
		return errors.New("organization is nil")
	}
	normalizeOrganization(org)
	if !IsValidOrgName(org.Name) {
		return errors.New("invalid organization name")
	}
	if initialQuota < 0 {
		return errors.New("invalid initial organization quota")
	}
	org.Quota = initialQuota
	if ownerUserId > 0 {
		org.OwnerUserId = ownerUserId
	}
	if err := DB.Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&Organization{}).Where("name = ?", org.Name).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrOrgNameTaken
		}
		if ownerUserId > 0 {
			var userCount int64
			if err := tx.Model(&User{}).Where("id = ?", ownerUserId).Count(&userCount).Error; err != nil {
				return err
			}
			if userCount == 0 {
				return ErrOrgUserNotFound
			}
			var memberCount int64
			if err := tx.Model(&OrgMember{}).Where("user_id = ?", ownerUserId).Count(&memberCount).Error; err != nil {
				return err
			}
			if memberCount > 0 {
				return ErrOrgUserAlreadyInOrg
			}
		}
		if err := tx.Create(org).Error; err != nil {
			return err
		}
		if ownerUserId > 0 {
			member := &OrgMember{
				OrgId:    org.Id,
				UserId:   ownerUserId,
				OrgRole:  OrgRoleAdmin,
				Status:   OrgMemberStatusEnabled,
				JoinedAt: common.GetTimestamp(),
			}
			if err := tx.Create(member).Error; err != nil {
				return err
			}
			return tx.Model(&User{}).Where("id = ?", ownerUserId).
				Updates(map[string]interface{}{"org_id": org.Id, "group": org.Group}).Error
		}
		return nil
	}); err != nil {
		return err
	}
	if ownerUserId > 0 {
		// 新管理员的 org_id/group 已变更，清理用户缓存使其立即以企业管理员身份生效
		return invalidateOrgMembersUserCache(org.Id)
	}
	return nil
}

// GetOrganizationById 按 ID 读取企业，未找到返回 ErrOrgNotFound
func GetOrganizationById(id int) (*Organization, error) {
	if id <= 0 {
		return nil, ErrOrgNotFound
	}
	var org Organization
	if err := DB.Where("id = ?", id).First(&org).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrOrgNotFound
		}
		return nil, err
	}
	return &org, nil
}

// GetOrganizationByName 按唯一标识读取企业，未找到返回 ErrOrgNotFound
func GetOrganizationByName(name string) (*Organization, error) {
	name = NormalizeOrgName(name)
	if name == "" {
		return nil, ErrOrgNotFound
	}
	var org Organization
	if err := DB.Where("name = ?", name).First(&org).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrOrgNotFound
		}
		return nil, err
	}
	return &org, nil
}

// GetAllOrganizations 分页查询企业列表，keyword 匹配标识与显示名
func GetAllOrganizations(keyword string, startIdx int, num int) ([]*Organization, int64, error) {
	var orgs []*Organization
	var total int64
	query := DB.Model(&Organization{})
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("name LIKE ? OR display_name LIKE ?", like, like)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Order("id desc").Limit(num).Offset(startIdx).Find(&orgs).Error; err != nil {
		return nil, 0, err
	}
	return orgs, total, nil
}

// UpdateOrganizationFields 按字段白名单更新企业信息
func UpdateOrganizationFields(id int, fields map[string]interface{}) error {
	if id <= 0 {
		return ErrOrgNotFound
	}
	if len(fields) == 0 {
		return nil
	}
	if err := DB.Model(&Organization{}).Where("id = ?", id).Updates(fields).Error; err != nil {
		return err
	}
	// 分组或状态变更会影响成员的计费与鉴权，清理成员的用户缓存
	return invalidateOrgMembersUserCache(id)
}

// UpdateOrganizationStatus 启用/禁用企业
func UpdateOrganizationStatus(id int, status int) error {
	if status != OrgStatusEnabled && status != OrgStatusDisabled {
		return errors.New("invalid organization status")
	}
	return UpdateOrganizationFields(id, map[string]interface{}{"status": status})
}

// UpdateOrganizationGroup 变更企业绑定的用户分组，并同步全部成员账号的分组。
// 分组决定计费倍率，只有系统管理员可以变更；不同步成员会导致新老成员倒率不一致。
func UpdateOrganizationGroup(orgId int, group string) error {
	if orgId <= 0 {
		return ErrOrgNotFound
	}
	group = strings.TrimSpace(group)
	if group == "" {
		group = DefaultUserGroup
	}
	if err := DB.Transaction(func(tx *gorm.DB) error {
		if _, err := getOrganizationByIdTx(tx, orgId); err != nil {
			return err
		}
		if err := tx.Model(&Organization{}).Where("id = ?", orgId).Update("group", group).Error; err != nil {
			return err
		}
		var userIds []int
		if err := tx.Model(&OrgMember{}).Where("org_id = ?", orgId).Pluck("user_id", &userIds).Error; err != nil {
			return err
		}
		if len(userIds) == 0 {
			return nil
		}
		return tx.Model(&User{}).Where("id IN ?", userIds).Update("group", group).Error
	}); err != nil {
		return err
	}
	return invalidateOrgMembersUserCache(orgId)
}

// DeleteOrganization 删除企业。仅允许删除已清空成员的企业，
// 避免批量解绑用户并重置其分组；调用方应先逐个移出成员。
func DeleteOrganization(orgId int) error {
	if orgId <= 0 {
		return ErrOrgNotFound
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if _, err := getOrganizationByIdTx(tx, orgId); err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&OrgMember{}).Where("org_id = ?", orgId).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrOrgNotEmpty
		}
		return tx.Where("id = ?", orgId).Delete(&Organization{}).Error
	})
}

// IncreaseOrgQuota 调整企业额度池余额（管理员充值/调额），delta 可为负
func IncreaseOrgQuota(orgId int, delta int) error {
	if orgId <= 0 {
		return ErrOrgNotFound
	}
	if delta == 0 {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var org Organization
		if err := lockForUpdate(tx).Where("id = ?", orgId).First(&org).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrOrgNotFound
			}
			return err
		}
		newQuota := org.Quota + delta
		if newQuota < 0 {
			return ErrOrgQuotaInsufficient
		}
		return tx.Model(&Organization{}).Where("id = ?", orgId).
			Update("quota", gorm.Expr("quota + ?", delta)).Error
	})
}

// ---------------------------------------------------------------------------
// 成员
// ---------------------------------------------------------------------------

// GetOrgMemberById 按主键读取成员
func GetOrgMemberById(id int) (*OrgMember, error) {
	if id <= 0 {
		return nil, ErrOrgMemberNotFound
	}
	var member OrgMember
	if err := DB.Where("id = ?", id).First(&member).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrOrgMemberNotFound
		}
		return nil, err
	}
	return &member, nil
}

// GetOrgMember 读取指定企业在指定用户上的成员记录
func GetOrgMember(orgId int, userId int) (*OrgMember, error) {
	if orgId <= 0 || userId <= 0 {
		return nil, ErrOrgMemberNotFound
	}
	var member OrgMember
	if err := DB.Where("org_id = ? AND user_id = ?", orgId, userId).First(&member).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrOrgMemberNotFound
		}
		return nil, err
	}
	return &member, nil
}

// GetOrgMemberByUserId 读取用户当前的成员记录（一个用户最多属于一个企业）
func GetOrgMemberByUserId(userId int) (*OrgMember, error) {
	if userId <= 0 {
		return nil, ErrOrgMemberNotFound
	}
	var member OrgMember
	if err := DB.Where("user_id = ?", userId).First(&member).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrOrgMemberNotFound
		}
		return nil, err
	}
	return &member, nil
}

// GetOrgMembers 分页查询企业成员，keyword 匹配用户名与显示名
func GetOrgMembers(orgId int, keyword string, startIdx int, num int) ([]*OrgMemberDetail, int64, error) {
	var details []*OrgMemberDetail
	var total int64
	countQuery := DB.Table("org_members").
		Joins("LEFT JOIN users ON users.id = org_members.user_id").
		Where("org_members.org_id = ?", orgId)
	query := DB.Table("org_members").
		Select("org_members.*, users.username AS username, users.display_name AS display_name, "+
			"users.email AS email, users.status AS user_status, users.quota AS user_quota, users.used_quota AS used_quota").
		Joins("LEFT JOIN users ON users.id = org_members.user_id").
		Where("org_members.org_id = ?", orgId)
	if keyword != "" {
		like := "%" + keyword + "%"
		cond := "users.username LIKE ? OR users.display_name LIKE ?"
		countQuery = countQuery.Where(cond, like, like)
		query = query.Where(cond, like, like)
	}
	if err := countQuery.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Order("org_members.id desc").Limit(num).Offset(startIdx).Find(&details).Error; err != nil {
		return nil, 0, err
	}
	return details, total, nil
}

// CountOrgMembers 统计企业成员数量
func CountOrgMembers(orgId int) (int64, error) {
	var count int64
	err := DB.Model(&OrgMember{}).Where("org_id = ?", orgId).Count(&count).Error
	return count, err
}

// GetOrgMemberUserIds 返回企业全部成员的用户 ID（含停用成员），用于日志与密钥的归属过滤
func GetOrgMemberUserIds(orgId int) ([]int, error) {
	var ids []int
	err := DB.Model(&OrgMember{}).Where("org_id = ?", orgId).Pluck("user_id", &ids).Error
	return ids, err
}

// GetOrgAdminUserIds 返回企业全部启用状态的管理员用户 ID，用于告警通知兜底收件人
func GetOrgAdminUserIds(orgId int) ([]int, error) {
	var ids []int
	err := DB.Model(&OrgMember{}).
		Where("org_id = ? AND org_role = ? AND status = ?", orgId, OrgRoleAdmin, OrgMemberStatusEnabled).
		Pluck("user_id", &ids).Error
	return ids, err
}

// AddOrgMember 把既有用户加入企业：写成员记录，并同步 User.OrgId 与企业分组。
// 用户已属于任何企业时返回 ErrOrgUserAlreadyInOrg。
func AddOrgMember(member *OrgMember) error {
	if member == nil || member.OrgId <= 0 || member.UserId <= 0 {
		return errors.New("invalid organization member")
	}
	if !IsValidOrgRole(member.OrgRole) {
		member.OrgRole = OrgRoleMember
	}
	if member.Status != OrgMemberStatusDisabled {
		member.Status = OrgMemberStatusEnabled
	}
	if member.QuotaLimit < 0 {
		member.QuotaLimit = 0
	}
	if member.JoinedAt == 0 {
		member.JoinedAt = common.GetTimestamp()
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		org, err := getOrganizationByIdTx(tx, member.OrgId)
		if err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&OrgMember{}).Where("user_id = ?", member.UserId).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrOrgUserAlreadyInOrg
		}
		var user User
		if err := tx.Where("id = ?", member.UserId).First(&user).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errors.New("user not found")
			}
			return err
		}
		if err := tx.Create(member).Error; err != nil {
			return err
		}
		if err := tx.Model(&User{}).Where("id = ?", member.UserId).
			Updates(map[string]interface{}{"org_id": org.Id, "group": org.Group}).Error; err != nil {
			return err
		}
		return nil
	})
}

// CreateOrgMemberUser 在企业内新建成员账号：一个事务里创建用户并写入成员记录，
// 用户的分组与 org_id 直接取企业配置，避免中途失败留下无企业的孤儿账号。
//
// 两个不可越权的约束：
//   - 系统角色固定为 RoleCommonUser，企业管理员身份只体现在 org_members.org_role
//   - 个人钱包额度归零：成员只从企业额度池消费，不走注册赠送（AllowWalletFallback
//     开启时也不会因为赠送额度而意外回落）
func CreateOrgMemberUser(user *User, member *OrgMember) error {
	if user == nil || member == nil {
		return errors.New("invalid organization member user")
	}
	if !IsValidOrgRole(member.OrgRole) {
		member.OrgRole = OrgRoleMember
	}
	if member.Status != OrgMemberStatusDisabled {
		member.Status = OrgMemberStatusEnabled
	}
	if member.QuotaLimit < 0 {
		member.QuotaLimit = 0
	}
	if member.JoinedAt == 0 {
		member.JoinedAt = common.GetTimestamp()
	}
	user.Role = common.RoleCommonUser
	if err := DB.Transaction(func(tx *gorm.DB) error {
		org, err := getOrganizationByIdTx(tx, member.OrgId)
		if err != nil {
			return err
		}
		if org.Status != OrgStatusEnabled {
			return ErrOrgDisabled
		}
		user.OrgId = org.Id
		user.Group = org.Group
		if err := user.InsertWithTx(tx, 0); err != nil {
			return err
		}
		if err := tx.Model(&User{}).Where("id = ?", user.Id).Update("quota", 0).Error; err != nil {
			return err
		}
		user.Quota = 0
		member.UserId = user.Id
		return tx.Create(member).Error
	}); err != nil {
		return err
	}
	user.FinishInsert(0)
	return nil
}

// UpdateOrgMemberFields 更新成员子额度/角色/状态
func UpdateOrgMemberFields(id int, fields map[string]interface{}) error {
	if id <= 0 {
		return ErrOrgMemberNotFound
	}
	if len(fields) == 0 {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		member, err := getOrgMemberByIdTx(tx, id)
		if err != nil {
			return err
		}
		if err := tx.Model(&OrgMember{}).Where("id = ?", id).Updates(fields).Error; err != nil {
			return err
		}
		return invalidateUserCacheTxSafe(member.UserId)
	})
}

// RemoveOrgMember 把用户移出企业：删除成员记录，User.OrgId 归零且分组回落系统默认组。
// 只解绑不删账号，用户的密钥与历史日志保留。
func RemoveOrgMember(orgId int, userId int) error {
	if orgId <= 0 || userId <= 0 {
		return ErrOrgMemberNotFound
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		// 必须在事务内用 tx 查询：调用全局 DB 的 GetOrgMember 会另取一条连接，
		// 连接池耗尽时死锁，且读到的是事务外快照，破坏移出的原子性。
		var member OrgMember
		if err := tx.Where("org_id = ? AND user_id = ?", orgId, userId).First(&member).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrOrgMemberNotFound
			}
			return err
		}
		if err := tx.Where("id = ?", member.Id).Delete(&OrgMember{}).Error; err != nil {
			return err
		}
		if err := tx.Model(&User{}).Where("id = ? AND org_id = ?", userId, orgId).
			Updates(map[string]interface{}{"org_id": 0, "group": DefaultUserGroup}).Error; err != nil {
			return err
		}
		return invalidateUserCacheTxSafe(userId)
	})
}

// invalidateOrgMembersUserCache 清理企业全部成员的用户缓存（企业分组/状态变更后调用）
func invalidateOrgMembersUserCache(orgId int) error {
	ids, err := GetOrgMemberUserIds(orgId)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := invalidateUserCache(id); err != nil {
			common.SysLog(fmt.Sprintf("failed to invalidate user cache after org update (userId=%d): %s", id, err.Error()))
		}
	}
	return nil
}

// invalidateUserCacheTxSafe 清理单个用户缓存，失败只记日志不回滚事务
func invalidateUserCacheTxSafe(userId int) error {
	if userId <= 0 {
		return nil
	}
	if err := invalidateUserCache(userId); err != nil {
		common.SysLog(fmt.Sprintf("failed to invalidate user cache (userId=%d): %s", userId, err.Error()))
	}
	return nil
}

func getOrganizationByIdTx(tx *gorm.DB, id int) (*Organization, error) {
	if id <= 0 {
		return nil, ErrOrgNotFound
	}
	var org Organization
	if err := tx.Where("id = ?", id).First(&org).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrOrgNotFound
		}
		return nil, err
	}
	return &org, nil
}

func getOrgMemberByIdTx(tx *gorm.DB, id int) (*OrgMember, error) {
	if id <= 0 {
		return nil, ErrOrgMemberNotFound
	}
	var member OrgMember
	if err := tx.Where("id = ?", id).First(&member).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrOrgMemberNotFound
		}
		return nil, err
	}
	return &member, nil
}

// ---------------------------------------------------------------------------
// 鉴权上下文
// ---------------------------------------------------------------------------

// GetUserOrgContext 返回用户的企业上下文，供鉴权中间件写入 gin.Context。
// 用户没有企业时返回 (0, "", nil)。
func GetUserOrgContext(userId int) (int, string, error) {
	if userId <= 0 {
		return 0, "", nil
	}
	member, err := GetOrgMemberByUserId(userId)
	if err != nil {
		if errors.Is(err, ErrOrgMemberNotFound) {
			return 0, "", nil
		}
		return 0, "", err
	}
	return member.OrgId, member.OrgRole, nil
}

// GetActiveOrganizationForUser 返回用户可用于计费的企业与成员记录。
// 用户无企业、企业被禁用、成员被停用或成员记录缺失时返回 (nil, nil, nil)，
// 由调用方按非企业路径处理。
func GetActiveOrganizationForUser(userId int) (*Organization, *OrgMember, error) {
	if userId <= 0 {
		return nil, nil, nil
	}
	var member OrgMember
	if err := DB.Where("user_id = ? AND status = ?", userId, OrgMemberStatusEnabled).
		First(&member).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, nil
		}
		return nil, nil, err
	}
	org, err := GetOrganizationById(member.OrgId)
	if err != nil {
		if errors.Is(err, ErrOrgNotFound) {
			return nil, nil, nil
		}
		return nil, nil, err
	}
	if org.Status != OrgStatusEnabled {
		return nil, nil, nil
	}
	return org, &member, nil
}

// ---------------------------------------------------------------------------
// 企业额度池计费
// ---------------------------------------------------------------------------

// ConsumeOrgQuota 从企业额度池扣减额度，并在同一事务内校验成员子额度。
// 双条件：企业池余额充足 且 成员 QuotaUsed+quota <= QuotaLimit（QuotaLimit<=0 视为不限）。
// 任一条件不满足则整体回滚，分别返回 ErrOrgQuotaInsufficient / ErrOrgMemberQuotaExceeded。
func ConsumeOrgQuota(orgId int, userId int, quota int) error {
	if orgId <= 0 {
		return ErrOrgNotFound
	}
	if quota == 0 {
		return nil
	}
	if quota < 0 {
		return RefundOrgQuota(orgId, userId, -quota)
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var org Organization
		if err := lockForUpdate(tx).Where("id = ?", orgId).First(&org).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrOrgNotFound
			}
			return err
		}
		if org.Status != OrgStatusEnabled {
			return ErrOrgDisabled
		}
		if org.Quota < quota {
			return ErrOrgQuotaInsufficient
		}
		if userId > 0 {
			var member OrgMember
			if err := lockForUpdate(tx).Where("org_id = ? AND user_id = ?", orgId, userId).
				First(&member).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrOrgMemberNotFound
				}
				return err
			}
			if member.Status != OrgMemberStatusEnabled {
				return ErrOrgMemberDisabled
			}
			if member.QuotaLimit > 0 && member.QuotaUsed+quota > member.QuotaLimit {
				return ErrOrgMemberQuotaExceeded
			}
			if err := tx.Model(&OrgMember{}).Where("id = ?", member.Id).
				Update("quota_used", gorm.Expr("quota_used + ?", quota)).Error; err != nil {
				return err
			}
		}
		return tx.Model(&Organization{}).Where("id = ?", orgId).Updates(map[string]interface{}{
			"quota":      gorm.Expr("quota - ?", quota),
			"used_quota": gorm.Expr("used_quota + ?", quota),
		}).Error
	})
}

// RefundOrgQuota 把额度退回企业额度池并同步回滚成员子额度用量。
func RefundOrgQuota(orgId int, userId int, quota int) error {
	if orgId <= 0 {
		return ErrOrgNotFound
	}
	if quota == 0 {
		return nil
	}
	if quota < 0 {
		return ConsumeOrgQuota(orgId, userId, -quota)
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var org Organization
		if err := lockForUpdate(tx).Where("id = ?", orgId).First(&org).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrOrgNotFound
			}
			return err
		}
		if userId > 0 {
			// 成员子额度用量不允许为负，用 GREATEST 语义在应用层收敛
			var member OrgMember
			err := tx.Where("org_id = ? AND user_id = ?", orgId, userId).First(&member).Error
			if err == nil {
				newUsed := member.QuotaUsed - quota
				if newUsed < 0 {
					newUsed = 0
				}
				if err := tx.Model(&OrgMember{}).Where("id = ?", member.Id).
					Update("quota_used", newUsed).Error; err != nil {
					return err
				}
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}
		newUsedQuota := org.UsedQuota - quota
		if newUsedQuota < 0 {
			newUsedQuota = 0
		}
		return tx.Model(&Organization{}).Where("id = ?", orgId).Updates(map[string]interface{}{
			"quota":      gorm.Expr("quota + ?", quota),
			"used_quota": newUsedQuota,
		}).Error
	})
}

// UpdateOrgAlertTimestamp 记录告警触发时间，用于 24h 冷却去重。
// field 取 "last_alert_at"（额度预警）或 "last_daily_alert_at"（日用量告警）。
func UpdateOrgAlertTimestamp(orgId int, field string, ts int64) error {
	if orgId <= 0 {
		return ErrOrgNotFound
	}
	if field != "last_alert_at" && field != "last_daily_alert_at" {
		return errors.New("invalid alert timestamp field")
	}
	return DB.Model(&Organization{}).Where("id = ?", orgId).Update(field, ts).Error
}
