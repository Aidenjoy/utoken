package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// 代理商（Reseller）体系：管理员把已注册用户提升为代理商并设定其可发放的折扣范围，
// 代理商在自己的范围内生成折扣邀请码引流；被邀请用户注册后充值永久享受该折扣。
// 与"企业（组织）"完全解耦：代理商不是系统角色，成员之间不互见、不共享额度池，
// 平台也不自动返佣（无佣金）。折扣只降低实付金额，额度一律按面值入账。
const (
	AgentStatusEnabled  = 1
	AgentStatusDisabled = 2
)

var (
	ErrAgentNotFound      = errors.New("agent not found")
	ErrAgentAlreadyExists = errors.New("user is already an agent")
	ErrAgentDiscountRange = errors.New("invalid agent discount range")
)

// Agent 代理商记录。MinDiscount/MaxDiscount 为支付乘数区间 (0,1]，
// 例如 0.6~1.0 表示代理商能发出的最大折扣为 6 折、最小折扣为原价。
// 约束 0 < MinDiscount <= MaxDiscount <= 1，由 ValidateAgentDiscountRange 强制。
type Agent struct {
	Id          int     `json:"id"`
	UserId      int     `json:"user_id" gorm:"type:int;uniqueIndex;column:user_id"`
	MinDiscount float64 `json:"min_discount" gorm:"column:min_discount"`
	MaxDiscount float64 `json:"max_discount" gorm:"column:max_discount"`
	Status      int     `json:"status" gorm:"type:int;default:1;column:status"`
	Remark      string  `json:"remark" gorm:"type:varchar(255);column:remark" validate:"max=255"`
	CreatedBy   int     `json:"created_by" gorm:"type:int;column:created_by"`
	CreatedAt   int64   `json:"created_at" gorm:"autoCreateTime;column:created_at"`
	UpdatedAt   int64   `json:"updated_at" gorm:"autoUpdateTime;column:updated_at"`

	// 列表返回时回填，不落库
	Username    string `json:"username" gorm:"-"`
	DisplayName string `json:"display_name" gorm:"-"`
	Email       string `json:"email" gorm:"-"`
	CodeCount   int64  `json:"code_count" gorm:"-"`
}

// ValidateAgentDiscountRange 校验代理商折扣区间：0 < min <= max <= 1。
func ValidateAgentDiscountRange(min, max float64) error {
	if !(min > 0) || !(max > 0) || min > max || max > 1 {
		return ErrAgentDiscountRange
	}
	return nil
}

// GetAgentByUserId 按用户 ID 读取代理商，未找到返回 ErrAgentNotFound。
func GetAgentByUserId(userId int) (*Agent, error) {
	if userId <= 0 {
		return nil, ErrAgentNotFound
	}
	var agent Agent
	if err := DB.Where("user_id = ?", userId).First(&agent).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAgentNotFound
		}
		return nil, err
	}
	return &agent, nil
}

// GetAgentById 按主键读取代理商，未找到返回 ErrAgentNotFound。
func GetAgentById(id int) (*Agent, error) {
	if id <= 0 {
		return nil, ErrAgentNotFound
	}
	var agent Agent
	if err := DB.Where("id = ?", id).First(&agent).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAgentNotFound
		}
		return nil, err
	}
	return &agent, nil
}

// ListAgents 分页返回代理商，并回填用户名/邮箱与其名下折扣码数量。
func ListAgents(pageInfo *common.PageInfo) (agents []*Agent, total int64, err error) {
	if err = DB.Model(&Agent{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err = DB.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&agents).Error; err != nil {
		return nil, 0, err
	}
	backfillAgentUserInfo(agents)
	return agents, total, nil
}

// backfillAgentUserInfo 批量回填代理商展示信息，避免 N+1 查询。
func backfillAgentUserInfo(agents []*Agent) {
	if len(agents) == 0 {
		return
	}
	ids := make([]int, 0, len(agents))
	for _, a := range agents {
		ids = append(ids, a.UserId)
	}

	var users []User
	if err := DB.Model(&User{}).Where("id IN ?", ids).Find(&users).Error; err == nil {
		byId := make(map[int]*User, len(users))
		for i := range users {
			byId[users[i].Id] = &users[i]
		}
		for _, a := range agents {
			if u, ok := byId[a.UserId]; ok {
				a.Username = u.Username
				a.DisplayName = u.DisplayName
				a.Email = u.Email
			}
		}
	}

	type codeCountRow struct {
		OwnerUserId int   `gorm:"column:owner_user_id"`
		Cnt         int64 `gorm:"column:cnt"`
	}
	var rows []codeCountRow
	if err := DB.Model(&DiscountInviteCode{}).
		Select("owner_user_id", "count(*) as cnt").
		Where("owner_type = ? AND owner_user_id IN ?", OwnerTypeAgent, ids).
		Group("owner_user_id").
		Find(&rows).Error; err == nil {
		cntByUser := make(map[int]int64, len(rows))
		for _, r := range rows {
			cntByUser[r.OwnerUserId] = r.Cnt
		}
		for _, a := range agents {
			a.CodeCount = cntByUser[a.UserId]
		}
	}
}

// CreateAgent 提升用户为代理商。同一用户不可重复提升。
func CreateAgent(agent *Agent) error {
	if agent == nil || agent.UserId <= 0 {
		return ErrAgentNotFound
	}
	if err := ValidateAgentDiscountRange(agent.MinDiscount, agent.MaxDiscount); err != nil {
		return err
	}
	var count int64
	if err := DB.Model(&Agent{}).Where("user_id = ?", agent.UserId).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return ErrAgentAlreadyExists
	}
	if agent.Status == 0 {
		agent.Status = AgentStatusEnabled
	}
	return DB.Create(agent).Error
}

// UpdateAgentFields 按字段白名单更新代理商信息。
func UpdateAgentFields(id int, fields map[string]interface{}) error {
	if id <= 0 {
		return ErrAgentNotFound
	}
	if len(fields) == 0 {
		return nil
	}
	res := DB.Model(&Agent{}).Where("id = ?", id).Updates(fields)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrAgentNotFound
	}
	return nil
}

// DeleteAgent 删除代理商记录（不影响其历史发放的折扣码与已绑定用户）。
func DeleteAgent(id int) error {
	if id <= 0 {
		return ErrAgentNotFound
	}
	res := DB.Where("id = ?", id).Delete(&Agent{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrAgentNotFound
	}
	return nil
}
