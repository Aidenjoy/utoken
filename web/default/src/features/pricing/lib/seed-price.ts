/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import type { PricingModel } from '../types'

// ----------------------------------------------------------------------------
// Seedance / Seedream billing display helpers
//
// 后端 billing_setting 为这两种计费模式按模型存储单价 JSON（原始字符串经
// /api/pricing 的 seedance_config / seedream_config 下发），这里负责解析与
// 换算展示价格：seedream 按张单价与 model_price 同量纲；seedance 配置值仅
// 用于推导档间倍率（基准档 = 480p 不含视频输入，对应 model_ratio 基准价），
// 与 relay 侧 GetVideoInputRatio 的语义保持一致。
// ----------------------------------------------------------------------------

// 分辨率档固定顺序（与系统设置编辑器一致）；其余自定义档按名称附后
export const SEEDANCE_RESOLUTION_ORDER = ['480p', '720p', '1080p', '4k'] as const
export const SEEDANCE_BASE_RESOLUTION = '480p'

export type SeedreamPrices = {
  inputImage: number
  outputImage: number
}

export type SeedanceTierPrice = {
  resolution: string
  withVideo: number
  withoutVideo: number
}

export type SeedanceTierVariant = 'withVideo' | 'withoutVideo'

export function isSeedreamBillingModel(model: PricingModel): boolean {
  return model.billing_mode === 'seedream' && Boolean(model.seedream_config)
}

export function isSeedanceBillingModel(model: PricingModel): boolean {
  return model.billing_mode === 'seedance' && Boolean(model.seedance_config)
}

function toPrice(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) && num >= 0 ? num : 0
}

/**
 * Parse seedream per-image prices (same dimension as model_price).
 * Returns null when the model is not in seedream mode or config is invalid.
 */
export function getSeedreamPrices(model: PricingModel): SeedreamPrices | null {
  if (!isSeedreamBillingModel(model)) return null
  try {
    const parsed = JSON.parse(model.seedream_config || '') as {
      input_image_price?: number
      output_image_price?: number
    }
    if (!parsed || typeof parsed !== 'object') return null
    return {
      inputImage: toPrice(parsed.input_image_price),
      outputImage: toPrice(parsed.output_image_price),
    }
  } catch {
    return null
  }
}

/**
 * Parse seedance per-resolution prices, ordered by the fixed resolution list.
 * Returns null when the model is not in seedance mode or config is invalid.
 */
export function getSeedanceTiers(model: PricingModel): SeedanceTierPrice[] | null {
  if (!isSeedanceBillingModel(model)) return null
  let parsed: Record<string, { with_video?: number; without_video?: number }>
  try {
    parsed = JSON.parse(model.seedance_config || '')
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const byResolution = new Map<string, SeedanceTierPrice>()
  for (const [key, tier] of Object.entries(parsed)) {
    const resolution = key.trim().toLowerCase()
    if (!resolution || !tier || typeof tier !== 'object') continue
    byResolution.set(resolution, {
      resolution,
      withVideo: toPrice(tier.with_video),
      withoutVideo: toPrice(tier.without_video),
    })
  }
  if (byResolution.size === 0) return null

  const known = SEEDANCE_RESOLUTION_ORDER.filter((res) =>
    byResolution.has(res)
  ).map((res) => byResolution.get(res) as SeedanceTierPrice)
  const extra = [...byResolution.values()]
    .filter(
      (tier) =>
        !(SEEDANCE_RESOLUTION_ORDER as readonly string[]).includes(
          tier.resolution
        )
    )
    .sort((a, b) => a.resolution.localeCompare(b.resolution))
  return [...known, ...extra]
}

/**
 * Seedance base price (480p without video input); relay uses it as the
 * denominator when deriving per-tier ratios.
 */
export function getSeedanceBasePrice(tiers: SeedanceTierPrice[]): number {
  return (
    tiers.find((tier) => tier.resolution === SEEDANCE_BASE_RESOLUTION)
      ?.withoutVideo ?? 0
  )
}

/**
 * Effective token unit price (USD per 1M input tokens, group ratio excluded)
 * for a seedance tier: base input price (model_ratio) × tier ratio, mirroring
 * the billing formula where the tier ratio multiplies the whole quota as an
 * OtherRatio. Returns null when base or tier price is missing.
 */
export function seedanceTierUnitPricePer1M(
  model: PricingModel,
  basePrice: number,
  tier: SeedanceTierPrice,
  variant: SeedanceTierVariant
): number | null {
  if (!(basePrice > 0)) return null
  const price = tier[variant]
  if (!(price > 0)) return null
  return model.model_ratio * 2 * (price / basePrice)
}
