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
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SECTION_PAGE_TITLE_CLASS } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { getUserModels } from '@/lib/api'
import { getModelCategory } from '@/lib/model-category'

import { generateImageBatch } from './api'
import { ChipGroup } from './components/chip-group'
import { CloseUpShowcase } from './components/closeup-showcase'
import { GarmentBaseFields } from './components/garment-base-fields'
import { GenerateBar } from './components/generate-bar'
import { NumberedHead } from './components/numbered-head'
import { ResultPanel, type ResultPhase } from './components/result-panel'
import { UploadTile } from './components/upload-tile'
import {
  CLOSE_UP_GEN_MODES,
  CLOSE_UP_OUTPUT_MODES,
  CLOSE_UP_PARTS,
  CLOSE_UP_SHOT_MODES,
  createDefaultCloseUpConfig,
  TRY_ON_RATIOS,
  TRY_ON_SIZES,
} from './constants'
import { buildImageSize } from './lib/image-size'
import { buildCloseUpRequest } from './lib/prompt-closeup'
import { saveGenerationToLibrary } from './lib/save-to-library'
import type {
  ChipOption,
  CloseUpConfig,
  GarmentBaseConfig,
  TryOnImage,
} from './types'

/** 细节图工作台：独立生成平铺或立体底图，再按部位生成细节图。 */
export function CloseUpImagePage() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<CloseUpConfig>(
    createDefaultCloseUpConfig
  )
  const [phase, setPhase] = useState<ResultPhase>('idle')
  const [results, setResults] = useState<string[]>([])
  const [error, setError] = useState('')
  const uploadsRef = useRef<HTMLElement>(null)
  const baseConfig =
    config.shotMode === 'position' ? null : config[config.shotMode]
  const isBase = baseConfig !== null
  const isLoading = phase === 'loading'
  const outputCount = isBase ? 1 : config.count
  const resolution = baseConfig?.resolution ?? config.resolution
  const ratio = baseConfig?.ratio ?? config.ratio
  const baseTitle =
    config.shotMode === 'threed'
      ? t('3D white background')
      : t('Flat-lay white background')
  const baseLoadingLabel =
    config.shotMode === 'threed'
      ? t('Generating 3D white-background image...')
      : t('Generating flat-lay image...')

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
    if (isLoading) return
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const updateBase = (changes: Partial<GarmentBaseConfig>) => {
    if (isLoading || config.shotMode === 'position') return
    const mode = config.shotMode
    setConfig((prev) => ({ ...prev, [mode]: { ...prev[mode], ...changes } }))
  }

  const changeShotMode = (shotMode: CloseUpConfig['shotMode']) => {
    if (isLoading || shotMode === config.shotMode) return
    update('shotMode', shotMode)
    setPhase('idle')
    setResults([])
    setError('')
  }

  const togglePart = (value: string) => {
    if (isLoading) return
    setConfig((prev) => ({
      ...prev,
      parts: prev.parts.includes(value)
        ? prev.parts.filter((item) => item !== value)
        : [...prev.parts, value],
    }))
  }

  const hasSources = baseConfig
    ? Boolean(baseConfig.front?.src)
    : [config.front, config.side, config.back].some((image) => image?.src) ||
      config.references.length > 0
  const missingBaseReference =
    baseConfig?.generationMode === 'reference' && !baseConfig.reference?.src

  const handleGenerate = async () => {
    if (isLoading) return
    if (!hasSources) {
      toast.error(
        isBase
          ? t('Upload the required front garment image')
          : t('Upload at least one garment or reference image')
      )
      return
    }
    if (!config.imageModel) {
      toast.error(t('Select an image model'))
      return
    }
    setPhase('loading')
    setError('')
    setResults([])
    const generated: string[] = []
    let sources: string[] = []
    try {
      const request = buildCloseUpRequest(config)
      sources = request.images
      await generateImageBatch(
        [
          {
            model: config.imageModel,
            prompt: request.prompt,
            size: buildImageSize(resolution, ratio),
            n: outputCount,
            watermark: false,
            image:
              request.images.length === 1 ? request.images[0] : request.images,
          },
        ],
        (url) => {
          generated.push(url)
          setResults([...generated])
        }
      )
      setPhase('done')
    } catch (generateError) {
      const message =
        generateError instanceof Error
          ? t(generateError.message)
          : t('Generation failed, please retry')
      setError(message)
      setPhase(generated.length > 0 ? 'done' : 'error')
      toast.error(message)
    } finally {
      if (generated.length > 0) {
        void saveGenerationToLibrary(
          'viral-hero',
          isBase ? baseTitle : t('Detail Images'),
          generated,
          sources,
          t
        )
      }
    }
  }

  const handleClear = () => {
    if (isLoading) return
    setConfig((prev) => {
      const defaults = createDefaultCloseUpConfig()
      if (prev.shotMode !== 'position') {
        return { ...prev, [prev.shotMode]: defaults[prev.shotMode] }
      }
      return {
        ...defaults,
        shotMode: prev.shotMode,
        imageModel: prev.imageModel,
        flat: prev.flat,
        threed: prev.threed,
      }
    })
    setPhase('idle')
    setResults([])
    setError('')
  }

  const useBaseForDetails = () => {
    if (!baseConfig || phase !== 'done' || !results[0]) return
    const image: TryOnImage = {
      id: crypto.randomUUID(),
      src: results[0],
      name: baseTitle,
    }
    setConfig((prev) => ({
      ...createDefaultCloseUpConfig(),
      imageModel: prev.imageModel,
      flat: prev.flat,
      threed: prev.threed,
      front: image,
      resolution,
      ratio,
    }))
    setPhase('idle')
    setResults([])
    setError('')
    uploadsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const tr = (options: ChipOption[]) =>
    options.map((option) => ({ ...option, label: t(option.label) }))
  const ratioOptions = TRY_ON_RATIOS.map((option) => ({
    ...option,
    label: option.value === 'smart' ? t('Smart') : option.label,
  }))
  const modelOptions = imageModels.map((name) => ({ label: name, value: name }))

  const singleTile = (key: 'front' | 'side' | 'back', label: string) => (
    <UploadTile
      label={label}
      badge={t('Local upload')}
      hint={t('Click or drag an image here')}
      max={1}
      disabled={isLoading}
      value={config[key] ? [config[key] as TryOnImage] : []}
      onChange={(next) => update(key, next[0] ?? null)}
    />
  )

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4 p-4 lg:p-6'>
      <header className='flex flex-wrap items-center justify-between gap-3'>
        <h1 className={SECTION_PAGE_TITLE_CLASS}>{t('Detail Images')}</h1>
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
          className='min-w-0 space-y-4 xl:min-h-0 xl:overflow-y-auto'
        >
          <section
            ref={uploadsRef}
            className='border-border bg-card space-y-3 rounded-lg border p-4'
          >
            <div className='bg-muted grid grid-cols-3 gap-1 rounded-lg p-1'>
              {tr(CLOSE_UP_SHOT_MODES).map((option) => {
                const selected = option.value === config.shotMode
                return (
                  <button
                    key={option.value}
                    type='button'
                    aria-pressed={selected}
                    disabled={isLoading}
                    className={`focus-visible:ring-ring rounded-md py-2 text-sm transition-colors outline-none focus-visible:ring-2 disabled:opacity-50 ${
                      selected
                        ? 'bg-primary text-primary-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    onClick={() =>
                      changeShotMode(option.value as CloseUpConfig['shotMode'])
                    }
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            {config.shotMode !== 'position' ? (
              <GarmentBaseFields
                key={config.shotMode}
                mode={config.shotMode}
                config={config[config.shotMode]}
                disabled={isLoading}
                onChange={updateBase}
              />
            ) : null}
            {config.shotMode === 'position' ? (
              <div className='grid gap-3 sm:grid-cols-3'>
                {singleTile('front', t('Front'))}
                {singleTile('side', t('Side'))}
                {singleTile('back', t('Back view'))}
              </div>
            ) : null}
          </section>

          {!isBase ? (
            <>
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
                  <span className='text-sm font-medium'>
                    {t('Detail parts')}
                  </span>
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
                  <span className='text-sm font-medium'>
                    {t('Extra content')}
                  </span>
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
            </>
          ) : null}

          <section className='border-border bg-card space-y-4 rounded-lg border p-4'>
            <ChipGroup
              label={t('Resolution')}
              options={TRY_ON_SIZES.map((size) => ({
                value: size,
                label: size,
              }))}
              value={resolution}
              onChange={(value) =>
                isBase
                  ? updateBase({ resolution: value })
                  : update('resolution', value)
              }
            />
            <ChipGroup
              label={t('Aspect ratio')}
              options={ratioOptions}
              value={ratio}
              onChange={(value) =>
                isBase ? updateBase({ ratio: value }) : update('ratio', value)
              }
            />
            {!isBase ? (
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Each reference image generates {{count}} e-commerce shot(s).',
                  {
                    count: config.count,
                  }
                )}
              </p>
            ) : null}
            <div className='flex justify-end'>
              <Button
                variant='outline'
                size='sm'
                disabled={isLoading}
                onClick={handleClear}
              >
                <Eraser className='size-4' />
                {t('Clear')}
              </Button>
            </div>
          </section>

          <GenerateBar
            modelOptions={modelOptions}
            imageModel={config.imageModel}
            onModelChange={(value) => update('imageModel', value)}
            count={outputCount}
            countHidden={isBase}
            onCountChange={(value) => update('count', value)}
            loading={isLoading}
            disabled={!hasSources || missingBaseReference}
            onGenerate={() => void handleGenerate()}
          />
        </fieldset>

        <div className='flex min-w-0 flex-col gap-3 xl:min-h-0 xl:overflow-y-auto'>
          {phase === 'idle' ? (
            <CloseUpShowcase mode={config.shotMode} />
          ) : (
            <ResultPanel
              progressive
              phase={phase}
              results={results}
              error={error}
              count={outputCount}
              loadingLabel={
                isBase ? baseLoadingLabel : t('Generating close-ups...')
              }
            />
          )}
          {isBase && phase === 'done' && results.length > 0 ? (
            <div className='space-y-2'>
              <Button onClick={useBaseForDetails}>
                {t('Use for detail images')}
              </Button>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Use this result as the front image for a new detail setup. Generation starts only when you confirm.'
                )}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
