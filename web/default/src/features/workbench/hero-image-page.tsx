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
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SECTION_PAGE_TITLE_CLASS } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { getUserModels } from '@/lib/api'
import { getModelCategory } from '@/lib/model-category'

import { generateImageBatch } from './api'
import { ChipGroup } from './components/chip-group'
import { GenerateBar } from './components/generate-bar'
import { HeroShowcase } from './components/hero-showcase'
import { ResultPanel, type ResultPhase } from './components/result-panel'
import { UploadTile } from './components/upload-tile'
import {
  createDefaultHeroImageConfig,
  HERO_CONTENT_ELEMENTS,
  TRY_ON_RATIOS,
  TRY_ON_SIZES,
} from './constants'
import { buildImageSize } from './lib/image-size'
import { buildHeroImageRequest } from './lib/prompt-hero'
import { saveGenerationToLibrary } from './lib/save-to-library'
import type { HeroImageConfig } from './types'

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
  const isLoading = phase === 'loading'

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
    if (isLoading) return
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const toggleElement = (value: string, checked: boolean) => {
    if (isLoading) return
    setConfig((prev) => ({
      ...prev,
      elements: checked
        ? [...prev.elements, value]
        : prev.elements.filter((item) => item !== value),
    }))
  }

  const handleGenerate = async () => {
    if (isLoading) return
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
    setResults([])
    const generated: string[] = []
    try {
      await generateImageBatch(
        [
          {
            model: config.imageModel,
            prompt: request.prompt,
            size: buildImageSize(config.resolution, config.ratio),
            n: config.count,
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
          ? generateError.message
          : t('Generation failed, please retry')
      setError(message)
      setPhase(generated.length > 0 ? 'done' : 'error')
      toast.error(message)
    } finally {
      if (generated.length > 0) {
        void saveGenerationToLibrary(
          'viral-hero',
          t('Hero Image Design'),
          generated,
          request.images,
          t
        )
      }
    }
  }

  const handleClear = () => {
    if (isLoading) return
    setConfig((prev) => ({
      ...createDefaultHeroImageConfig(),
      imageModel: prev.imageModel,
    }))
    setPhase('idle')
    setResults([])
    setError('')
  }

  const resolutionOptions = TRY_ON_SIZES.map((size) => ({
    label: size,
    value: size,
  }))
  const ratioOptions = TRY_ON_RATIOS.map((option) => ({
    ...option,
    label: option.value === 'smart' ? t('Smart') : option.label,
  }))
  const modelOptions = imageModels.map((name) => ({ label: name, value: name }))

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4 p-4 lg:p-6'>
      <header className='flex flex-wrap items-center justify-between gap-3'>
        <h1 className={SECTION_PAGE_TITLE_CLASS}>{t('Hero Image Design')}</h1>
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
          className='flex min-w-0 flex-col gap-4 xl:min-h-0 xl:overflow-y-auto'
        >
          <section className='border-border bg-card flex flex-col gap-3 rounded-lg border p-4'>
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
              badge={t('Optional')}
              hint={t(
                'Only layout, composition, background and text zones are referenced.'
              )}
              max={1}
              value={config.template ? [config.template] : []}
              onChange={(next) => update('template', next[0] ?? null)}
            />
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor='hero-extra-requirements'>
                  {t('Extra requirements')}
                </FieldLabel>
                <Textarea
                  id='hero-extra-requirements'
                  rows={3}
                  value={config.extra}
                  placeholder={t(
                    'e.g. Slogan: Travel light; Price: ¥99; Keep the product logo visible.'
                  )}
                  onChange={(event) => update('extra', event.target.value)}
                />
              </Field>
            </FieldGroup>
          </section>

          <section className='border-border bg-card flex flex-col gap-3 rounded-lg border p-4'>
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

          <section className='border-border bg-card flex flex-col gap-4 rounded-lg border p-4'>
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
            loading={isLoading}
            disabled={config.products.length === 0}
            onGenerate={() => void handleGenerate()}
          />
        </fieldset>

        <div className='flex min-w-0 flex-col xl:min-h-0 xl:overflow-y-auto'>
          {phase === 'idle' ? (
            <HeroShowcase />
          ) : (
            <ResultPanel
              progressive
              phase={phase}
              results={results}
              error={error}
              count={config.count}
              loadingLabel={t('Generating hero images...')}
            />
          )}
        </div>
      </div>
    </div>
  )
}
