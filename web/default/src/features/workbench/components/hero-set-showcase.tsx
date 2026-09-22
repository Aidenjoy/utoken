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
import { Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import modelOne from '@/assets/hero/model-set-1.webp'
import modelTwo from '@/assets/hero/model-set-2.webp'
import modelThree from '@/assets/hero/model-set-3.webp'
import modelFour from '@/assets/hero/model-set-4.webp'
import productScene from '@/assets/hero/product-set-1.webp'
import productSelling from '@/assets/hero/product-set-2.webp'

import { PRODUCT_SET_TYPES } from '../constants'
import type { HeroSetConfig } from '../types'
import { ShowcaseHint } from './showcase-hint'

const modelExamples = [modelOne, modelTwo, modelThree, modelFour]
const productExamples = [
  { src: productScene, label: 'Usage scene image' },
  { src: productSelling, label: 'Core selling point image' },
]
const productPurposes = PRODUCT_SET_TYPES.filter(
  (type) => type.defaultCount > 0
)

/** 两种套图的静态示例，仅在尚未生成时展示。 */
export function HeroSetShowcase(props: { mode: HeroSetConfig['mode'] }) {
  const { t } = useTranslation()

  return (
    <section
      aria-label={t('Example preview')}
      className='dark:bg-muted/30 border-border flex min-h-[420px] min-w-0 flex-1 flex-col justify-center gap-5 overflow-hidden rounded-xl border bg-[#edf3f0] p-4 sm:p-6'
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <span className='text-sm font-medium'>{t('Generated result')}</span>
        <span className='text-muted-foreground text-xs'>
          {t('Example preview')}
        </span>
      </div>
      {props.mode === 'model' ? (
        <>
          <figure className='border-border bg-card rounded-xl border p-3 shadow-sm'>
            <figcaption className='mb-3 flex flex-wrap items-center justify-between gap-2'>
              <span className='text-sm font-medium'>
                {t('One model, four poses')}
              </span>
              <span className='text-muted-foreground text-xs'>
                {t('Consistent person, outfit and scene')}
              </span>
            </figcaption>
            <div className='grid grid-cols-4 gap-2'>
              {modelExamples.map((src, index) => (
                <img
                  key={src}
                  src={src}
                  alt={t('Model set pose example {{index}}', {
                    index: index + 1,
                  })}
                  width={400}
                  height={688}
                  decoding='async'
                  className='h-auto w-full rounded-lg'
                />
              ))}
            </div>
          </figure>
          <ShowcaseHint
            icon={Layers}
            title={t('Model set')}
            description={t(
              'Upload a model image and choose views to create a consistent image set.'
            )}
            badges={[t('Front'), t('Side'), t('Back view')]}
          />
        </>
      ) : (
        <>
          <div className='grid grid-cols-2 gap-2'>
            {productExamples.map((example) => (
              <img
                key={example.src}
                src={example.src}
                alt={t(example.label)}
                width={640}
                height={867}
                decoding='async'
                className='border-border bg-card h-auto w-full rounded-xl border shadow-sm'
              />
            ))}
          </div>
          <ShowcaseHint
            icon={Layers}
            title={t('Product set')}
            description={t(
              'Upload product images and choose purposes to create matching hero, selling point, scene, detail and white background images.'
            )}
            badges={productPurposes.map((type) => t(type.label))}
          />
        </>
      )}
    </section>
  )
}
