import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ChevronDown,
  ChevronUp,
  History,
  LayoutGrid,
  Loader2,
  Store,
} from 'lucide-react'
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

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getUserModels } from '@/lib/api'
import { getModelCategory } from '@/lib/model-category'

import { generateTryOnImages } from './api'
import { HistoryDialog } from './components/history-dialog'
import { ResultPanel, type ResultPhase } from './components/result-panel'
import { UploadTile } from './components/upload-tile'
import {
  ACTION_MAX,
  createDefaultTryOnConfig,
  GARMENT_PLUS_DETAIL_MAX,
  REFERENCE_MAX,
  TRY_ON_COUNTS,
  TRY_ON_SIZES,
} from './constants'
import { buildTryOnRequest } from './lib/prompt'
import {
  clearTryOnTasks,
  loadTryOnTasks,
  removeTryOnTask,
  saveTryOnTask,
} from './lib/storage'
import type { TryOnConfig, TryOnTask } from './types'

/**
 * Free try-on workbench: upload garment/model/pose materials on the left,
 * generation results on the right. One page per try-on product line; this is
 * the single-garment "free" variant.
 */
export function TryOnPage() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<TryOnConfig>(createDefaultTryOnConfig)
  const [uploadsOpen, setUploadsOpen] = useState(true)
  const [phase, setPhase] = useState<ResultPhase>('idle')
  const [results, setResults] = useState<string[]>([])
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [tasks, setTasks] = useState<TryOnTask[]>(() => loadTryOnTasks())
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

  const update = <K extends keyof TryOnConfig>(
    key: K,
    value: TryOnConfig[K]
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const garmentBudgetLeft =
    GARMENT_PLUS_DETAIL_MAX - config.garments.length - config.details.length

  const handleGenerate = async () => {
    if (config.garments.length === 0) {
      toast.error(t('Upload at least one garment image'))
      return
    }
    if (!config.imageModel) {
      toast.error(t('Select an image model'))
      return
    }
    const { prompt, images } = buildTryOnRequest(config)
    setPhase('loading')
    setError('')
    try {
      const response = await generateTryOnImages({
        model: config.imageModel,
        prompt,
        size: config.size,
        n: config.count,
        watermark: false,
        image: images.length === 1 ? images[0] : images,
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
        saveTryOnTask({
          id: `${Date.now()}`,
          createdAt: Date.now(),
          imageModel: config.imageModel,
          size: config.size,
          count: config.count,
          prompt,
          results: urls,
          garmentThumbs: config.garments.slice(0, 3).map((item) => item.src),
          modelThumb: config.model?.src ?? null,
        })
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

  const focusUploads = () => {
    setUploadsOpen(true)
    uploadsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const summaryThumbs = [
    ...(config.model ? [config.model] : []),
    ...config.garments,
    ...config.references,
  ].slice(0, 6)

  const sizeOptions = TRY_ON_SIZES.map((size) => ({
    label: size,
    value: size,
  }))
  const countOptions = TRY_ON_COUNTS.map((count) => ({
    label: String(count),
    value: String(count),
  }))
  const modelOptions = imageModels.map((name) => ({
    label: name,
    value: name,
  }))

  return (
    <div className='flex flex-col gap-4 p-4 lg:p-6'>
      <header className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex items-start gap-3'>
          <Badge variant='outline' className='mt-1 gap-1'>
            <Store className='size-3.5' />
            {t('Product Visual Workbench')}
          </Badge>
          <div>
            <h1 className='text-xl font-semibold'>{t('Free Try-On')}</h1>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Upload garment images, describe the need, generate professional commercial shots in one click'
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
          <section className='border-border bg-card rounded-lg border'>
            <div className='border-border flex items-center justify-between border-b px-4 py-3'>
              <h2 className='text-sm font-semibold'>{t('Upload images')}</h2>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setUploadsOpen((open) => !open)}
              >
                {uploadsOpen ? (
                  <ChevronUp className='size-4' />
                ) : (
                  <ChevronDown className='size-4' />
                )}
                {uploadsOpen ? t('Collapse') : t('Expand')}
              </Button>
            </div>
            {uploadsOpen ? (
              <div className='space-y-3 p-4'>
                <UploadTile
                  label={t('Reference images')}
                  badge={t('Optional')}
                  hint={t(
                    'Pick several at once; each reference or pose image yields one more output, matched at random. Without pose images the reference composition is used.'
                  )}
                  max={REFERENCE_MAX}
                  multiple
                  value={config.references}
                  onChange={(next) => update('references', next)}
                />
                <UploadTile
                  label={t('Garment images')}
                  badge={t('Garment + detail up to 10 images')}
                  hint={t(
                    'Front and back shots of the garment on a plain background work best.'
                  )}
                  max={Math.max(garmentBudgetLeft, 0)}
                  multiple
                  value={config.garments}
                  onChange={(next) => update('garments', next)}
                />
                <div className='flex items-center gap-2 px-1'>
                  <span className='text-muted-foreground shrink-0 text-sm'>
                    {t('Garment name')}
                  </span>
                  <Input
                    value={config.garmentName}
                    placeholder={t('Enter a garment name (optional)')}
                    onChange={(event) =>
                      update('garmentName', event.target.value)
                    }
                  />
                </div>
                <label className='flex items-center gap-2 px-1 text-sm'>
                  <Checkbox
                    checked={config.intimateApparel}
                    onCheckedChange={(checked) =>
                      update('intimateApparel', checked === true)
                    }
                  />
                  {t('The uploaded garment is underwear, swimwear or lingerie')}
                </label>
                <UploadTile
                  label={t('Detail images')}
                  badge={t('Optional')}
                  hint={t(
                    'Accessory, fabric or special-design close-ups raise output fidelity.'
                  )}
                  max={Math.max(garmentBudgetLeft, 0)}
                  multiple
                  value={config.details}
                  onChange={(next) => update('details', next)}
                />
                <UploadTile
                  label={t('Model image')}
                  badge={t('Soft-light frontal photos work best')}
                  max={1}
                  value={config.model ? [config.model] : []}
                  onChange={(next) => update('model', next[0] ?? null)}
                />
                <UploadTile
                  label={t('Pose reference images')}
                  badge={t('Optional')}
                  hint={t(
                    'Borrow pose and action only; without them the reference composition is used.'
                  )}
                  max={ACTION_MAX}
                  multiple
                  value={config.actions}
                  onChange={(next) => update('actions', next)}
                />
                <div className='space-y-2 px-1'>
                  <span className='text-sm font-medium'>
                    {t('Atmosphere source')}
                  </span>
                  <div className='bg-muted grid grid-cols-2 gap-1 rounded-md p-1'>
                    {(
                      [
                        ['reference', t('Reference images (scene)')],
                        ['action', t('Pose references (action only)')],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type='button'
                        aria-pressed={config.atmosphereSource === value}
                        className={`rounded px-3 py-1.5 text-sm ${
                          config.atmosphereSource === value
                            ? 'bg-background font-medium shadow-sm'
                            : 'text-muted-foreground'
                        }`}
                        onClick={() => update('atmosphereSource', value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className='flex items-start gap-2 px-1 text-sm'>
                  <Checkbox
                    checked={config.naturalVariation}
                    onCheckedChange={(checked) =>
                      update('naturalVariation', checked === true)
                    }
                  />
                  <span>
                    <span className='font-medium'>
                      {t('Natural pose and expression variation')}
                    </span>
                    <span className='text-muted-foreground block text-xs'>
                      {t(
                        'When on, pose and expression must differ naturally from the base images; when off, the base framing is reproduced strictly.'
                      )}
                    </span>
                  </span>
                </label>
              </div>
            ) : null}
          </section>

          <section className='border-border bg-card flex items-center gap-3 rounded-lg border p-3'>
            <div className='flex gap-2'>
              {summaryThumbs.map((item, index) => (
                <div
                  key={item.id}
                  className='border-border relative size-12 overflow-hidden rounded-md border'
                >
                  <img
                    src={item.src}
                    alt=''
                    className='size-full object-cover'
                  />
                  <span className='absolute top-0.5 left-0.5 rounded bg-black/60 px-1 text-[10px] text-white'>
                    {index + 1}
                  </span>
                </div>
              ))}
            </div>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Garment: {{garment}}; person: {{person}}; roles fuse per the map above.',
                {
                  garment:
                    config.garments.length > 0
                      ? t('{{count}} uploaded', {
                          count: config.garments.length,
                        })
                      : t('pending upload'),
                  person: config.model ? t('uploaded') : t('system-matched'),
                }
              )}
            </p>
          </section>

          <section className='border-border bg-card flex flex-wrap items-center gap-2 rounded-lg border p-3'>
            <span className='text-sm font-medium'>{t('Image model')}</span>
            <Select
              items={modelOptions}
              value={config.imageModel}
              onValueChange={(value) => update('imageModel', value ?? '')}
            >
              <SelectTrigger className='w-44'>
                <SelectValue placeholder={t('Select an image model')} />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {modelOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              items={sizeOptions}
              value={config.size}
              onValueChange={(value) => update('size', value ?? config.size)}
            >
              <SelectTrigger className='w-24'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {sizeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              items={countOptions}
              value={String(config.count)}
              onValueChange={(value) =>
                update('count', Number(value ?? config.count))
              }
            >
              <SelectTrigger className='w-24'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {countOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              className='ml-auto'
              disabled={phase === 'loading'}
              onClick={() => void handleGenerate()}
            >
              {phase === 'loading' ? (
                <Loader2 className='size-4 animate-spin' />
              ) : null}
              {t('Generate images')}
            </Button>
          </section>

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
        />
      </div>

      <HistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        tasks={tasks}
        onRemove={(taskId) => setTasks(removeTryOnTask(taskId))}
        onClear={() => {
          clearTryOnTasks()
          setTasks([])
        }}
      />
    </div>
  )
}
