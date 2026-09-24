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
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SECTION_PAGE_TITLE_CLASS } from '@/components/layout'
import { Button } from '@/components/ui/button'

import {
  DesignChannels,
  DesignChoice,
  DesignOutputControls,
  DesignSection,
  DesignText,
  DesignUpload,
} from './components/design-controls'
import { DesignItemEditor } from './components/design-item-editor'
import { GenerateBar } from './components/generate-bar'
import { IndustryShowcase } from './components/industry-showcase'
import { PackagingMaterialControls } from './components/packaging-material-controls'
import { ResultPanel } from './components/result-panel'
import { SegmentBar } from './components/segment-bar'
import { UploadTile } from './components/upload-tile'
import { useDesignGeneration } from './hooks/use-design-generation'
import { buildPackagingPlan } from './lib/prompt-packaging'
import {
  createPackagingConfig,
  PACKAGING_MODES,
  PACKAGING_REFRESH,
  PACKAGING_SCENES,
  PACKAGING_WARNING,
  type PackagingConfig,
  type PackagingMode,
} from './packaging-config'

export function PackagingDesignPage() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<PackagingMode>('concept')
  const [configs, setConfigs] = useState(
    () =>
      Object.fromEntries(
        PACKAGING_MODES.map((item) => [
          item.value,
          createPackagingConfig(item.value),
        ])
      ) as Record<PackagingMode, PackagingConfig>
  )
  const generation = useDesignGeneration(t('Packaging Design'))
  const formRef = useRef<HTMLFieldSetElement>(null)
  const config = configs[mode]
  const update = (patch: Partial<PackagingConfig>) => {
    if (!generation.isLoading) {
      setConfigs((previous) => ({
        ...previous,
        [mode]: { ...previous[mode], ...patch },
      }))
    }
  }
  const validation = useMemo(() => {
    try {
      return { plan: buildPackagingPlan(config), error: '' }
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
  const designCopy = mode === 'concept' || mode === 'refresh'
  const materialControls =
    mode === 'concept' || mode === 'materials' || mode === 'unboxing'
  const multiRatio = mode === 'display' && config.multiRatio
  const countHidden = mode === 'materials' || mode === 'series' || multiRatio
  const reuse = (src: string, index: number, target: PackagingMode) => {
    if (generation.isLoading) return
    setConfigs((previous) => ({
      ...previous,
      [target]: {
        ...previous[target],
        master: {
          id: crypto.randomUUID(),
          src,
          name: generation.labels[index],
        },
      },
    }))
    setMode(target)
    formRef.current?.scrollTo({ top: 0 })
    toast.success(t('Master selected. Review settings before generating.'))
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4 p-4 lg:p-6'>
      <header className='flex flex-wrap items-center justify-between gap-3'>
        <h1 className={SECTION_PAGE_TITLE_CLASS}>{t('Packaging Design')}</h1>
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
          ref={formRef}
          disabled={generation.isLoading}
          className='min-w-0 space-y-4 xl:min-h-0 xl:overflow-y-auto'
        >
          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <SegmentBar
              singleRow
              label={t('What would you like to create?')}
              options={PACKAGING_MODES.map((item) => ({
                ...item,
                label: t(item.label),
              }))}
              value={mode}
              onChange={(value) => {
                if (!generation.isLoading) setMode(value as PackagingMode)
              }}
            />
            <p className='text-muted-foreground text-xs'>
              {t(PACKAGING_WARNING)}
            </p>
          </section>
          <DesignSection title='Source materials'>
            {mode !== 'concept' ? (
              <DesignUpload
                label={
                  mode === 'unboxing'
                    ? 'Existing gift box (optional)'
                    : 'Packaging master (required)'
                }
                value={config.master}
                onChange={(master) => update({ master })}
              />
            ) : null}
            {designCopy ? (
              <>
                <UploadTile
                  label={t('Product photos (optional)')}
                  max={mode === 'concept' ? 4 : 1}
                  multiple={mode === 'concept'}
                  value={config.products}
                  onChange={(products) => update({ products })}
                />
                <DesignUpload
                  label='Brand or Logo reference (optional)'
                  value={config.brand}
                  onChange={(brand) => update({ brand })}
                  hint='Logo reference does not guarantee pixel-perfect reproduction.'
                />
              </>
            ) : null}
            {mode === 'concept' ? (
              <DesignUpload
                label='Style reference (optional)'
                value={config.style}
                onChange={(style) => update({ style })}
                hint='Style only; never a source for food, products or text.'
              />
            ) : null}
            {mode === 'unboxing' || mode === 'series' ? (
              <DesignItemEditor
                items={config.items}
                min={mode === 'series' ? 2 : 1}
                max={mode === 'series' ? 6 : 4}
                sku={mode === 'series'}
                namesRequired={mode === 'series'}
                optionalImages={mode === 'series'}
                quantities={mode === 'unboxing'}
                onChange={(items) => update({ items })}
              />
            ) : null}
          </DesignSection>
          <DesignSection title='Design requirements'>
            {designCopy || mode === 'unboxing' ? (
              <DesignText
                label='Packaging brief'
                multiline
                maxLength={2000}
                required={mode !== 'refresh'}
                value={config.brief}
                onChange={(brief) => update({ brief })}
              />
            ) : null}
            {designCopy ? (
              <>
                <DesignText
                  label='Brand name (optional)'
                  value={config.brandName}
                  onChange={(brandName) => update({ brandName })}
                />
                <DesignText
                  label='Product name (optional)'
                  value={config.productName}
                  onChange={(productName) => update({ productName })}
                />
                <DesignText
                  label='Short packaging copy (optional)'
                  maxLength={120}
                  value={config.copy}
                  onChange={(copy) => update({ copy })}
                  hint='No invented barcodes, ingredients, nutrition tables or certifications.'
                />
              </>
            ) : null}
            {mode === 'refresh' ? (
              <DesignChoice
                label='Refresh scope'
                options={PACKAGING_REFRESH}
                value={config.refresh}
                onChange={(refresh) => update({ refresh })}
              />
            ) : null}
            {materialControls ? (
              <PackagingMaterialControls config={config} onChange={update} />
            ) : null}
            {mode === 'series' ? (
              <p className='text-muted-foreground text-sm'>
                {t('Only the current SKU is sent with the selected master.')}
              </p>
            ) : null}
            {mode === 'display' ? (
              <DesignChoice
                label='Photographic setting'
                options={PACKAGING_SCENES}
                value={config.scene}
                onChange={(scene) => update({ scene })}
              />
            ) : null}
          </DesignSection>
          <section className='border-border bg-card space-y-4 rounded-lg border p-4'>
            {mode === 'display' ? (
              <label className='flex items-center gap-2 text-sm'>
                <input
                  type='checkbox'
                  className='accent-primary size-4'
                  checked={config.multiRatio}
                  onChange={(event) =>
                    update({ multiRatio: event.target.checked })
                  }
                />
                {t('Multiple output formats')}
              </label>
            ) : null}
            <DesignOutputControls
              resolution={config.resolution}
              ratio={config.ratio}
              multiRatio={multiRatio}
              onResolution={(resolution) => update({ resolution })}
              onRatio={(ratio) => update({ ratio })}
            />
            {multiRatio ? (
              <DesignChannels
                value={config.channels}
                onChange={(channels) => update({ channels })}
              />
            ) : null}
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
                  update(createPackagingConfig(mode))
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
            <IndustryShowcase packaging={mode} />
          ) : (
            <ResultPanel
              progressive
              preserveAspect
              phase={generation.phase}
              results={generation.results}
              resultLabels={generation.labels}
              error={generation.error}
              count={generation.labels.length}
              downloadPrefix='packaging'
              notice={t(PACKAGING_WARNING)}
              loadingLabel={t('Generating packaging images...')}
              renderResultActions={(src, index) =>
                generation.isLoading ? null : (
                  <details>
                    <summary className='focus-visible:outline-primary cursor-pointer rounded text-sm font-medium focus-visible:outline-2'>
                      {t('Use as packaging master')}
                    </summary>
                    <div className='mt-2 flex flex-wrap gap-2'>
                      {PACKAGING_MODES.filter((item) =>
                        ['refresh', 'series', 'display'].includes(item.value)
                      ).map((item) => (
                        <Button
                          key={item.value}
                          size='sm'
                          variant='outline'
                          onClick={() => reuse(src, index, item.value)}
                        >
                          {t(item.label)}
                        </Button>
                      ))}
                    </div>
                  </details>
                )
              }
            />
          )}
        </div>
      </div>
    </div>
  )
}
