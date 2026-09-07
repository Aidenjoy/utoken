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
// 展示：seedream 为按张单价（与 model_price 同量纲）；seedance 各档配置值即
// 每百万 token 的绝对单价（与编辑器录入的 $/1M 同量纲），展示时按录入值直接
// 呈现，不再经 model_ratio 换算，未配置的档（<=0）不展示。
// ----------------------------------------------------------------------------

// 分辨率档固定顺序（与系统设置编辑器一致）；其余自定义档按名称附后
export const SEEDANCE_RESOLUTION_ORDER = ['480p', '720p', '1080p', '4k'] as const

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
 * Seedance tier display price (USD per 1M tokens, group ratio excluded):
 * the value entered for that tier in system settings. Returns null when the
 * tier variant is not configured (<= 0) so callers can hide or show '-'.
 */
export function seedanceTierEnteredPricePer1M(
  tier: SeedanceTierPrice,
  variant: SeedanceTierVariant
): number | null {
  const price = tier[variant]
  return price > 0 ? price : null
}
