package common

import (
	"errors"
	"fmt"
	"math"
	"strings"
)

// 按用户按模型折扣（管理员配置）：JSON 形如 {"doubao-seedance-2.0":0.8,"seedance*":0.9}。
// 折扣值域 (0,1]，1 表示原价。匹配以请求模型名（OriginModelName）为准，
// 精确键优先，其次是以 "*" 结尾的前缀通配键，取最长前缀命中。
// 放在 common 是因为 relay/common、relay/helper、service、controller 都要用，
// 而 service 已依赖 relay/common，无法反向引用。
const (
	// NoModelDiscount 无折扣（原价）。
	NoModelDiscount = 1.0
	// MaxModelDiscountEntries 单个用户可配置的折扣条目上限，防止 JSON 无限膨胀。
	MaxModelDiscountEntries = 500
	// MaxModelDiscountKeyLength 模型名（含通配）的最大长度。
	MaxModelDiscountKeyLength = 200
	// modelDiscountPrecision 折扣保留的小数位（0.8125 = 8.125 折）。
	modelDiscountPrecision = 10000
)

var (
	errModelDiscountEmptyKey    = errors.New("模型名不能为空")
	errModelDiscountGlobalWild  = errors.New("不支持全局通配折扣（*）")
	errModelDiscountKeyTooLong  = errors.New("模型名过长")
	errModelDiscountTooMany     = errors.New("折扣条目数量超过上限")
	errModelDiscountInvalidRate = errors.New("折扣必须在 0 到 100% 之间（不含 0）")
	// 代理商授权专用错误：管理员配的授权清单不能为空、不能带通配，
	// 代理给成员设的折扣不能超出授权范围、不能低于授权下限。
	ErrAgentModelsEmpty        = errors.New("至少需要授权一个模型")
	errAgentModelWildcard      = errors.New("授权模型不支持通配（*），请填完整模型名")
	ErrAgentModelNotAuthorized = errors.New("模型不在该代理商的授权范围内")
	ErrAgentDiscountBelowFloor = errors.New("折扣低于该模型允许的下限")
)

// ParseModelDiscounts 解析折扣 JSON；空串或解析失败返回 nil（等同无折扣）。
func ParseModelDiscounts(discountsJSON string) map[string]float64 {
	trimmed := strings.TrimSpace(discountsJSON)
	if trimmed == "" {
		return nil
	}
	var discounts map[string]float64
	if err := Unmarshal([]byte(trimmed), &discounts); err != nil {
		SysError("failed to unmarshal user model discounts: " + err.Error())
		return nil
	}
	return discounts
}

// HasModelDiscounts 判断用户是否配置了至少一条真正改变价格的折扣（值 < 1），
// 用于前端「原价/折扣」两列的默认可见性。折扣恒为 1 等同原价，
// 两列只会一直显示「原价 = 费用、折扣 = 100%」，因此不算“有折扣”。
func HasModelDiscounts(discountsJSON string) bool {
	for _, ratio := range ParseModelDiscounts(discountsJSON) {
		if isValidModelDiscount(ratio) && ratio < NoModelDiscount {
			return true
		}
	}
	return false
}

// ResolveUserModelDiscount 返回指定模型的折扣比例，无匹配或配置非法时返回 1（原价）。
func ResolveUserModelDiscount(discountsJSON, modelName string) float64 {
	if modelName == "" {
		return NoModelDiscount
	}
	discounts := ParseModelDiscounts(discountsJSON)
	if len(discounts) == 0 {
		return NoModelDiscount
	}

	if ratio, ok := discounts[modelName]; ok && isValidModelDiscount(ratio) {
		return ratio
	}

	// 前缀通配：最长前缀命中优先，避免 "seedance*" 覆盖更精确的 "seedance-2.0*"。
	bestPrefix := ""
	bestRatio := NoModelDiscount
	for key, ratio := range discounts {
		if !strings.HasSuffix(key, "*") || !isValidModelDiscount(ratio) {
			continue
		}
		prefix := strings.TrimSuffix(key, "*")
		if prefix == "" || !strings.HasPrefix(modelName, prefix) {
			continue
		}
		if len(prefix) > len(bestPrefix) {
			bestPrefix = prefix
			bestRatio = ratio
		}
	}
	return bestRatio
}

// NormalizeModelDiscounts 校验并规范化管理员提交的折扣配置：
// 键去空白、限制长度与条目数，值限定 (0,1] 并保留 4 位小数。
func NormalizeModelDiscounts(discounts map[string]float64) (map[string]float64, error) {
	if len(discounts) == 0 {
		return map[string]float64{}, nil
	}
	if len(discounts) > MaxModelDiscountEntries {
		return nil, fmt.Errorf("%w（%d/%d）", errModelDiscountTooMany, len(discounts), MaxModelDiscountEntries)
	}

	normalized := make(map[string]float64, len(discounts))
	for rawKey, ratio := range discounts {
		key := strings.TrimSpace(rawKey)
		if key == "" {
			return nil, errModelDiscountEmptyKey
		}
		if key == "*" {
			return nil, errModelDiscountGlobalWild
		}
		if len(key) > MaxModelDiscountKeyLength {
			return nil, fmt.Errorf("%w（%d）", errModelDiscountKeyTooLong, len(key))
		}
		if !isValidModelDiscount(ratio) {
			return nil, errModelDiscountInvalidRate
		}
		if _, exists := normalized[key]; exists {
			return nil, fmt.Errorf("模型折扣重复配置：%s", key)
		}
		normalized[key] = roundModelDiscount(ratio)
	}
	return normalized, nil
}

// isValidModelDiscount 拒绝 NaN/Inf/0/负数/大于 1 的“折扣”，
// 这些值一旦进入计费乘法会产生负扣费或额度膨胀。
func isValidModelDiscount(ratio float64) bool {
	return ratio > 0 && ratio <= 1 && !math.IsNaN(ratio) && !math.IsInf(ratio, 0)
}

// NormalizeAgentModelFloors 校验并规范化管理员提交的代理商授权配置：
// {"模型名": 折扣下限}。键即授权模型清单，值即代理能给该模型设的最低折扣。
//
// 与 NormalizeModelDiscounts 的两处关键差异：
//   - 不允许为空：空授权等于“成员一个模型都调不通”，是个陷井，因此在写入时就拦住；
//   - 不允许通配键：白名单语义下通配会过度放行，模型名必须是精确值。
func NormalizeAgentModelFloors(floors map[string]float64) (map[string]float64, error) {
	if len(floors) == 0 {
		return nil, ErrAgentModelsEmpty
	}
	if len(floors) > MaxModelDiscountEntries {
		return nil, fmt.Errorf("%w（%d/%d）", errModelDiscountTooMany, len(floors), MaxModelDiscountEntries)
	}

	normalized := make(map[string]float64, len(floors))
	for rawKey, ratio := range floors {
		key := strings.TrimSpace(rawKey)
		if key == "" {
			return nil, errModelDiscountEmptyKey
		}
		if strings.Contains(key, "*") {
			return nil, errAgentModelWildcard
		}
		if len(key) > MaxModelDiscountKeyLength {
			return nil, fmt.Errorf("%w（%d）", errModelDiscountKeyTooLong, len(key))
		}
		if !isValidModelDiscount(ratio) {
			return nil, errModelDiscountInvalidRate
		}
		if _, exists := normalized[key]; exists {
			return nil, fmt.Errorf("授权模型重复配置：%s", key)
		}
		normalized[key] = roundModelDiscount(ratio)
	}
	return normalized, nil
}

// ValidateModelDiscountsWithinFloors 校验代理商给成员设的折扣是否落在授权范围内：
// 每个模型必须在 floors 里（即已授权），且折扣值 >= 该模型的下限。
// 入参 discounts 应已经过 NormalizeModelDiscounts，故此处不再重复检查值域与条目数。
//
// 返回出错的模型名 + 对应的哨兵错误（ErrAgentModelNotAuthorized / ErrAgentDiscountBelowFloor），
// 调用方据模型名填充 i18n 的 {{.Model}} 占位；无错误时返回 "" 与 nil。
//
// 浮点比较前两边都过 roundModelDiscount，避免 0.8 与 0.7999999999 这类
// 表示误差把合法的“恰好等于下限”误判为越界。
func ValidateModelDiscountsWithinFloors(discounts map[string]float64, floors map[string]float64) (string, error) {
	for model, ratio := range discounts {
		floor, ok := floors[model]
		if !ok {
			return model, fmt.Errorf("%w：%s", ErrAgentModelNotAuthorized, model)
		}
		if roundModelDiscount(ratio) < roundModelDiscount(floor) {
			return model, fmt.Errorf("%w：%s", ErrAgentDiscountBelowFloor, model)
		}
	}
	return "", nil
}

// roundModelDiscount 按 modelDiscountPrecision 归一折扣值，消除二进制浮点尾差。
func roundModelDiscount(ratio float64) float64 {
	return math.Round(ratio*modelDiscountPrecision) / modelDiscountPrecision
}
