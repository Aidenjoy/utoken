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
  unitCost,
} from '../lib/calc'
import { CalculatorField, DiscountField } from './calculator-field'
import { CostSummary } from './cost-summary'

/**
 * Image model estimator: input (reference) and output (generated) image
 * prices multiplied by the matching image counts.
 */
export function ImageModelCalculator() {
  const { t } = useTranslation()
  const [priceInputImage, setPriceInputImage] = useState('')
  const [priceOutputImage, setPriceOutputImage] = useState('')
  const [inputImages, setInputImages] = useState('')
  const [outputImages, setOutputImages] = useState('')
  const [discount, setDiscount] = useState('100')

  const factor = discountFactor(discount)
  const inputImageCost = unitCost(
    parseAmount(priceInputImage),
    parseAmount(inputImages),
    factor
  )
  const outputImageCost = unitCost(
    parseAmount(priceOutputImage),
    parseAmount(outputImages),
    factor
  )

  return (
    <div className='space-y-6'>
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        <CalculatorField
          label={t('Input Image Price')}
          prefix='$'
          suffix={t('per image')}
          value={priceInputImage}
          onChange={setPriceInputImage}
        />
        <CalculatorField
          label={t('Output Image Price')}
          prefix='$'
          suffix={t('per image')}
          value={priceOutputImage}
          onChange={setPriceOutputImage}
        />
        <DiscountField value={discount} onChange={setDiscount} />
        <CalculatorField
          label={t('Input Images')}
          value={inputImages}
          onChange={setInputImages}
        />
        <CalculatorField
          label={t('Output Images')}
          value={outputImages}
          onChange={setOutputImages}
        />
      </div>
      <CostSummary
        rows={[
          { label: t('Input Image Cost'), value: formatUsd(inputImageCost) },
          { label: t('Output Image Cost'), value: formatUsd(outputImageCost) },
          { label: t('Discount Rate'), value: `${discountPercent(discount)}%` },
        ]}
        total={{
          label: t('Estimated Total'),
          value: formatUsd(inputImageCost + outputImageCost),
        }}
      />
    </div>
  )
}
