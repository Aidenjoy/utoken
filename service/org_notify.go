package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/bytedance/gopkg/util/gopool"
)

// orgAlertCooldown 是企业级告警的去重窗口。消费结算是高频路径，若不做冷却，
// 余额跌破阈值后的每一次请求都会触发一封通知，把管理员的邮箱/推送刷爆。
const orgAlertCooldown = 24 * time.Hour

// 企业告警审计动作标识，与 controller/audit.go 的 auditContentTemplates
// 及前端 AUDIT_TEMPLATES 一一对应。
const (
	AlertActionOrgQuotaLow   = "alert.org_quota_low"
	AlertActionOrgDailyUsage = "alert.org_daily_usage"
	AlertActionMemberQuota   = "alert.member_quota"
)

// checkAndSendOrgQuotaNotify 在企业额度池结算后检查企业级告警：
// 池余额跌破预警阈值、当日累计用量超过日用量阈值。
// 成员个人钱包未被扣减，因此调用方不应再走 checkAndSendQuotaNotify。
func checkAndSendOrgQuotaNotify(relayInfo *relaycommon.RelayInfo) {
	if relayInfo == nil || relayInfo.OrgId <= 0 {
		return
	}
	orgId := relayInfo.OrgId
	memberUserId := relayInfo.UserId
	gopool.Go(func() {
		org, err := model.GetOrganizationById(orgId)
		if err != nil || org == nil {
			return
		}
		checkOrgQuotaThreshold(org)
		checkOrgDailyUsage(org)
		checkOrgMemberQuotaThreshold(org, memberUserId)
	})
}

// checkOrgQuotaThreshold 企业池余额跌破 WarningThreshold 时通知企业管理员。
func checkOrgQuotaThreshold(org *model.Organization) {
	if org.WarningThreshold <= 0 || org.Quota > org.WarningThreshold {
		return
	}
	if !claimOrgAlert(org.Id, "last_alert_at", org.LastAlertAt) {
		return
	}
	title := fmt.Sprintf("企业 %s 额度池即将用尽", orgAlertDisplayName(org))
	content := "企业 {{value}} 的额度池余额为 {{value}}，已跌破预警阈值 {{value}}，请及时充值以免影响成员使用。"
	values := []interface{}{orgAlertDisplayName(org), logger.FormatQuota(org.Quota), logger.FormatQuota(org.WarningThreshold)}
	sendOrgAlert(org, dto.NotifyTypeQuotaExceed, title, content, values)
	recordOrgAlertAudit(org, AlertActionOrgQuotaLow, map[string]interface{}{
		"name":      orgAlertDisplayName(org),
		"threshold": org.WarningThreshold,
		"quota":     org.Quota,
	})
}

// checkOrgDailyUsage 企业当日累计用量超过 DailyUsageAlert 时通知企业管理员。
func checkOrgDailyUsage(org *model.Organization) {
	if org.DailyUsageAlert <= 0 {
		return
	}
	now := common.GetTimestamp()
	used, err := model.GetOrgDailyQuota(org.Id, now)
	if err != nil || used < org.DailyUsageAlert {
		return
	}
	if !claimOrgAlert(org.Id, "last_daily_alert_at", org.LastDailyAlertAt) {
		return
	}
	title := fmt.Sprintf("企业 %s 当日用量超限", orgAlertDisplayName(org))
	content := "企业 {{value}} 当日累计用量为 {{value}}，已超过告警阈值 {{value}}。"
	values := []interface{}{orgAlertDisplayName(org), logger.FormatQuota(used), logger.FormatQuota(org.DailyUsageAlert)}
	sendOrgAlert(org, dto.NotifyTypeQuotaExceed, title, content, values)
	recordOrgAlertAudit(org, AlertActionOrgDailyUsage, map[string]interface{}{
		"name":      orgAlertDisplayName(org),
		"threshold": org.DailyUsageAlert,
		"used":      used,
	})
}

// checkOrgMemberQuotaThreshold 成员子额度使用率告警。
// 阈值默认继承企业的 WarningThreshold 语义（按剩余额度判断），成员可在个人设置里
// 用 QuotaWarningThreshold 覆盖；QuotaLimit<=0 表示不限额，不告警。
func checkOrgMemberQuotaThreshold(org *model.Organization, userId int) {
	if userId <= 0 {
		return
	}
	member, err := model.GetOrgMember(org.Id, userId)
	if err != nil || member == nil || member.QuotaLimit <= 0 {
		return
	}
	threshold := org.WarningThreshold
	if setting, settingErr := model.GetUserSetting(userId, false); settingErr == nil && setting.QuotaWarningThreshold != 0 {
		threshold = int(setting.QuotaWarningThreshold)
	}
	if threshold <= 0 || member.QuotaLimit-member.QuotaUsed > threshold {
		return
	}
	// 成员级告警发给成员本人，复用其个人通知渠道；冷却沿用全局通知频控。
	title := "您的企业子额度即将用尽"
	content := "您在企业 {{value}} 的子额度剩余 {{value}}（上限 {{value}}），请联系企业管理员调整。"
	values := []interface{}{orgAlertDisplayName(org), logger.FormatQuota(member.QuotaLimit - member.QuotaUsed), logger.FormatQuota(member.QuotaLimit)}
	percent := 100
	if member.QuotaLimit > 0 {
		percent = member.QuotaUsed * 100 / member.QuotaLimit
	}
	if user, userErr := model.GetUserById(userId, false); userErr == nil && user != nil {
		setting, _ := model.GetUserSetting(userId, false)
		if notifyErr := NotifyUser(userId, user.Email, setting, dto.NewNotify(dto.NotifyTypeQuotaExceed, title, content, values)); notifyErr != nil {
			common.SysError(fmt.Sprintf("failed to send org member quota notify to user %d: %s", userId, notifyErr.Error()))
		}
	}
	recordOrgAlertAudit(org, AlertActionMemberQuota, map[string]interface{}{
		"username":  orgAlertUsername(userId),
		"name":      orgAlertDisplayName(org),
		"threshold": percent,
	})
}

// claimOrgAlert 以"先占位再发送"的方式实现冷却去重：先把告警时间戳推到当前时间，
// 只有占位成功（距上次告警已超过冷却窗口）才返回 true。
// 先写后发可以让并发结算请求中只有一个发出通知，代价是发送失败也要等冷却结束。
func claimOrgAlert(orgId int, field string, lastAlertAt int64) bool {
	now := common.GetTimestamp()
	if lastAlertAt > 0 && now-lastAlertAt < int64(orgAlertCooldown.Seconds()) {
		return false
	}
	if err := model.UpdateOrgAlertTimestamp(orgId, field, now); err != nil {
		common.SysError(fmt.Sprintf("failed to claim org alert (orgId=%d, field=%s): %s", orgId, field, err.Error()))
		return false
	}
	return true
}

// sendOrgAlert 按企业配置的通知方式发给收件人。
// NotifyTarget 非空时按逗号分隔的用户名定向发送，否则发给全部启用的企业管理员。
func sendOrgAlert(org *model.Organization, notifyType string, title string, content string, values []interface{}) {
	for _, recipient := range orgAlertRecipients(org) {
		setting := recipient.setting
		if org.NotifyType != "" {
			setting.NotifyType = org.NotifyType
		}
		if err := NotifyUser(recipient.userId, recipient.email, setting, dto.NewNotify(notifyType, title, content, values)); err != nil {
			common.SysError(fmt.Sprintf("failed to send org alert to user %d (orgId=%d): %s", recipient.userId, org.Id, err.Error()))
		}
	}
}

type orgAlertRecipient struct {
	userId  int
	email   string
	setting dto.UserSetting
}

func orgAlertRecipients(org *model.Organization) []orgAlertRecipient {
	userIds := make([]int, 0, 4)
	if target := strings.TrimSpace(org.NotifyTarget); target != "" {
		for _, username := range strings.Split(target, ",") {
			username = strings.TrimSpace(username)
			if username == "" {
				continue
			}
			if user, err := model.GetUserByUsername(username); err == nil && user != nil {
				userIds = append(userIds, user.Id)
			}
		}
	} else if adminIds, err := model.GetOrgAdminUserIds(org.Id); err == nil {
		userIds = append(userIds, adminIds...)
	}

	recipients := make([]orgAlertRecipient, 0, len(userIds))
	for _, userId := range userIds {
		user, err := model.GetUserById(userId, false)
		if err != nil || user == nil {
			continue
		}
		setting, settingErr := model.GetUserSetting(userId, false)
		if settingErr != nil {
			setting = dto.UserSetting{}
		}
		recipients = append(recipients, orgAlertRecipient{userId: userId, email: user.Email, setting: setting})
	}
	return recipients
}

// recordOrgAlertAudit 把告警事件写入审计日志，归属到企业负责人（缺失时退回首个企业管理员）。
// 告警由系统触发而非人工操作，因此 admin_info 显式标注 system_generated，
// 便于在审计列表里与真实的管理动作区分。
func recordOrgAlertAudit(org *model.Organization, action string, params map[string]interface{}) {
	logUserId := org.OwnerUserId
	if logUserId <= 0 {
		if adminIds, err := model.GetOrgAdminUserIds(org.Id); err == nil && len(adminIds) > 0 {
			logUserId = adminIds[0]
		}
	}
	model.RecordOperationAuditLog(logUserId, orgAlertAuditContent(action, params), "", action, params,
		map[string]interface{}{
			"admin_id":         logUserId,
			"admin_username":   orgAlertUsername(logUserId),
			"auth_method":      "system",
			"system_generated": true,
			"org_id":           org.Id,
		}, nil)
}

// orgAlertAuditContent 渲染告警审计日志的英文兜底文本，与 controller 侧
// auditContentTemplates 中同名 action 的模板保持一致（service 无法复用该表，
// 因为它是 controller 包的私有变量）。
func orgAlertAuditContent(action string, params map[string]interface{}) string {
	name := fmt.Sprintf("%v", params["name"])
	threshold := fmt.Sprintf("%v", params["threshold"])
	switch action {
	case AlertActionOrgQuotaLow:
		return fmt.Sprintf("Organization %s quota dropped below warning threshold %s", name, threshold)
	case AlertActionOrgDailyUsage:
		return fmt.Sprintf("Organization %s daily usage exceeded %s", name, threshold)
	case AlertActionMemberQuota:
		return fmt.Sprintf("Member %v organization sub-quota usage exceeded %s%%", params["username"], threshold)
	default:
		return action
	}
}

func orgAlertDisplayName(org *model.Organization) string {
	if org.DisplayName != "" {
		return org.DisplayName
	}
	return org.Name
}

func orgAlertUsername(userId int) string {
	if userId <= 0 {
		return ""
	}
	if username, err := model.GetUsernameById(userId, false); err == nil {
		return username
	}
	return ""
}
