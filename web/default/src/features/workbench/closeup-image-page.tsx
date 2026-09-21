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
import { Eraser, History, LayoutGrid, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { getUserModels } from '@/lib/api'
import { getModelCategory } from '@/lib/model-category'

import { generateTryOnImages } from './api'
import { ChipGroup } from './components/chip-group'
import { GenerateBar } from './components/generate-bar'
import { HistoryDialog } from './components/history-dialog'
import { NumberedHead } from './components/numbered-head'
import { ResolutionCards } from './components/resolution-cards'
import { ResultPanel, type ResultPhase } from './components/result-panel'
import { UploadTile } from './components/upload-tile'
import {
  CLOSE_UP_GEN_MODES,
  CLOSE_UP_OUTPUT_MODES,
  CLOSE_UP_PARTS,
  CLOSE_UP_SHOT_MODES,
  CLOSE_UP_STORAGE_KEY,
  createDefaultCloseUpConfig,
  TRY_ON_RATIOS,
} from './constants'
import { buildCloseUpRequest } from './lib/prompt-closeup'
import {
  clearTryOnTasks,
  loadTryOnTasks,
  removeTryOnTask,
  saveTryOnTask,
} from './lib/storage'
import type { ChipOption, CloseUpConfig, TryOnImage, TryOnTask } from './types'

/**
 * Garment close-up workbench: garment views (or one flat/3D shot) plus detail
 * references and picked parts become crisp part-level e-commerce close-ups.
 */
export function CloseUpImagePage() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<CloseUpConfig>(
    createDefaultCloseUpConfig
  )
  const [phase, setPhase] = useState<ResultPhase>('idle')
  const [results, setResults] = useState<string[]>([])
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [tasks, setTasks] = useState<TryOnTask[]>(() =>
    loadTryOnTasks(CLOSE_UP_STORAGE_KEY)
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

  const update = <K extends keyof CloseUpConfig>(
    key: K,
    value: CloseUpConfig[K]
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const togglePart = (value: string) => {
    setConfig((prev) => ({
      ...prev,
      parts: prev.parts.includes(value)
        ? prev.parts.filter((item) => item !== value)
        : [...prev.parts, value],
    }))
  }

  const garmentImages = useMemo(() => {
    if (config.shotMode === 'position') {
      return [config.front, config.side, config.back].filter(
        (item): item is TryOnImage => item !== null
      )
    }
    return config.garment ? [config.garment] : []
  }, [config.shotMode, config.front, config.side, config.back, config.garment])

  const hasSources = garmentImages.length > 0 || config.references.length > 0

  const handleGenerate = async () => {
    if (!hasSources) {
      toast.error(t('Upload at least one garment or reference image'))
      return
    }
    if (!config.imageModel) {
      toast.error(t('Select an image model'))
      return
    }
    const request = buildCloseUpRequest(config)
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
      setTasks(
        saveTryOnTask(
          {
            id: `${Date.now()}`,
            createdAt: Date.now(),
            imageModel: config.imageModel,
            size: config.resolution,
            count: urls.length,
            prompt: request.prompt,
            results: urls,
            garmentThumbs: garmentImages.slice(0, 3).map((item) => item.src),
            modelThumb: config.model?.src ?? null,
          },
          CLOSE_UP_STORAGE_KEY
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
      ...createDefaultCloseUpConfig(),
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
    t('Upload garment views'),
    t('Pick detail parts and output mode'),
    t('Generate the close-ups'),
  ]

  const singleTile = (
    key: 'front' | 'side' | 'back' | 'garment',
    label: string
  ) => (
    <UploadTile
      label={label}
      badge={t('Local upload')}
      hint={t('Click or drag an image here')}
      max={1}
      value={config[key] ? [config[key] as TryOnImage] : []}
      onChange={(next) => update(key, next[0] ?? null)}
    />
  )

  return (
    <div className='flex flex-col gap-4 p-4 lg:p-6'>
      <header className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex items-start gap-3'>
          <Badge variant='outline' className='mt-1 gap-1'>
            <Sparkles className='size-3.5' />
            {t('Product Visual Workbench')}
          </Badge>
          <div>
            <h1 className='text-xl font-semibold'>{t('Detail Images')}</h1>
            <p className='text-muted-foreground text-sm'>
              {t('Upload, generation and preview stay in sync')}
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
          <div>
            <p className='text-primary text-xs font-medium'>
              {t('Viral Hero Image')}
            </p>
            <h2 className='mt-1 text-lg font-semibold'>
              {t('Garment close-ups')}
            </h2>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Pick garment views, detail parts and output mode to render crisp close-ups.'
              )}
            </p>
          </div>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <div className='bg-muted grid grid-cols-3 gap-1 rounded-lg p-1'>
              {tr(CLOSE_UP_SHOT_MODES).map((option) => {
                const selected = option.value === config.shotMode
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
                      update(
                        'shotMode',
                        option.value as CloseUpConfig['shotMode']
                      )
                    }
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            {config.shotMode === 'position' ? (
              <div className='grid gap-3 sm:grid-cols-3'>
                {singleTile('front', t('Front'))}
                {singleTile('side', t('Side'))}
                {singleTile('back', t('Back view'))}
              </div>
            ) : (
              singleTile('garment', t('Upload garment views'))
            )}
          </section>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <span className='text-sm font-medium'>
              {t('Upload detail reference images')}
            </span>
            <UploadTile
              label={t('Upload detail reference images')}
              badge={`${config.references.length}/3`}
              hint={t('Click or drag an image here')}
              max={3}
              multiple
              value={config.references}
              onChange={(next) => update('references', next)}
            />
          </section>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <div className='space-y-1'>
              <span className='text-sm font-medium'>{t('Detail parts')}</span>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Multiple picks allowed; one image shows these garment parts first, otherwise the references decide.'
                )}
              </p>
            </div>
            <div className='grid gap-2 sm:grid-cols-3'>
              {tr(CLOSE_UP_PARTS).map((part) => {
                const selected = config.parts.includes(part.value)
                return (
                  <button
                    key={part.value}
                    type='button'
                    aria-pressed={selected}
                    className={`rounded-md border py-2 text-sm transition-colors ${
                      selected
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-primary/40'
                    }`}
                    onClick={() => togglePart(part.value)}
                  >
                    {part.label}
                  </button>
                )
              })}
            </div>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Common picks: neck / collar, cuff, hem, shoulder, back panel, print / pattern, fabric texture.'
              )}
            </p>
          </section>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <ChipGroup
              label={t('Output method')}
              options={tr(CLOSE_UP_OUTPUT_MODES)}
              value={config.outputMode}
              onChange={(value) => update('outputMode', value)}
            />
            <p className='text-muted-foreground text-xs'>
              {t(
                'Pure white background by default; scenes, titles and captions from the references are not replicated.'
              )}
            </p>
            <ChipGroup
              label={t('Generation method')}
              options={tr(CLOSE_UP_GEN_MODES)}
              value={config.genMode}
              onChange={(value) => update('genMode', value)}
            />
            <p className='text-muted-foreground text-xs'>
              {t(
                'Independent generation: without picked parts the references decide.'
              )}
            </p>
          </section>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <NumberedHead
              index={1}
              title={t('Model try-on on the reference')}
            />
            <p className='text-muted-foreground text-xs'>
              {t(
                'If the reference shows a model, provide the model image for the try-on.'
              )}
            </p>
            <UploadTile
              label={t('Model image')}
              badge={t('Optional')}
              hint={t(
                'Optional; without a model image AI follows the reference.'
              )}
              max={1}
              value={config.model ? [config.model] : []}
              onChange={(next) => update('model', next[0] ?? null)}
            />
          </section>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <NumberedHead index={2} title={t('Edit copy')} />
            <div className='space-y-1.5'>
              <span className='text-sm font-medium'>{t('Extra content')}</span>
              <Textarea
                rows={4}
                value={config.note}
                placeholder={t(
                  'e.g. Highlight the cuff stitching and fabric texture, keep the white background clean.'
                )}
                onChange={(event) => update('note', event.target.value)}
              />
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Extra content is filled by the merchant; it is not a prompt.'
                )}
              </p>
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
              {t(
                'Each reference image generates {{count}} e-commerce shot(s).',
                {
                  count: config.count,
                }
              )}
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
            disabled={!hasSources}
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
          idleTitle={t('Garment details in crisp close-ups')}
          idleDescription={t(
            'Upload garment views and detail references; the finished close-ups appear here.'
          )}
          idleSteps={idleSteps}
          loadingLabel={t('Generating close-ups...')}
        />
      </div>

      <HistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        tasks={tasks}
        onRemove={(taskId) =>
          setTasks(removeTryOnTask(taskId, CLOSE_UP_STORAGE_KEY))
        }
        onClear={() => {
          clearTryOnTasks(CLOSE_UP_STORAGE_KEY)
          setTasks([])
        }}
      />
    </div>
  )
}
