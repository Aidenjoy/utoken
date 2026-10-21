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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getBillingCurrencySymbol } from '@/lib/currency'

import {
  discountFactor,
  discountPercent,
  estimateVideoTokens,
  formatAmount,
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
  // 价格由用户按站点配置币种录入，输入前缀与结果展示均跟随该币种（与模型广场一致）
  const currencySymbol = getBillingCurrencySymbol()
  const [priceWithoutVideoInput, setPriceWithoutVideoInput] = useState('')
  const [priceWithVideoInput, setPriceWithVideoInput] = useState('')
  const [tokens, setTokens] = useState('')
  const [discount, setDiscount] = useState('100')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [frameRate, setFrameRate] = useState('')
  const [seconds, setSeconds] = useState('')

  const estimatedTokens = estimateVideoTokens(
    parseAmount(width),
    parseAmount(height),
    parseAmount(frameRate),
    parseAmount(seconds)
  )

  useEffect(() => {
    if (estimatedTokens > 0) {
      setTokens(String(estimatedTokens))
    }
  }, [estimatedTokens])

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
          prefix={currencySymbol}
          suffix={t('Per 1M tokens')}
          value={priceWithoutVideoInput}
          onChange={setPriceWithoutVideoInput}
        />
        <CalculatorField
          label={t('Price with Video Input')}
          prefix={currencySymbol}
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
            value: formatAmount(withoutVideoInputCost, currencySymbol),
          },
          {
            label: t('Cost with Video Input'),
            value: formatAmount(withVideoInputCost, currencySymbol),
          },
          { label: t('Discount Rate'), value: `${discountPercent(discount)}%` },
        ]}
      />
      <div className='border-border bg-muted/30 space-y-4 rounded-lg border p-4'>
        <div className='space-y-2'>
          <h3 className='text-sm font-medium'>{t('Video Token Estimator')}</h3>
          <code className='bg-muted block w-fit rounded-md px-3 py-2 font-mono text-sm'>
            {t('tokens = (width × height ÷ 1024) × (fps × seconds + 1)')}
          </code>
        </div>
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          <CalculatorField
            label={t('Width')}
            value={width}
            onChange={setWidth}
          />
          <CalculatorField
            label={t('Height')}
            value={height}
            onChange={setHeight}
          />
          <CalculatorField
            label={t('Frame Rate (fps)')}
            value={frameRate}
            onChange={setFrameRate}
          />
          <CalculatorField
            label={t('Duration (seconds)')}
            value={seconds}
            onChange={setSeconds}
          />
        </div>
        <p className='text-sm'>
          {t('Estimated Tokens')}:{' '}
          <span className='font-medium'>
            {estimatedTokens.toLocaleString('en-US')}
          </span>
          {estimatedTokens > 0 ? (
            <span className='text-muted-foreground'>
              {' '}
              · {t('Auto-filled into Token Count above')}
            </span>
          ) : null}
        </p>
      </div>
    </div>
  )
}
