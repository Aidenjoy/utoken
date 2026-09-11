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
 * Video generation estimator: the same token count is priced with both the
 * without-video-input and with-video-input rates (per 1M tokens) so the two
 * scenarios stay comparable; there is no combined total by design.
 */
export function VideoModelCalculator() {
  const { t } = useTranslation()
  const [priceWithoutVideoInput, setPriceWithoutVideoInput] = useState('')
  const [priceWithVideoInput, setPriceWithVideoInput] = useState('')
  const [tokens, setTokens] = useState('')
  const [discount, setDiscount] = useState('100')

  const factor = discountFactor(discount)
  const withoutVideoInputCost = tokenCost(
    parseAmount(priceWithoutVideoInput),
    parseAmount(tokens),
    factor
  )
  const withVideoInputCost = tokenCost(
    parseAmount(priceWithVideoInput),
    parseAmount(tokens),
    factor
  )

  return (
    <div className='space-y-6'>
      <p className='text-muted-foreground text-sm'>
        {t(
          'The same token count is priced with both rates so you can compare tasks with and without video input.'
        )}
      </p>
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        <CalculatorField
          label={t('Price without Video Input')}
          prefix='$'
          suffix={t('Per 1M tokens')}
          value={priceWithoutVideoInput}
          onChange={setPriceWithoutVideoInput}
        />
        <CalculatorField
          label={t('Price with Video Input')}
          prefix='$'
          suffix={t('Per 1M tokens')}
          value={priceWithVideoInput}
          onChange={setPriceWithVideoInput}
        />
        <CalculatorField
          label={t('Token Count')}
          value={tokens}
          onChange={setTokens}
        />
        <DiscountField value={discount} onChange={setDiscount} />
      </div>
      <CostSummary
        rows={[
          {
            label: t('Cost without Video Input'),
            value: formatUsd(withoutVideoInputCost),
          },
          {
            label: t('Cost with Video Input'),
            value: formatUsd(withVideoInputCost),
          },
          { label: t('Discount Rate'), value: `${discountPercent(discount)}%` },
        ]}
      />
    </div>
  )
}
