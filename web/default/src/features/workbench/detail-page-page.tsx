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
import { Field, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { getUserModels } from '@/lib/api'
import { getModelCategory } from '@/lib/model-category'

import { generateImageBatch } from './api'
import { ChipGroup } from './components/chip-group'
import { DetailShowcase } from './components/detail-showcase'
import { GenerateBar } from './components/generate-bar'
import { ResultPanel, type ResultPhase } from './components/result-panel'
import { UploadTile } from './components/upload-tile'
import {
  createDefaultDetailPageConfig,
  DETAIL_CONTENT_ELEMENTS,
  DETAIL_ELEMENT_REFERENCE_MAX,
  TRY_ON_RATIOS,
  TRY_ON_SIZES,
} from './constants'
import { buildImageSize } from './lib/image-size'
import {
  buildDetailPageRequest,
  getSelectedDetailElements,
} from './lib/prompt-detail'
import { saveGenerationToLibrary } from './lib/save-to-library'
import type {
  DetailPageConfig,
  DetailPageElement,
  DetailPageElementValue,
  TryOnImage,
} from './types'

/**
 * Detail page set workbench: one product sample group plus confirmed selling
 * facts become an ordered set of conversion-focused detail pages.
 */
export function DetailPagePage() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<DetailPageConfig>(
    createDefaultDetailPageConfig
  )
  const [phase, setPhase] = useState<ResultPhase>('idle')
  const [results, setResults] = useState<string[]>([])
  const [error, setError] = useState('')
  const [generationCount, setGenerationCount] = useState(0)
  const selectedElements = getSelectedDetailElements(config.elements)
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

  const update = <K extends keyof DetailPageConfig>(
    key: K,
    value: DetailPageConfig[K]
  ) => {
    if (isLoading) return
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const updateElement = (
    value: DetailPageElementValue,
    patch: Partial<DetailPageElement>
  ) => {
    if (isLoading) return
    setConfig((prev) => ({
      ...prev,
      elements: prev.elements.map((element) =>
        element.value === value ? { ...element, ...patch } : element
      ),
    }))
  }

  const toggleElement = (value: DetailPageElementValue, checked: boolean) => {
    updateElement(value, { enabled: checked })
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
    if (selectedElements.length === 0) {
      toast.error(t('Select at least one content module'))
      return
    }
    setGenerationCount(selectedElements.length)
    setPhase('loading')
    setError('')
    setResults([])
    const generated: string[] = []
    try {
      const size = buildImageSize(config.resolution, config.ratio)
      const requests = selectedElements.map((_element, index) => {
        const request = buildDetailPageRequest(config, index)
        return {
          model: config.imageModel,
          prompt: request.prompt,
          size,
          n: 1,
          watermark: false,
          image:
            request.images.length === 1 ? request.images[0] : request.images,
        }
      })
      await generateImageBatch(
        requests,
        (url) => {
          generated.push(url)
          setResults([...generated])
        },
        undefined,
        'detail'
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
          t('Detail Page Images'),
          generated,
          config.products.map((image) => image.src),
          t
        )
      }
    }
  }

  const handleClear = () => {
    if (isLoading) return
    setConfig((prev) => ({
      ...createDefaultDetailPageConfig(),
      imageModel: prev.imageModel,
    }))
    setPhase('idle')
    setGenerationCount(0)
    setResults([])
    setError('')
  }

  const ratioOptions = TRY_ON_RATIOS.map((option) => ({
    ...option,
    label: option.value === 'smart' ? t('Smart') : option.label,
  }))
  const modelOptions = imageModels.map((name) => ({ label: name, value: name }))
  const resolutionOptions = TRY_ON_SIZES.map((size) => ({
    label: size,
    value: size,
  }))

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4 p-4 lg:p-6'>
      <header className='flex flex-wrap items-center justify-between gap-3'>
        <h1 className={SECTION_PAGE_TITLE_CLASS}>{t('Detail Page Images')}</h1>
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
          className='min-w-0 space-y-3 xl:min-h-0 xl:overflow-y-auto'
        >
          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <h2 className='text-sm font-medium'>
                {t('Upload product images')}
              </h2>
              <span className='text-muted-foreground text-xs'>
                {t('Supports 1 to 5 images')} · {config.products.length}/5
              </span>
            </div>
            <UploadTile
              compact
              label={t('Add product images')}
              max={5}
              multiple
              value={config.products}
              onChange={(next) => update('products', next)}
            />
          </section>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <div className='flex flex-wrap items-baseline justify-between gap-2'>
              <h2 className='text-sm font-medium'>
                {t('Content and materials')}
                <span className='text-muted-foreground ml-2 text-xs font-normal'>
                  {t('Multiple choices supported')}
                </span>
              </h2>
              <span className='text-muted-foreground text-xs'>
                {t('{{count}} selected · {{count}} images', {
                  count: selectedElements.length,
                })}
              </span>
            </div>
            <p className='text-muted-foreground text-xs'>
              {t(
                'One selected module creates one image, in the order below. References and notes apply only to that image.'
              )}
            </p>
            <div className='@container grid gap-3 sm:grid-cols-2'>
              {DETAIL_CONTENT_ELEMENTS.map((option) => {
                const element = config.elements.find(
                  (item) => item.value === option.value
                )
                if (!element) return null
                const value = element.value
                const label = t(option.label)
                const references: TryOnImage[] = element.references
                return (
                  <div
                    key={value}
                    className={`min-w-0 rounded-lg border p-3 ${
                      element.enabled
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-border'
                    }`}
                  >
                    <Field orientation='horizontal' className='mb-2 gap-2'>
                      <Checkbox
                        id={`detail-element-${value}`}
                        checked={element.enabled}
                        onCheckedChange={(checked) =>
                          toggleElement(value, checked === true)
                        }
                      />
                      <FieldLabel
                        htmlFor={`detail-element-${value}`}
                        className='text-sm'
                      >
                        {label}
                      </FieldLabel>
                    </Field>
                    <div className='grid gap-2'>
                      <UploadTile
                        compact
                        label={t('{{type}} reference images', {
                          type: label,
                        })}
                        max={DETAIL_ELEMENT_REFERENCE_MAX}
                        multiple
                        value={references}
                        onChange={(next) =>
                          updateElement(value, { references: next })
                        }
                      />
                      <Field className='gap-1'>
                        <FieldLabel
                          htmlFor={`detail-element-extra-${value}`}
                          className='sr-only'
                        >
                          {t('{{type}} requirements', { type: label })}
                        </FieldLabel>
                        <Textarea
                          id={`detail-element-extra-${value}`}
                          rows={2}
                          value={element.extra}
                          placeholder={t('{{type}} requirements', {
                            type: label,
                          })}
                          onChange={(event) =>
                            updateElement(value, { extra: event.target.value })
                          }
                        />
                      </Field>
                      {!element.enabled ? (
                        <p className='text-muted-foreground text-xs'>
                          {t(
                            'Not generated this time; references and requirements are kept.'
                          )}
                        </p>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className='border-border bg-card rounded-lg border p-4'>
            <Field className='gap-1.5'>
              <FieldLabel htmlFor='detail-extra'>
                {t('Additional detail page requirements')}
              </FieldLabel>
              <Textarea
                id='detail-extra'
                rows={3}
                value={config.extra}
                placeholder={t(
                  'e.g. Warm wood surfaces and side lighting throughout; headline: Travel light. Add verified dimensions, materials or packaging details.'
                )}
                onChange={(event) => update('extra', event.target.value)}
              />
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Set the shared style and exact copy here. Every image can include backgrounds and text; provide verified facts for specifications, packaging and usage steps.'
                )}
              </p>
            </Field>
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
            count={selectedElements.length}
            generateLabel={t('Generate {{count}} images', {
              count: selectedElements.length,
            })}
            onCountChange={() => {}}
            loading={isLoading}
            disabled={
              config.products.length === 0 || selectedElements.length === 0
            }
            countHidden
            onGenerate={() => void handleGenerate()}
          />
        </fieldset>

        <div className='flex min-w-0 flex-col xl:min-h-0 xl:overflow-y-auto'>
          {phase === 'idle' ? (
            <DetailShowcase />
          ) : (
            <ResultPanel
              layout='continuous'
              progressive
              phase={phase}
              results={results}
              error={error}
              count={generationCount}
              loadingLabel={t('Generating detail pages...')}
            />
          )}
        </div>
      </div>
    </div>
  )
}
