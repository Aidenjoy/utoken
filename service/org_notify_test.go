package service

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"

	"github.com/stretchr/testify/assert"
)

// TestOrgAlertConfigured 锁定企业告警的投递前提：渠道与目标齐备才进入
// 占位与投递流程；未配置（含存量空渠道）整体跳过，结算路径不空转、不消耗冷却。
func TestOrgAlertConfigured(t *testing.T) {
	tests := []struct {
		name string
		org  *model.Organization
		want bool
	}{
		{"unconfigured channel", &model.Organization{NotifyType: "", NotifyTarget: "leftover"}, false},
		{"email with targets", &model.Organization{NotifyType: dto.NotifyTypeEmail, NotifyTarget: "a@example.com; b@example.com"}, true},
		{"email with separators only", &model.Organization{NotifyType: dto.NotifyTypeEmail, NotifyTarget: " ; "}, false},
		{"email with empty target", &model.Organization{NotifyType: dto.NotifyTypeEmail, NotifyTarget: ""}, false},
		{"webhook with url", &model.Organization{NotifyType: dto.NotifyTypeWebhook, NotifyTarget: "https://example.com/hook"}, true},
		{"webhook with blank url", &model.Organization{NotifyType: dto.NotifyTypeWebhook, NotifyTarget: "  "}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, orgAlertConfigured(tt.org))
		})
	}
}
