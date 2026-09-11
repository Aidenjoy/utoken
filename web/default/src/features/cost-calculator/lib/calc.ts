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
/** Accepts digits with at most one decimal point, matching the pricing inputs. */
export const NUMERIC_DRAFT_REGEX = /^\d*\.?\d*$/

const MILLION = 1_000_000

export function parseAmount(raw: string): number {
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value) || value < 0) return 0
  return value
}

/**
 * The discount is the payable percentage of the list price (85 = pay 85%).
 * An empty input means "no discount"; values above 100 are clamped.
 */
export function discountPercent(raw: string): number {
  if (raw.trim() === '') return 100
  return Math.min(parseAmount(raw), 100)
}

export function discountFactor(raw: string): number {
  return discountPercent(raw) / 100
}

/** Token prices are quoted per million tokens. */
export function tokenCost(
  pricePerMillionTokens: number,
  tokens: number,
  factor: number
): number {
  return ((pricePerMillionTokens * tokens) / MILLION) * factor
}

export function unitCost(
  pricePerUnit: number,
  units: number,
  factor: number
): number {
  return pricePerUnit * units * factor
}

/** Calculator prices are entered in USD, so results stay in USD as well. */
export function formatUsd(value: number): string {
  const rounded = Math.round(value * MILLION) / MILLION
  return `$${rounded.toLocaleString('en-US', { maximumFractionDigits: 6 })}`
}
