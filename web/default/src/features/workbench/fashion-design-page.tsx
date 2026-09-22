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
import { Eraser, LayoutGrid } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SECTION_PAGE_TITLE_CLASS } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { getUserModels } from '@/lib/api'
import { getModelCategory } from '@/lib/model-category'

import { generateTryOnImages } from './api'
import { ChipGroup } from './components/chip-group'
import {
  FashionPresetPreview,
  FashionShowcase,
} from './components/fashion-showcase'
import { GenerateBar } from './components/generate-bar'
import { ResultPanel, type ResultPhase } from './components/result-panel'
import { SegmentBar } from './components/segment-bar'
import { UploadTile } from './components/upload-tile'
import {
  createDefaultFashionDesignConfig,
  FASHION_DIRECTIONS,
  FASHION_PRESETS,
  fashionInputsFor,
  TRY_ON_RATIOS,
  TRY_ON_SIZES,
} from './constants'
import { buildImageSize } from './lib/image-size'
import { buildFashionRequest } from './lib/prompt-fashion'
import { saveGenerationToLibrary } from './lib/save-to-library'
import type {
  ChipOption,
  FashionDesignConfig,
  FashionDirection,
  TryOnImage,
} from './types'

/**
 * Fashion design workbench: garment, fabric, reference and line-art materials
 * plus a direction template become studio-grade fashion renders.
 */
export function FashionDesignPage() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<FashionDesignConfig>(
    createDefaultFashionDesignConfig
  )
  const [phase, setPhase] = useState<ResultPhase>('idle')
  const [results, setResults] = useState<string[]>([])
  const [error, setError] = useState('')
  const isLoading = phase === 'loading'

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
    if (isLoading) return
    setConfig((prev) => ({ ...prev, [key]: value }))
    if (key === 'preset' && value !== config.preset) {
      setPhase('idle')
      setResults([])
      setError('')
    }
  }

  const updateSlot = (key: string, next: TryOnImage[]) => {
    if (isLoading) return
    setConfig((prev) => ({
      ...prev,
      images: { ...prev.images, [key]: next },
    }))
  }

  const changeDirection = (value: string) => {
    if (isLoading || value === config.direction) return
    const direction = value as FashionDirection
    const firstPreset = FASHION_PRESETS[direction]?.[0]?.value ?? ''
    setConfig((prev) => ({ ...prev, direction, preset: firstPreset }))
    setPhase('idle')
    setResults([])
    setError('')
  }

  const isFreeText = config.direction === 'free'
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
    if (isLoading) return
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
    const requests = [buildFashionRequest(config, preset)]
    setPhase('loading')
    setError('')
    setResults([])
    try {
      const urls: string[] = []
      for (const request of requests) {
        const response = await generateTryOnImages({
          model: config.imageModel,
          prompt: request.prompt,
          size: buildImageSize(config.resolution, config.ratio),
          n: config.count,
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
      void saveGenerationToLibrary(
        'viral-design',
        t('Fashion Design'),
        urls,
        [...new Set(requests.flatMap((request) => request.images))],
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
    if (isLoading) return
    setConfig((prev) => ({
      ...createDefaultFashionDesignConfig(),
      imageModel: prev.imageModel,
    }))
    setPhase('idle')
    setResults([])
    setError('')
  }

  const tr = (options: ChipOption[]) =>
    options.map((option) => ({ ...option, label: t(option.label) }))
  const resolutionOptions = TRY_ON_SIZES.map((size) => ({
    label: size,
    value: size,
  }))
  const ratioOptions = TRY_ON_RATIOS.map((option) => ({
    ...option,
    label: option.value === 'smart' ? t('Smart') : option.label,
  }))
  const modeHint = t(
    'No template: the design description below drives the run.'
  )
  const modelOptions = imageModels.map((name) => ({ label: name, value: name }))

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4 p-4 lg:p-6'>
      <header className='flex flex-wrap items-center justify-between gap-3'>
        <h1 className={SECTION_PAGE_TITLE_CLASS}>{t('Fashion Design')}</h1>
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
          disabled={isLoading}
          className='min-w-0 space-y-3 xl:min-h-0 xl:overflow-y-auto'
        >
          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <SegmentBar
              label={t('Design direction')}
              options={tr(FASHION_DIRECTIONS)}
              value={config.direction}
              onChange={changeDirection}
            />
            {isFreeText ? (
              <p className='text-muted-foreground text-xs'>{modeHint}</p>
            ) : (
              <div
                className={
                  config.direction === 'redesign' ||
                  config.direction === 'new' ||
                  config.direction === 'series' ||
                  config.direction === 'pattern'
                    ? 'grid gap-2 min-[360px]:grid-cols-2 sm:grid-cols-3'
                    : 'grid gap-2 sm:grid-cols-2'
                }
              >
                {presets.map((item) => {
                  const selected = item.value === config.preset
                  return (
                    <button
                      key={item.value}
                      type='button'
                      aria-pressed={selected}
                      className={`focus-visible:ring-ring min-w-0 rounded-lg border p-2 text-left transition-colors outline-none focus-visible:ring-2 disabled:opacity-50 ${
                        selected
                          ? 'border-primary bg-primary/5 ring-primary/30 ring-1'
                          : 'border-border hover:border-primary/40'
                      }`}
                      onClick={() => update('preset', item.value)}
                    >
                      <div className='mb-2 flex flex-wrap items-start justify-between gap-1.5'>
                        <span className='text-xs leading-5 font-medium sm:text-sm'>
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
                      <FashionPresetPreview preset={item} />
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <span className='text-sm font-medium'>{t('Materials')}</span>
            <div
              className={
                inputs.length > 1 ? 'grid gap-3 sm:grid-cols-2' : 'grid gap-3'
              }
            >
              {inputs.map((input) => (
                <UploadTile
                  key={input.key}
                  label={t(input.label)}
                  badge={input.required ? t('Required') : t('Optional')}
                  max={input.max}
                  multiple={input.max > 1}
                  disabled={isLoading}
                  value={config.images[input.key]}
                  onChange={(next) => updateSlot(input.key, next)}
                />
              ))}
            </div>
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
              <label
                htmlFor='fashion-design-description'
                className='text-sm font-medium'
              >
                {t('Design description')}
                {needsDescription ? null : (
                  <span className='text-muted-foreground ml-1 text-xs'>
                    {t('Optional')}
                  </span>
                )}
              </label>
              <Textarea
                id='fashion-design-description'
                rows={3}
                value={config.description}
                placeholder={t(
                  'Describe the change, e.g. turn the round neck into a V-neck and add puff sleeves'
                )}
                onChange={(event) => update('description', event.target.value)}
              />
            </div>
          </section>

          <section className='border-border bg-card flex flex-col gap-4 rounded-lg border p-4'>
            <ChipGroup
              label={t('Resolution')}
              options={resolutionOptions}
              value={config.resolution}
              onChange={(value) => update('resolution', value)}
            />
            <ChipGroup
              label={t('Aspect ratio')}
              options={ratioOptions}
              value={config.ratio}
              onChange={(value) => update('ratio', value)}
            />
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
            loading={isLoading}
            disabled={missingRequired.length > 0}
            onGenerate={() => void handleGenerate()}
          />
        </fieldset>

        <div className='flex min-w-0 flex-col xl:min-h-0 xl:overflow-y-auto'>
          {phase === 'idle' ? (
            <FashionShowcase preset={preset} />
          ) : (
            <ResultPanel
              phase={phase}
              results={results}
              error={error}
              count={config.count}
              loadingLabel={t('Generating fashion designs...')}
            />
          )}
        </div>
      </div>
    </div>
  )
}
