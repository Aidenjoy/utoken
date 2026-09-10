package model

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// Prompt 模板可见性。
//
//	private 仅本人可见；
//	org    同企业（组织）成员可见，要求 org_id > 0；
//	public 全体用户可见，只有 root 能设置与管理。
const (
	PromptVisibilityPrivate = "private"
	PromptVisibilityOrg     = "org"
	PromptVisibilityPublic  = "public"
)

// promptTagsMax / promptContentMax 是写入前的长度上限，避免把整篇文档塞进模板表。
const (
	promptTitleMax       = 255
	promptDescriptionMax = 512
	promptTagsMax        = 255
	promptContentMax     = 64 * 1024
	promptTagCountMax    = 20
)

var (
	ErrPromptTemplateNotFound   = errors.New("prompt template not found")
	ErrPromptTemplateForbidden  = errors.New("prompt template access denied")
	ErrPromptTitleEmpty         = errors.New("prompt title cannot be empty")
	ErrPromptTitleTooLong       = errors.New("prompt title too long")
	ErrPromptContentEmpty       = errors.New("prompt content cannot be empty")
	ErrPromptContentTooLong     = errors.New("prompt content too long")
	ErrPromptDescriptionTooLong = errors.New("prompt description too long")
	ErrPromptVisibilityInvalid  = errors.New("invalid prompt visibility")
	ErrPromptTagsTooMany        = errors.New("too many prompt tags")
)

// PromptTemplate 是 Prompt 模板库条目。
//
// UserId 是创建者，OrgId 是创建时所属企业（0 表示个人模板）。
// OrgId 在创建后不随成员退出企业而变更：企业内共享的模板属于企业资产，
// 创建者离开企业后模板仍应对同企业成员可见。
type PromptTemplate struct {
	Id          int    `json:"id"`
	UserId      int    `json:"user_id" gorm:"type:int;index;default:0"`
	OrgId       int    `json:"org_id" gorm:"type:int;default:0;index:idx_prompt_org_visibility,priority:1"`
	Title       string `json:"title" gorm:"size:255;not null"`
	Content     string `json:"content" gorm:"type:text"`
	Description string `json:"description" gorm:"size:512"`
	Tags        string `json:"tags" gorm:"size:255"` // 逗号分隔，读取时用 ParsePromptTags
	Visibility  string `json:"visibility" gorm:"size:16;index:idx_prompt_org_visibility,priority:2"`
	UseCount    int    `json:"use_count" gorm:"type:int;default:0"`
	CreatedAt   int64  `json:"created_at" gorm:"autoCreateTime;column:created_at"`
	UpdatedAt   int64  `json:"updated_at" gorm:"autoUpdateTime;column:updated_at"`
}

func (PromptTemplate) TableName() string {
	return "prompt_templates"
}

// ---------------------------------------------------------------------------
// 校验与归一化
// ---------------------------------------------------------------------------

func IsValidPromptVisibility(visibility string) bool {
	switch visibility {
	case PromptVisibilityPrivate, PromptVisibilityOrg, PromptVisibilityPublic:
		return true
	}
	return false
}

// ParsePromptTags 把逗号分隔的标签串解析为切片，去除空白项。
func ParsePromptTags(tags string) []string {
	if strings.TrimSpace(tags) == "" {
		return []string{}
	}
	parts := strings.Split(tags, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if tag := strings.TrimSpace(part); tag != "" {
			result = append(result, tag)
		}
	}
	return result
}

// JoinPromptTags 把标签切片归一化为存储用的逗号分隔串：去空白、去重、限长。
func JoinPromptTags(tags []string) string {
	seen := make(map[string]struct{}, len(tags))
	result := make([]string, 0, len(tags))
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		if _, ok := seen[tag]; ok {
			continue
		}
		seen[tag] = struct{}{}
		result = append(result, tag)
	}
	return strings.Join(result, ",")
}

// ValidatePromptTemplate 校验模板内容并归一化字段，创建与更新共用。
// 只在写入前做一次校验，避免把非法数据带进库里再靠查询兜底。
func ValidatePromptTemplate(t *PromptTemplate) error {
	if t == nil {
		return ErrPromptTemplateNotFound
	}
	t.Title = strings.TrimSpace(t.Title)
	t.Description = strings.TrimSpace(t.Description)
	t.Content = strings.TrimSpace(t.Content)
	t.Tags = JoinPromptTags(ParsePromptTags(t.Tags))

	if t.Title == "" {
		return ErrPromptTitleEmpty
	}
	if len(t.Title) > promptTitleMax {
		return ErrPromptTitleTooLong
	}
	if t.Content == "" {
		return ErrPromptContentEmpty
	}
	if len(t.Content) > promptContentMax {
		return ErrPromptContentTooLong
	}
	if len(t.Description) > promptDescriptionMax {
		return ErrPromptDescriptionTooLong
	}
	if len(t.Tags) > promptTagsMax {
		return ErrPromptTagsTooMany
	}
	if len(ParsePromptTags(t.Tags)) > promptTagCountMax {
		return ErrPromptTagsTooMany
	}
	if !IsValidPromptVisibility(t.Visibility) {
		return ErrPromptVisibilityInvalid
	}
	// org 可见性必须绑定企业，否则会退化成"任何人都看不到的孤儿模板"。
	if t.Visibility == PromptVisibilityOrg && t.OrgId <= 0 {
		t.Visibility = PromptVisibilityPrivate
	}
	return nil
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

func CreatePromptTemplate(t *PromptTemplate) error {
	if err := ValidatePromptTemplate(t); err != nil {
		return err
	}
	return DB.Create(t).Error
}

func GetPromptTemplateById(id int) (*PromptTemplate, error) {
	if id <= 0 {
		return nil, ErrPromptTemplateNotFound
	}
	var t PromptTemplate
	if err := DB.Where("id = ?", id).First(&t).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPromptTemplateNotFound
		}
		return nil, err
	}
	return &t, nil
}

func UpdatePromptTemplateFields(id int, fields map[string]interface{}) error {
	if id <= 0 {
		return ErrPromptTemplateNotFound
	}
	if len(fields) == 0 {
		return nil
	}
	return DB.Model(&PromptTemplate{}).Where("id = ?", id).Updates(fields).Error
}

func DeletePromptTemplate(id int) error {
	if id <= 0 {
		return ErrPromptTemplateNotFound
	}
	return DB.Where("id = ?", id).Delete(&PromptTemplate{}).Error
}

// IncreasePromptTemplateUseCount 记录一次"在 Playground 中使用"或复制。
// 非关键路径，失败只影响排序热度，不影响主流程。
func IncreasePromptTemplateUseCount(id int) error {
	if id <= 0 {
		return ErrPromptTemplateNotFound
	}
	return DB.Model(&PromptTemplate{}).Where("id = ?", id).
		Update("use_count", gorm.Expr("use_count + 1")).Error
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

// promptVisibleScope 构造"当前用户可见"的条件：
// public 全体可见，private 仅本人，org 仅同企业成员。
func promptVisibleScope(userId int, orgId int) *gorm.DB {
	if orgId > 0 {
		return DB.Where(
			"visibility = ? OR (visibility = ? AND user_id = ?) OR (visibility = ? AND org_id = ?)",
			PromptVisibilityPublic, PromptVisibilityPrivate, userId, PromptVisibilityOrg, orgId)
	}
	return DB.Where("visibility = ? OR (visibility = ? AND user_id = ?)",
		PromptVisibilityPublic, PromptVisibilityPrivate, userId)
}

func applyPromptFilters(query *gorm.DB, keyword string, tag string, visibility string) *gorm.DB {
	if keyword != "" {
		like := "%" + escapePromptLikePattern(keyword) + "%"
		query = query.Where("title LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!' OR content LIKE ? ESCAPE '!'",
			like, like, like)
	}
	if tag = strings.TrimSpace(tag); tag != "" {
		// 标签以逗号分隔存储，用两侧补逗号的方式做整词匹配，避免 "code" 命中 "coding"。
		query = query.Where(promptTagsFilterCondition(), promptTagsFilterPattern(tag))
	}
	if IsValidPromptVisibility(visibility) {
		query = query.Where("visibility = ?", visibility)
	}
	return query
}

// promptTagsFilterCondition 返回跨库的标签匹配条件。
// MySQL 默认把 || 当逻辑或，因此必须走 CONCAT；其余库用 || 拼接。
func promptTagsFilterCondition() string {
	if common.UsingMainDatabase(common.DatabaseTypeMySQL) {
		return "CONCAT(',', tags, ',') LIKE ? ESCAPE '!'"
	}
	return "(',' || tags || ',') LIKE ? ESCAPE '!'"
}

// promptTagsFilterPattern 转义 LIKE 通配符后拼上逗号边界。
// 用 ! 而非 \ 作为 ESCAPE 字符，避开 MySQL 对反斜杠的二次转义。
func promptTagsFilterPattern(tag string) string {
	return "%," + escapePromptLikePattern(tag) + ",%"
}

func escapePromptLikePattern(s string) string {
	return strings.NewReplacer(
		"!", "!!",
		"%", "!%",
		"_", "!_",
	).Replace(s)
}

// GetVisiblePromptTemplates 分页查询用户可见的模板，按更新时间倒序。
func GetVisiblePromptTemplates(userId int, orgId int, keyword string, tag string, visibility string, startIdx int, num int) ([]*PromptTemplate, int64, error) {
	var templates []*PromptTemplate
	var total int64
	countQuery := promptVisibleScope(userId, orgId).Model(&PromptTemplate{})
	countQuery = applyPromptFilters(countQuery, keyword, tag, visibility)
	if err := countQuery.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	listQuery := promptVisibleScope(userId, orgId).Model(&PromptTemplate{})
	listQuery = applyPromptFilters(listQuery, keyword, tag, visibility)
	if err := listQuery.Order("updated_at desc, id desc").Limit(num).Offset(startIdx).Find(&templates).Error; err != nil {
		return nil, 0, err
	}
	return templates, total, nil
}

// GetPromptTemplatesForOrgAdmin 供企业管理员管理本企业模板：
// 覆盖本企业的全部可见性（含成员的 private），不含 public 与他人企业。
func GetPromptTemplatesForOrgAdmin(orgId int, keyword string, tag string, startIdx int, num int) ([]*PromptTemplate, int64, error) {
	if orgId <= 0 {
		return nil, 0, ErrPromptTemplateNotFound
	}
	var templates []*PromptTemplate
	var total int64
	countQuery := DB.Model(&PromptTemplate{}).Where("org_id = ?", orgId)
	countQuery = applyPromptFilters(countQuery, keyword, tag, "")
	if err := countQuery.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	listQuery := DB.Model(&PromptTemplate{}).Where("org_id = ?", orgId)
	listQuery = applyPromptFilters(listQuery, keyword, tag, "")
	if err := listQuery.Order("updated_at desc, id desc").Limit(num).Offset(startIdx).Find(&templates).Error; err != nil {
		return nil, 0, err
	}
	return templates, total, nil
}

// GetPublicPromptTemplates 供 root 管理全站公开模板。
func GetPublicPromptTemplates(keyword string, tag string, startIdx int, num int) ([]*PromptTemplate, int64, error) {
	var templates []*PromptTemplate
	var total int64
	countQuery := DB.Model(&PromptTemplate{}).Where("visibility = ?", PromptVisibilityPublic)
	countQuery = applyPromptFilters(countQuery, keyword, tag, "")
	if err := countQuery.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	listQuery := DB.Model(&PromptTemplate{}).Where("visibility = ?", PromptVisibilityPublic)
	listQuery = applyPromptFilters(listQuery, keyword, tag, "")
	if err := listQuery.Order("updated_at desc, id desc").Limit(num).Offset(startIdx).Find(&templates).Error; err != nil {
		return nil, 0, err
	}
	return templates, total, nil
}

// GetPromptTemplateTags 汇总当前用户可见模板的标签，供前端标签筛选下拉使用。
func GetPromptTemplateTags(userId int, orgId int) ([]string, error) {
	var tags []string
	if err := promptVisibleScope(userId, orgId).Model(&PromptTemplate{}).
		Where("tags <> ''").Distinct().Pluck("tags", &tags).Error; err != nil {
		return nil, err
	}
	seen := make(map[string]struct{})
	result := make([]string, 0, len(tags))
	for _, raw := range tags {
		for _, tag := range ParsePromptTags(raw) {
			if _, ok := seen[tag]; ok {
				continue
			}
			seen[tag] = struct{}{}
			result = append(result, tag)
		}
	}
	return result, nil
}

// ---------------------------------------------------------------------------
// 权限判定
// ---------------------------------------------------------------------------

// CanReadPromptTemplate 判断用户能否读取模板内容。
func CanReadPromptTemplate(t *PromptTemplate, userId int, orgId int) bool {
	if t == nil {
		return false
	}
	switch t.Visibility {
	case PromptVisibilityPublic:
		return true
	case PromptVisibilityOrg:
		return orgId > 0 && t.OrgId == orgId
	default:
		return t.UserId == userId
	}
}

// CanManagePromptTemplate 判断用户能否编辑/删除模板。
//
// 三类主体：创建者本人、本企业的企业管理员（orgRole == OrgRoleAdmin 且同企业）、
// root（仅对 public 模板生效，避免 root 越权改企业/个人私有内容）。
func CanManagePromptTemplate(t *PromptTemplate, userId int, orgId int, orgRole string, isRoot bool) bool {
	if t == nil {
		return false
	}
	if t.UserId == userId {
		return true
	}
	if orgId > 0 && t.OrgId == orgId && orgRole == OrgRoleAdmin {
		return true
	}
	return isRoot && t.Visibility == PromptVisibilityPublic
}
