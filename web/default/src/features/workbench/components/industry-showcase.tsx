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
import { Package, Utensils } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import foodBatch from '@/assets/hero/food-batch.webp'
import foodCombo from '@/assets/hero/food-combo.webp'
import foodPoster from '@/assets/hero/food-poster.webp'
import foodRetouch from '@/assets/hero/food-retouch.webp'
import packagingConcept from '@/assets/hero/packaging-concept.webp'
import packagingDisplay from '@/assets/hero/packaging-display.webp'
import packagingMaterials from '@/assets/hero/packaging-materials.webp'
import packagingRefresh from '@/assets/hero/packaging-refresh.webp'
import packagingSeries from '@/assets/hero/packaging-series.webp'
import packagingUnboxing from '@/assets/hero/packaging-unboxing.webp'

import { FOOD_MODES, type FoodMode } from '../food-config'
import { PACKAGING_MODES, type PackagingMode } from '../packaging-config'
import { ShowcaseHint } from './showcase-hint'

const FOOD_HELP: Record<FoodMode, { input: string; output: string }> = {
  retouch: {
    input: 'One real dish photo; optional style reference.',
    output:
      'Improve light and background while retaining the dish and portion.',
  },
  batch: {
    input: '1–6 dishes, one photo and separate notes per dish.',
    output: 'One consistent menu photo per dish, in list order.',
  },
  combo: {
    input: '2–4 real dishes or drinks with confirmed quantities.',
    output: 'One complete meal composition, without extra items.',
  },
  poster: {
    input: '1–4 real dishes; optional approved headline and offer.',
    output: 'A simple campaign poster or a text-free background.',
  },
}
const PACKAGING_HELP: Record<PackagingMode, { input: string; output: string }> =
  {
    concept: {
      input: 'A packaging brief; product and brand photos are optional.',
      output:
        'Independent visual directions, even without an existing package.',
    },
    refresh: {
      input: 'One existing package; choose the area to update.',
      output:
        'Refresh graphics, a label or a belly band while keeping the form.',
    },
    materials: {
      input: 'One master and 2–4 material and finish combinations.',
      output: 'One material per image, with the same form, angle and layout.',
    },
    unboxing: {
      input: 'A gift-box brief and 1–4 real contents with quantities.',
      output: 'An open-box arrangement with a conceptual inner tray.',
    },
    series: {
      input: 'One master and 2–6 named SKUs with separate notes.',
      output: 'One image per SKU, preserving the master brand hierarchy.',
    },
    display: {
      input: 'One approved package and a photographic setting.',
      output: 'Change the photographic environment, not the package design.',
    },
  }

/** 实拍风格示例图，与左侧流程一一对应，切换流程时右侧同步换图。 */
const FOOD_PREVIEWS: Record<
  FoodMode,
  { src: string; width: number; height: number }
> = {
  retouch: { src: foodRetouch, width: 496, height: 496 },
  batch: { src: foodBatch, width: 496, height: 496 },
  combo: { src: foodCombo, width: 496, height: 496 },
  poster: { src: foodPoster, width: 496, height: 496 },
}
const PACKAGING_PREVIEWS: Record<
  PackagingMode,
  { src: string; width: number; height: number }
> = {
  concept: { src: packagingConcept, width: 496, height: 496 },
  refresh: { src: packagingRefresh, width: 496, height: 496 },
  materials: { src: packagingMaterials, width: 496, height: 496 },
  unboxing: { src: packagingUnboxing, width: 496, height: 496 },
  series: { src: packagingSeries, width: 496, height: 496 },
  display: { src: packagingDisplay, width: 496, height: 496 },
}

export function IndustryShowcase(props: {
  food?: FoodMode
  packaging?: PackagingMode
}) {
  const { t } = useTranslation()
  const food = props.food
  const packaging = props.packaging ?? 'concept'
  const help = food ? FOOD_HELP[food] : PACKAGING_HELP[packaging]
  const preview = food ? FOOD_PREVIEWS[food] : PACKAGING_PREVIEWS[packaging]
  const title = food
    ? (FOOD_MODES.find((mode) => mode.value === food)?.label ?? 'Food Design')
    : (PACKAGING_MODES.find((mode) => mode.value === packaging)?.label ??
      'Packaging Design')
  return (
    <section
      aria-label={t('Example preview')}
      className='dark:bg-muted/30 border-border flex min-h-[420px] min-w-0 flex-1 flex-col justify-center gap-5 overflow-hidden rounded-xl border bg-[#edf3f0] p-4 sm:p-6'
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <span className='text-sm font-medium'>{t('Example preview')}</span>
        <span className='text-muted-foreground text-xs'>
          {food ? t('Food Design') : t('Packaging Design')}
        </span>
      </div>
      <figure className='flex min-h-[240px] flex-1 items-center justify-center'>
        <img
          src={preview.src}
          alt={t(title)}
          width={preview.width}
          height={preview.height}
          decoding='async'
          className='border-border max-h-full w-auto max-w-full rounded-xl border shadow-sm'
        />
      </figure>
      <ShowcaseHint
        icon={food ? Utensils : Package}
        title={t(title)}
        description={`${t(help.input)} ${t(help.output)}`}
        badges={
          food
            ? [
                t('Dish retouch'),
                t('Batch menu photos'),
                t('Food campaign poster'),
              ]
            : [
                t('New packaging concept'),
                t('Material comparison'),
                t('Packaging series'),
              ]
        }
      />
    </section>
  )
}
