package controller

func clearChannelReadOnlyFields(channel *PatchChannel, requestData map[string]any) {
	if _, ok := requestData["created_time"]; ok {
		channel.CreatedTime = 0
	}
	if _, ok := requestData["test_time"]; ok {
		channel.TestTime = 0
	}
	if _, ok := requestData["response_time"]; ok {
		channel.ResponseTime = 0
	}
	if _, ok := requestData["balance"]; ok {
		channel.Balance = 0
	}
	if _, ok := requestData["balance_updated_time"]; ok {
		channel.BalanceUpdatedTime = 0
	}
	if _, ok := requestData["used_quota"]; ok {
		channel.UsedQuota = 0
	}
	// upstream_prices 是平台机密且由专用接口管理：清零后 GORM Updates 会跳过
	// 该零值列，从而保留数据库已配置的费率卡，客户端无法通过通用编辑端点注入。
	if _, ok := requestData["upstream_prices"]; ok {
		channel.UpstreamPrices = ""
	}
}
