package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

// ---------------------------------------------------------------------------
// BillingSession — 统一计费会话
// ---------------------------------------------------------------------------

// BillingSession 封装单次请求的预扣费/结算/退款生命周期。
// 实现 relaycommon.BillingSettler 接口。
type BillingSession struct {
	relayInfo        *relaycommon.RelayInfo
	funding          FundingSource
	preConsumedQuota int  // 实际预扣额度（信任用户可能为 0）
	tokenConsumed    int  // 令牌额度实际扣减量
	extraReserved    int  // 发送前补充预扣的额度（订阅退款时需要单独回滚）
	trusted          bool // 是否命中信任额度旁路
	fundingSettled   bool // funding.Settle 已成功，资金来源已提交
	settled          bool // Settle 全部完成（资金 + 令牌）
	refunded         bool // Refund 已调用
	mu               sync.Mutex
}

// Settle 根据实际消耗额度进行结算。
// 资金来源和令牌额度分两步提交：若资金来源已提交但令牌调整失败，
// 会标记 fundingSettled 防止 Refund 对已提交的资金来源执行退款。
func (s *BillingSession) Settle(actualQuota int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.settled {
		return nil
	}
	delta := actualQuota - s.preConsumedQuota
	if delta == 0 {
		s.settled = true
		return nil
	}
	// 1) 调整资金来源（仅在尚未提交时执行，防止重复调用）
	if !s.fundingSettled {
		if err := s.funding.Settle(delta); err != nil {
			return err
		}
		s.fundingSettled = true
	}
	// 2) 调整令牌额度
	var tokenErr error
	if !s.relayInfo.IsPlayground {
		if delta > 0 {
			tokenErr = model.DecreaseTokenQuota(s.relayInfo.TokenId, s.relayInfo.TokenKey, delta)
		} else {
			tokenErr = model.IncreaseTokenQuota(s.relayInfo.TokenId, s.relayInfo.TokenKey, -delta)
		}
		if tokenErr != nil {
			// 资金来源已提交，令牌调整失败只能记录日志；标记 settled 防止 Refund 误退资金
			common.SysLog(fmt.Sprintf("error adjusting token quota after funding settled (userId=%d, tokenId=%d, delta=%d): %s",
				s.relayInfo.UserId, s.relayInfo.TokenId, delta, tokenErr.Error()))
		}
	}
	// 3) 更新 relayInfo 上的订阅 PostDelta（用于日志）
	if s.funding.Source() == BillingSourceSubscription {
		s.relayInfo.SubscriptionPostDelta += int64(delta)
	}
	s.settled = true
	return tokenErr
}

// Refund 退还所有预扣费，幂等安全，异步执行。
func (s *BillingSession) Refund(c *gin.Context) {
	s.mu.Lock()
	if s.settled || s.refunded || !s.needsRefundLocked() {
		s.mu.Unlock()
		return
	}
	s.refunded = true
	s.mu.Unlock()

	logger.LogInfo(c, fmt.Sprintf("用户 %d 请求失败, 返还预扣费（token_quota=%s, funding=%s）",
		s.relayInfo.UserId,
		logger.FormatQuota(s.tokenConsumed),
		s.funding.Source(),
	))

	// 复制需要的值到闭包中
	tokenId := s.relayInfo.TokenId
	tokenKey := s.relayInfo.TokenKey
	isPlayground := s.relayInfo.IsPlayground
	tokenConsumed := s.tokenConsumed
	extraReserved := s.extraReserved
	subscriptionId := s.relayInfo.SubscriptionId
	funding := s.funding

	gopool.Go(func() {
		// 1) 退还资金来源
		if err := funding.Refund(); err != nil {
			common.SysLog("error refunding billing source: " + err.Error())
		}
		if extraReserved > 0 && funding.Source() == BillingSourceSubscription && subscriptionId > 0 {
			if err := model.PostConsumeUserSubscriptionDelta(subscriptionId, -int64(extraReserved)); err != nil {
				common.SysLog("error refunding subscription extra reserved quota: " + err.Error())
			}
		}
		// 2) 退还令牌额度
		if tokenConsumed > 0 && !isPlayground {
			if err := model.IncreaseTokenQuota(tokenId, tokenKey, tokenConsumed); err != nil {
				common.SysLog("error refunding token quota: " + err.Error())
			}
		}
	})
}

// NeedsRefund 返回是否存在需要退还的预扣状态。
func (s *BillingSession) NeedsRefund() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.needsRefundLocked()
}

func (s *BillingSession) needsRefundLocked() bool {
	if s.settled || s.refunded || s.fundingSettled {
		// fundingSettled 时资金来源已提交结算，不能再退预扣费
		return false
	}
	if s.tokenConsumed > 0 {
		return true
	}
	// 订阅可能在 tokenConsumed=0 时仍预扣了额度
	if sub, ok := s.funding.(*SubscriptionFunding); ok && sub.preConsumed > 0 {
		return true
	}
	// 企业额度池同理：信任旁路关闭后 consumed 与 tokenConsumed 同步，
	// 但异步任务（ForcePreConsume）等场景下仍应独立判定。
	if org, ok := s.funding.(*OrganizationFunding); ok && org.consumed > 0 {
		return true
	}
	return false
}

// GetPreConsumedQuota 返回实际预扣的额度。
func (s *BillingSession) GetPreConsumedQuota() int {
	return s.preConsumedQuota
}

func (s *BillingSession) Reserve(targetQuota int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.settled || s.refunded || s.trusted || targetQuota <= s.preConsumedQuota {
		return nil
	}

	delta := targetQuota - s.preConsumedQuota
	if delta <= 0 {
		return nil
	}

	if err := s.reserveFunding(delta); err != nil {
		return err
	}
	if err := s.reserveToken(delta); err != nil {
		s.rollbackFundingReserve(delta)
		return err
	}

	s.preConsumedQuota += delta
	s.tokenConsumed += delta
	s.extraReserved += delta
	s.syncRelayInfo()
	return nil
}

// ---------------------------------------------------------------------------
// PreConsume — 统一预扣费入口（含信任额度旁路）
// ---------------------------------------------------------------------------

// preConsume 执行预扣费：信任检查 -> 令牌预扣 -> 资金来源预扣。
// 任一步骤失败时原子回滚已完成的步骤。
func (s *BillingSession) preConsume(c *gin.Context, quota int) *types.NewAPIError {
	effectiveQuota := quota

	// ---- 信任额度旁路 ----
	if s.shouldTrust(c) {
		s.trusted = true
		effectiveQuota = 0
		logger.LogInfo(c, fmt.Sprintf("用户 %d 额度充足, 信任且不需要预扣费 (funding=%s)", s.relayInfo.UserId, s.funding.Source()))
	} else if effectiveQuota > 0 {
		logger.LogInfo(c, fmt.Sprintf("用户 %d 需要预扣费 %s (funding=%s)", s.relayInfo.UserId, logger.FormatQuota(effectiveQuota), s.funding.Source()))
	}

	// ---- 1) 预扣令牌额度 ----
	if effectiveQuota > 0 {
		if err := PreConsumeTokenQuota(s.relayInfo, effectiveQuota); err != nil {
			return types.NewErrorWithStatusCode(err, types.ErrorCodePreConsumeTokenQuotaFailed, http.StatusForbidden, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
		}
		s.tokenConsumed = effectiveQuota
	}

	// ---- 2) 预扣资金来源 ----
	if err := s.funding.PreConsume(effectiveQuota); err != nil {
		// 预扣费失败，回滚令牌额度
		if s.tokenConsumed > 0 && !s.relayInfo.IsPlayground {
			if rollbackErr := model.IncreaseTokenQuota(s.relayInfo.TokenId, s.relayInfo.TokenKey, s.tokenConsumed); rollbackErr != nil {
				common.SysLog(fmt.Sprintf("error rolling back token quota (userId=%d, tokenId=%d, amount=%d, fundingErr=%s): %s",
					s.relayInfo.UserId, s.relayInfo.TokenId, s.tokenConsumed, err.Error(), rollbackErr.Error()))
			}
			s.tokenConsumed = 0
		}
		// TODO: model 层应定义哨兵错误（如 ErrNoActiveSubscription），用 errors.Is 替代字符串匹配
		errMsg := err.Error()
		// 钱包/企业额度不足 / 成员子额度超限 / 企业或成员已停用：与钱包额度不足同义，
		// 按 403 返回且不重试、不记错误日志（属于正常业务拒绝而非系统故障）。
		if errors.Is(err, model.ErrInsufficientUserQuota) ||
			errors.Is(err, model.ErrOrgQuotaInsufficient) || errors.Is(err, model.ErrOrgMemberQuotaExceeded) ||
			errors.Is(err, model.ErrOrgDisabled) || errors.Is(err, model.ErrOrgMemberDisabled) {
			return types.NewErrorWithStatusCode(err, types.ErrorCodeInsufficientUserQuota, http.StatusForbidden, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
		}
		if errors.Is(err, model.ErrInsufficientTokenQuota) {
			return types.NewErrorWithStatusCode(err, types.ErrorCodeInsufficientUserQuota, http.StatusForbidden, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
		}
		if strings.Contains(errMsg, "no active subscription") || strings.Contains(errMsg, "subscription quota insufficient") {
			return types.NewErrorWithStatusCode(fmt.Errorf("订阅额度不足或未配置订阅: %s", errMsg), types.ErrorCodeInsufficientUserQuota, http.StatusForbidden, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
		}
		return types.NewError(err, types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
	}

	s.preConsumedQuota = effectiveQuota

	// ---- 同步 RelayInfo 兼容字段 ----
	s.syncRelayInfo()

	return nil
}

func (s *BillingSession) reserveFunding(delta int) error {
	switch funding := s.funding.(type) {
	case *WalletFunding:
		if err := model.DecreaseUserQuota(funding.userId, delta, false); err != nil {
			return types.NewError(err, types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
		}
		funding.consumed += delta
		return nil
	case *SubscriptionFunding:
		if err := model.PostConsumeUserSubscriptionDelta(funding.subscriptionId, int64(delta)); err != nil {
			return types.NewErrorWithStatusCode(
				fmt.Errorf("订阅额度不足或未配置订阅: %s", err.Error()),
				types.ErrorCodeInsufficientUserQuota,
				http.StatusForbidden,
				types.ErrOptionWithSkipRetry(),
				types.ErrOptionWithNoRecordErrorLog(),
			)
		}
		return nil
	case *OrganizationFunding:
		// 补扣同样走 ConsumeOrgQuota：企业池余额与成员子额度在单个事务内一起校验，
		// 避免流式请求追加预扣时绕过子额度上限。
		if err := model.ConsumeOrgQuota(funding.orgId, funding.userId, delta); err != nil {
			if errors.Is(err, model.ErrOrgQuotaInsufficient) || errors.Is(err, model.ErrOrgMemberQuotaExceeded) {
				return types.NewErrorWithStatusCode(err, types.ErrorCodeInsufficientUserQuota, http.StatusForbidden, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
			}
			return types.NewError(err, types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
		}
		funding.consumed += delta
		return nil
	default:
		return types.NewError(fmt.Errorf("unsupported funding source: %s", s.funding.Source()), types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
	}
}

func (s *BillingSession) rollbackFundingReserve(delta int) {
	switch funding := s.funding.(type) {
	case *WalletFunding:
		if err := model.IncreaseUserQuota(funding.userId, delta, false); err != nil {
			common.SysLog("error rolling back wallet funding reserve: " + err.Error())
		} else {
			funding.consumed -= delta
		}
	case *SubscriptionFunding:
		if err := model.PostConsumeUserSubscriptionDelta(funding.subscriptionId, -int64(delta)); err != nil {
			common.SysLog("error rolling back subscription funding reserve: " + err.Error())
		}
	case *OrganizationFunding:
		if err := model.RefundOrgQuota(funding.orgId, funding.userId, delta); err != nil {
			common.SysLog("error rolling back organization funding reserve: " + err.Error())
		} else {
			funding.consumed -= delta
		}
	}
}

func (s *BillingSession) reserveToken(delta int) error {
	if delta <= 0 || s.relayInfo.IsPlayground {
		return nil
	}
	if err := PreConsumeTokenQuota(s.relayInfo, delta); err != nil {
		return types.NewErrorWithStatusCode(err, types.ErrorCodePreConsumeTokenQuotaFailed, http.StatusForbidden, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
	}
	return nil
}

// shouldTrust 统一信任额度检查，适用于钱包和订阅。
func (s *BillingSession) shouldTrust(c *gin.Context) bool {
	// 异步任务（ForcePreConsume=true）必须预扣全额，不允许信任旁路
	if s.relayInfo.ForcePreConsume {
		return false
	}

	trustQuota := common.GetTrustQuota()
	if trustQuota <= 0 {
		return false
	}

	// 检查令牌是否充足
	tokenTrusted := s.relayInfo.TokenUnlimited
	if !tokenTrusted {
		tokenQuota := c.GetInt("token_quota")
		tokenTrusted = tokenQuota > trustQuota
	}
	if !tokenTrusted {
		return false
	}

	switch s.funding.Source() {
	case BillingSourceWallet:
		if s.relayInfo.UserQuota <= trustQuota {
			return false
		}
		// 并发闸门：信任旁路跳过预扣费，余额检查与实际消费之间存在窗口期。
		// 高并发下大量请求可能同时通过余额检查并各自消费，导致透支。
		// 用 Redis 计数器限制同一用户的在途信任请求数，超限则降级为正常预扣费路径。
		return acquireTrustSlot(s.relayInfo.UserId)
	case BillingSourceSubscription:
		// 订阅不能启用信任旁路。原因：
		// 1. PreConsumeUserSubscription 要求 amount>0 来创建预扣记录并锁定订阅
		// 2. SubscriptionFunding.PreConsume 忽略参数，始终用 s.amount 预扣
		// 3. 若信任旁路将 effectiveQuota 设为 0，会导致 preConsumedQuota 与实际订阅预扣不一致
		return false
	case BillingSourceOrganization:
		// 企业计费必须关闭信任旁路：旁路会把 effectiveQuota 置 0，从而跳过
		// ConsumeOrgQuota 里的成员子额度校验，成员就能超额消费企业池。
		return false
	default:
		return false
	}
}

// trustSlotTTL 信任令牌有效期：覆盖一次请求的正常耗时，
// 过期自动释放，避免请求异常中断时槽位泄漏。
const trustSlotTTL = 60 * time.Second

// acquireTrustSlot 尝试占用一个信任令牌。
// Redis 未启用时放行（降级为原有行为，不做并发限制）。
func acquireTrustSlot(userId int) bool {
	if !common.RedisEnabled {
		return true
	}
	key := fmt.Sprintf("trust:active:%d", userId)
	// INCRBY 原子递增后读取当前值，判断是否超过上限。
	// RedisIncr 不返回新值，这里直接用底层客户端拿到结果。
	ctx := context.Background()
	count, err := common.RDB.Incr(ctx, key).Result()
	if err != nil {
		// Redis 异常时保守放行，避免因基础设施故障拒绝正常请求
		return true
	}
	if count == 1 {
		// 首次创建，设置过期时间；否则沿用既有 TTL
		common.RDB.Expire(ctx, key, trustSlotTTL)
	}
	limit := common.GetTrustConcurrentLimit()
	if limit <= 0 {
		limit = 5
	}
	if count > int64(limit) {
		// 超限：释放本次占位（避免把槽位长期占满）并降级为预扣费路径
		common.RDB.Decr(ctx, key)
		return false
	}
	return true
}

// syncRelayInfo 将 BillingSession 的状态同步到 RelayInfo 的兼容字段上。
func (s *BillingSession) syncRelayInfo() {
	info := s.relayInfo
	info.FinalPreConsumedQuota = s.preConsumedQuota
	info.BillingSource = s.funding.Source()

	if sub, ok := s.funding.(*SubscriptionFunding); ok {
		info.SubscriptionId = sub.subscriptionId
		info.SubscriptionPreConsumed = sub.preConsumed + int64(s.extraReserved)
		info.SubscriptionPostDelta = 0
		info.SubscriptionAmountTotal = sub.AmountTotal
		info.SubscriptionAmountUsedAfterPreConsume = sub.AmountUsedAfter + int64(s.extraReserved)
		info.SubscriptionPlanId = sub.PlanId
		info.SubscriptionPlanTitle = sub.PlanTitle
	} else {
		info.SubscriptionId = 0
		info.SubscriptionPreConsumed = 0
	}

	// 企业维度归属：供消费日志 other 与 quota_data 使用。
	if org, ok := s.funding.(*OrganizationFunding); ok {
		info.OrgId = org.OrgId()
		info.OrgName = org.OrgName()
	}
}

// ---------------------------------------------------------------------------
// NewBillingSession 工厂 — 根据计费偏好创建会话并处理回退
// ---------------------------------------------------------------------------

// NewBillingSession 根据用户计费偏好创建 BillingSession，处理 subscription_first / wallet_first 的回退。
func NewBillingSession(c *gin.Context, relayInfo *relaycommon.RelayInfo, preConsumedQuota int) (*BillingSession, *types.NewAPIError) {
	if relayInfo == nil {
		return nil, types.NewError(fmt.Errorf("relayInfo is nil"), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}

	// 请求级幂等：客户端重试或网关重放同一 requestId 时不得重复扣费。
	// 计费失败（下面的 preConsume 返回错误）时会释放占位，允许用户重试；
	// 计费成功则保留占位，重复请求在此被拒绝。
	if !TryAcquireBillingIdempotency(relayInfo.RequestId, relayInfo.UserId, relayInfo.OriginModelName) {
		return nil, types.NewErrorWithStatusCode(
			fmt.Errorf("重复的请求（requestId=%s），请勿重试已受理的请求", relayInfo.RequestId),
			types.ErrorCodeInvalidRequest, http.StatusConflict,
			types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
	}

	session, apiErr := newBillingSession(c, relayInfo, preConsumedQuota)
	if apiErr != nil {
		// 计费未成立：释放幂等位，允许客户端修正后用同一 requestId 重试
		ReleaseBillingIdempotency(relayInfo.RequestId, relayInfo.UserId, relayInfo.OriginModelName)
	}
	return session, apiErr
}

// newBillingSession 按计费偏好创建预扣费会话（不含幂等占位）。
func newBillingSession(c *gin.Context, relayInfo *relaycommon.RelayInfo, preConsumedQuota int) (*BillingSession, *types.NewAPIError) {
	pref := common.NormalizeBillingPreference(relayInfo.UserSetting.BillingPreference)

	// 企业额度池优先：成员的消费一律先扣企业池，与个人计费偏好无关
	// （偏好描述的是"钱包 vs 订阅"，企业池是第三方资金源）。
	// 池不足或成员子额度超限时直接报额度不足，仅当企业开启 AllowWalletFallback
	// 才回落到下面的钱包/订阅偏好逻辑（语义对齐订阅的 AllowWalletOverflow）。
	// 非企业成员路径完全不受影响。
	if orgSession, orgErr, handled := tryOrganizationBilling(c, relayInfo, preConsumedQuota); handled {
		return orgSession, orgErr
	}

	// 钱包路径需要先检查用户额度
	tryWallet := func() (*BillingSession, *types.NewAPIError) {
		userQuota, err := model.GetUserQuota(relayInfo.UserId, false)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		}
		if userQuota <= 0 {
			return nil, types.NewErrorWithStatusCode(
				fmt.Errorf("用户额度不足, 剩余额度: %s", logger.FormatQuota(userQuota)),
				types.ErrorCodeInsufficientUserQuota, http.StatusForbidden,
				types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
		}
		if userQuota-preConsumedQuota < 0 {
			return nil, types.NewErrorWithStatusCode(
				fmt.Errorf("预扣费额度失败, 用户剩余额度: %s, 需要预扣费额度: %s", logger.FormatQuota(userQuota), logger.FormatQuota(preConsumedQuota)),
				types.ErrorCodeInsufficientUserQuota, http.StatusForbidden,
				types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
		}
		relayInfo.UserQuota = userQuota

		session := &BillingSession{
			relayInfo: relayInfo,
			funding:   &WalletFunding{userId: relayInfo.UserId},
		}
		if apiErr := session.preConsume(c, preConsumedQuota); apiErr != nil {
			return nil, apiErr
		}
		return session, nil
	}

	trySubscription := func() (*BillingSession, *types.NewAPIError) {
		subConsume := int64(preConsumedQuota)
		if subConsume <= 0 {
			subConsume = 1
		}
		session := &BillingSession{
			relayInfo: relayInfo,
			funding: &SubscriptionFunding{
				requestId: relayInfo.RequestId,
				userId:    relayInfo.UserId,
				modelName: relayInfo.OriginModelName,
				amount:    subConsume,
			},
		}
		// 必须传 subConsume 而非 preConsumedQuota，保证 SubscriptionFunding.amount、
		// preConsume 参数和 FinalPreConsumedQuota 三者一致，避免订阅多扣费。
		if apiErr := session.preConsume(c, int(subConsume)); apiErr != nil {
			return nil, apiErr
		}
		return session, nil
	}

	switch pref {
	case "subscription_only":
		return trySubscription()
	case "wallet_only":
		return tryWallet()
	case "wallet_first":
		session, err := tryWallet()
		if err != nil {
			if err.GetErrorCode() == types.ErrorCodeInsufficientUserQuota {
				return trySubscription()
			}
			return nil, err
		}
		return session, nil
	case "subscription_first":
		fallthrough
	default:
		hasSub, subCheckErr := model.HasActiveUserSubscription(relayInfo.UserId)
		if subCheckErr != nil {
			return nil, types.NewError(subCheckErr, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		}
		if !hasSub {
			return tryWallet()
		}
		session, apiErr := trySubscription()
		if apiErr != nil {
			if apiErr.GetErrorCode() == types.ErrorCodeInsufficientUserQuota {
				// 仅当用户的活跃订阅允许钱包回退时才回退到钱包，否则返回订阅额度不足错误
				allowOverflow, overflowErr := model.UserActiveSubscriptionsAllowWalletOverflow(relayInfo.UserId)
				if overflowErr != nil {
					return nil, types.NewError(overflowErr, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
				}
				if allowOverflow {
					return tryWallet()
				}
				return nil, apiErr
			}
			return nil, apiErr
		}
		return session, nil
	}
}

// tryOrganizationBilling 尝试用企业额度池为本次请求预扣费。
//
// 返回值 handled 表示"结果已定"：true 时调用方必须直接返回 (session, apiErr)；
// false 表示该用户不走企业计费（非成员 / 企业停用）或企业允许回落，
// 调用方应继续走个人计费偏好。
func tryOrganizationBilling(c *gin.Context, relayInfo *relaycommon.RelayInfo, preConsumedQuota int) (*BillingSession, *types.NewAPIError, bool) {
	org, member, err := model.GetActiveOrganizationForUser(relayInfo.UserId)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry()), true
	}
	if org == nil || member == nil {
		return nil, nil, false
	}

	// 日志与报表归属：无论最终由谁付费，本次请求都属于该企业。
	relayInfo.OrgId = org.Id
	relayInfo.OrgName = org.DisplayName
	if relayInfo.OrgName == "" {
		relayInfo.OrgName = org.Name
	}

	// 预检查只为尽早判定能否回落；真正的原子校验在 ConsumeOrgQuota 的事务内完成。
	insufficient := org.Quota < preConsumedQuota ||
		(member.QuotaLimit > 0 && member.QuotaUsed+preConsumedQuota > member.QuotaLimit)
	if insufficient {
		if !org.AllowWalletFallback {
			return nil, orgInsufficientError(org, member, preConsumedQuota), true
		}
		return nil, nil, false
	}

	session := &BillingSession{
		relayInfo: relayInfo,
		funding: &OrganizationFunding{
			orgId:   org.Id,
			userId:  relayInfo.UserId,
			orgName: relayInfo.OrgName,
		},
	}
	if apiErr := session.preConsume(c, preConsumedQuota); apiErr != nil {
		// preConsume 已回滚令牌预扣。并发下企业池可能刚好被其他请求扣空，
		// 此时按企业配置决定是否回落个人资金；其他错误（如数据库故障）不回落。
		if org.AllowWalletFallback && isOrgQuotaShortage(apiErr) {
			return nil, nil, false
		}
		return nil, apiErr, true
	}
	return session, nil, true
}

// isOrgQuotaShortage 判定预扣失败是否属于"企业额度不够"（池不足 / 子额度超限），
// 以便与数据库故障等系统错误区分：只有前者才允许回落个人资金。
func isOrgQuotaShortage(apiErr *types.NewAPIError) bool {
	if apiErr == nil {
		return false
	}
	return errors.Is(apiErr, model.ErrInsufficientUserQuota) ||
		errors.Is(apiErr, model.ErrOrgQuotaInsufficient) ||
		errors.Is(apiErr, model.ErrOrgMemberQuotaExceeded) ||
		errors.Is(apiErr, model.ErrOrgDisabled) ||
		errors.Is(apiErr, model.ErrOrgMemberDisabled)
}

// orgInsufficientError 构造企业额度不足的对外错误。
// 区分"企业池没钱"与"你自己的子额度用完"两种语义，便于成员自助排查；
// 不回落钱包时这是终态错误，因此跳过重试且不记错误日志。
func orgInsufficientError(org *model.Organization, member *model.OrgMember, preConsumedQuota int) *types.NewAPIError {
	var err error
	if member.QuotaLimit > 0 && member.QuotaUsed+preConsumedQuota > member.QuotaLimit {
		err = fmt.Errorf("%s: 子额度上限 %s，已用 %s，本次需预扣 %s",
			model.ErrOrgMemberQuotaExceeded.Error(),
			logger.FormatQuota(member.QuotaLimit),
			logger.FormatQuota(member.QuotaUsed),
			logger.FormatQuota(preConsumedQuota))
	} else {
		err = fmt.Errorf("%s: 企业 %s 剩余额度 %s，本次需预扣 %s",
			model.ErrOrgQuotaInsufficient.Error(),
			org.Name,
			logger.FormatQuota(org.Quota),
			logger.FormatQuota(preConsumedQuota))
	}
	return types.NewErrorWithStatusCode(err, types.ErrorCodeInsufficientUserQuota, http.StatusForbidden,
		types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
}
