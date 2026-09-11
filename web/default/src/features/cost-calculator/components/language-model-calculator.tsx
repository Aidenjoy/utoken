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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  discountFactor,
  discountPercent,
  formatUsd,
  parseAmount,
  tokenCost,
} from '../lib/calc'
import { CalculatorField, DiscountField } from './calculator-field'
import { CostSummary } from './cost-summary'

/**
 * Language model estimator: cache-hit/cache-miss input and output prices
 * (per 1M tokens) multiplied by the matching token counts.
 */
export function LanguageModelCalculator() {
  const { t } = useTranslation()
  const [priceCacheHit, setPriceCacheHit] = useState('')
  const [priceCacheMiss, setPriceCacheMiss] = useState('')
  const [priceOutput, setPriceOutput] = useState('')
  const [tokensCacheHit, setTokensCacheHit] = useState('')
  const [tokensCacheMiss, setTokensCacheMiss] = useState('')
  const [tokensOutput, setTokensOutput] = useState('')
  const [discount, setDiscount] = useState('100')

  const factor = discountFactor(discount)
  const cacheHitCost = tokenCost(
    parseAmount(priceCacheHit),
    parseAmount(tokensCacheHit),
    factor
  )
  const cacheMissCost = tokenCost(
    parseAmount(priceCacheMiss),
    parseAmount(tokensCacheMiss),
    factor
  )
  const outputCost = tokenCost(
    parseAmount(priceOutput),
    parseAmount(tokensOutput),
    factor
  )

  return (
    <div className='space-y-6'>
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        <CalculatorField
          label={t('Input Price (Cache Hit)')}
          prefix='$'
          suffix={t('Per 1M tokens')}
          value={priceCacheHit}
          onChange={setPriceCacheHit}
        />
        <CalculatorField
          label={t('Input Price (Cache Miss)')}
          prefix='$'
          suffix={t('Per 1M tokens')}
          value={priceCacheMiss}
          onChange={setPriceCacheMiss}
        />
        <CalculatorField
          label={t('Output Price')}
          prefix='$'
          suffix={t('Per 1M tokens')}
          value={priceOutput}
          onChange={setPriceOutput}
        />
        <CalculatorField
          label={t('Input Tokens (Cache Hit)')}
          value={tokensCacheHit}
          onChange={setTokensCacheHit}
        />
        <CalculatorField
          label={t('Input Tokens (Cache Miss)')}
          value={tokensCacheMiss}
          onChange={setTokensCacheMiss}
        />
        <CalculatorField
          label={t('Output Tokens')}
          value={tokensOutput}
          onChange={setTokensOutput}
        />
        <DiscountField value={discount} onChange={setDiscount} />
      </div>
      <CostSummary
        rows={[
          { label: t('Cache Hit Input Cost'), value: formatUsd(cacheHitCost) },
          {
            label: t('Cache Miss Input Cost'),
            value: formatUsd(cacheMissCost),
          },
          { label: t('Output Cost'), value: formatUsd(outputCost) },
          { label: t('Discount Rate'), value: `${discountPercent(discount)}%` },
        ]}
        total={{
          label: t('Estimated Total'),
          value: formatUsd(cacheHitCost + cacheMissCost + outputCost),
        }}
      />
    </div>
  )
}
