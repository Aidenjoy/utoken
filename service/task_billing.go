package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

// LogTaskConsumption 记录任务消费日志和统计信息（仅记录，不涉及实际扣费）。
// 实际扣费已由 BillingSession（PreConsumeBilling + SettleBilling）完成。
// taskID 写入 other，供计费视图把后续差额结算/退款日志折叠回本行。
func LogTaskConsumption(c *gin.Context, info *relaycommon.RelayInfo, taskID string) {
	tokenName := c.GetString("token_name")
	logContent := fmt.Sprintf("操作 %s", info.Action)
	// 支持任务仅按次计费
	if common.StringsContains(constant.TaskPricePatches, info.OriginModelName) {
		logContent = fmt.Sprintf("%s，按次计费", logContent)
	} else {
		if otherRatios := info.PriceData.OtherRatios(); len(otherRatios) > 0 {
			var contents []string
			for key, ra := range otherRatios {
				if 1.0 != ra {
					contents = append(contents, fmt.Sprintf("%s: %.2f", key, ra))
				}
			}
			if len(contents) > 0 {
				logContent = fmt.Sprintf("%s, 计算参数：%s", logContent, strings.Join(contents, ", "))
			}
		}
	}
	other := make(map[string]interface{})
	other["is_task"] = true
	if taskID != "" {
		other["task_id"] = taskID
	}
	other["request_path"] = c.Request.URL.Path
	other["model_price"] = info.PriceData.ModelPrice
	if info.PriceData.ModelRatio > 0 {
		other["model_ratio"] = info.PriceData.ModelRatio
	}
	other["group_ratio"] = info.PriceData.GroupRatioInfo.GroupRatio
	if info.PriceData.GroupRatioInfo.HasSpecialRatio {
		other["user_group_ratio"] = info.PriceData.GroupRatioInfo.GroupSpecialRatio
	}
	if info.IsModelMapped {
		other["is_model_mapped"] = true
		other["upstream_model_name"] = info.UpstreamModelName
	}
	attachQuotaSaturation(c, info, other)
	model.RecordConsumeLog(c, info.UserId, model.RecordConsumeLogParams{
		ChannelId: info.ChannelId,
		ModelName: info.OriginModelName,
		TokenName: tokenName,
		Quota:     info.PriceData.Quota,
		Content:   logContent,
		TokenId:   info.TokenId,
		Group:     info.UsingGroup,
		Other:     other,
	})
	model.UpdateUserUsedQuotaAndRequestCount(info.UserId, info.PriceData.Quota)
	model.UpdateChannelUsedQuota(info.ChannelId, info.PriceData.Quota)
}

// ---------------------------------------------------------------------------
// 异步任务计费辅助函数
// ---------------------------------------------------------------------------

// resolveTokenKey 通过 TokenId 运行时获取令牌 Key（用于 Redis 缓存操作）。
// 如果令牌已被删除或查询失败，返回空字符串。
func resolveTokenKey(ctx context.Context, tokenId int, taskID string) string {
	token, err := model.GetTokenById(tokenId)
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("获取令牌 key 失败 (tokenId=%d, task=%s): %s", tokenId, taskID, err.Error()))
		return ""
	}
	return token.Key
}

// taskIsSubscription 判断任务是否通过订阅计费。
func taskIsSubscription(task *model.Task) bool {
	return task.PrivateData.BillingSource == BillingSourceSubscription && task.PrivateData.SubscriptionId > 0
}

// taskAdjustFunding 调整任务的资金来源（钱包、订阅或企业池），delta > 0 表示扣费，delta < 0 表示退还。
func taskAdjustFunding(task *model.Task, delta int) error {
	if taskIsSubscription(task) {
		return model.PostConsumeUserSubscriptionDelta(task.PrivateData.SubscriptionId, int64(delta))
	}
	if task.PrivateData.BillingSource == BillingSourceOrganization {
		// 企业计费的差额/退款必须回到企业池并同步成员子额度用量，
		// 不能落到成员个人钱包。旧任务未持久化 OrgId 时按当前成员关系回落。
		orgId := task.PrivateData.OrgId
		if orgId <= 0 {
			org, _, err := model.GetActiveOrganizationForUser(task.UserId)
			if err != nil {
				return err
			}
			if org != nil {
				orgId = org.Id
			}
		}
		if orgId <= 0 {
			return fmt.Errorf("task %s billed by organization but org id unresolved", task.TaskID)
		}
		if delta > 0 {
			return model.ConsumeOrgQuota(orgId, task.UserId, delta)
		}
		return model.RefundOrgQuota(orgId, task.UserId, -delta)
	}
	if delta > 0 {
		return model.DecreaseUserQuota(task.UserId, delta, false)
	}
	return model.IncreaseUserQuota(task.UserId, -delta, false)
}

// taskAdjustTokenQuota 调整任务的令牌额度，delta > 0 表示扣费，delta < 0 表示退还。
// 需要通过 resolveTokenKey 运行时获取 key（不从 PrivateData 中读取）。
func taskAdjustTokenQuota(ctx context.Context, task *model.Task, delta int) {
	if task.PrivateData.TokenId <= 0 || delta == 0 {
		return
	}
	tokenKey := resolveTokenKey(ctx, task.PrivateData.TokenId, task.TaskID)
	if tokenKey == "" {
		return
	}
	var err error
	if delta > 0 {
		err = model.DecreaseTokenQuota(task.PrivateData.TokenId, tokenKey, delta)
	} else {
		err = model.IncreaseTokenQuota(task.PrivateData.TokenId, tokenKey, -delta)
	}
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("调整令牌额度失败 (delta=%d, task=%s): %s", delta, task.TaskID, err.Error()))
	}
}

// settleTaskFundingWithRetry 以指数退避重试调整任务资金来源。
//
// 差额结算的资金调整（补扣/退款）失败会导致账目不平：补扣失败平台少收钱，
// 退款失败用户被多扣。这类失败通常是瞬时故障（DB 连接抖动、行锁超时），
// 重试可解决；重试耗尽则记录 recovery 日志，供管理员按 task_id 人工对账。
func settleTaskFundingWithRetry(ctx context.Context, task *model.Task, delta int) error {
	const maxAttempts = 3
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if err := taskAdjustFunding(task, delta); err == nil {
			return nil
		} else {
			lastErr = err
		}
		if attempt < maxAttempts {
			time.Sleep(time.Duration(attempt) * time.Second)
		}
	}

	// 重试耗尽：登记 recovery 记录，包含对账所需的全部关键信息
	direction := "补扣"
	if delta < 0 {
		direction = "退款"
	}
	logger.LogError(ctx, fmt.Sprintf(
		"[BILLING_RECOVERY] 差额结算最终失败，需人工对账: task_id=%s user_id=%d delta=%d(%s) billing_source=%s err=%s",
		task.TaskID, task.UserId, delta, direction,
		task.PrivateData.BillingSource, lastErr.Error(),
	))
	return lastErr
}

// taskBillingOther 从 task 的 BillingContext 构建日志 Other 字段。
func taskBillingOther(task *model.Task) map[string]interface{} {
	other := make(map[string]interface{})
	if bc := task.PrivateData.BillingContext; bc != nil {
		other["model_price"] = bc.ModelPrice
		if bc.ModelRatio > 0 {
			other["model_ratio"] = bc.ModelRatio
		}
		other["group_ratio"] = bc.GroupRatio
		if priceData := taskBillingContextPriceData(bc); priceData != nil {
			for k, v := range priceData.OtherRatios() {
				other[k] = v
			}
		}
	}
	props := task.Properties
	if props.UpstreamModelName != "" && props.UpstreamModelName != props.OriginModelName {
		other["is_model_mapped"] = true
		other["upstream_model_name"] = props.UpstreamModelName
	}
	return other
}

func taskBillingContextPriceData(bc *model.TaskBillingContext) *types.PriceData {
	if bc == nil || len(bc.OtherRatios) == 0 {
		return nil
	}
	priceData := &types.PriceData{}
	if !priceData.ReplaceOtherRatios(bc.OtherRatios) {
		return nil
	}
	return priceData
}

// taskModelName 从 BillingContext 或 Properties 中获取模型名称。
func taskModelName(task *model.Task) string {
	if bc := task.PrivateData.BillingContext; bc != nil && bc.OriginModelName != "" {
		return bc.OriginModelName
	}
	return task.Properties.OriginModelName
}

// RefundTaskQuota 统一的任务失败退款逻辑。
// 当异步任务失败时，将预扣的 quota 退还给用户（支持钱包和订阅），并退还令牌额度。
func RefundTaskQuota(ctx context.Context, task *model.Task, reason string) {
	quota := task.Quota
	if quota == 0 {
		return
	}

	// 1. 退还资金来源（钱包或订阅）
	if err := taskAdjustFunding(task, -quota); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("退还资金来源失败 task %s: %s", task.TaskID, err.Error()))
		return
	}

	// 2. 退还令牌额度
	taskAdjustTokenQuota(ctx, task, -quota)

	// 3. 减少已用额度统计（退款不影响请求次数）
	model.DecreaseUserUsedQuota(task.UserId, quota)

	// 4. 记录日志
	other := taskBillingOther(task)
	other["task_id"] = task.TaskID
	other["reason"] = reason
	model.RecordTaskBillingLog(model.RecordTaskBillingLogParams{
		UserId:             task.UserId,
		LogType:            model.LogTypeRefund,
		Content:            "",
		ChannelId:          task.ChannelId,
		ModelName:          taskModelName(task),
		Quota:              quota,
		TokenId:            task.PrivateData.TokenId,
		Group:              task.Group,
		Other:              other,
		NodeName:           task.PrivateData.NodeName,
		QuotaDataCreatedAt: task.SubmitTime,
	})
}

// RecalculateTaskQuota 通用的异步差额结算。
// actualQuota 是任务完成后的实际应扣额度，与预扣额度 (task.Quota) 做差额结算。
// reason 用于日志记录（例如 "token重算" 或 "adaptor调整"）。
// promptTokens/completionTokens 为上游返回的实际 token 用量（未知时传 0），
// 随差额结算日志落库，使日志页 Tokens 列能展示任务真实消耗。
// clamps 可选：若计算 actualQuota 时发生额度饱和，将其记入日志 admin_info（仅管理员可见）。
func RecalculateTaskQuota(ctx context.Context, task *model.Task, actualQuota int, reason string, promptTokens, completionTokens int, clamps ...*common.QuotaClamp) {
	if actualQuota <= 0 {
		return
	}
	preConsumedQuota := task.Quota
	quotaDelta := actualQuota - preConsumedQuota

	if quotaDelta == 0 {
		logger.LogInfo(ctx, fmt.Sprintf("任务 %s 预扣费准确（%s，%s）",
			task.TaskID, logger.LogQuota(actualQuota), reason))
		return
	}

	logger.LogInfo(ctx, fmt.Sprintf("任务 %s 差额结算：delta=%s（实际：%s，预扣：%s，%s）",
		task.TaskID,
		logger.LogQuota(quotaDelta),
		logger.LogQuota(actualQuota),
		logger.LogQuota(preConsumedQuota),
		reason,
	))

	// 调整资金来源（带重试：结算失败意味着平台少收钱或多退款，
	// 不能只记日志放过，重试耗尽后登记待人工处理的工单）
	if err := settleTaskFundingWithRetry(ctx, task, quotaDelta); err != nil {
		logger.LogError(ctx, fmt.Sprintf("差额结算资金调整最终失败 task %s: %s", task.TaskID, err.Error()))
		return
	}

	// 调整令牌额度
	taskAdjustTokenQuota(ctx, task, quotaDelta)

	task.Quota = actualQuota
	if err := task.UpdateQuota(); err != nil {
		logger.LogError(ctx, fmt.Sprintf("差额结算回写 quota 失败 task %s: %s", task.TaskID, err.Error()))
	}

	var logType int
	var logQuota int
	if quotaDelta > 0 {
		logType = model.LogTypeConsume
		logQuota = quotaDelta
		model.UpdateUserUsedQuotaAndRequestCount(task.UserId, quotaDelta)
		model.UpdateChannelUsedQuota(task.ChannelId, quotaDelta)
	} else {
		logType = model.LogTypeRefund
		logQuota = -quotaDelta
		model.DecreaseUserUsedQuota(task.UserId, -quotaDelta)
	}
	other := taskBillingOther(task)
	other["task_id"] = task.TaskID
	other["pre_consumed_quota"] = preConsumedQuota
	other["actual_quota"] = actualQuota
	for _, clamp := range clamps {
		attachQuotaSaturationToOther(other, clamp)
	}
	model.RecordTaskBillingLog(model.RecordTaskBillingLogParams{
		UserId:             task.UserId,
		LogType:            logType,
		Content:            reason,
		ChannelId:          task.ChannelId,
		ModelName:          taskModelName(task),
		Quota:              logQuota,
		TokenId:            task.PrivateData.TokenId,
		Group:              task.Group,
		PromptTokens:       promptTokens,
		CompletionTokens:   completionTokens,
		Other:              other,
		NodeName:           task.PrivateData.NodeName,
		QuotaDataCreatedAt: task.SubmitTime,
	})
}

// RecalculateTaskQuotaByTokens 根据实际 token 消耗重新计费（异步差额结算）。
// 当任务成功且返回了 totalTokens 时，根据模型倍率和分组倍率重新计算实际扣费额度，
// 与预扣费的差额进行补扣或退还。支持钱包和订阅计费来源。
func RecalculateTaskQuotaByTokens(ctx context.Context, task *model.Task, totalTokens int) {
	actualQuota, clamp, reason, ok := computeTaskQuotaByTokens(task, totalTokens)
	if !ok {
		return
	}
	// 仅有 totalTokens 的上游（如方舟视频 completion=total）按 completion 记录
	RecalculateTaskQuota(ctx, task, actualQuota, reason, 0, totalTokens, clamp)
}

// ComputeTaskQuotaByTokens 是 computeTaskQuotaByTokens 的导出版（纯计算，不结算），
// 供 adaptor.AdjustBillingOnComplete 复用同一套分组倍率解析与饱和转换，避免重复实现计费公式。
// 调用前若需按响应分辨率重算 seedance 倍率，应先更新 task 的 BillingContext.OtherRatios。
// 返回 (quota, ok)：ok=false 表示模型未配置倍率或分组信息缺失，调用方应放弃重算。
func ComputeTaskQuotaByTokens(task *model.Task, totalTokens int) (int, bool) {
	quota, _, _, ok := computeTaskQuotaByTokens(task, totalTokens)
	return quota, ok
}

// computeTaskQuotaByTokens 计算任务按 token 的最终额度（纯计算，不结算）。
// 公式：totalTokens × modelRatio × finalGroupRatio × otherMultiplier（饱和转换，防止溢出成负数）。
// 返回 (quota, clamp, reason, ok)：ok=false 表示无法重算（token<=0 / 模型未配倍率 / 分组缺失）。
func computeTaskQuotaByTokens(task *model.Task, totalTokens int) (int, *common.QuotaClamp, string, bool) {
	if totalTokens <= 0 {
		return 0, nil, "", false
	}

	modelName := taskModelName(task)

	// 获取模型价格和倍率
	modelRatio, hasRatioSetting, _ := ratio_setting.GetModelRatio(modelName)
	// seedance 绝对单价模式（管理员已配置 seedance_config）：倍率以提交/结算快照中按
	// 档价（每百万 token 实际单价/2）合成的值为准（AdjustSeedanceBillingOnComplete 已按
	// 响应分辨率覆盖快照），不再使用 ModelRatio×video_input 相对公式，也不要求配置 ModelRatio。
	if bc := task.PrivateData.BillingContext; bc != nil && bc.ModelRatio > 0 &&
		billing_setting.GetBillingMode(modelName) == billing_setting.BillingModeSeedance {
		if _, ok := billing_setting.GetSeedanceConfig(modelName); ok {
			modelRatio = bc.ModelRatio
			hasRatioSetting = true
		}
	}
	// 只有配置了倍率(非固定价格)时才按 token 重新计费
	if !hasRatioSetting || modelRatio <= 0 {
		return 0, nil, "", false
	}

	// 获取用户和组的倍率信息
	group := task.Group
	if group == "" {
		user, err := model.GetUserById(task.UserId, false)
		if err == nil {
			group = user.Group
		}
	}
	if group == "" {
		return 0, nil, "", false
	}

	groupRatio := ratio_setting.GetGroupRatio(group)
	userGroupRatio, hasUserGroupRatio := ratio_setting.GetGroupGroupRatio(group, group)

	var finalGroupRatio float64
	if hasUserGroupRatio {
		finalGroupRatio = userGroupRatio
	} else {
		finalGroupRatio = groupRatio
	}

	// 计算 OtherRatios 乘积（视频折扣、时长等）
	otherMultiplier := 1.0
	if priceData := taskBillingContextPriceData(task.PrivateData.BillingContext); priceData != nil {
		otherMultiplier = priceData.OtherRatioMultiplier()
	}

	// 计算实际应扣费额度: totalTokens * modelRatio * groupRatio * otherMultiplier（饱和转换，防止溢出成负数）
	actualQuota, clamp := common.QuotaFromFloatChecked(float64(totalTokens) * modelRatio * finalGroupRatio * otherMultiplier)

	reason := fmt.Sprintf("token重算：tokens=%d, modelRatio=%.2f, groupRatio=%.2f, otherMultiplier=%.4f", totalTokens, modelRatio, finalGroupRatio, otherMultiplier)
	return actualQuota, clamp, reason, true
}
