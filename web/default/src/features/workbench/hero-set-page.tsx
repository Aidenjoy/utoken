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
import { ChevronDown, ChevronUp, Eraser, LayoutGrid } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SECTION_PAGE_TITLE_CLASS } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { ChipGroup } from './components/chip-group'
import { GenerateBar } from './components/generate-bar'
import { ResolutionCards } from './components/resolution-cards'
import { ResultPanel, type ResultPhase } from './components/result-panel'
import { UploadTile } from './components/upload-tile'
import {
  createDefaultHeroSetConfig,
  HERO_SET_ANGLE_COUNTS,
  HERO_SET_ANGLES,
  HERO_SET_EXPRESSIONS,
  HERO_SET_MODES,
  HERO_SET_OTHERS,
  HERO_SET_OUTFITS,
  HERO_SET_POSES,
  HERO_SET_SCENES,
  TRY_ON_RATIOS,
} from './constants'
import { buildImageSize } from './lib/image-size'
import { buildHeroSetRequest, heroSetTotalCount } from './lib/prompt-hero-set'
import { saveGenerationToLibrary } from './lib/save-to-library'
import type { ChipOption, HeroSetConfig } from './types'

type HeroSetCustomKey = 'pose' | 'expression' | 'outfit' | 'scene' | 'other'

/**
 * Hero image set workbench: one reference shot plus a per-angle output plan
 * become a same-series set of consistent views.
 */
export function HeroSetPage() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<HeroSetConfig>(
    createDefaultHeroSetConfig
  )
  const [phase, setPhase] = useState<ResultPhase>('idle')
  const [results, setResults] = useState<string[]>([])
  const [error, setError] = useState('')
  const [customOpen, setCustomOpen] = useState(true)
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

  const update = <K extends keyof HeroSetConfig>(
    key: K,
    value: HeroSetConfig[K]
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const toggleAngle = (value: string) => {
    setConfig((prev) => {
      const selected = prev.angles.some((item) => item.value === value)
      const values = selected
        ? prev.angles
            .filter((item) => item.value !== value)
            .map((item) => item.value)
        : [...prev.angles.map((item) => item.value), value]
      const counts = new Map(
        prev.angles.map((item) => [item.value, item.count])
      )
      return {
        ...prev,
        angles: HERO_SET_ANGLES.filter((option) =>
          values.includes(option.value)
        ).map((option) => ({
          value: option.value,
          count: counts.get(option.value) ?? 1,
        })),
      }
    })
  }

  const updateAngleCount = (value: string, count: number) => {
    setConfig((prev) => ({
      ...prev,
      angles: prev.angles.map((item) =>
        item.value === value ? { ...item, count } : item
      ),
    }))
  }

  const totalCount = heroSetTotalCount(config)

  const handleGenerate = async () => {
    if (!config.reference) {
      toast.error(t('Upload a reference image'))
      return
    }
    if (totalCount === 0) {
      toast.error(t('Select at least one view'))
      return
    }
    if (!config.imageModel) {
      toast.error(t('Select an image model'))
      return
    }
    const request = buildHeroSetRequest(config)
    setPhase('loading')
    setError('')
    try {
      const response = await generateTryOnImages({
        model: config.imageModel,
        prompt: request.prompt,
        size: buildImageSize(config.resolution, config.ratio),
        n: totalCount,
        watermark: false,
        image: request.images[0],
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
        'viral-hero',
        t('Hero Image Set'),
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
      ...createDefaultHeroSetConfig(),
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
  const countOptions = HERO_SET_ANGLE_COUNTS.map((count) => ({
    label: String(count),
    value: String(count),
  }))
  const modelOptions = imageModels.map((name) => ({ label: name, value: name }))
  const customFields: {
    key: HeroSetCustomKey
    label: string
    placeholder: string
    options: ChipOption[]
  }[] =
    config.mode === 'model'
      ? [
          {
            key: 'pose',
            label: t('Change the pose to'),
            placeholder: t('Describe pose'),
            options: tr(HERO_SET_POSES),
          },
          {
            key: 'expression',
            label: t('Adjust the model expression'),
            placeholder: t('Describe expression'),
            options: tr(HERO_SET_EXPRESSIONS),
          },
          {
            key: 'outfit',
            label: t('Outfit'),
            placeholder: t('Describe outfit'),
            options: tr(HERO_SET_OUTFITS),
          },
          {
            key: 'other',
            label: t('Other'),
            placeholder: t('Describe other needs'),
            options: tr(HERO_SET_OTHERS),
          },
        ]
      : [
          {
            key: 'pose',
            label: t('Display pose'),
            placeholder: t('Describe pose'),
            options: tr(HERO_SET_POSES),
          },
          {
            key: 'scene',
            label: t('Scene'),
            placeholder: t('Describe scene'),
            options: tr(HERO_SET_SCENES),
          },
          {
            key: 'other',
            label: t('Other'),
            placeholder: t('Describe other needs'),
            options: tr(HERO_SET_OTHERS),
          },
        ]
  const idleSteps = [
    t('Upload one reference image'),
    t('Pick view angles and counts'),
    t('Generate the image set'),
  ]

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:p-6'>
      <header className='flex flex-wrap items-center justify-between gap-3'>
        <h1 className={SECTION_PAGE_TITLE_CLASS}>{t('Hero Image Set')}</h1>
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
          <div>
            <Badge variant='secondary' className='gap-1.5 rounded-full'>
              <span className='bg-primary size-1.5 rounded-full' />
              {t('Viral Hero Image')}
            </Badge>
            <h2 className='mt-2 text-lg font-semibold'>
              {t('Image set generation')}
            </h2>
          </div>

          <div className='border-border bg-card grid grid-cols-2 gap-1 rounded-lg border p-1'>
            {tr(HERO_SET_MODES).map((option) => {
              const selected = option.value === config.mode
              return (
                <button
                  key={option.value}
                  type='button'
                  aria-pressed={selected}
                  className={`rounded-md py-2 text-sm font-medium transition-colors ${
                    selected
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() =>
                    update('mode', option.value as HeroSetConfig['mode'])
                  }
                >
                  {option.label}
                </button>
              )
            })}
          </div>

          <section className='border-border bg-card space-y-4 rounded-lg border p-4'>
            <UploadTile
              label={
                config.mode === 'model' ? t('Model image') : t('Product image')
              }
              badge={`${config.reference ? 1 : 0}/1`}
              hint={t(
                'Click, paste or drag an image here; PNG and JPG supported.'
              )}
              max={1}
              value={config.reference ? [config.reference] : []}
              onChange={(next) => update('reference', next[0] ?? null)}
            />
          </section>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <div>
              <span className='text-sm font-medium'>
                {t('Select generation views')}
              </span>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Generated views should match the view of the uploaded reference image.'
                )}
              </p>
            </div>
            <div className='grid gap-2 sm:grid-cols-3'>
              {HERO_SET_ANGLES.map((angle) => {
                const selected = config.angles.find(
                  (item) => item.value === angle.value
                )
                return (
                  <div
                    key={angle.value}
                    className={`flex items-center justify-between gap-2 rounded-lg border p-3 transition-colors ${
                      selected
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/40'
                    }`}
                  >
                    <button
                      type='button'
                      aria-pressed={Boolean(selected)}
                      className='flex-1 text-left text-sm font-medium'
                      onClick={() => toggleAngle(angle.value)}
                    >
                      {t(angle.label)}
                    </button>
                    {selected ? (
                      <Select
                        items={countOptions}
                        value={String(selected.count)}
                        onValueChange={(value) =>
                          updateAngleCount(
                            angle.value,
                            Number(value ?? selected.count)
                          )
                        }
                      >
                        <SelectTrigger className='h-8 w-16'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            {countOptions.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </section>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <button
              type='button'
              aria-expanded={customOpen}
              className='flex w-full items-center justify-between'
              onClick={() => setCustomOpen((open) => !open)}
            >
              <span className='text-sm font-medium'>
                {t('Custom pose, expression, outfit and more (optional)')}
              </span>
              {customOpen ? (
                <ChevronUp className='text-muted-foreground size-4' />
              ) : (
                <ChevronDown className='text-muted-foreground size-4' />
              )}
            </button>
            {customOpen ? (
              <div className='border-border flex flex-wrap items-center gap-x-2 gap-y-3 rounded-lg border p-3'>
                {customFields.map((field, index) => (
                  <span
                    key={field.key}
                    className='flex items-center gap-2 text-sm'
                  >
                    {index > 0 ? (
                      <span className='text-muted-foreground'>;</span>
                    ) : null}
                    {field.label}
                    <Select
                      items={field.options}
                      value={config[field.key]}
                      onValueChange={(value) => update(field.key, value ?? '')}
                    >
                      <SelectTrigger className='w-36'>
                        <SelectValue placeholder={field.placeholder} />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectGroup>
                          {field.options.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </span>
                ))}
              </div>
            ) : null}
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
                count: totalCount,
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
            count={totalCount}
            onCountChange={() => {}}
            loading={phase === 'loading'}
            disabled={!config.reference || totalCount === 0}
            countHidden
            onGenerate={() => void handleGenerate()}
          />
        </div>

        <ResultPanel
          phase={phase}
          results={results}
          error={error}
          count={Math.max(totalCount, 1)}
          onStartUpload={focusUploads}
          idleTitle={t('One reference, a whole consistent set')}
          idleDescription={t(
            'Upload one reference image and pick the view plan; the finished set appears here.'
          )}
          idleSteps={idleSteps}
          loadingLabel={t('Generating image set...')}
        />
      </div>
    </div>
  )
}
