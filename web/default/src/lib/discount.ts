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
import type { TFunction } from 'i18next'

/**
 * A recharge discount is stored as a pay multiplier in (0, 1]: 0.6 means the
 * user pays 60% of the face value. A value of 0 (unset) or 1 means no discount.
 */
export function hasRechargeDiscount(discount?: number): boolean {
  return (
    typeof discount === 'number' &&
    Number.isFinite(discount) &&
    discount > 0 &&
    discount < 1
  )
}

/**
 * Format a discount multiplier for display. Chinese locales use the "折"
 * convention (multiplier × 10, so 0.6 → "6 折"); every other locale shows the
 * savings as a percentage off (0.6 → "40% off"). Values without a discount
 * render as "No discount".
 */
export function formatDiscount(
  discount: number | undefined,
  language: string | undefined,
  t: TFunction
): string {
  if (!hasRechargeDiscount(discount)) {
    return t('No discount')
  }
  const value = discount as number
  if (language?.toLowerCase().startsWith('zh')) {
    // 0.6 → 6, 0.65 → 6.5; trim a spurious trailing .0
    const zhe = Math.round(value * 100) / 10
    return t('{{value}} 折', { value: zhe })
  }
  const percentOff = Math.round((1 - value) * 100)
  return t('{{value}}% off', { value: percentOff })
}

/**
 * Format a per-model billing discount for the usage-log "discount" column.
 * Unlike `formatDiscount` above (recharge discounts, rendered as the savings:
 * "8 折" / "20% off"), this always renders the share of the original price that
 * was actually charged, so an undiscounted row reads "100%" next to a
 * discounted row reading "80%" instead of falling back to "No discount".
 * Ratios outside (0, 1] — including the `undefined` a legacy log row carries
 * because the field did not exist yet — fall back to 100%.
 */
export function formatModelDiscount(
  ratio: number | null | undefined,
  locale?: string
): string {
  const value =
    ratio == null || !Number.isFinite(ratio) || ratio <= 0 || ratio > 1
      ? 1
      : ratio
  return Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(value)
}
