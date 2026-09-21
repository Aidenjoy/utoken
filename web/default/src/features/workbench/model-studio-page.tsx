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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SECTION_PAGE_TITLE_CLASS } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { getUserModels } from '@/lib/api'
import { getModelCategory } from '@/lib/model-category'

import { generateTryOnImages } from './api'
import { ChipGroup } from './components/chip-group'
import { GenerateBar } from './components/generate-bar'
import { ResultPanel, type ResultPhase } from './components/result-panel'
import { StudioShowcase } from './components/studio-showcase'
import { UploadTile } from './components/upload-tile'
import {
  createDefaultModelStudioConfig,
  MODEL_STUDIO_FACE_SLOT_IDS,
  MODEL_STUDIO_MODES,
  MODEL_STUDIO_VIEW_SLOTS,
  TRY_ON_RATIOS,
  TRY_ON_SIZES,
} from './constants'
import { buildImageSize } from './lib/image-size'
import { buildModelStudioRequest } from './lib/prompt-model-studio'
import { saveGenerationToLibrary } from './lib/save-to-library'
import type {
  ChipOption,
  ModelStudioConfig,
  ModelStudioMode,
  TryOnImage,
} from './types'

/**
 * Dedicated model studio: portrait slots fuse into one stable person identity
 * (or multi-view uploads synthesize a full-body model / an existing portrait
 * is restyled) for repeated reuse.
 */
export function ModelStudioPage() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<ModelStudioConfig>(
    createDefaultModelStudioConfig
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

  const update = <K extends keyof ModelStudioConfig>(
    key: K,
    value: ModelStudioConfig[K]
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const setFace = (index: number, image: TryOnImage | null) => {
    setConfig((prev) => {
      const faces = [...prev.faces]
      faces[index] = image
      return { ...prev, faces }
    })
  }

  const setView = (index: number, image: TryOnImage | null) => {
    setConfig((prev) => {
      const views = [...prev.views]
      views[index] = image
      return { ...prev, views }
    })
  }

  const faceImages = config.faces.filter(
    (item): item is TryOnImage => item !== null
  )
  let hasSources = config.model !== null
  if (config.mode === 'compose') {
    hasSources = faceImages.length > 0
  } else if (config.mode === 'existing') {
    hasSources = config.views.every((view) => view !== null)
  }

  const handleGenerate = async () => {
    if (!hasSources) {
      toast.error(
        config.mode === 'existing'
          ? t('Upload the front, left-side and right-side images first')
          : t('Upload at least one portrait image')
      )
      return
    }
    if (!config.imageModel) {
      toast.error(t('Select an image model'))
      return
    }
    const request = buildModelStudioRequest(config)
    setPhase('loading')
    setError('')
    try {
      const response = await generateTryOnImages({
        model: config.imageModel,
        prompt: request.prompt,
        size: buildImageSize(config.resolution, config.ratio),
        n: config.count,
        watermark: false,
        image: request.images.length === 1 ? request.images[0] : request.images,
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
        'try-on',
        t('Dedicated Model'),
        urls,
        request.images,
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
      ...createDefaultModelStudioConfig(),
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
  const resolutionOptions = TRY_ON_SIZES.map((size) => ({
    label: size,
    value: size,
  }))
  const ratioOptions = TRY_ON_RATIOS.map((option) => ({
    ...option,
    label: option.value === 'smart' ? t('Smart') : option.label,
  }))
  const modelOptions = imageModels.map((name) => ({ label: name, value: name }))

  let uploadSection: ReactNode
  if (config.mode === 'compose') {
    uploadSection = (
      <>
        <span className='text-sm font-medium'>
          {t('Upload 3 model images')}
        </span>
        <p className='text-muted-foreground text-xs'>
          {t('Portraits must be chest-up shots with shoulders fully visible.')}
        </p>
        <div className='grid gap-3 sm:grid-cols-3'>
          {MODEL_STUDIO_FACE_SLOT_IDS.map((slotId, index) => {
            const face = config.faces[index]
            return (
              <UploadTile
                key={slotId}
                label={t('Upload portrait {{index}}', {
                  index: index + 1,
                })}
                badge={t('Local upload')}
                hint={t('Click or drag an image here')}
                max={1}
                value={face ? [face] : []}
                onChange={(next) => setFace(index, next[0] ?? null)}
              />
            )
          })}
        </div>
      </>
    )
  } else if (config.mode === 'existing') {
    uploadSection = (
      <>
        <span className='text-sm font-medium'>
          {t('Upload three-view model images')}
        </span>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Upload front, left-side and right-side images in order; the next slot unlocks automatically.'
          )}
        </p>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Images must be at least 1024 px and visually clear, of the same model with identical hairstyle and makeup, and the face must be clear and unobstructed.'
          )}
        </p>
        <div className='grid gap-3 sm:grid-cols-3'>
          {MODEL_STUDIO_VIEW_SLOTS.map((slot, index) => {
            const view = config.views[index]
            const locked = index > 0 && !config.views[index - 1]
            return (
              <UploadTile
                key={slot.id}
                label={`${index + 1}. ${t(slot.label)}`}
                hint={
                  locked
                    ? t('Complete the previous angle image first')
                    : t(slot.hint)
                }
                max={1}
                disabled={locked}
                value={view ? [view] : []}
                onChange={(next) => setView(index, next[0] ?? null)}
              />
            )
          })}
        </div>
      </>
    )
  } else {
    uploadSection = (
      <>
        <span className='text-sm font-medium'>
          {t('Upload the model image')}
        </span>
        <UploadTile
          label={t('Model image')}
          badge={t('Local upload')}
          hint={t('Click or drag an image here')}
          max={1}
          value={config.model ? [config.model] : []}
          onChange={(next) => update('model', next[0] ?? null)}
        />
      </>
    )
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:p-6'>
      <header className='flex flex-wrap items-center justify-between gap-3'>
        <h1 className={SECTION_PAGE_TITLE_CLASS}>{t('Dedicated Model')}</h1>
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
          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <div className='bg-muted grid grid-cols-3 gap-1 rounded-lg p-1'>
              {tr(MODEL_STUDIO_MODES).map((option) => {
                const selected = option.value === config.mode
                return (
                  <button
                    key={option.value}
                    type='button'
                    aria-pressed={selected}
                    className={`rounded-md py-2 text-sm transition-colors ${
                      selected
                        ? 'bg-primary text-primary-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() =>
                      update('mode', option.value as ModelStudioMode)
                    }
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            <div className='bg-muted flex flex-wrap items-center justify-between gap-2 rounded-md p-2'>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Please confirm you hold legal authorization for the portraits used.'
                )}
              </p>
            </div>
          </section>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            {uploadSection}
          </section>

          {config.mode === 'existing' ? null : (
            <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
              <div className='space-y-1'>
                <span className='text-sm font-medium'>
                  {t('Pick hairstyle and hair color')}
                </span>
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'When unspecified, hairstyle and hair color are inferred automatically.'
                  )}
                </p>
              </div>
              <div className='grid gap-3 sm:grid-cols-2'>
                <UploadTile
                  label={t('Change hairstyle')}
                  badge={t('Not required')}
                  hint={t('Click or drag an image here')}
                  max={1}
                  value={config.hairStyle ? [config.hairStyle] : []}
                  onChange={(next) => update('hairStyle', next[0] ?? null)}
                />
                <UploadTile
                  label={t('Change hair color')}
                  badge={t('Not required')}
                  hint={t('Click or drag an image here')}
                  max={1}
                  value={config.hairColor ? [config.hairColor] : []}
                  onChange={(next) => update('hairColor', next[0] ?? null)}
                />
              </div>
            </section>
          )}

          <section className='border-border bg-card space-y-4 rounded-lg border p-4'>
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
            loading={phase === 'loading'}
            disabled={!hasSources}
            generateLabel={
              config.mode === 'existing'
                ? t('Compose full-body model')
                : undefined
            }
            onGenerate={() => void handleGenerate()}
          />
        </div>

        {phase === 'idle' ? (
          <StudioShowcase mode={config.mode} />
        ) : (
          <ResultPanel
            phase={phase}
            results={results}
            error={error}
            count={config.count}
            onStartUpload={focusUploads}
            loadingLabel={t('Composing the model...')}
          />
        )}
      </div>
    </div>
  )
}
