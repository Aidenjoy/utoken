package controller

import (
	"errors"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// Prompt 模板库接口。
//
// 权限模型完全落在实体上而非路由上：同一组端点按调用者身份决定可见范围与可管理范围，
// 因此不需要为企业管理员和 root 各开一套路由。
//   - 读取：public 全体可见；org 仅同企业成员；private 仅创建者
//   - 管理：创建者本人、本企业的企业管理员、以及 root（仅限 public 模板）
//
// 越权访问统一按"模板不存在"响应，不泄露他人私有模板的存在性。

// promptListScopeOrg / promptListScopePublic 是列表接口的管理视角。
// 缺省为空表示"我可见的模板"，即普通使用视角。
const (
	promptListScopeOrg    = "org"
	promptListScopePublic = "public"
)

// promptTemplateRequest 是创建与更新共用的请求体。
// 更新时零值字段视为"不修改"，因此 Visibility 留空表示保持原值。
type promptTemplateRequest struct {
	Title       string `json:"title"`
	Content     string `json:"content"`
	Description string `json:"description"`
	Tags        string `json:"tags"`
	Visibility  string `json:"visibility"`
}

// isRootUser 判断当前请求是否来自超级管理员。
// 只有 root 能发布 public 模板：public 意味着全站可见，属于平台级内容治理权限。
func isRootUser(c *gin.Context) bool {
	return c.GetInt("role") >= common.RoleRootUser
}

// loadReadablePromptTemplate 读取模板并校验当前用户可见。
// 不可见与不存在返回同一个错误，避免通过状态差异探测他人私有模板。
func loadReadablePromptTemplate(c *gin.Context) (*model.PromptTemplate, bool) {
	template, ok := loadPromptTemplate(c)
	if !ok {
		return nil, false
	}
	if !model.CanReadPromptTemplate(template, c.GetInt("id"), middleware.OrgIdFromContext(c)) {
		common.ApiErrorI18n(c, i18n.MsgPromptNotFound)
		return nil, false
	}
	return template, true
}

// loadManageablePromptTemplate 读取模板并校验当前用户可管理，失败时已写好响应
func loadManageablePromptTemplate(c *gin.Context) (*model.PromptTemplate, bool) {
	template, ok := loadPromptTemplate(c)
	if !ok {
		return nil, false
	}
	if !model.CanManagePromptTemplate(template, c.GetInt("id"), middleware.OrgIdFromContext(c),
		middleware.OrgRoleFromContext(c), isRootUser(c)) {
		common.ApiErrorI18n(c, i18n.MsgPromptNotFound)
		return nil, false
	}
	return template, true
}

func loadPromptTemplate(c *gin.Context) (*model.PromptTemplate, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorI18n(c, i18n.MsgPromptNotFound)
		return nil, false
	}
	template, err := model.GetPromptTemplateById(id)
	if err != nil {
		if errors.Is(err, model.ErrPromptTemplateNotFound) {
			common.ApiErrorI18n(c, i18n.MsgPromptNotFound)
		} else {
			common.ApiError(c, err)
		}
		return nil, false
	}
	return template, true
}

// promptValidationError 把 model 层的校验哨兵错误映射为对应的 i18n 提示。
// 返回 false 表示不是校验类错误，调用方应走通用错误响应。
func promptValidationError(c *gin.Context, err error) bool {
	switch {
	case errors.Is(err, model.ErrPromptTitleEmpty):
		common.ApiErrorI18n(c, i18n.MsgPromptTitleEmpty)
	case errors.Is(err, model.ErrPromptTitleTooLong):
		common.ApiErrorI18n(c, i18n.MsgPromptTitleTooLong)
	case errors.Is(err, model.ErrPromptContentEmpty):
		common.ApiErrorI18n(c, i18n.MsgPromptContentEmpty)
	case errors.Is(err, model.ErrPromptContentTooLong):
		common.ApiErrorI18n(c, i18n.MsgPromptContentTooLong)
	case errors.Is(err, model.ErrPromptDescriptionTooLong):
		common.ApiErrorI18n(c, i18n.MsgPromptDescriptionTooLong)
	case errors.Is(err, model.ErrPromptTagsTooMany):
		common.ApiErrorI18n(c, i18n.MsgPromptTagsTooMany)
	case errors.Is(err, model.ErrPromptVisibilityInvalid):
		common.ApiErrorI18n(c, i18n.MsgPromptVisibilityInvalid)
	default:
		return false
	}
	return true
}

// GetPromptTemplates 分页查询 Prompt 模板。
//
// scope 缺省为"我可见的"；企业管理员可传 scope=org 管理本企业全部模板，
// root 可传 scope=public 管理全站公开模板。无权限的 scope 直接回落默认视角，
// 而不是报错——列表是高频只读接口，静默降级比拒绝更不容易误导前端。
func GetPromptTemplates(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	keyword := strings.TrimSpace(c.Query("keyword"))
	tag := strings.TrimSpace(c.Query("tag"))
	visibility := strings.TrimSpace(c.Query("visibility"))
	userId := c.GetInt("id")
	orgId := middleware.OrgIdFromContext(c)

	var (
		templates []*model.PromptTemplate
		total     int64
		err       error
	)
	switch c.Query("scope") {
	case promptListScopeOrg:
		if orgId > 0 && middleware.IsOrgAdmin(c) {
			templates, total, err = model.GetPromptTemplatesForOrgAdmin(orgId, keyword, tag,
				pageInfo.GetStartIdx(), pageInfo.GetPageSize())
			break
		}
		templates, total, err = model.GetVisiblePromptTemplates(userId, orgId, keyword, tag, visibility,
			pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	case promptListScopePublic:
		if isRootUser(c) {
			templates, total, err = model.GetPublicPromptTemplates(keyword, tag,
				pageInfo.GetStartIdx(), pageInfo.GetPageSize())
			break
		}
		templates, total, err = model.GetVisiblePromptTemplates(userId, orgId, keyword, tag, visibility,
			pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	default:
		templates, total, err = model.GetVisiblePromptTemplates(userId, orgId, keyword, tag, visibility,
			pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(templates)
	common.ApiSuccess(c, pageInfo)
}

// GetPromptTemplateTags 返回当前用户可见模板的标签集合，供前端标签筛选下拉使用
func GetPromptTemplateTags(c *gin.Context) {
	tags, err := model.GetPromptTemplateTags(c.GetInt("id"), middleware.OrgIdFromContext(c))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, tags)
}

// GetPromptTemplate 读取单个模板详情
func GetPromptTemplate(c *gin.Context) {
	template, ok := loadReadablePromptTemplate(c)
	if !ok {
		return
	}
	common.ApiSuccess(c, template)
}

// CreatePromptTemplate 新建模板。归属企业取创建者当前所属企业，
// 创建后不随其退出企业而变更（企业内共享的模板属于企业资产）。
func CreatePromptTemplate(c *gin.Context) {
	var req promptTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	orgId := middleware.OrgIdFromContext(c)
	visibility := strings.TrimSpace(req.Visibility)
	if visibility == "" {
		visibility = model.PromptVisibilityPrivate
	}
	if visibility == model.PromptVisibilityPublic && !isRootUser(c) {
		common.ApiErrorI18n(c, i18n.MsgPromptVisibilityPublicOnly)
		return
	}
	if visibility == model.PromptVisibilityOrg && orgId <= 0 {
		common.ApiErrorI18n(c, i18n.MsgPromptVisibilityOrgNoOrg)
		return
	}

	template := &model.PromptTemplate{
		UserId:      c.GetInt("id"),
		OrgId:       orgId,
		Title:       req.Title,
		Content:     req.Content,
		Description: req.Description,
		Tags:        req.Tags,
		Visibility:  visibility,
	}
	if err := model.CreatePromptTemplate(template); err != nil {
		if promptValidationError(c, err) {
			return
		}
		common.ApiErrorI18n(c, i18n.MsgPromptCreateFailed)
		return
	}
	common.ApiSuccess(c, template)
}

// UpdatePromptTemplate 更新模板。仅提交请求里出现的字段，未提供的保持原值。
func UpdatePromptTemplate(c *gin.Context) {
	template, ok := loadManageablePromptTemplate(c)
	if !ok {
		return
	}
	var req promptTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}

	fields := make(map[string]interface{}, 5)
	if strings.TrimSpace(req.Title) != "" {
		fields["title"] = strings.TrimSpace(req.Title)
	}
	if strings.TrimSpace(req.Content) != "" {
		fields["content"] = req.Content
	}
	if req.Description != template.Description {
		fields["description"] = strings.TrimSpace(req.Description)
	}
	if req.Tags != template.Tags {
		fields["tags"] = model.JoinPromptTags(model.ParsePromptTags(req.Tags))
	}
	if visibility := strings.TrimSpace(req.Visibility); visibility != "" && visibility != template.Visibility {
		// 提升为 public 是平台级动作，只有 root 能做；企业管理员也不能把
		// 成员的 private 模板改成 org 共享，避免越权扩散内容。
		if visibility == model.PromptVisibilityPublic && !isRootUser(c) {
			common.ApiErrorI18n(c, i18n.MsgPromptVisibilityPublicOnly)
			return
		}
		if visibility == model.PromptVisibilityOrg && template.OrgId <= 0 {
			common.ApiErrorI18n(c, i18n.MsgPromptVisibilityOrgNoOrg)
			return
		}
		if !model.IsValidPromptVisibility(visibility) {
			common.ApiErrorI18n(c, i18n.MsgPromptVisibilityInvalid)
			return
		}
		fields["visibility"] = visibility
	}
	if len(fields) == 0 {
		common.ApiSuccess(c, template)
		return
	}

	// 复用 model 层校验：把改动叠加到副本上验证，通过后再落库，
	// 避免"部分字段合法、组合后超长"的情况写进库里。
	candidate := *template
	if title, ok := fields["title"].(string); ok {
		candidate.Title = title
	}
	if content, ok := fields["content"].(string); ok {
		candidate.Content = content
	}
	if description, ok := fields["description"].(string); ok {
		candidate.Description = description
	}
	if tags, ok := fields["tags"].(string); ok {
		candidate.Tags = tags
	}
	if visibility, ok := fields["visibility"].(string); ok {
		candidate.Visibility = visibility
	}
	if err := model.ValidatePromptTemplate(&candidate); err != nil {
		if promptValidationError(c, err) {
			return
		}
		common.ApiErrorI18n(c, i18n.MsgPromptUpdateFailed)
		return
	}
	if err := model.UpdatePromptTemplateFields(template.Id, fields); err != nil {
		common.ApiErrorI18n(c, i18n.MsgPromptUpdateFailed)
		return
	}
	updated, err := model.GetPromptTemplateById(template.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, updated)
}

// DeletePromptTemplate 删除模板
func DeletePromptTemplate(c *gin.Context) {
	template, ok := loadManageablePromptTemplate(c)
	if !ok {
		return
	}
	if err := model.DeletePromptTemplate(template.Id); err != nil {
		common.ApiErrorI18n(c, i18n.MsgPromptDeleteFailed)
		return
	}
	common.ApiSuccessI18n(c, i18n.MsgDeleteSuccess, nil)
}

// copyPromptTemplateRequest 复制副本时的可选覆盖项
type copyPromptTemplateRequest struct {
	Title      string `json:"title"`
	Visibility string `json:"visibility"`
}

// CopyPromptTemplate 把可见模板复制成调用者自己的副本。
// 副本默认 private 且不带企业归属，避免"复制一份就顺手扩散给全企业"；
// 需要共享时由调用者显式指定 visibility。
func CopyPromptTemplate(c *gin.Context) {
	source, ok := loadReadablePromptTemplate(c)
	if !ok {
		return
	}
	var req copyPromptTemplateRequest
	// 请求体可选：前端"复制副本"按钮通常不带 body
	_ = c.ShouldBindJSON(&req)

	visibility := strings.TrimSpace(req.Visibility)
	if visibility == "" {
		visibility = model.PromptVisibilityPrivate
	}
	if visibility == model.PromptVisibilityPublic && !isRootUser(c) {
		common.ApiErrorI18n(c, i18n.MsgPromptVisibilityPublicOnly)
		return
	}
	orgId := 0
	if visibility == model.PromptVisibilityOrg {
		orgId = middleware.OrgIdFromContext(c)
		if orgId <= 0 {
			common.ApiErrorI18n(c, i18n.MsgPromptVisibilityOrgNoOrg)
			return
		}
	}

	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = source.Title
	}
	copyTemplate := &model.PromptTemplate{
		UserId:      c.GetInt("id"),
		OrgId:       orgId,
		Title:       title,
		Content:     source.Content,
		Description: source.Description,
		Tags:        source.Tags,
		Visibility:  visibility,
	}
	if err := model.CreatePromptTemplate(copyTemplate); err != nil {
		if promptValidationError(c, err) {
			return
		}
		common.ApiErrorI18n(c, i18n.MsgPromptCreateFailed)
		return
	}
	common.ApiSuccess(c, copyTemplate)
}

// UsePromptTemplate 记录一次"在 Playground 中使用"。
// 计数只用于热度排序，失败也不影响前端拿到内容，因此始终返回成功。
func UsePromptTemplate(c *gin.Context) {
	template, ok := loadReadablePromptTemplate(c)
	if !ok {
		return
	}
	if err := model.IncreasePromptTemplateUseCount(template.Id); err != nil {
		common.SysError("failed to increase prompt template use count: " + err.Error())
	}
	common.ApiSuccess(c, gin.H{"id": template.Id, "use_count": template.UseCount + 1})
}
