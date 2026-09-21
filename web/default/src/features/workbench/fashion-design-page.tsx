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
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Eraser, History, LayoutGrid, Store } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { getUserModels } from '@/lib/api'
import { getModelCategory } from '@/lib/model-category'

import { generateTryOnImages } from './api'
import { BoardGlyph } from './components/board-glyph'
import { ChipGroup } from './components/chip-group'
import { GenerateBar } from './components/generate-bar'
import { HistoryDialog } from './components/history-dialog'
import { ResolutionCards } from './components/resolution-cards'
import { ResultPanel, type ResultPhase } from './components/result-panel'
import { UploadTile } from './components/upload-tile'
import {
  createDefaultFashionDesignConfig,
  FASHION_DESIGN_STORAGE_KEY,
  FASHION_DIRECTIONS,
  FASHION_PRESETS,
  fashionInputsFor,
  TRY_ON_RATIOS,
} from './constants'
import {
  buildFashionBatchRequests,
  buildFashionRequest,
} from './lib/prompt-fashion'
import {
  clearTryOnTasks,
  loadTryOnTasks,
  removeTryOnTask,
  saveTryOnTask,
} from './lib/storage'
import type {
  ChipOption,
  FashionDesignConfig,
  FashionDirection,
  TryOnImage,
  TryOnTask,
} from './types'

/**
 * Fashion design workbench: garment, fabric, reference and line-art materials
 * plus a direction template become studio-grade fashion renders; batch mode
 * runs one generation per garment image.
 */
export function FashionDesignPage() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<FashionDesignConfig>(
    createDefaultFashionDesignConfig
  )
  const [phase, setPhase] = useState<ResultPhase>('idle')
  const [results, setResults] = useState<string[]>([])
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [tasks, setTasks] = useState<TryOnTask[]>(() =>
    loadTryOnTasks(FASHION_DESIGN_STORAGE_KEY)
  )
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

  const update = <K extends keyof FashionDesignConfig>(
    key: K,
    value: FashionDesignConfig[K]
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const updateSlot = (key: string, next: TryOnImage[]) => {
    setConfig((prev) => ({
      ...prev,
      images: { ...prev.images, [key]: next },
    }))
  }

  const changeDirection = (value: string) => {
    const direction = value as FashionDirection
    const firstPreset = FASHION_PRESETS[direction]?.[0]?.value ?? ''
    setConfig((prev) => ({ ...prev, direction, preset: firstPreset }))
  }

  const isBatch = config.direction === 'batch'
  const isFreeText =
    config.direction === 'free' || config.direction === 'custom'
  const presets = FASHION_PRESETS[config.direction] ?? []
  const preset = isFreeText
    ? null
    : (presets.find((item) => item.value === config.preset) ?? null)
  const inputs = fashionInputsFor(config.direction, config.preset)
  const missingRequired = inputs.filter(
    (input) => input.required && config.images[input.key].length === 0
  )
  const needsDescription = isFreeText || (preset?.needsDescription ?? false)

  const handleGenerate = async () => {
    if (missingRequired.length > 0) {
      toast.error(t('Upload the required images for this template'))
      return
    }
    if (needsDescription && !config.description.trim()) {
      toast.error(t('Write a design description first'))
      return
    }
    if (!config.imageModel) {
      toast.error(t('Select an image model'))
      return
    }
    const requests = isBatch
      ? buildFashionBatchRequests(config)
      : [buildFashionRequest(config, preset)]
    setPhase('loading')
    setError('')
    try {
      const urls: string[] = []
      for (const request of requests) {
        const response = await generateTryOnImages({
          model: config.imageModel,
          prompt: request.prompt,
          size: config.resolution,
          n: isBatch ? 1 : config.count,
          watermark: false,
          image:
            request.images.length === 1 ? request.images[0] : request.images,
        })
        const message = response.error?.message
        if (message) {
          throw new Error(message)
        }
        const runUrls = (response.data ?? [])
          .map((item) =>
            (item.url ?? item.b64_json)
              ? (item.url ?? `data:image/png;base64,${item.b64_json}`)
              : ''
          )
          .filter(Boolean)
        urls.push(...runUrls)
      }
      if (urls.length === 0) {
        throw new Error(t('The model returned no images'))
      }
      setResults(urls)
      setPhase('done')
      const thumbs = (
        config.images.garment.length > 0
          ? config.images.garment
          : config.images.fabric
      ).slice(0, 3)
      setTasks(
        saveTryOnTask(
          {
            id: `${Date.now()}`,
            createdAt: Date.now(),
            imageModel: config.imageModel,
            size: config.resolution,
            count: urls.length,
            prompt: requests[0].prompt,
            results: urls,
            garmentThumbs: thumbs.map((item) => item.src),
            modelThumb: null,
          },
          FASHION_DESIGN_STORAGE_KEY
        )
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
      ...createDefaultFashionDesignConfig(),
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
  const modeHint = isFreeText
    ? t('No template: the design description below drives the run.')
    : t('Batch mode generates one board per garment image, in order.')
  const idleSteps = [
    t('Pick a direction and template'),
    t('Upload the required materials'),
    t('Generate fashion designs'),
  ]

  return (
    <div className='flex flex-col gap-4 p-4 lg:p-6'>
      <header className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex items-start gap-3'>
          <Badge variant='outline' className='mt-1 gap-1'>
            <Store className='size-3.5' />
            {t('Product Visual Workbench')}
          </Badge>
          <div>
            <h1 className='text-xl font-semibold'>{t('Fashion Design')}</h1>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Redesign, new styles, patterns, fabrics and line art in one workbench'
              )}
            </p>
          </div>
        </div>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            render={<Link to='/asset-library' />}
          >
            <LayoutGrid className='size-4' />
            {t('Asset Library')}
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setHistoryOpen(true)}
          >
            <History className='size-4' />
            {t('History')}
          </Button>
        </div>
      </header>

      <div className='grid gap-4 xl:grid-cols-2'>
        <div ref={uploadsRef} className='space-y-4'>
          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <ChipGroup
              label={t('Design direction')}
              options={tr(FASHION_DIRECTIONS)}
              value={config.direction}
              onChange={changeDirection}
            />
            {isFreeText || isBatch ? (
              <p className='text-muted-foreground text-xs'>{modeHint}</p>
            ) : (
              <div className='grid gap-3 sm:grid-cols-2'>
                {presets.map((item) => {
                  const selected = item.value === config.preset
                  return (
                    <button
                      key={item.value}
                      type='button'
                      aria-pressed={selected}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        selected
                          ? 'border-primary bg-primary/5 ring-primary/30 ring-1'
                          : 'border-border hover:border-primary/40'
                      }`}
                      onClick={() => update('preset', item.value)}
                    >
                      <div className='mb-2 flex items-start justify-between gap-2'>
                        <span className='text-sm font-medium'>
                          {t(item.label)}
                        </span>
                        {item.tag ? (
                          <Badge
                            variant='secondary'
                            className='shrink-0 border-pink-200 bg-pink-100 text-[10px] text-pink-600'
                          >
                            {t(item.tag)}
                          </Badge>
                        ) : null}
                      </div>
                      <BoardGlyph kind={item.glyph} />
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <span className='text-sm font-medium'>{t('Materials')}</span>
            {inputs.map((input) => (
              <UploadTile
                key={input.key}
                label={t(input.label)}
                badge={input.required ? t('Required') : t('Optional')}
                max={input.max}
                multiple={input.max > 1}
                value={config.images[input.key]}
                onChange={(next) => updateSlot(input.key, next)}
              />
            ))}
            {preset?.usesColor ? (
              <div className='flex items-center gap-2'>
                <span className='text-sm font-medium'>{t('Target color')}</span>
                <input
                  type='color'
                  aria-label={t('Target color')}
                  value={config.color}
                  onChange={(event) => update('color', event.target.value)}
                  className='border-border h-8 w-12 cursor-pointer rounded-md border bg-transparent'
                />
                <span className='text-muted-foreground text-xs'>
                  {config.color}
                </span>
              </div>
            ) : null}
            <div className='space-y-1.5'>
              <span className='text-sm font-medium'>
                {t('Design description')}
                {needsDescription ? null : (
                  <span className='text-muted-foreground ml-1 text-xs'>
                    {t('Optional')}
                  </span>
                )}
              </span>
              <Textarea
                rows={3}
                value={config.description}
                placeholder={t(
                  'Describe the change, e.g. turn the round neck into a V-neck and add puff sleeves'
                )}
                onChange={(event) => update('description', event.target.value)}
              />
            </div>
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
              {isBatch
                ? t(
                    'Batch mode generates one board per garment image, in order.'
                  )
                : t('Each run generates {{count}} images.', {
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
            disabled={missingRequired.length > 0}
            countHidden={isBatch}
            onGenerate={() => void handleGenerate()}
          />

          <p className='text-muted-foreground text-center text-xs'>
            <Link to='/docs' className='hover:underline'>
              {t('View upload guidelines')}
            </Link>
            {' · '}
            <Link to='/user-agreement' className='hover:underline'>
              {t('Disclaimer')}
            </Link>
          </p>
        </div>

        <ResultPanel
          phase={phase}
          results={results}
          error={error}
          count={config.count}
          onStartUpload={focusUploads}
          idleTitle={t('Turn garment photos into studio-grade fashion designs')}
          idleDescription={t(
            'Pick a direction and template; the finished designs appear here.'
          )}
          idleSteps={idleSteps}
          loadingLabel={t('Generating fashion designs...')}
        />
      </div>

      <HistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        tasks={tasks}
        onRemove={(taskId) =>
          setTasks(removeTryOnTask(taskId, FASHION_DESIGN_STORAGE_KEY))
        }
        onClear={() => {
          clearTryOnTasks(FASHION_DESIGN_STORAGE_KEY)
          setTasks([])
        }}
      />
    </div>
  )
}
