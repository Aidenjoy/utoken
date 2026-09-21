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
import { Eraser, History, UserRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getUserModels } from '@/lib/api'
import { getModelCategory } from '@/lib/model-category'

import { generateTryOnImages } from './api'
import { ChipGroup } from './components/chip-group'
import { GenerateBar } from './components/generate-bar'
import { HistoryDialog } from './components/history-dialog'
import { NumberedHead } from './components/numbered-head'
import { ResultPanel, type ResultPhase } from './components/result-panel'
import { UploadTile } from './components/upload-tile'
import {
  createDefaultModelStudioConfig,
  MODEL_STUDIO_FACE_SLOT_IDS,
  MODEL_STUDIO_MODES,
  MODEL_STUDIO_STORAGE_KEY,
  TRY_ON_SIZES,
} from './constants'
import { buildModelStudioRequest } from './lib/prompt-model-studio'
import {
  clearTryOnTasks,
  loadTryOnTasks,
  removeTryOnTask,
  saveTryOnTask,
} from './lib/storage'
import type {
  ChipOption,
  ModelStudioConfig,
  ModelStudioMode,
  TryOnImage,
  TryOnTask,
} from './types'

/**
 * Dedicated model studio: portrait slots fuse into one stable person identity
 * (or an existing portrait is restyled / registered) for repeated reuse.
 */
export function ModelStudioPage() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<ModelStudioConfig>(
    createDefaultModelStudioConfig
  )
  const [phase, setPhase] = useState<ResultPhase>('idle')
  const [results, setResults] = useState<string[]>([])
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [tasks, setTasks] = useState<TryOnTask[]>(() =>
    loadTryOnTasks(MODEL_STUDIO_STORAGE_KEY)
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

  const faceImages = config.faces.filter(
    (item): item is TryOnImage => item !== null
  )
  const hasSources =
    config.mode === 'compose' ? faceImages.length > 0 : config.model !== null

  const persistTask = (prompt: string, urls: string[]) => {
    setTasks(
      saveTryOnTask(
        {
          id: `${Date.now()}`,
          createdAt: Date.now(),
          imageModel: config.imageModel,
          size: config.resolution,
          count: urls.length,
          prompt,
          results: urls,
          garmentThumbs: faceImages.slice(0, 3).map((item) => item.src),
          modelThumb:
            config.mode === 'compose'
              ? (faceImages[0]?.src ?? null)
              : (config.model?.src ?? null),
        },
        MODEL_STUDIO_STORAGE_KEY
      )
    )
  }

  const handleGenerate = async () => {
    if (!hasSources) {
      toast.error(t('Upload at least one portrait image'))
      return
    }
    if (config.mode === 'existing' && config.model) {
      const urls = [config.model.src]
      setResults(urls)
      setPhase('done')
      persistTask('', urls)
      toast.success(t('Model asset saved'))
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
        size: config.resolution,
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
      persistTask(request.prompt, urls)
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
  const modelOptions = imageModels.map((name) => ({ label: name, value: name }))
  const idleSteps = [
    t('Upload portraits'),
    t('Pick hairstyle and hair color'),
    t('Compose the model identity'),
  ]
  const studioSteps = [
    t('Upload portraits'),
    t('Lock the identity'),
    t('Reuse everywhere'),
  ]

  return (
    <div className='flex flex-col gap-4 p-4 lg:p-6'>
      <header className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex items-start gap-3'>
          <Badge variant='outline' className='mt-1 gap-1'>
            <UserRound className='size-3.5' />
            {t('Dedicated Model Workbench')}
          </Badge>
          <div>
            <h1 className='text-xl font-semibold'>{t('Dedicated Model')}</h1>
            <p className='text-muted-foreground text-sm'>
              {t('Identity assets, hairstyles and reuse')}
            </p>
          </div>
        </div>
        <Button
          variant='outline'
          size='sm'
          onClick={() => setHistoryOpen(true)}
        >
          <History className='size-4' />
          {t('History')}
        </Button>
      </header>

      <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
        <div>
          <p className='text-primary text-xs font-medium'>
            {t('Model Studio')}
          </p>
          <h2 className='mt-1 text-lg font-semibold'>{t('Dedicated Model')}</h2>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Keep one stable person asset for try-on, detail pages, short videos and brand content.'
            )}
          </p>
        </div>
        <div className='grid gap-2 sm:grid-cols-3'>
          {studioSteps.map((label, index) => (
            <div
              key={label}
              className='border-border bg-muted/50 rounded-lg border p-3'
            >
              <NumberedHead index={index + 1} title={label} />
            </div>
          ))}
        </div>
      </section>

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
              <Link to='/docs' className='text-primary text-xs hover:underline'>
                {t('View usage guidelines')}
              </Link>
            </div>
          </section>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            {config.mode === 'compose' ? (
              <>
                <div className='flex items-center justify-between gap-2'>
                  <span className='text-sm font-medium'>
                    {t('Upload 3 model images')}
                  </span>
                  <Button
                    variant='outline'
                    size='sm'
                    render={<Link to='/docs' />}
                  >
                    {t('View upload rules')}
                  </Button>
                </div>
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'Portraits must be chest-up shots with shoulders fully visible.'
                  )}
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
            ) : (
              <>
                <span className='text-sm font-medium'>
                  {config.mode === 'restyle'
                    ? t('Upload the model image')
                    : t('Upload existing model')}
                </span>
                {config.mode === 'existing' ? (
                  <p className='text-muted-foreground text-xs'>
                    {t('The portrait is registered as-is without generation.')}
                  </p>
                ) : null}
                <UploadTile
                  label={t('Model image')}
                  badge={t('Local upload')}
                  hint={t('Click or drag an image here')}
                  max={1}
                  value={config.model ? [config.model] : []}
                  onChange={(next) => update('model', next[0] ?? null)}
                />
              </>
            )}
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
              config.mode === 'existing' ? t('Save model asset') : undefined
            }
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
          idleTitle={t('Your dedicated model appears here')}
          idleDescription={t(
            'Compose a stable person identity once and reuse it across try-on, detail pages and videos.'
          )}
          idleSteps={idleSteps}
          loadingLabel={t('Composing the model...')}
        />
      </div>

      <HistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        tasks={tasks}
        onRemove={(taskId) =>
          setTasks(removeTryOnTask(taskId, MODEL_STUDIO_STORAGE_KEY))
        }
        onClear={() => {
          clearTryOnTasks(MODEL_STUDIO_STORAGE_KEY)
          setTasks([])
        }}
      />
    </div>
  )
}
