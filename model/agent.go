package model

import (
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"gorm.io/gorm"
)

// 代理商（Reseller）体系：管理员把已注册用户提升为代理商，并授权其一批模型 +
// 每个模型的折扣下限；代理商用邀请码引流，被邀请用户注册后绑定到该代理商，
// 只能调用授权的这些模型，代理商可在下限之上为自己的成员单独设置按模型折扣。
//
// 与"企业（组织）"完全解耦：代理商不是系统角色，成员之间不互见、不共享额度池，
// 平台也不自动返佣（无佣金）。折扣只作用于钱包计费，额度与倍率口径不变。
const (
	AgentStatusEnabled  = 1
	AgentStatusDisabled = 2
)

var (
	ErrAgentNotFound      = errors.New("agent not found")
	ErrAgentAlreadyExists = errors.New("user is already an agent")
	// ErrAgentModelDiscountsInvalid 是授权配置各类校验失败（通配键、值域、条目数、键长度）
	// 收敛后的哨兵错误。common 里这些子错误多为包内私有，controller 无法逐个 errors.Is，
	// 因此在此统一包一层：前端展示 i18n 文案，具体原因保留在 wrapped message 里供日志排查。
	// 「授权清单为空」不收敛，它有自己的 i18n 文案（common.ErrAgentModelsEmpty）。
	ErrAgentModelDiscountsInvalid = errors.New("invalid agent model discounts")
)

// Agent 代理商记录。ModelDiscounts 存 JSON：{"模型名": 折扣下限}，
// 键即授权模型清单（成员只能调这些模型），值即代理商能给该模型设置的最低折扣，
// 例如 {"gpt-4o":0.8} 表示只授权 gpt-4o，且代理商最多只能给到 8 折（可设 0.8~1.0）。
// 校验统一走 common.NormalizeAgentModelFloors（非空、精确模型名、值域 (0,1]）。
//
// 历史的 min_discount / max_discount 两列已废弃：结构体不再声明，GORM AutoMigrate
// 不会删列，故它们作为孤儿列留在库里，无任何代码读写。
type Agent struct {
	Id     int `json:"id"`
	UserId int `json:"user_id" gorm:"type:int;uniqueIndex;column:user_id"`
	// ModelDiscounts 是授权配置的落库文本，JSON 响应里由 ModelDiscountMap 以对象形式下发。
	ModelDiscounts string `json:"-" gorm:"type:text;column:model_discounts"`
	Status         int    `json:"status" gorm:"type:int;default:1;column:status"`
	Remark         string `json:"remark" gorm:"type:varchar(255);column:remark" validate:"max=255"`
	CreatedBy      int    `json:"created_by" gorm:"type:int;column:created_by"`
	CreatedAt      int64  `json:"created_at" gorm:"autoCreateTime;column:created_at"`
	UpdatedAt      int64  `json:"updated_at" gorm:"autoUpdateTime;column:updated_at"`

	// 列表返回时回填，不落库
	Username    string `json:"username" gorm:"-"`
	DisplayName string `json:"display_name" gorm:"-"`
	Email       string `json:"email" gorm:"-"`
	InviteCount int64  `json:"invite_count" gorm:"-"`
	// ModelDiscountMap 是授权配置的对象视图，前端直接当 Record<string, number> 用，
	// 不必自己 JSON.parse 一段字符串。永不为 nil（无配置时是空对象）。
	ModelDiscountMap map[string]float64 `json:"model_discounts" gorm:"-"`
}

// syncModelDiscountMap 把落库文本同步到响应字段。凡是写出 Agent 之前都要调一次，
// 否则响应里会是上一版的授权配置。
func (a *Agent) syncModelDiscountMap() {
	floors := a.ModelFloors()
	if floors == nil {
		floors = map[string]float64{}
	}
	a.ModelDiscountMap = floors
}

// AllowedModels 是代理商授权模型清单的内存表示，用于按请求模型名做白名单匹配。
type AllowedModels map[string]bool

// ParseAllowedModels 解析授权模型清单 JSON（字符串数组）。
// 空串或解析失败返回 nil，调用方据此走 fail-open（放行并记录错误），
// 因为白名单查不到就拒绝会让配置异常放大成全站中断。
func ParseAllowedModels(modelsJSON string) AllowedModels {
	trimmed := strings.TrimSpace(modelsJSON)
	if trimmed == "" {
		return nil
	}
	var names []string
	if err := common.Unmarshal([]byte(trimmed), &names); err != nil {
		common.SysError("failed to unmarshal agent allowed models: " + err.Error())
		return nil
	}
	allowed := make(AllowedModels, len(names)*2)
	for _, name := range names {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		allowed[name] = true
		// 与渠道能力表（group2model2channels）一致：额外登记归一化模型名，
		// 使 gpt-4o-2024-11-20 这类带日期后缀的变体能命中管理员配置的族名。
		allowed[ratio_setting.FormatMatchingModelName(name)] = true
	}
	return allowed
}

// Allows 判断请求模型是否在授权清单内。清单为空一律返回 false，
// 由调用方决定是"拒绝"还是"fail-open 放行"。
func (a AllowedModels) Allows(modelName string) bool {
	if len(a) == 0 || modelName == "" {
		return false
	}
	if a[modelName] {
		return true
	}
	return a[ratio_setting.FormatMatchingModelName(modelName)]
}

// Filter 从候选模型名里筛出授权的部分，保持入参顺序。
// 用于模型广场与 GetUserModels，避免前端展示的模型与实调能力不一致。
//
// 清单为空时原样返回而不返回 nil：空清单等价于「不受限」（无代理归属或
// fail-open），若在这里把列表清空，代理配置损坏就会直接把用户的可用模型清成空。
func (a AllowedModels) Filter(models []string) []string {
	if len(a) == 0 {
		return models
	}
	filtered := make([]string, 0, len(models))
	for _, name := range models {
		if a.Allows(name) {
			filtered = append(filtered, name)
		}
	}
	return filtered
}

// ResolveAllowedModels 把「用户所属代理商 + 授权清单快照」解析成白名单。
// 返回 nil 一律表示「不做白名单限制」，有两种来源，调用方靠 agentId 区分：
//   - agentId<=0：用户无代理归属，本就应放行全部模型；
//   - agentId>0 但快照解析不出清单：代理行缺失或 JSON 损坏，此时 fail-open。
//
// 三个执行点（分发拦截、模型广场列表、GetUserModels）共用这一份解析，
// 避免对同一用户给出「能看见但调不通」或反过来的不一致结果。
func ResolveAllowedModels(agentId int, allowedModelsJSON string) AllowedModels {
	if agentId <= 0 {
		return nil
	}
	return ParseAllowedModels(allowedModelsJSON)
}

// ModelFloors 返回授权配置 {模型名: 折扣下限}，解析失败或为空返回 nil。
func (a *Agent) ModelFloors() map[string]float64 {
	return common.ParseModelDiscounts(a.ModelDiscounts)
}

// AllowedModelsJSON 返回授权模型清单的 JSON 数组，用于写入用户缓存快照。
// 配置为空或序列化失败返回空串，与 ParseAllowedModels 的 fail-open 判定对齐。
func (a *Agent) AllowedModelsJSON() string {
	floors := a.ModelFloors()
	if len(floors) == 0 {
		return ""
	}
	names := make([]string, 0, len(floors))
	for name := range floors {
		names = append(names, name)
	}
	sort.Strings(names)
	payload, err := common.Marshal(names)
	if err != nil {
		common.SysError("failed to marshal agent allowed models: " + err.Error())
		return ""
	}
	return string(payload)
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
	agent.syncModelDiscountMap()
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
	agent.syncModelDiscountMap()
	return &agent, nil
}

// ListAgents 分页返回代理商，并回填用户名/邮箱与其名下邀请码数量。
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
		a.syncModelDiscountMap()
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

	type inviteCountRow struct {
		OwnerUserId int   `gorm:"column:owner_user_id"`
		Cnt         int64 `gorm:"column:cnt"`
	}
	var rows []inviteCountRow
	if err := DB.Model(&InviteCode{}).
		Select("owner_user_id", "count(*) as cnt").
		Where("owner_type = ? AND owner_user_id IN ?", OwnerTypeAgent, ids).
		Group("owner_user_id").
		Find(&rows).Error; err == nil {
		cntByUser := make(map[int]int64, len(rows))
		for _, r := range rows {
			cntByUser[r.OwnerUserId] = r.Cnt
		}
		for _, a := range agents {
			a.InviteCount = cntByUser[a.UserId]
		}
	}
}

// CreateAgent 提升用户为代理商。同一用户不可重复提升。
func CreateAgent(agent *Agent) error {
	if agent == nil || agent.UserId <= 0 {
		return ErrAgentNotFound
	}
	if err := validateAgentModelDiscounts(agent.ModelDiscounts); err != nil {
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
	if err := DB.Create(agent).Error; err != nil {
		return err
	}
	agent.syncModelDiscountMap()
	return nil
}

// UpdateAgentFields 按字段白名单更新代理商信息。
// 改动授权清单会立刻影响其全部成员的模型可见性，因此必须失效成员的用户缓存，
// 否则各节点仍按旧白名单放行/拦截，最长滞后一个缓存 TTL。
func UpdateAgentFields(id int, fields map[string]interface{}) error {
	if id <= 0 {
		return ErrAgentNotFound
	}
	if len(fields) == 0 {
		return nil
	}
	if raw, ok := fields["model_discounts"]; ok {
		jsonStr, _ := raw.(string)
		if err := validateAgentModelDiscounts(jsonStr); err != nil {
			return err
		}
	}
	res := DB.Model(&Agent{}).Where("id = ?", id).Updates(fields)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrAgentNotFound
	}
	if _, touched := fields["model_discounts"]; touched {
		InvalidateAgentMembersCache(id)
	}
	return nil
}

// DeleteAgent 删除代理商记录，并解除其成员的归属（agent_id 置 0）。
// 解绑后成员恢复全模型访问——与"查不到代理行则 fail-open"的语义一致，
// 避免删除代理商把已付费成员永久锁死在白名单外。历史邀请码保留不动。
func DeleteAgent(id int) error {
	if id <= 0 {
		return ErrAgentNotFound
	}
	var agent Agent
	if err := DB.Where("id = ?", id).First(&agent).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrAgentNotFound
		}
		return err
	}

	err := DB.Transaction(func(tx *gorm.DB) error {
		res := tx.Where("id = ?", id).Delete(&Agent{})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return ErrAgentNotFound
		}
		return tx.Model(&User{}).Where("agent_id = ?", id).Update("agent_id", 0).Error
	})
	if err != nil {
		return err
	}

	InvalidateAgentMembersCache(id)
	return nil
}

// validateAgentModelDiscounts 校验已序列化的授权配置：解析后交给 common 做规则校验。
// 此处只做校验，不修改入参；序列化由 controller 在拿到规范化结果后完成。
func validateAgentModelDiscounts(discountsJSON string) error {
	floors := common.ParseModelDiscounts(discountsJSON)
	if _, err := common.NormalizeAgentModelFloors(floors); err != nil {
		if errors.Is(err, common.ErrAgentModelsEmpty) {
			return err
		}
		return fmt.Errorf("%w：%v", ErrAgentModelDiscountsInvalid, err)
	}
	return nil
}

// InvalidateAgentMembersCache 清除某代理商全部成员的用户缓存。
// 用户缓存只存在于共享 Redis 中，删键即对所有节点生效，无需额外广播。
func InvalidateAgentMembersCache(agentId int) {
	if agentId <= 0 || !common.RedisEnabled {
		return
	}
	var userIds []int
	if err := DB.Model(&User{}).Where("agent_id = ?", agentId).Pluck("id", &userIds).Error; err != nil {
		common.SysError("failed to load agent members for cache invalidation: " + err.Error())
		return
	}
	for _, userId := range userIds {
		if err := invalidateUserCache(userId); err != nil {
			common.SysError("failed to invalidate agent member cache: " + err.Error())
		}
	}
}
