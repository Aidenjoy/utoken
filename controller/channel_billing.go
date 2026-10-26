package controller

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// 渠道账单中心：管理员按渠道/时间/模型统计上游真实 token 消耗与估算成本，
// 用于与上游对账。口径见 model/channel_billing.go 顶部注释：
// tokens 永远取上游真实值（不受用户费率缩放影响），费用只是按渠道合同
// 费率卡的估算，未配置价格时纯 token 对账。

// parseChannelBillingFilter 解析渠道账单查询参数：
// channel_ids 逗号列表（缺省全部）、model_name（含 % 走模糊）、时间戳范围。
func parseChannelBillingFilter(c *gin.Context) model.ChannelBillingFilter {
	filter := model.ChannelBillingFilter{
		ModelName: c.Query("model_name"),
	}
	if raw := c.Query("channel_ids"); raw != "" {
		filter.ChannelIds = parseIntList(raw)
	}
	filter.Start, _ = strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	filter.End, _ = strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	return filter
}

func GetChannelBilling(c *gin.Context) {
	filter := parseChannelBillingFilter(c)
	records, stat, err := model.GetChannelBillingRecords(filter)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    gin.H{"records": records, "stat": stat},
	})
}

func GetChannelBillingDetail(c *gin.Context) {
	filter := parseChannelBillingFilter(c)
	pageInfo := common.GetPageQuery(c)
	logs, total, err := model.GetChannelBillingDetails(filter, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    gin.H{"items": logs, "total": total},
	})
}

func ExportChannelBilling(c *gin.Context) {
	filter := parseChannelBillingFilter(c)
	records, stat, err := model.GetChannelBillingRecords(filter)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	header := []string{"日期", "渠道", "模型", "请求数", "上游输入tokens", "上游输出tokens", "上游总tokens", "估算费用", "价格已配置"}
	rows := make([][]string, 0, len(records)+1)
	for _, record := range records {
		rows = append(rows, []string{
			time.Unix(record.Date, 0).UTC().Format("2006-01-02"),
			channelDisplayName(record.ChannelId, record.ChannelName),
			record.ModelName,
			strconv.FormatInt(record.RequestCount, 10),
			strconv.FormatInt(record.PromptTokens, 10),
			strconv.FormatInt(record.CompletionTokens, 10),
			strconv.FormatInt(record.TotalTokens, 10),
			logger.FormatQuota(record.EstimatedCostQuota),
			strconv.FormatBool(record.PriceConfigured),
		})
	}
	rows = append(rows, []string{
		"合计", "", "",
		strconv.FormatInt(stat.RequestCount, 10),
		strconv.FormatInt(stat.PromptTokens, 10),
		strconv.FormatInt(stat.CompletionTokens, 10),
		strconv.FormatInt(stat.TotalTokens, 10),
		logger.FormatQuota(int(stat.EstimatedCost)),
		"",
	})
	writeBillingCSV(c, "channel-billing-"+time.Now().Format("20060102-150405")+".csv", header, rows)
}

func ExportChannelBillingDetail(c *gin.Context) {
	filter := parseChannelBillingFilter(c)
	logs, err := model.GetChannelBillingDetailsAll(filter)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	header := []string{"时间", "渠道", "模型", "类型", "上游输入tokens", "上游输出tokens", "计费输入tokens", "计费输出tokens", "请求ID", "上游请求ID"}
	rows := make([][]string, 0, len(logs))
	for _, log := range logs {
		typeText := "消耗"
		if log.Type == model.LogTypeRefund {
			typeText = "退款"
		}
		if log.TaskSettle {
			typeText += "(结算行,对账不计)"
		}
		upstreamPrompt, upstreamCompletion := log.UpstreamTokenUsage()
		rows = append(rows, []string{
			billingTimestamp(log.CreatedAt),
			channelDisplayName(log.ChannelId, log.ChannelName),
			log.ModelName,
			typeText,
			strconv.Itoa(upstreamPrompt),
			strconv.Itoa(upstreamCompletion),
			strconv.Itoa(log.PromptTokens),
			strconv.Itoa(log.CompletionTokens),
			log.RequestId,
			log.UpstreamRequestId,
		})
	}
	writeBillingCSV(c, "channel-billing-detail-"+time.Now().Format("20060102-150405")+".csv", header, rows)
}

func channelDisplayName(channelId int, name string) string {
	if name == "" {
		return "渠道 #" + strconv.Itoa(channelId)
	}
	return name + "(#" + strconv.Itoa(channelId) + ")"
}

// GetChannelUpstreamPrices 返回渠道的上游合同费率卡（美元/百万 tokens）。
// 渠道列表接口因 MaskedJSON 掩码拿不到本列，读写只走这两个专用接口。
func GetChannelUpstreamPrices(c *gin.Context) {
	channelId, err := strconv.Atoi(c.Query("channel_id"))
	if err != nil || channelId <= 0 {
		common.ApiErrorMsg(c, "channel_id 无效")
		return
	}
	prices, err := model.GetChannelUpstreamPricesRaw(channelId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if prices == nil {
		prices = model.ChannelUpstreamPrices{}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    gin.H{"channel_id": channelId, "prices": prices},
	})
}

type saveChannelUpstreamPricesRequest struct {
	ChannelId int                         `json:"channel_id"`
	Prices    model.ChannelUpstreamPrices `json:"prices"`
}

// validateChannelUpstreamPrices 校验费率卡：单价必须是非负有限数（负价会让
// 成本估算倒贴、NaN/Inf 会污染整行合计，同 PriceData.AddOtherRatio 的防御
// 口径），模型名不能为空。空 map 合法，表示清空配置回到纯 token 对账。
func validateChannelUpstreamPrices(prices model.ChannelUpstreamPrices) error {
	for modelName, price := range prices {
		if modelName == "" {
			return errors.New("模型名不能为空")
		}
		for _, value := range []float64{price.Input, price.Output} {
			if value < 0 || math.IsNaN(value) || math.IsInf(value, 0) {
				return fmt.Errorf("模型 %s 的单价必须是非负有限数", modelName)
			}
		}
	}
	return nil
}

// SaveChannelUpstreamPrices 保存渠道费率卡。单价必须是非负有限数：
// 负价会让成本估算倒贴、NaN/Inf 会污染整行合计（同 PriceData.AddOtherRatio
// 的防御口径），在入口直接拒绝。空 map 视为清空配置（回到纯 token 对账）。
func SaveChannelUpstreamPrices(c *gin.Context) {
	var req saveChannelUpstreamPricesRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorMsg(c, "请求体解析失败")
		return
	}
	if req.ChannelId <= 0 {
		common.ApiErrorMsg(c, "channel_id 无效")
		return
	}
	if err := validateChannelUpstreamPrices(req.Prices); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if err := model.SaveChannelUpstreamPrices(req.ChannelId, req.Prices); err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": nil})
}
