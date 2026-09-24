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
import { Link } from '@tanstack/react-router'
import { Eraser, LayoutGrid } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SECTION_PAGE_TITLE_CLASS } from '@/components/layout'
import { Button } from '@/components/ui/button'

import {
  DesignChoice,
  DesignOutputControls,
  DesignSection,
  DesignText,
  DesignUpload,
} from './components/design-controls'
import { DesignItemEditor } from './components/design-item-editor'
import { GenerateBar } from './components/generate-bar'
import { IndustryShowcase } from './components/industry-showcase'
import { ResultPanel } from './components/result-panel'
import { SegmentBar } from './components/segment-bar'
import {
  createFoodConfig,
  FOOD_BACKGROUNDS,
  FOOD_MODES,
  FOOD_OCCASIONS,
  FOOD_WARNING,
  type FoodConfig,
  type FoodMode,
} from './food-config'
import { useDesignGeneration } from './hooks/use-design-generation'
import { buildFoodPlan } from './lib/prompt-food'

export function FoodDesignPage() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<FoodMode>('retouch')
  const [configs, setConfigs] = useState(
    () =>
      Object.fromEntries(
        FOOD_MODES.map((item) => [item.value, createFoodConfig(item.value)])
      ) as Record<FoodMode, FoodConfig>
  )
  const generation = useDesignGeneration(t('Food Design'))
  const config = configs[mode]
  const update = (patch: Partial<FoodConfig>) => {
    if (!generation.isLoading) {
      setConfigs((previous) => ({
        ...previous,
        [mode]: { ...previous[mode], ...patch },
      }))
    }
  }
  const validation = useMemo(() => {
    try {
      return { plan: buildFoodPlan(config), error: '' }
    } catch (error) {
      return {
        plan: null,
        error:
          error instanceof Error
            ? error.message
            : t('Select a valid design option'),
      }
    }
  }, [config, t])
  const marketing = mode === 'poster'
  const countHidden = mode === 'batch'
  let maxItems = 4
  if (mode === 'retouch') maxItems = 1
  if (mode === 'batch') maxItems = 6

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4 p-4 lg:p-6'>
      <header className='flex flex-wrap items-center justify-between gap-3'>
        <h1 className={SECTION_PAGE_TITLE_CLASS}>{t('Food Design')}</h1>
        <Button
          variant='outline'
          size='sm'
          render={<Link to='/director/assets' />}
        >
          <LayoutGrid className='size-4' />
          {t('Asset Library')}
        </Button>
      </header>
      <div className='grid min-h-0 flex-1 gap-4 overflow-y-auto xl:grid-cols-2 xl:grid-rows-1 xl:overflow-hidden'>
        <fieldset
          disabled={generation.isLoading}
          className='min-w-0 space-y-4 xl:min-h-0 xl:overflow-y-auto'
        >
          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <SegmentBar
              singleRow
              label={t('What would you like to create?')}
              options={FOOD_MODES.map((item) => ({
                ...item,
                label: t(item.label),
              }))}
              value={mode}
              onChange={(value) => {
                if (!generation.isLoading) setMode(value as FoodMode)
              }}
            />
            <p className='text-muted-foreground text-xs'>{t(FOOD_WARNING)}</p>
          </section>
          <DesignSection title='Source materials'>
            <DesignItemEditor
              items={config.items}
              min={mode === 'combo' ? 2 : 1}
              max={maxItems}
              quantities={mode === 'combo'}
              namesRequired={mode === 'combo'}
              onChange={(items) => update({ items })}
            />
            {mode === 'retouch' || mode === 'batch' ? (
              <DesignUpload
                label='Style reference (optional)'
                hint='Style only; never a source for food, products or text.'
                value={config.style}
                onChange={(style) => update({ style })}
              />
            ) : null}
          </DesignSection>
          <DesignSection title='Design requirements'>
            {marketing ? (
              <>
                <DesignChoice
                  label='Campaign direction'
                  options={FOOD_OCCASIONS}
                  value={config.occasion}
                  onChange={(occasion) => update({ occasion })}
                />
                <DesignChoice
                  label='Text treatment'
                  options={[
                    { value: 'none', label: 'Text-free image' },
                    { value: 'short', label: 'Short approved copy' },
                  ]}
                  value={config.copyMode}
                  onChange={(copyMode) =>
                    update({ copyMode: copyMode as FoodConfig['copyMode'] })
                  }
                />
                {config.copyMode === 'short' ? (
                  <>
                    <DesignText
                      label='Headline'
                      required
                      value={config.title}
                      onChange={(title) => update({ title })}
                    />
                    <DesignText
                      label='Subtitle (optional)'
                      maxLength={120}
                      value={config.subtitle}
                      onChange={(subtitle) => update({ subtitle })}
                    />
                    <DesignText
                      label='Exact price or offer (optional)'
                      maxLength={120}
                      value={config.offer}
                      onChange={(offer) => update({ offer })}
                      hint='Only supplied copy is used. Check all text before publishing.'
                    />
                  </>
                ) : null}
              </>
            ) : (
              <DesignChoice
                label='Background direction'
                options={FOOD_BACKGROUNDS}
                value={config.background}
                onChange={(background) => update({ background })}
              />
            )}
          </DesignSection>
          <section className='border-border bg-card space-y-4 rounded-lg border p-4'>
            <DesignOutputControls
              resolution={config.resolution}
              ratio={config.ratio}
              onResolution={(resolution) => update({ resolution })}
              onRatio={(ratio) => update({ ratio })}
            />
            <p className='text-muted-foreground text-xs' aria-live='polite'>
              {t('This run: {{count}} images', {
                count: validation.plan?.requests.length ?? 0,
              })}
            </p>
            {validation.error ? (
              <p className='text-muted-foreground text-xs'>
                {validation.error}
              </p>
            ) : null}
            <div className='flex justify-end'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => {
                  update(createFoodConfig(mode))
                  generation.clear()
                }}
              >
                <Eraser className='size-4' />
                {t('Clear')}
              </Button>
            </div>
          </section>
          <GenerateBar
            modelOptions={generation.modelOptions}
            imageModel={generation.imageModel}
            onModelChange={generation.setModel}
            count={config.count}
            countHidden={countHidden}
            onCountChange={(count) => update({ count })}
            loading={generation.isLoading}
            disabled={!validation.plan || !generation.imageModel}
            onGenerate={() => {
              if (validation.plan) {
                void generation.generate(validation.plan, config.resolution)
              }
            }}
          />
        </fieldset>
        <div className='flex min-w-0 flex-col xl:min-h-0 xl:overflow-y-auto'>
          {generation.phase === 'idle' ? (
            <IndustryShowcase food={mode} />
          ) : (
            <ResultPanel
              progressive
              preserveAspect
              phase={generation.phase}
              results={generation.results}
              resultLabels={generation.labels}
              error={generation.error}
              count={generation.labels.length}
              downloadPrefix='food'
              notice={t(FOOD_WARNING)}
              loadingLabel={t('Generating food images...')}
            />
          )}
        </div>
      </div>
    </div>
  )
}
