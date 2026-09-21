import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Eraser, LayoutGrid } from 'lucide-react'
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
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SECTION_PAGE_TITLE_CLASS } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { getUserModels } from '@/lib/api'
import { getModelCategory } from '@/lib/model-category'

import { generateTryOnImages } from './api'
import { BoardGlyph } from './components/board-glyph'
import { ChipGroup } from './components/chip-group'
import { GenerateBar } from './components/generate-bar'
import { ResolutionCards } from './components/resolution-cards'
import { ResultPanel, type ResultPhase } from './components/result-panel'
import { UploadTile } from './components/upload-tile'
import {
  createDefaultProductDesignConfig,
  DESIGN_BOARD_TYPES,
  DESIGN_DIRECTIONS,
  DESIGN_PRESETS,
  TRY_ON_RATIOS,
} from './constants'
import { buildImageSize } from './lib/image-size'
import { buildProductDesignRequest } from './lib/prompt-product'
import { saveGenerationToLibrary } from './lib/save-to-library'
import type { ChipOption, DesignDirection, ProductDesignConfig } from './types'

/**
 * Merchandise design workbench: one product photo plus a direction template
 * (or a custom brief) becomes a complete e-commerce design board.
 */
export function ProductDesignPage() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<ProductDesignConfig>(
    createDefaultProductDesignConfig
  )
  const [phase, setPhase] = useState<ResultPhase>('idle')
  const [results, setResults] = useState<string[]>([])
  const [error, setError] = useState('')
  const uploadsRef = useRef<HTMLDivElement>(null)

  const { data: modelsData } = useQuery({
    queryKey: ['try-on-models'],
    queryFn: getUserModels,
  })

  const imageModels = useMemo(() => {
    const names = modelsData?.success && modelsData.data ? modelsData.data : []
    return names.filter((name) => getModelCategory(name) === 'image')
  }, [modelsData])

  useEffect(() => {
    if (config.imageModel || imageModels.length === 0) return
    setConfig((prev) => ({ ...prev, imageModel: imageModels[0] }))
  }, [config.imageModel, imageModels])

  const update = <K extends keyof ProductDesignConfig>(
    key: K,
    value: ProductDesignConfig[K]
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const changeDirection = (value: string) => {
    const direction = value as DesignDirection
    const firstPreset = DESIGN_PRESETS[direction]?.[0]?.value ?? ''
    setConfig((prev) => ({ ...prev, direction, preset: firstPreset }))
  }

  const presets = DESIGN_PRESETS[config.direction] ?? []

  const handleGenerate = async () => {
    if (!config.product) {
      toast.error(t('Upload a product photo first'))
      return
    }
    if (config.direction === 'custom' && !config.customBrief.trim()) {
      toast.error(t('Write a custom brief or pick a template'))
      return
    }
    if (!config.imageModel) {
      toast.error(t('Select an image model'))
      return
    }
    const { prompt, images } = buildProductDesignRequest(config)
    setPhase('loading')
    setError('')
    try {
      const response = await generateTryOnImages({
        model: config.imageModel,
        prompt,
        size: buildImageSize(config.resolution, config.ratio),
        n: config.count,
        watermark: false,
        image: images[0],
      })
      const message = response.error?.message
      if (message) {
        throw new Error(message)
      }
      const urls = (response.data ?? [])
        .map((item) =>
          (item.url ?? item.b64_json)
            ? (item.url ?? `data:image/png;base64,${item.b64_json}`)
            : ''
        )
        .filter(Boolean)
      if (urls.length === 0) {
        throw new Error(t('The model returned no images'))
      }
      setResults(urls)
      setPhase('done')
      void saveGenerationToLibrary(
        'viral-design',
        t('Merchandise Design'),
        urls,
        images,
        t
      )
    } catch (generateError) {
      const message =
        generateError instanceof Error
          ? generateError.message
          : t('Generation failed, please retry')
      setError(message)
      setPhase('error')
      toast.error(message)
    }
  }

  const handleClear = () => {
    setConfig((prev) => ({
      ...createDefaultProductDesignConfig(),
      imageModel: prev.imageModel,
    }))
    setPhase('idle')
    setResults([])
    setError('')
  }

  const focusUploads = () => {
    uploadsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const tr = (options: ChipOption[]) =>
    options.map((option) => ({ ...option, label: t(option.label) }))
  const ratioOptions = TRY_ON_RATIOS.map((option) => ({
    ...option,
    label: option.value === 'smart' ? t('Smart') : option.label,
  }))
  const modelOptions = imageModels.map((name) => ({ label: name, value: name }))
  const idleSteps = [
    t('Upload a product photo'),
    t('Pick a direction and template'),
    t('Generate the design board'),
  ]

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:p-6'>
      <header className='flex flex-wrap items-center justify-between gap-3'>
        <h1 className={SECTION_PAGE_TITLE_CLASS}>{t('Merchandise Design')}</h1>
        <Button
          variant='outline'
          size='sm'
          render={<Link to='/director/assets' />}
        >
          <LayoutGrid className='size-4' />
          {t('Asset Library')}
        </Button>
      </header>

      <div className='grid gap-4 xl:grid-cols-2'>
        <div ref={uploadsRef} className='space-y-4'>
          <section className='border-border bg-card rounded-lg border p-4'>
            <UploadTile
              label={t('Upload product photo')}
              hint={t(
                'One clean product shot on a plain background works best.'
              )}
              max={1}
              value={config.product ? [config.product] : []}
              onChange={(next) => update('product', next[0] ?? null)}
            />
          </section>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <ChipGroup
              label={t('Design direction')}
              options={tr(DESIGN_DIRECTIONS)}
              value={config.direction}
              onChange={changeDirection}
            />
            {config.direction === 'custom' ? (
              <div className='space-y-1.5'>
                <span className='text-sm font-medium'>
                  {t('Custom design brief')}
                </span>
                <Textarea
                  rows={4}
                  value={config.customBrief}
                  placeholder={t(
                    'Describe the board you want, e.g. a nine-grid of colorway variations for this bottle'
                  )}
                  onChange={(event) =>
                    update('customBrief', event.target.value)
                  }
                />
              </div>
            ) : (
              <div className='grid gap-3 sm:grid-cols-2'>
                {presets.map((preset) => {
                  const board = DESIGN_BOARD_TYPES[preset.boardType]
                  const selected = preset.value === config.preset
                  return (
                    <button
                      key={preset.value}
                      type='button'
                      aria-pressed={selected}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        selected
                          ? 'border-primary bg-primary/5 ring-primary/30 ring-1'
                          : 'border-border hover:border-primary/40'
                      }`}
                      onClick={() => update('preset', preset.value)}
                    >
                      <div className='mb-2 flex items-start justify-between gap-2'>
                        <span className='text-sm font-medium'>
                          {t(preset.label)}
                        </span>
                        {board ? (
                          <Badge
                            variant='secondary'
                            className='shrink-0 text-[10px]'
                          >
                            {t(board.label)}
                          </Badge>
                        ) : null}
                      </div>
                      <BoardGlyph kind={board?.glyph ?? 'collage'} />
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          <section className='border-border bg-card space-y-1.5 rounded-lg border p-4'>
            <span className='text-sm font-medium'>
              {t('Extra notes (optional)')}
            </span>
            <Textarea
              rows={2}
              value={config.notes}
              placeholder={t(
                'e.g. keep the logo area untouched, use warm studio light'
              )}
              onChange={(event) => update('notes', event.target.value)}
            />
          </section>

          <section className='border-border bg-card space-y-4 rounded-lg border p-4'>
            <ResolutionCards
              value={config.resolution}
              onChange={(value) => update('resolution', value)}
            />
            <ChipGroup
              label={t('Aspect ratio')}
              options={ratioOptions}
              value={config.ratio}
              onChange={(value) => update('ratio', value)}
            />
            <p className='text-muted-foreground text-xs'>
              {t('Each run generates {{count}} boards.', {
                count: config.count,
              })}
            </p>
            <div className='flex justify-end'>
              <Button variant='outline' size='sm' onClick={handleClear}>
                <Eraser className='size-4' />
                {t('Clear')}
              </Button>
            </div>
          </section>

          <GenerateBar
            modelOptions={modelOptions}
            imageModel={config.imageModel}
            onModelChange={(value) => update('imageModel', value)}
            count={config.count}
            onCountChange={(value) => update('count', value)}
            loading={phase === 'loading'}
            disabled={!config.product}
            onGenerate={() => void handleGenerate()}
          />
        </div>

        <ResultPanel
          phase={phase}
          results={results}
          error={error}
          count={config.count}
          onStartUpload={focusUploads}
          idleTitle={t('Turn one product into a whole design board')}
          idleDescription={t(
            'Pick a direction and template; the finished board appears here.'
          )}
          idleSteps={idleSteps}
          loadingLabel={t('Generating design boards...')}
        />
      </div>
    </div>
  )
}
