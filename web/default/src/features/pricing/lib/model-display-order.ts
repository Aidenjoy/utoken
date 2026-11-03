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

/**
 * Shared display order for the model square and the price overview so both
 * pages list models identically: vendors keep the sequence implied by their
 * model names, and inside one vendor the newest / most advanced models come
 * first (generation descending, then tier max > pro > standard > flash).
 */

/** Tier tokens ranked from flagship to lightweight. */
const TIER_RANKS: Record<string, number> = {
  max: 0,
  ultra: 0,
  opus: 0,
  pro: 1,
  sonnet: 1,
  flash: 3,
  fast: 3,
  turbo: 3,
  lite: 3,
  mini: 3,
  haiku: 3,
}

const STANDARD_TIER_RANK = 2

/**
 * Version tuple parsed from the model name, e.g. `claude-opus-5-5` -> [5, 5]
 * and `qwen3.8-max` -> [3, 8]. Longer tuples win over their own prefix so a
 * point release (5.1) still ranks above its base generation (5).
 */
export function parseModelGeneration(modelName: string): number[] {
  const parts: number[] = []
  for (const match of modelName.matchAll(/\d+(?:\.\d+)?/g)) {
    for (const part of match[0].split('.')) parts.push(Number(part))
  }
  return parts
}

export function parseModelTierRank(modelName: string): number {
  for (const token of modelName.toLowerCase().split(/[^a-z0-9]+/)) {
    const rank = TIER_RANKS[token]
    if (rank !== undefined) return rank
  }
  return STANDARD_TIER_RANK
}

function compareGenerationsDescending(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** Newer generation first, then higher tier, then name for stability. */
export function compareModelsInVendor(
  a: PricingModel,
  b: PricingModel
): number {
  const generation = compareGenerationsDescending(
    parseModelGeneration(a.model_name || ''),
    parseModelGeneration(b.model_name || '')
  )
  if (generation !== 0) return generation
  const tier =
    parseModelTierRank(a.model_name || '') -
    parseModelTierRank(b.model_name || '')
  if (tier !== 0) return tier
  return (a.model_name || '').localeCompare(b.model_name || '')
}

/**
 * Group-aware display order: vendors are sequenced by their alphabetically
 * first model name (the order the name-sorted square has always shown), and
 * each vendor's models follow {@link compareModelsInVendor}.
 */
export function sortModelsForDisplay(models: PricingModel[]): PricingModel[] {
  const groups = new Map<string, PricingModel[]>()
  for (const model of models) {
    const vendor = model.vendor_name || ''
    const group = groups.get(vendor)
    if (group) group.push(model)
    else groups.set(vendor, [model])
  }
  return [...groups.values()]
    .map((group) => ({
      vendorKey: [...group]
        .map((model) => model.model_name || '')
        .sort((a, b) => a.localeCompare(b))[0],
      models: [...group].sort(compareModelsInVendor),
    }))
    .sort((a, b) => a.vendorKey.localeCompare(b.vendorKey))
    .flatMap((entry) => entry.models)
}
