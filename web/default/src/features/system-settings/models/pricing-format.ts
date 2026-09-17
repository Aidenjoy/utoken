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
// 比例（如 cacheRatio = 缓存价 / 输入价）以美元价反算显示时靠 ratio × 输入价还原，
// 序列化位数太少会让还原值偏离用户输入（如 0.3/9 截到 12 位再 ×9 = 0.299999999997，
// 偏差 3e-12 超出下方 snap 容差而无法归位）。取 15 位（接近 double 精度）可让还原值
// 落回 snapFloatDrift 容差内，显示回 0.3。
const DISPLAY_DECIMALS = 15
const SNAP_DECIMALS = 8
const SNAP_EPSILON = 1e-12
// 美元价回显专用容差：回显值 = ratio × 输入价，历史数据里 ratio 曾被截到较少
// 位数，还原值会带 0.299999999997 这类尾差。用较宽容差归位到用户输入的短小数；
// 仅用于显示，不参与比例序列化，故不影响存储精度。
const PRICE_SNAP_EPSILON = 1e-9

function toNumberOrNull(value: unknown): number | null {
  if (
    value === '' ||
    value === null ||
    value === undefined ||
    value === false
  ) {
    return null
  }

  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function roundToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function snapFloatDrift(value: number, epsilon = SNAP_EPSILON): number {
  const tolerance = Math.max(epsilon, Math.abs(value) * Number.EPSILON * 8)

  for (let decimals = 0; decimals <= SNAP_DECIMALS; decimals += 1) {
    const rounded = roundToDecimals(value, decimals)
    if (Math.abs(value - rounded) <= tolerance) {
      return rounded
    }
  }

  return value
}

export function formatPricingNumber(value: unknown): string {
  const num = toNumberOrNull(value)
  if (num === null) return ''

  const normalized = snapFloatDrift(num)
  return Number.parseFloat(normalized.toFixed(DISPLAY_DECIMALS)).toString()
}

// formatDisplayPrice 用于把比例反算回美元价展示（如缓存读取价 = cacheRatio × 输入价）。
// 相比 formatPricingNumber 采用更宽容差，能把 ratio × 价 产生的浮点尾差（含旧数据）
// 归位到用户实际输入的短小数；不用于序列化存储，故不会降低比例精度。
export function formatDisplayPrice(value: unknown): string {
  const num = toNumberOrNull(value)
  if (num === null) return ''

  const normalized = snapFloatDrift(num, PRICE_SNAP_EPSILON)
  return Number.parseFloat(normalized.toFixed(DISPLAY_DECIMALS)).toString()
}
