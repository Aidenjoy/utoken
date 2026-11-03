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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { PageTopGlow } from '@/components/page-top-glow'
import { PageTransition } from '@/components/page-transition'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { getLobeIcon } from '@/lib/lobe-icon'
import { getModelCategory, type ModelCategory } from '@/lib/model-category'
import { cn } from '@/lib/utils'

import {
  PriceOverviewTable,
  type PriceOverviewVariant,
} from './components/price-overview-table'
import { DEFAULT_PRICING_PAGE_SIZE, FILTER_ALL } from './constants'
import { usePricingData } from './hooks/use-pricing-data'
import { filterByVendor } from './lib/filters'
import { sortModelsForDisplay } from './lib/model-display-order'

const CATEGORY_TABS = [
  {
    value: 'all',
    labelKey: 'All Models',
    activeClass: 'border-primary/60 bg-primary/10 text-primary',
  },
  {
    value: 'text',
    labelKey: 'Language Model',
    activeClass:
      'border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  {
    value: 'image',
    labelKey: 'Image Model',
    activeClass:
      'border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  {
    value: 'video',
    labelKey: 'Video Model',
    activeClass:
      'border-sky-500/60 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  },
] as const

/**
 * Each model type gets its own table shape: language models use input /
 * output / cached columns, image models use per-image input / output price
 * columns, and video models list one row per resolution tier with
 * without-video / with-video price columns.
 */
const CATEGORY_SECTIONS: {
  value: ModelCategory
  labelKey: string
  variant: PriceOverviewVariant
}[] = [
  { value: 'text', labelKey: 'Language Model', variant: 'text' },
  { value: 'image', labelKey: 'Image Model', variant: 'image' },
  { value: 'video', labelKey: 'Video Model', variant: 'video' },
]

type PriceCategory = 'all' | ModelCategory

export function PricePage() {
  const { t } = useTranslation()
  const [category, setCategory] = useState<PriceCategory>('all')
  const [vendor, setVendor] = useState(FILTER_ALL)
  const [visibleCount, setVisibleCount] = useState(DEFAULT_PRICING_PAGE_SIZE)
  const { models, vendors, isLoading, priceRate, usdExchangeRate } =
    usePricingData()

  const filteredModels = useMemo(() => {
    let result = filterByVendor(models, vendor)
    if (category !== 'all') {
      result = result.filter(
        (model) => getModelCategory(model.model_name) === category
      )
    }
    // Same order and page size as the model square so both pages agree.
    return sortModelsForDisplay(result)
  }, [models, vendor, category])

  const visibleModels = useMemo(
    () => filteredModels.slice(0, visibleCount),
    [filteredModels, visibleCount]
  )

  const sections = useMemo(
    () =>
      CATEGORY_SECTIONS.filter(
        (section) => category === 'all' || category === section.value
      )
        .map((section) => ({
          ...section,
          models: visibleModels.filter(
            (model) => getModelCategory(model.model_name) === section.value
          ),
        }))
        .filter((section) => section.models.length > 0),
    [visibleModels, category]
  )

  const resetVisibleCount = () => setVisibleCount(DEFAULT_PRICING_PAGE_SIZE)

  let priceTables
  if (isLoading) {
    priceTables = (
      <div className='space-y-px overflow-hidden rounded-xl border p-4'>
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className='mb-2 h-12 w-full last:mb-0' />
        ))}
      </div>
    )
  } else if (sections.length === 0) {
    priceTables = (
      <PriceOverviewTable
        models={[]}
        priceRate={priceRate}
        usdExchangeRate={usdExchangeRate}
        variant='text'
      />
    )
  } else {
    priceTables = sections.map((section) => (
      <section key={section.value} className='mt-8'>
        <h2 className='mb-3 text-base font-semibold'>{t(section.labelKey)}</h2>
        <PriceOverviewTable
          models={section.models}
          priceRate={priceRate}
          usdExchangeRate={usdExchangeRate}
          variant={section.variant}
        />
      </section>
    ))
  }

  return (
    <PublicLayout showMainContainer={false}>
      <div className='relative'>
        <PageTopGlow />
        <PageTransition className='relative'>
          <main className='mx-auto w-full max-w-[1440px] px-3 pt-16 pb-8 sm:px-6 sm:pt-20 sm:pb-10'>
            <div className='flex flex-wrap gap-2' aria-label={t('Model')}>
              {CATEGORY_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type='button'
                  aria-pressed={category === tab.value}
                  onClick={() => {
                    setCategory(tab.value)
                    setVendor(FILTER_ALL)
                    resetVisibleCount()
                  }}
                  className={cn(
                    'rounded-full border px-4 py-2 text-sm font-medium transition-all duration-200',
                    category === tab.value
                      ? tab.activeClass
                      : 'border-border/60 bg-card/50 text-muted-foreground hover:border-border hover:text-foreground'
                  )}
                >
                  {t(tab.labelKey)}
                </button>
              ))}
            </div>

            {vendors.length > 0 && (
              <div className='mt-5 flex flex-wrap gap-2'>
                <button
                  type='button'
                  aria-pressed={vendor === FILTER_ALL}
                  onClick={() => {
                    setVendor(FILTER_ALL)
                    resetVisibleCount()
                  }}
                  className={cn(
                    'h-8 rounded-full border px-3.5 text-xs font-medium transition-colors',
                    vendor === FILTER_ALL
                      ? 'border-primary/60 bg-primary/10 text-primary'
                      : 'border-border/60 bg-card/50 text-muted-foreground hover:border-border hover:text-foreground'
                  )}
                >
                  {t('All')}
                </button>
                {vendors.map((item) => (
                  <button
                    key={item.id}
                    type='button'
                    aria-pressed={vendor === item.name}
                    onClick={() => {
                      setVendor(item.name)
                      resetVisibleCount()
                    }}
                    className={cn(
                      'flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors',
                      vendor === item.name
                        ? 'border-primary/60 bg-primary/10 text-primary'
                        : 'border-border/60 bg-card/50 text-muted-foreground hover:border-border hover:text-foreground'
                    )}
                  >
                    {item.icon && getLobeIcon(item.icon, 13)}
                    {item.name}
                  </button>
                ))}
              </div>
            )}

            {priceTables}

            {visibleModels.length < filteredModels.length && (
              <div className='mt-6 text-center'>
                <Button
                  type='button'
                  variant='outline'
                  onClick={() =>
                    setVisibleCount(
                      (current) => current + DEFAULT_PRICING_PAGE_SIZE
                    )
                  }
                >
                  {t('Load more models')}
                </Button>
              </div>
            )}
          </main>
        </PageTransition>
      </div>
    </PublicLayout>
  )
}
