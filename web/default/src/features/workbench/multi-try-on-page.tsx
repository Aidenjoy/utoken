import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Eraser, History, LayoutGrid, Store } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { getUserModels } from '@/lib/api'
import { getModelCategory } from '@/lib/model-category'

import { generateTryOnImages } from './api'
import { ChipGroup } from './components/chip-group'
import { GenerateBar } from './components/generate-bar'
import { HistoryDialog } from './components/history-dialog'
import { ResolutionCards } from './components/resolution-cards'
import { ResultPanel, type ResultPhase } from './components/result-panel'
import { SegmentBar } from './components/segment-bar'
import { UploadTile } from './components/upload-tile'
import {
  ACTION_MAX,
  createDefaultMultiTryOnConfig,
  MULTI_AGE_GROUPS,
  MULTI_GENDERS,
  MULTI_SLOT_LABELS,
  MULTI_STRUCTURES,
  MULTI_TRY_ON_STORAGE_KEY,
  REFERENCE_MAX,
  TRY_ON_EXPRESSIONS,
  TRY_ON_ORIENTATIONS,
  TRY_ON_OUTPUT_MODES,
  TRY_ON_POSES,
  TRY_ON_RATIOS,
} from './constants'
import { buildMultiTryOnRequest } from './lib/prompt-multi'
import {
  clearTryOnTasks,
  loadTryOnTasks,
  removeTryOnTask,
  saveTryOnTask,
} from './lib/storage'
import type {
  ChipOption,
  MultiGarmentSlot,
  MultiTryOnConfig,
  TryOnImage,
  TryOnTask,
} from './types'

/**
 * Multi-garment try-on workbench: structured outfit slots (top+bottom,
 * inner+outer, 3-piece) plus category, pose and framing controls on the left,
 * generation results on the right.
 */
export function MultiTryOnPage() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<MultiTryOnConfig>(
    createDefaultMultiTryOnConfig
  )
  const [phase, setPhase] = useState<ResultPhase>('idle')
  const [results, setResults] = useState<string[]>([])
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [tasks, setTasks] = useState<TryOnTask[]>(() =>
    loadTryOnTasks(MULTI_TRY_ON_STORAGE_KEY)
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

  const update = <K extends keyof MultiTryOnConfig>(
    key: K,
    value: MultiTryOnConfig[K]
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const updateSlot = (slot: MultiGarmentSlot, image: TryOnImage | null) => {
    setConfig((prev) => ({ ...prev, slots: { ...prev.slots, [slot]: image } }))
  }

  const structure =
    MULTI_STRUCTURES.find((item) => item.value === config.structure) ??
    MULTI_STRUCTURES[0]
  const missingSlots = structure.slots.filter((slot) => !config.slots[slot])
  const referenceTotal = config.references.length + config.actions.length

  const handleGenerate = async () => {
    if (missingSlots.length > 0) {
      toast.error(t('Upload every garment slot for the selected structure'))
      return
    }
    if (!config.imageModel) {
      toast.error(t('Select an image model'))
      return
    }
    const { prompt, images } = buildMultiTryOnRequest(config)
    setPhase('loading')
    setError('')
    try {
      const response = await generateTryOnImages({
        model: config.imageModel,
        prompt,
        size: config.resolution,
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
        saveTryOnTask(
          {
            id: `${Date.now()}`,
            createdAt: Date.now(),
            imageModel: config.imageModel,
            size: config.resolution,
            count: config.count,
            prompt,
            results: urls,
            garmentThumbs: structure.slots
              .flatMap((slot) => {
                const image = config.slots[slot]
                return image ? [image.src] : []
              })
              .slice(0, 3),
            modelThumb: config.model?.src ?? null,
          },
          MULTI_TRY_ON_STORAGE_KEY
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
      ...createDefaultMultiTryOnConfig(),
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
  const structureOptions = tr(
    MULTI_STRUCTURES.map((item) => ({ value: item.value, label: item.label }))
  )
  const modelOptions = imageModels.map((name) => ({ label: name, value: name }))
  const idleSteps = [
    ...structure.slots.map((slot) => t(MULTI_SLOT_LABELS[slot])),
    t('Pick references and model'),
    t('Generate commercial shots'),
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
            <h1 className='text-xl font-semibold'>{t('Multi-Item Try-On')}</h1>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Combine several garment pieces into one complete styled look'
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
          <section className='border-border bg-card space-y-4 rounded-lg border p-4'>
            <div className='flex items-center gap-2'>
              <span className='text-muted-foreground shrink-0 text-sm'>
                {t('Garment name')}
              </span>
              <Input
                value={config.garmentName}
                placeholder={t('Enter a garment name (optional)')}
                onChange={(event) => update('garmentName', event.target.value)}
              />
            </div>
            <SegmentBar
              label={t('Outfit structure')}
              options={structureOptions}
              value={config.structure}
              onChange={(value) =>
                update('structure', value as MultiTryOnConfig['structure'])
              }
            />
            <div className='space-y-2'>
              <span className='text-sm font-medium'>
                {t(
                  'Upload garment real shots, combine multiple pieces in one generation'
                )}
              </span>
              <div className='grid gap-3 sm:grid-cols-2'>
                {structure.slots.map((slot) => {
                  const slotImage = config.slots[slot]
                  return (
                    <UploadTile
                      key={slot}
                      label={t(MULTI_SLOT_LABELS[slot])}
                      max={1}
                      value={slotImage ? [slotImage] : []}
                      onChange={(next) => updateSlot(slot, next[0] ?? null)}
                    />
                  )
                })}
              </div>
            </div>
            <ChipGroup
              label={t('Pick a category')}
              options={tr(MULTI_GENDERS)}
              value={config.gender}
              onChange={(value) => update('gender', value)}
            />
            <ChipGroup
              options={tr(MULTI_AGE_GROUPS)}
              value={config.ageGroup}
              onChange={(value) => update('ageGroup', value)}
            />
            <Textarea
              rows={2}
              value={config.description}
              placeholder={t(
                'Describe garment traits for more accurate length and color (optional)'
              )}
              onChange={(event) => update('description', event.target.value)}
            />
          </section>

          <section className='border-border bg-card rounded-lg border p-4'>
            <UploadTile
              label={t('Select reference images / scene')}
              badge={t('Optional')}
              hint={t(
                'Pick several at once; each reference or pose image yields one more output, matched at random. Without pose images the reference composition is used.'
              )}
              max={REFERENCE_MAX}
              multiple
              value={config.references}
              onChange={(next) => update('references', next)}
            />
          </section>

          <section className='border-border bg-card rounded-lg border p-4'>
            <UploadTile
              label={t('Select model (optional)')}
              badge={t('Soft-light frontal photos work best')}
              max={1}
              value={config.model ? [config.model] : []}
              onChange={(next) => update('model', next[0] ?? null)}
            />
          </section>

          <section className='border-border bg-card grid gap-4 rounded-lg border p-4 md:grid-cols-2'>
            <div className='space-y-3'>
              <ChipGroup
                label={t('Output mode')}
                options={tr(TRY_ON_OUTPUT_MODES)}
                value={config.outputMode}
                onChange={(value) => update('outputMode', value)}
              />
              <p className='text-muted-foreground text-xs'>
                {t('Recreate action, camera and background')}
              </p>
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
                  rows={3}
                  value={config.actionNote}
                  placeholder={t(
                    'e.g. hold the product naturally in the right hand, front facing the lens, eyes on the product'
                  )}
                  onChange={(event) => update('actionNote', event.target.value)}
                />
              </div>
            </div>
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
                'Selected {{total}} reference images; each run generates {{count}} shots.',
                {
                  total: referenceTotal,
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
            disabled={missingSlots.length > 0}
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
          idleTitle={t(
            'Upload multiple garments to generate a styled model shot'
          )}
          idleDescription={t(
            'Works for top + bottom, inner + outer and 3-piece set combinations.'
          )}
          idleSteps={idleSteps}
        />
      </div>

      <HistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        tasks={tasks}
        onRemove={(taskId) =>
          setTasks(removeTryOnTask(taskId, MULTI_TRY_ON_STORAGE_KEY))
        }
        onClear={() => {
          clearTryOnTasks(MULTI_TRY_ON_STORAGE_KEY)
          setTasks([])
        }}
      />
    </div>
  )
}
