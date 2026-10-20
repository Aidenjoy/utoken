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
/**
 * Format a per-model billing discount for the usage-log "discount" column.
 * This always renders the share of the original price that was actually
 * charged, so an undiscounted row reads "100%" next to a discounted row reading
 * "80%" instead of falling back to a separate "no discount" label.
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
