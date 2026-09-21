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
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SECTION_PAGE_TITLE_CLASS } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { getUserModels } from '@/lib/api'
import { getModelCategory } from '@/lib/model-category'

import { generateTryOnImages } from './api'
import { ChipGroup } from './components/chip-group'
import { GenerateBar } from './components/generate-bar'
import { ResultPanel, type ResultPhase } from './components/result-panel'
import { SegmentBar } from './components/segment-bar'
import { TryOnShowcase } from './components/tryon-showcase'
import { UploadTile } from './components/upload-tile'
import {
  ACTION_MAX,
  createDefaultMultiTryOnConfig,
  MULTI_AGE_GROUPS,
  MULTI_GENDERS,
  MULTI_SLOT_LABELS,
  MULTI_STRUCTURES,
  TRY_ON_RATIOS,
  TRY_ON_SIZES,
} from './constants'
import { buildImageSize } from './lib/image-size'
import { buildMultiTryOnRequest } from './lib/prompt-multi'
import { saveGenerationToLibrary } from './lib/save-to-library'
import type {
  ChipOption,
  MultiGarmentSlot,
  MultiTryOnConfig,
  TryOnImage,
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
        size: buildImageSize(config.resolution, config.ratio),
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
      void saveGenerationToLibrary(
        'try-on',
        t('Multi-Item Try-On'),
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
      ...createDefaultMultiTryOnConfig(),
      imageModel: prev.imageModel,
    }))
    setPhase('idle')
    setResults([])
    setError('')
  }

  const tr = (options: ChipOption[]) =>
    options.map((option) => ({ ...option, label: t(option.label) }))
  const ratioOptions = TRY_ON_RATIOS.map((option) => ({
    ...option,
    label: option.value === 'smart' ? t('Smart') : option.label,
  }))
  const resolutionOptions = TRY_ON_SIZES.map((size) => ({
    label: size,
    value: size,
  }))
  const structureOptions = tr(
    MULTI_STRUCTURES.map((item) => ({ value: item.value, label: item.label }))
  )
  const modelOptions = imageModels.map((name) => ({ label: name, value: name }))

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:p-6'>
      <header className='flex flex-wrap items-center justify-between gap-3'>
        <h1 className={SECTION_PAGE_TITLE_CLASS}>{t('Multi-Item Try-On')}</h1>
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
        <div className='space-y-4'>
          <section className='border-border bg-card space-y-4 rounded-lg border p-4'>
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
            <div className='grid gap-3 sm:grid-cols-2'>
              <ChipGroup
                label={t('Pick a category')}
                options={tr(MULTI_GENDERS)}
                value={config.gender}
                onChange={(value) => update('gender', value)}
              />
              <ChipGroup
                label={t('Pick an age group')}
                options={tr(MULTI_AGE_GROUPS)}
                value={config.ageGroup}
                onChange={(value) => update('ageGroup', value)}
              />
            </div>
          </section>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <div className='grid gap-3 sm:grid-cols-2'>
              <UploadTile
                label={t('Reference images')}
                badge={t('Optional')}
                hint={t(
                  'Borrows composition, camera angle and lighting from this shot.'
                )}
                max={1}
                value={config.references}
                onChange={(next) => update('references', next)}
              />
              <UploadTile
                label={t('Select model (optional)')}
                hint={t('Soft-light frontal photos work best')}
                max={1}
                value={config.model ? [config.model] : []}
                onChange={(next) => update('model', next[0] ?? null)}
              />
            </div>
            <div className='grid gap-3 sm:grid-cols-2'>
              <UploadTile
                label={t('Scene image')}
                badge={t('Optional')}
                hint={t('Stage, indoor or other background environment shots.')}
                max={1}
                value={config.scene ? [config.scene] : []}
                onChange={(next) => update('scene', next[0] ?? null)}
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
                    'When on, pose and expression must differ naturally from the reference images; when off, the reference framing is reproduced strictly.'
                  )}
                </span>
              </span>
            </label>
          </section>

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
            disabled={missingSlots.length > 0}
            onGenerate={() => void handleGenerate()}
          />
        </div>

        {phase === 'idle' ? (
          <TryOnShowcase />
        ) : (
          <ResultPanel
            phase={phase}
            results={results}
            error={error}
            count={config.count}
          />
        )}
      </div>
    </div>
  )
}
