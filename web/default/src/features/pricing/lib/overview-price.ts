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
import { DEFAULT_TOKEN_UNIT } from '../constants'
import type { PricingModel, TokenUnit } from '../types'
import {
  formatDynamicUnitPrice,
  getDynamicDisplayGroupRatio,
  getDynamicPricingSummary,
} from './dynamic-price'
import { isTokenBasedModel } from './model-helpers'
import {
  formatPrice,
  formatRequestPrice,
  formatUnitPrice,
  stripTrailingZeros,
} from './price'
import {
  getSeedanceTiers,
  getSeedreamPrices,
  isSeedreamBillingModel,
  seedanceTierEnteredPricePer1M,
  type SeedanceTierVariant,
} from './seed-price'

/**
 * Which column / slot a billing row feeds: `input`, `output` and `cached` map
 * onto the language-model table columns, `item` stays a stacked billing row.
 */
export type OverviewPriceField = 'input' | 'output' | 'cached' | 'item'

export type OverviewPriceRow = {
  field: OverviewPriceField
  /** i18n key of the billing item label */
  labelKey: string
  /** Raw text shown before the translated label (e.g. a resolution) */
  labelPrefix?: string
  /** Already localized unit suffix, e.g. "/ 1M tokens" */
  sub: string | null
  value: string | null
}

export type ModelOverviewPriceInfo = {
  rows: OverviewPriceRow[]
  isSpecialExpression: boolean
}

type OverviewPriceOptions = {
  tokenUnit?: TokenUnit
  priceRate?: number
  usdExchangeRate?: number
  translate?: (key: string) => string
}

const SEEDANCE_VARIANT_LABELS: {
  variant: SeedanceTierVariant
  labelKey: string
}[] = [
  { variant: 'withoutVideo', labelKey: 'Without video input' },
  { variant: 'withVideo', labelKey: 'With video input' },
]

function fieldForDynamicEntry(field: string): OverviewPriceField {
  if (field === 'inputPrice') return 'input'
  if (field === 'outputPrice') return 'output'
  if (field === 'cacheReadPrice') return 'cached'
  return 'item'
}

/**
 * Convert every billing mode exposed by /api/pricing into billing rows.
 * All currency and group-ratio calculations stay in the existing pricing
 * helpers so this overview cannot drift from the model square.
 */
export function getModelOverviewPriceInfo(
  model: PricingModel,
  options: OverviewPriceOptions = {}
): ModelOverviewPriceInfo {
  const tokenUnit = options.tokenUnit ?? DEFAULT_TOKEN_UNIT
  const priceRate = options.priceRate ?? 1
  const usdExchangeRate = options.usdExchangeRate ?? 1
  const translate = options.translate ?? ((key: string) => key)
  const tokenUnitLabel = tokenUnit === 'K' ? '1K' : '1M'
  const tokenSub = `/ ${tokenUnitLabel} tokens`
  const rows: OverviewPriceRow[] = []
  let isSpecialExpression = false

  const dynamicOptions = {
    tokenUnit,
    priceRate,
    usdExchangeRate,
    groupRatioMultiplier: getDynamicDisplayGroupRatio(model),
  }

  const seedanceTiers = getSeedanceTiers(model)
  if (seedanceTiers) {
    for (const tier of seedanceTiers) {
      for (const { variant, labelKey } of SEEDANCE_VARIANT_LABELS) {
        const unit = seedanceTierEnteredPricePer1M(tier, variant)
        if (unit === null) continue
        rows.push({
          field: 'item',
          labelKey,
          labelPrefix: tier.resolution,
          sub: tokenSub,
          value: stripTrailingZeros(
            formatDynamicUnitPrice(unit, dynamicOptions)
          ),
        })
      }
    }
    if (rows.length > 0) return { rows, isSpecialExpression }
  }

  const dynamicSummary = getDynamicPricingSummary(model, dynamicOptions)
  if (dynamicSummary) {
    isSpecialExpression = dynamicSummary.isSpecialExpression
    for (const entry of dynamicSummary.entries) {
      rows.push({
        field: fieldForDynamicEntry(entry.field),
        labelKey: entry.label,
        sub: tokenSub,
        value: stripTrailingZeros(entry.formatted),
      })
    }
    return { rows, isSpecialExpression }
  }

  if (isSeedreamBillingModel(model)) {
    const seedreamPrices = getSeedreamPrices(model)
    if (seedreamPrices) {
      const imageSub = `/ ${translate('per image')}`
      rows.push({
        field: 'input',
        labelKey: 'Input image price',
        sub: imageSub,
        value: stripTrailingZeros(
          formatUnitPrice(
            model,
            seedreamPrices.inputImage,
            false,
            priceRate,
            usdExchangeRate
          )
        ),
      })
      rows.push({
        field: 'output',
        labelKey: 'Output image price',
        sub: imageSub,
        value: stripTrailingZeros(
          formatUnitPrice(
            model,
            seedreamPrices.outputImage,
            false,
            priceRate,
            usdExchangeRate
          )
        ),
      })
      return { rows, isSpecialExpression }
    }
  }

  if (isTokenBasedModel(model)) {
    rows.push({
      field: 'input',
      labelKey: 'Input',
      sub: tokenSub,
      value: stripTrailingZeros(
        formatPrice(
          model,
          'input',
          tokenUnit,
          false,
          priceRate,
          usdExchangeRate
        )
      ),
    })
    rows.push({
      field: 'output',
      labelKey: 'Output',
      sub: tokenSub,
      value: stripTrailingZeros(
        formatPrice(
          model,
          'output',
          tokenUnit,
          false,
          priceRate,
          usdExchangeRate
        )
      ),
    })
    if (model.cache_ratio != null) {
      rows.push({
        field: 'cached',
        labelKey: 'Cached',
        sub: tokenSub,
        value: stripTrailingZeros(
          formatPrice(
            model,
            'cache',
            tokenUnit,
            false,
            priceRate,
            usdExchangeRate
          )
        ),
      })
    }
    return { rows, isSpecialExpression }
  }

  rows.push({
    field: 'item',
    labelKey: 'Per Request',
    sub: `/ ${translate('request')}`,
    value: stripTrailingZeros(
      formatRequestPrice(model, false, priceRate, usdExchangeRate)
    ),
  })
  return { rows, isSpecialExpression }
}
