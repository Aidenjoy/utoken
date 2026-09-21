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
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { getUserModels } from '@/lib/api'
import { getModelCategory } from '@/lib/model-category'

import { generateTryOnImages } from './api'
import { ChipGroup } from './components/chip-group'
import { GenerateBar } from './components/generate-bar'
import { HistoryDialog } from './components/history-dialog'
import { ResolutionCards } from './components/resolution-cards'
import { ResultPanel, type ResultPhase } from './components/result-panel'
import { UploadTile } from './components/upload-tile'
import {
  createDefaultHeroImageConfig,
  HERO_CONTENT_ELEMENTS,
  HERO_IMAGE_STORAGE_KEY,
  HERO_OUTPUT_MODES,
  HERO_PERSON_MODES,
  TRY_ON_EXPRESSIONS,
  TRY_ON_ORIENTATIONS,
  TRY_ON_POSES,
  TRY_ON_RATIOS,
} from './constants'
import { buildHeroImageRequest } from './lib/prompt-hero'
import {
  clearTryOnTasks,
  loadTryOnTasks,
  removeTryOnTask,
  saveTryOnTask,
} from './lib/storage'
import type { ChipOption, HeroImageConfig, TryOnTask } from './types'

/**
 * Viral hero image workbench: product shots plus a hero content checklist
 * become high-click-rate e-commerce main visuals.
 */
export function HeroImagePage() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<HeroImageConfig>(
    createDefaultHeroImageConfig
  )
  const [phase, setPhase] = useState<ResultPhase>('idle')
  const [results, setResults] = useState<string[]>([])
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [tasks, setTasks] = useState<TryOnTask[]>(() =>
    loadTryOnTasks(HERO_IMAGE_STORAGE_KEY)
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

  const update = <K extends keyof HeroImageConfig>(
    key: K,
    value: HeroImageConfig[K]
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const toggleElement = (value: string, checked: boolean) => {
    setConfig((prev) => ({
      ...prev,
      elements: checked
        ? [...prev.elements, value]
        : prev.elements.filter((item) => item !== value),
    }))
  }

  const handleGenerate = async () => {
    if (config.products.length === 0) {
      toast.error(t('Upload at least one product image'))
      return
    }
    if (!config.imageModel) {
      toast.error(t('Select an image model'))
      return
    }
    const request = buildHeroImageRequest(config)
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
            garmentThumbs: config.products.slice(0, 3).map((item) => item.src),
            modelThumb: config.model?.src ?? null,
          },
          HERO_IMAGE_STORAGE_KEY
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
      ...createDefaultHeroImageConfig(),
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
    t('Upload product images'),
    t('Describe the product and pick hero elements'),
    t('Generate the hero image'),
  ]

  return (
    <div className='flex flex-col gap-4 p-4 lg:p-6'>
      <header className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex items-start gap-3'>
          <Badge variant='outline' className='mt-1 gap-1'>
            <Sparkles className='size-3.5' />
            {t('Product Visual Workbench')}
          </Badge>
          <div>
            <h1 className='text-xl font-semibold'>{t('Viral Hero Image')}</h1>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Upload product shots; AI reads visible features and generates high-click e-commerce hero images'
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
          <div>
            <Badge variant='secondary' className='gap-1.5 rounded-full'>
              <span className='bg-primary size-1.5 rounded-full' />
              {t('Viral Hero Image')}
            </Badge>
            <h2 className='mt-2 text-lg font-semibold'>
              {t('Product visual')}
            </h2>
          </div>

          <section className='border-border bg-card space-y-4 rounded-lg border p-4'>
            <UploadTile
              label={t('Product images (up to 3)')}
              badge={`${config.products.length}/3`}
              hint={t('Supports JPG, PNG, WEBP')}
              max={3}
              multiple
              value={config.products}
              onChange={(next) => update('products', next)}
            />
            <UploadTile
              label={t('Hero template reference (optional)')}
              badge={`${config.templates.length}/4`}
              hint={t(
                'Optional; multiple allowed. Only layout, composition, background and text zones are referenced.'
              )}
              max={4}
              multiple
              value={config.templates}
              onChange={(next) => update('templates', next)}
            />
          </section>

          <section className='border-border bg-card space-y-4 rounded-lg border p-4'>
            <div className='space-y-1.5'>
              <span className='text-sm font-medium'>
                {t('Product description')}
              </span>
              <Textarea
                rows={3}
                value={config.description}
                placeholder={t(
                  'e.g. Black glossy cup body with white letter logo and signature pattern on the front, shown with its box'
                )}
                onChange={(event) => update('description', event.target.value)}
              />
              <p className='text-muted-foreground text-xs'>
                {t(
                  'The generation uses this description as the hero copy basis; edit it freely before generating.'
                )}
              </p>
            </div>
            <div className='space-y-1.5'>
              <span className='text-sm font-medium'>
                {t('Extra requirements')}
              </span>
              <Textarea
                rows={2}
                value={config.extra}
                placeholder={t(
                  'e.g. Keep the lid complete, do not cover the front logo, use a light tech-feel background'
                )}
                onChange={(event) => update('extra', event.target.value)}
              />
            </div>
          </section>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <div>
              <span className='text-sm font-medium'>
                {t('Hero content elements')}
              </span>
              <p className='text-muted-foreground text-xs'>
                {t('Adjustable per product before generating')}
              </p>
            </div>
            <div className='grid gap-2 sm:grid-cols-3'>
              {HERO_CONTENT_ELEMENTS.map((element) => (
                <label
                  key={element.value}
                  className='flex items-center gap-2 text-sm'
                >
                  <Checkbox
                    checked={config.elements.includes(element.value)}
                    onCheckedChange={(checked) =>
                      toggleElement(element.value, checked === true)
                    }
                  />
                  <span>{t(element.label)}</span>
                </label>
              ))}
            </div>
          </section>

          <section className='border-border bg-card space-y-4 rounded-lg border p-4'>
            <ChipGroup
              label={t('Person handling')}
              options={tr(HERO_PERSON_MODES)}
              value={config.personMode}
              onChange={(value) =>
                update('personMode', value as HeroImageConfig['personMode'])
              }
            />
            {config.personMode === 'replace' ? (
              <UploadTile
                label={t('Model image')}
                badge={t('Optional')}
                hint={t(
                  'When no model is uploaded, AI generates one automatically.'
                )}
                max={1}
                value={config.model ? [config.model] : []}
                onChange={(next) => update('model', next[0] ?? null)}
              />
            ) : null}
            <ChipGroup
              label={t('Output mode')}
              options={tr(HERO_OUTPUT_MODES)}
              value={config.outputMode}
              onChange={(value) => update('outputMode', value)}
            />
            <div className='grid gap-3 sm:grid-cols-2'>
              <ChipGroup
                label={t('Body pose')}
                options={tr(TRY_ON_POSES)}
                value={config.pose}
                onChange={(value) => update('pose', value)}
              />
              <ChipGroup
                label={t('Facing')}
                options={tr(TRY_ON_ORIENTATIONS)}
                value={config.orientation}
                onChange={(value) => update('orientation', value)}
              />
            </div>
            <ChipGroup
              label={t('Model expression')}
              options={tr(TRY_ON_EXPRESSIONS)}
              value={config.expression}
              onChange={(value) => update('expression', value)}
            />
            <div className='space-y-1.5'>
              <span className='text-sm font-medium'>
                {t('Extra action notes for the model')}
              </span>
              <Textarea
                rows={2}
                value={config.actionNote}
                placeholder={t(
                  'e.g. Right hand naturally holds the product, product front faces the lens, eyes on the product'
                )}
                onChange={(event) => update('actionNote', event.target.value)}
              />
            </div>
            <UploadTile
              label={t('Pose reference images')}
              badge={t('Optional')}
              hint={t(
                'Optional; multiple allowed. Actions and framing are matched randomly; without them AI composes freely.'
              )}
              max={4}
              multiple
              value={config.actions}
              onChange={(next) => update('actions', next)}
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
              {t('Each run generates {{count}} images.', {
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
            disabled={config.products.length === 0}
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
          idleTitle={t('Turn product shots into high-click hero images')}
          idleDescription={t(
            'Upload product images and describe the product; the finished hero visual appears here.'
          )}
          idleSteps={idleSteps}
          loadingLabel={t('Generating hero images...')}
        />
      </div>

      <HistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        tasks={tasks}
        onRemove={(taskId) =>
          setTasks(removeTryOnTask(taskId, HERO_IMAGE_STORAGE_KEY))
        }
        onClear={() => {
          clearTryOnTasks(HERO_IMAGE_STORAGE_KEY)
          setTasks([])
        }}
      />
    </div>
  )
}
