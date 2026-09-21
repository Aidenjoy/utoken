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
import { getUserModels } from '@/lib/api'
import { getModelCategory } from '@/lib/model-category'

import { generateTryOnImages } from './api'
import { ChipGroup } from './components/chip-group'
import { DuoShowcase } from './components/duo-showcase'
import { GenerateBar } from './components/generate-bar'
import { ResultPanel, type ResultPhase } from './components/result-panel'
import { SegmentBar } from './components/segment-bar'
import { UploadTile } from './components/upload-tile'
import {
  ACTION_MAX,
  createDefaultDuoTryOnConfig,
  DUO_COLOR_MODES,
  DUO_RELATIONS,
  TRY_ON_RATIOS,
  TRY_ON_SIZES,
} from './constants'
import { buildImageSize } from './lib/image-size'
import { buildDuoTryOnRequest } from './lib/prompt-duo'
import { saveGenerationToLibrary } from './lib/save-to-library'
import type { ChipOption, DuoTryOnConfig } from './types'

/** Ten garment shots max, same ceiling as free try-on. */
const DUO_GARMENT_MAX = 10

/**
 * Duo try-on workbench: garment pieces (or two colorways) dressed on two
 * models in a shared scene — couple, brothers, besties or parent-child pairs.
 */
export function DuoTryOnPage() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<DuoTryOnConfig>(
    createDefaultDuoTryOnConfig
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

  const update = <K extends keyof DuoTryOnConfig>(
    key: K,
    value: DuoTryOnConfig[K]
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const handleGenerate = async () => {
    if (config.garments.length === 0) {
      toast.error(t('Upload at least one garment image'))
      return
    }
    if (!config.imageModel) {
      toast.error(t('Select an image model'))
      return
    }
    const { prompt, images } = buildDuoTryOnRequest(config)
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
      void saveGenerationToLibrary('try-on', t('Duo Try-On'), urls, images, t)
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
      ...createDefaultDuoTryOnConfig(),
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
  const modelOptions = imageModels.map((name) => ({ label: name, value: name }))

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:p-6'>
      <header className='flex flex-wrap items-center justify-between gap-3'>
        <h1 className={SECTION_PAGE_TITLE_CLASS}>{t('Duo Try-On')}</h1>
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
          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <SegmentBar
              label={t('Pairing relation')}
              options={tr(DUO_RELATIONS)}
              value={config.relation}
              onChange={(value) =>
                update('relation', value as DuoTryOnConfig['relation'])
              }
            />
            <UploadTile
              label={t('Upload garment real shots')}
              badge={t('Garment + detail up to 10 images')}
              hint={t(
                'Upload tops, bottoms or a full set; pieces combine into one coordinated outfit.'
              )}
              max={DUO_GARMENT_MAX}
              multiple
              value={config.garments}
              onChange={(next) => update('garments', next)}
            />
            <ChipGroup
              options={tr(DUO_COLOR_MODES)}
              value={config.colorMode}
              onChange={(value) =>
                update('colorMode', value as DuoTryOnConfig['colorMode'])
              }
            />
            <div className='grid gap-3 sm:grid-cols-3'>
              <UploadTile
                label={t('Reference images')}
                badge={t('Optional')}
                hint={t(
                  'Fixes placement, pose relation, framing and background.'
                )}
                max={1}
                value={config.reference ? [config.reference] : []}
                onChange={(next) => update('reference', next[0] ?? null)}
              />
              <UploadTile
                label={t('Select model 1 (optional)')}
                hint={t('Soft-light frontal photos work best')}
                max={1}
                value={config.adultModel ? [config.adultModel] : []}
                onChange={(next) => update('adultModel', next[0] ?? null)}
              />
              <UploadTile
                label={t('Select model 2 (optional)')}
                max={1}
                value={config.childModel ? [config.childModel] : []}
                onChange={(next) => update('childModel', next[0] ?? null)}
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
            disabled={config.garments.length === 0}
            onGenerate={() => void handleGenerate()}
          />
        </div>

        <div className='flex flex-col gap-4'>
          {phase === 'idle' ? (
            <DuoShowcase />
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
    </div>
  )
}
