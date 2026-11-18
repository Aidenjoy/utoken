package model

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// ===== 智能画布（Smart Canvas） =====
// 画布由「项目」+「图层文档 + revision」构成：文档整份存 projects.document，
// 保存时以 revision 做乐观锁，旧版本写入直接冲突，避免覆盖他人/其他标签页的新内容。
//
// Document/Result/Snapshot 等字段刻意不加 gorm type 标签：string 在 MySQL 映射为
// longtext、PostgreSQL/SQLite 映射为 text，跨库都是大文本（与 LogBody 同一约定）。

// 画布任务状态。前端只认这几态，上游差异在 service 层归一化。
const (
	CanvasTaskStatusPending   = "pending"   // 已受理，等待执行（占位已预扣）
	CanvasTaskStatusRunning   = "running"   // 已提交上游/正在处理
	CanvasTaskStatusSucceeded = "succeeded" // 上游成功且结果已转存
	CanvasTaskStatusFailed    = "failed"    // 失败且已退款
	CanvasTaskStatusCanceled  = "canceled"  // 用户取消
	// CanvasTaskStatusReviewing 上游提交结果未知（超时/网络中断/5xx 无响应体）：
	// 此时既不重发也不退款，进入待核对，由人工或后续补偿确认后再结案，
	// 避免「上游已受理但本地重发」造成重复计费。
	CanvasTaskStatusReviewing = "reviewing"
)

// 画布任务计费状态（与资金流水一一对应，CAS 推进，保证至多执行一次）。
const (
	CanvasBillingNone        = "none"        // 未计费（价格为 0 或使用 Relay 计费链路的工具）
	CanvasBillingPreConsumed = "preconsumed" // 已预扣
	CanvasBillingSettled     = "settled"     // 已按实际结算
	CanvasBillingRefunded    = "refunded"    // 已全额退款
)

// 资金流水类型
const (
	CanvasLedgerPreConsume = "preconsume"
	CanvasLedgerSettle     = "settle"
	CanvasLedgerRefund     = "refund"
)

// 计费资金来源（企业成员优先扣企业额度池）
const (
	CanvasFundingWallet       = "wallet"
	CanvasFundingOrganization = "organization"
)

var (
	// ErrCanvasRevisionConflict 保存时 revision 与库中不一致（旧版本写入）。
	ErrCanvasRevisionConflict = errors.New("canvas revision conflict")
	// ErrCanvasIdempotencyConflict 同一幂等键提交了不同参数。
	ErrCanvasIdempotencyConflict = errors.New("canvas idempotency key reused with different parameters")
)

// CanvasProject 画布项目。document 为整份图层文档 JSON，revision 为单调递增版本号。
type CanvasProject struct {
	ID         int    `json:"id" gorm:"primaryKey"`
	CreatedAt  int64  `json:"createdAt" gorm:"index"`
	UpdatedAt  int64  `json:"updatedAt"`
	UserID     int    `json:"userId" gorm:"index:idx_canvas_project_user,priority:1"`
	OrgID      int    `json:"orgId" gorm:"index"`
	Title      string `json:"title" gorm:"type:varchar(191)"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	Background string `json:"background" gorm:"type:varchar(32)"`
	Thumbnail  string `json:"thumbnail"`
	Document   string `json:"document"`
	LayerCount int    `json:"layerCount"`
	Revision   int64  `json:"revision"`
	// TaskCount / LastTaskAt 仅列表聚合时由查询填充（非持久化）。
	TaskCount  int64 `json:"taskCount,omitempty" gorm:"-"`
	LastTaskAt int64 `json:"lastTaskAt,omitempty" gorm:"-"`
}

func (CanvasProject) TableName() string { return "canvas_projects" }

// CanvasTask 画布生成/编辑任务。input_snapshot 保存提交时的完整入参快照，
// 重试、核对与审计都以快照为准，不依赖前端状态。
type CanvasTask struct {
	ID             int    `json:"id" gorm:"primaryKey"`
	CreatedAt      int64  `json:"createdAt" gorm:"index"`
	UpdatedAt      int64  `json:"updatedAt"`
	UserID         int    `json:"userId" gorm:"index:idx_canvas_task_idem,priority:1"`
	ProjectID      int    `json:"projectId" gorm:"index:idx_canvas_task_idem,priority:2;index:idx_canvas_task_project,priority:1"`
	Tool           string `json:"tool" gorm:"type:varchar(48);index"`
	IdempotencyKey string `json:"idempotencyKey" gorm:"type:varchar(191);uniqueIndex:idx_canvas_task_idem,priority:3"`
	ParamsHash     string `json:"paramsHash" gorm:"type:varchar(64)"`
	Status         string `json:"status" gorm:"type:varchar(16);index:idx_canvas_task_project,priority:2"`
	Stage          string `json:"stage" gorm:"type:varchar(48)"`
	Progress       int    `json:"progress"`
	Upstream       string `json:"upstream" gorm:"type:varchar(32)"`
	Model          string `json:"model" gorm:"type:varchar(128)"`
	ChannelID      int    `json:"channelId"`
	UpstreamTaskID string `json:"upstreamTaskId" gorm:"type:varchar(191)"`
	InputSnapshot  string `json:"-"`
	Result         string `json:"result"`
	ErrorCode      string `json:"errorCode" gorm:"type:varchar(64)"`
	ErrorMsg       string `json:"errorMsg"`
	// 计费：canvas 层只对「不经 Relay 计费链路」的上游工具计费（见 service/canvas）。
	BillingState    string `json:"billingState" gorm:"type:varchar(16);index"`
	BillingSource   string `json:"billingSource" gorm:"type:varchar(16)"`
	Quota           int    `json:"quota"`
	SettledQuota    int    `json:"settledQuota"`
	FundingOrgID    int    `json:"fundingOrgId"`
	CancelRequested bool   `json:"cancelRequested"`
	StartedAt       int64  `json:"startedAt"`
	FinishedAt      int64  `json:"finishedAt"`
}

func (CanvasTask) TableName() string { return "canvas_tasks" }

// CanvasLedger 画布计费流水。task_id + kind 唯一，是「至多扣/退一次」的最终防线：
// 资金变动与流水写入在同一事务内完成，重复执行会撞唯一索引而不是重复扣款。
type CanvasLedger struct {
	ID        int64  `json:"id" gorm:"primaryKey"`
	CreatedAt int64  `json:"createdAt" gorm:"index"`
	TaskID    int    `json:"taskId" gorm:"uniqueIndex:idx_canvas_ledger_task_kind,priority:1"`
	Kind      string `json:"kind" gorm:"type:varchar(16);uniqueIndex:idx_canvas_ledger_task_kind,priority:2"`
	UserID    int    `json:"userId" gorm:"index"`
	OrgID     int    `json:"orgId"`
	Source    string `json:"source" gorm:"type:varchar(16)"`
	Quota     int    `json:"quota"`
	Reason    string `json:"reason" gorm:"type:varchar(191)"`
}

func (CanvasLedger) TableName() string { return "canvas_ledgers" }

// ---------- 项目 ----------

// Insert 创建画布项目，初始 revision 固定为 1。
func (p *CanvasProject) Insert() error {
	now := time.Now().Unix()
	p.CreatedAt = now
	p.UpdatedAt = now
	if p.Revision <= 0 {
		p.Revision = 1
	}
	return DB.Create(p).Error
}

func GetCanvasProjectByID(id int) (*CanvasProject, error) {
	var p CanvasProject
	err := DB.Where("id = ?", id).First(&p).Error
	return &p, err
}

// CanvasProjectListFilter 项目列表过滤条件
type CanvasProjectListFilter struct {
	UserID   int
	Keyword  string
	Page     int
	PageSize int
}

// ListCanvasProjects 分页列出项目（不含 document，避免列表拉全量文档）。
func ListCanvasProjects(f CanvasProjectListFilter) ([]*CanvasProject, int64, error) {
	tx := DB.Model(&CanvasProject{}).Where("user_id = ?", f.UserID)
	if kw := strings.TrimSpace(f.Keyword); kw != "" {
		tx = tx.Where("title LIKE ?", "%"+kw+"%")
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	page, pageSize := f.Page, f.PageSize
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}
	list := make([]*CanvasProject, 0, pageSize)
	err := tx.Select("id, created_at, updated_at, user_id, org_id, title, width, height, background, thumbnail, layer_count, revision").
		Order("updated_at DESC, id DESC").
		Offset((page - 1) * pageSize).Limit(pageSize).
		Find(&list).Error
	if err != nil {
		return nil, 0, err
	}
	return list, total, nil
}

// SaveCanvasDocument 以 revision 乐观锁保存整份文档。
// 返回递增后的新 revision；旧版本写入返回 ErrCanvasRevisionConflict。
func (p *CanvasProject) SaveCanvasDocument(revision int64, document string, width, height int, background, thumbnail string, layerCount int) error {
	now := time.Now().Unix()
	result := DB.Model(&CanvasProject{}).
		Where("id = ? AND revision = ?", p.ID, revision).
		Updates(map[string]any{
			"document":    document,
			"width":       width,
			"height":      height,
			"background":  background,
			"thumbnail":   thumbnail,
			"layer_count": layerCount,
			"revision":    revision + 1,
			"updated_at":  now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrCanvasRevisionConflict
	}
	p.Revision = revision + 1
	p.UpdatedAt = now
	p.Document = document
	p.Width = width
	p.Height = height
	p.Background = background
	p.Thumbnail = thumbnail
	p.LayerCount = layerCount
	return nil
}

// RenameCanvasProject 重命名（不动 revision 与文档内容）。
func RenameCanvasProject(id, userID int, title string) error {
	return DB.Model(&CanvasProject{}).
		Where("id = ? AND user_id = ?", id, userID).
		Updates(map[string]any{"title": title, "updated_at": time.Now().Unix()}).Error
}

// DeleteCanvasProjectCascade 删除项目及其任务与流水记录。
func DeleteCanvasProjectCascade(id, userID int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var taskIDs []int
		if err := tx.Model(&CanvasTask{}).Where("project_id = ?", id).Pluck("id", &taskIDs).Error; err != nil {
			return err
		}
		if len(taskIDs) > 0 {
			if err := tx.Where("task_id IN ?", taskIDs).Delete(&CanvasLedger{}).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("project_id = ?", id).Delete(&CanvasTask{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND user_id = ?", id, userID).Delete(&CanvasProject{}).Error
	})
}

// CountCanvasProjects 项目数（列表页概览用）
func CountCanvasProjects(userID int) int64 {
	var total int64
	DB.Model(&CanvasProject{}).Where("user_id = ?", userID).Count(&total)
	return total
}

// ---------- 任务 ----------

// InsertCanvasTask 落库一条任务。唯一索引冲突时返回已存在的任务，
// 保证同一作用域（用户 + 项目）内同一幂等键只产生一个任务。
func InsertCanvasTask(task *CanvasTask) (*CanvasTask, error) {
	now := time.Now().Unix()
	task.CreatedAt = now
	task.UpdatedAt = now
	err := DB.Create(task).Error
	if err == nil {
		return task, nil
	}
	if !isUniqueViolation(err) {
		return nil, err
	}
	existing, getErr := GetCanvasTaskByIdempotency(task.UserID, task.ProjectID, task.IdempotencyKey)
	if getErr != nil {
		return nil, err
	}
	return existing, nil
}

// isUniqueViolation 判定插入是否撞唯一索引（跨库：SQLite/MySQL 走字符串匹配，
// PostgreSQL 由 gorm 翻译成 ErrDuplicatedKey）。
func isUniqueViolation(err error) bool {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique constraint") ||
		strings.Contains(msg, "duplicate entry") ||
		strings.Contains(msg, "unique failed")
}

func GetCanvasTaskByIdempotency(userID, projectID int, key string) (*CanvasTask, error) {
	var task CanvasTask
	err := DB.Where("user_id = ? AND project_id = ? AND idempotency_key = ?", userID, projectID, key).First(&task).Error
	return &task, err
}

func GetCanvasTaskByID(id int) (*CanvasTask, error) {
	var task CanvasTask
	err := DB.Where("id = ?", id).First(&task).Error
	return &task, err
}

// CanvasTaskListFilter 任务列表过滤
type CanvasTaskListFilter struct {
	UserID    int
	ProjectID int
	Tool      string
	Status    string
	Page      int
	PageSize  int
}

func ListCanvasTasks(f CanvasTaskListFilter) ([]*CanvasTask, int64, error) {
	tx := DB.Model(&CanvasTask{})
	if f.UserID > 0 {
		tx = tx.Where("user_id = ?", f.UserID)
	}
	if f.ProjectID > 0 {
		tx = tx.Where("project_id = ?", f.ProjectID)
	}
	if f.Tool != "" {
		tx = tx.Where("tool = ?", f.Tool)
	}
	if f.Status != "" {
		tx = tx.Where("status = ?", f.Status)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	page, pageSize := f.Page, f.PageSize
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}
	list := make([]*CanvasTask, 0, pageSize)
	err := tx.Order("id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&list).Error
	return list, total, err
}

// ClaimCanvasTask 状态 CAS：仅当当前状态在 from 中时推进到 to。
// 轮询、执行、取消、重启补偿都靠它互斥，避免并发重复提交或重复结算。
func ClaimCanvasTask(id int, from []string, to string) (bool, error) {
	result := DB.Model(&CanvasTask{}).
		Where("id = ? AND status IN ?", id, from).
		Updates(map[string]any{"status": to, "updated_at": time.Now().Unix()})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

// UpdateCanvasTaskFields 更新任务字段（仅当仍未终结时才允许被覆盖状态类字段的场景由调用方 CAS 保证）。
func UpdateCanvasTaskFields(id int, fields map[string]any) error {
	fields["updated_at"] = time.Now().Unix()
	return DB.Model(&CanvasTask{}).Where("id = ?", id).Updates(fields).Error
}

// FinalizeCanvasTask 终结任务：仅当状态仍为 running/pending 时写入终态，
// 防止「用户取消」与「上游完成」并发时互相覆盖（先到者胜）。
func FinalizeCanvasTask(id int, status string, fields map[string]any) (bool, error) {
	fields["status"] = status
	fields["updated_at"] = time.Now().Unix()
	if _, ok := fields["finished_at"]; !ok {
		fields["finished_at"] = time.Now().Unix()
	}
	result := DB.Model(&CanvasTask{}).
		Where("id = ? AND status IN ?", id, []string{CanvasTaskStatusPending, CanvasTaskStatusRunning}).
		Updates(fields)
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

// ListUnfinishedCanvasTasks 供重启补偿：进程启动后把中断的任务收敛到明确状态。
func ListUnfinishedCanvasTasks(limit int) ([]*CanvasTask, error) {
	if limit <= 0 {
		limit = 500
	}
	list := make([]*CanvasTask, 0, limit)
	err := DB.Where("status IN ?", []string{CanvasTaskStatusPending, CanvasTaskStatusRunning}).
		Order("id ASC").Limit(limit).Find(&list).Error
	return list, err
}

// ListCanvasTasksByProjectIDs 批量取项目最近任务时间（列表展示用）
func ListCanvasTasksByProjectIDs(projectIDs []int) (map[int][]*CanvasTask, error) {
	out := make(map[int][]*CanvasTask, len(projectIDs))
	if len(projectIDs) == 0 {
		return out, nil
	}
	var rows []*CanvasTask
	err := DB.Select("id, project_id, tool, status, updated_at, created_at").
		Where("project_id IN ?", projectIDs).
		Order("id DESC").Limit(2000).Find(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.ProjectID] = append(out[r.ProjectID], r)
	}
	return out, nil
}

// ---------- 计费流水 ----------

// RecordCanvasLedger 写入一条计费流水，返回是否为本次新建。
// (task_id, kind) 唯一索引是「至多扣/退一次」的最终防线：重复执行只会撞索引返回 false，
// 调用方据此决定是否真正变动资金。刻意不把资金变动放进同一事务——
// 企业额度池的扣减/回补走 model 层既有函数（内部使用全局 DB），
// 放同一事务会在 SQLite 单连接下自锁。因此顺序固定为「先记流水、再动资金」：
// 极端崩溃时最坏结果是少扣，绝不会重复扣款或重复退款。
func RecordCanvasLedger(ledger *CanvasLedger) (bool, error) {
	ledger.CreatedAt = time.Now().Unix()
	err := DB.Create(ledger).Error
	if err == nil {
		return true, nil
	}
	if isUniqueViolation(err) {
		return false, nil
	}
	return false, err
}

// adjustUserQuota 调整用户额度（正数增加、负数扣减，扣减时校验余额）。
func adjustUserQuota(userID int, delta int) error {
	if delta == 0 {
		return nil
	}
	if delta > 0 {
		return IncreaseUserQuota(userID, delta, true)
	}
	return DecreaseUserQuota(userID, -delta, true)
}

// AdjustCanvasFunding 按资金来源调整额度（钱包或个人所在企业额度池）。
func AdjustCanvasFunding(source string, userID, orgID, delta int) error {
	if delta == 0 {
		return nil
	}
	switch source {
	case CanvasFundingOrganization:
		if orgID <= 0 {
			return fmt.Errorf("企业额度池缺失，无法调整额度")
		}
		if delta > 0 {
			return IncreaseOrgQuota(orgID, delta)
		}
		return ConsumeOrgQuota(orgID, userID, -delta)
	default:
		return adjustUserQuota(userID, delta)
	}
}

// CanvasLedgerExists 查询流水是否已记录（结算前置判断，避免无意义事务）。
func CanvasLedgerExists(taskID int, kind string) bool {
	var count int64
	DB.Model(&CanvasLedger{}).Where("task_id = ? AND kind = ?", taskID, kind).Count(&count)
	return count > 0
}

// GetUserOrgID 读取用户所属企业（0 表示非企业成员）。
func GetUserOrgID(userID int) int {
	var orgID int
	DB.Model(&User{}).Select("org_id").Where("id = ?", userID).Scan(&orgID)
	return orgID
}

// CanvasTaskCountByStatus 统计各状态任务数（前端概览/补偿脚本用）
func CanvasTaskCountByStatus(userID int) map[string]int64 {
	type row struct {
		Status string
		Total  int64
	}
	var rows []row
	DB.Model(&CanvasTask{}).Select("status, count(*) as total").
		Where("user_id = ?", userID).Group("status").Scan(&rows)
	out := make(map[string]int64, len(rows))
	for _, r := range rows {
		out[r.Status] = r.Total
	}
	return out
}

// CanvasProjectPublic 列表项（不含文档正文）
type CanvasProjectPublic struct {
	ID         int    `json:"id"`
	CreatedAt  int64  `json:"createdAt"`
	UpdatedAt  int64  `json:"updatedAt"`
	Title      string `json:"title"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	Background string `json:"background"`
	Thumbnail  string `json:"thumbnail"`
	LayerCount int    `json:"layerCount"`
	Revision   int64  `json:"revision"`
}

// ToPublic 转为不含文档正文的列表项
func (p *CanvasProject) ToPublic() CanvasProjectPublic {
	return CanvasProjectPublic{
		ID: p.ID, CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt, Title: p.Title,
		Width: p.Width, Height: p.Height, Background: p.Background,
		Thumbnail: p.Thumbnail, LayerCount: p.LayerCount, Revision: p.Revision,
	}
}

// HashCanvasParams 计算入参摘要，用于「同幂等键不同参数」判定与快照对账。
func HashCanvasParams(payload []byte) string {
	return common.Sha1(payload)
}
