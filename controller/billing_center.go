package controller

import (
	"encoding/csv"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// 账单中心：管理员按用户/企业维度查询充值流水与消耗明细，支持 CSV 导出。

type billingFilter struct {
	userIds []int
	orgIds  []int
	start   int64
	end     int64
}

func parseBillingFilter(c *gin.Context) billingFilter {
	filter := billingFilter{
		userIds: parseIntList(c.Query("user_ids")),
		orgIds:  parseIntList(c.Query("org_ids")),
	}
	filter.start, _ = strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	filter.end, _ = strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	return filter
}

func parseIntList(raw string) []int {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	ids := make([]int, 0, len(parts))
	for _, part := range parts {
		id, err := strconv.Atoi(strings.TrimSpace(part))
		if err == nil && id > 0 {
			ids = append(ids, id)
		}
	}
	return ids
}

func GetBillingRecharge(c *gin.Context) {
	filter := parseBillingFilter(c)
	records, stat, err := model.GetBillingRechargeRecords(filter.userIds, filter.orgIds, filter.start, filter.end)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(200, gin.H{
		"success": true,
		"message": "",
		"data":    gin.H{"records": records, "stat": stat},
	})
}

func GetBillingConsumption(c *gin.Context) {
	filter := parseBillingFilter(c)
	pageInfo := common.GetPageQuery(c)
	logs, total, stat, userOrg, orgNames, err := model.GetBillingConsumption(filter.userIds, filter.orgIds, filter.start, filter.end, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(200, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"items":     logs,
			"total":     total,
			"stat":      stat,
			"user_org":  userOrg,
			"org_names": orgNames,
		},
	})
}

func billingTimestamp(ts int64) string {
	if ts == 0 {
		return ""
	}
	return time.Unix(ts, 0).Format("2006-01-02 15:04:05")
}

func rechargeSourceText(source string) string {
	switch source {
	case model.BillingSourceOnlineTopup:
		return "在线充值"
	case model.BillingSourceUserAdjust:
		return "用户调额"
	case model.BillingSourceOrgAdjust:
		return "企业调额"
	}
	return source
}

func rechargeTargetText(record *model.BillingRechargeRecord) string {
	if record.Source == model.BillingSourceOrgAdjust {
		if record.OrgName != "" {
			return fmt.Sprintf("%s(ID %d)", record.OrgName, record.OrgId)
		}
		return fmt.Sprintf("ID %d", record.OrgId)
	}
	if record.Username != "" {
		return fmt.Sprintf("%s(ID %d)", record.Username, record.UserId)
	}
	return fmt.Sprintf("ID %d", record.UserId)
}

func writeBillingCSV(c *gin.Context, filename string, header []string, rows [][]string) {
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	_, _ = c.Writer.Write([]byte{0xEF, 0xBB, 0xBF})
	writer := csv.NewWriter(c.Writer)
	_ = writer.Write(header)
	for _, row := range rows {
		_ = writer.Write(row)
	}
	writer.Flush()
}

func ExportBillingRecharge(c *gin.Context) {
	filter := parseBillingFilter(c)
	records, stat, err := model.GetBillingRechargeRecords(filter.userIds, filter.orgIds, filter.start, filter.end)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	header := []string{"时间", "类型", "对象", "额度变化", "折算金额", "支付金额", "支付方式", "订单号", "操作人"}
	rows := make([][]string, 0, len(records)+1)
	for _, record := range records {
		rows = append(rows, []string{
			billingTimestamp(record.CreatedAt),
			rechargeSourceText(record.Source),
			rechargeTargetText(record),
			strconv.Itoa(record.Quota),
			logger.LogQuota(record.Quota),
			strconv.FormatFloat(record.Money, 'f', 2, 64),
			record.PaymentMethod,
			record.TradeNo,
			record.Operator,
		})
	}
	rows = append(rows, []string{
		"合计", "", "",
		strconv.Itoa(stat.TotalQuota),
		logger.LogQuota(stat.TotalQuota),
		"", "", "", "",
	})
	writeBillingCSV(c, "billing-recharge-"+time.Now().Format("20060102-150405")+".csv", header, rows)
}

func ExportBillingConsumption(c *gin.Context) {
	filter := parseBillingFilter(c)
	logs, userOrg, orgNames, err := model.GetBillingConsumptionAll(filter.userIds, filter.orgIds, filter.start, filter.end)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	header := []string{"时间", "用户", "企业", "令牌", "模型", "类型", "额度变化", "折算金额", "输入tokens", "输出tokens", "请求ID"}
	rows := make([][]string, 0, len(logs))
	for _, log := range logs {
		quota := log.Quota
		typeText := "消耗"
		if log.Type == model.LogTypeRefund {
			quota = -quota
			typeText = "退款"
		}
		orgName := ""
		if orgId, ok := userOrg[log.UserId]; ok {
			orgName = orgNames[orgId]
		}
		rows = append(rows, []string{
			billingTimestamp(log.CreatedAt),
			log.Username,
			orgName,
			log.TokenName,
			log.ModelName,
			typeText,
			strconv.Itoa(quota),
			logger.LogQuota(quota),
			strconv.Itoa(log.PromptTokens),
			strconv.Itoa(log.CompletionTokens),
			log.RequestId,
		})
	}
	writeBillingCSV(c, "billing-consumption-"+time.Now().Format("20060102-150405")+".csv", header, rows)
}
