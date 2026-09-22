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
import { ChevronDown, Eraser, LayoutGrid } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SECTION_PAGE_TITLE_CLASS } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { getUserModels } from '@/lib/api'
import { getModelCategory } from '@/lib/model-category'

import { generateTryOnImages } from './api'
import { ChipGroup } from './components/chip-group'
import { DetailShowcase } from './components/detail-showcase'
import { GenerateBar } from './components/generate-bar'
import { ResultPanel, type ResultPhase } from './components/result-panel'
import { UploadTile } from './components/upload-tile'
import {
  createDefaultDetailPageConfig,
  DETAIL_CONTENT_ELEMENTS,
  DETAIL_PAGE_COUNTS,
  DETAIL_SCENE_MODES,
  DETAIL_TEXT_LANGUAGES,
  TRY_ON_RATIOS,
  TRY_ON_SIZES,
} from './constants'
import { buildImageSize } from './lib/image-size'
import { buildDetailPageRequest } from './lib/prompt-detail'
import { saveGenerationToLibrary } from './lib/save-to-library'
import type { ChipOption, DetailPageConfig } from './types'

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
    const request = buildDetailPageRequest(config)
    setPhase('loading')
    setError('')
    try {
      const response = await generateTryOnImages({
        model: config.imageModel,
        prompt: request.prompt,
        size: buildImageSize(config.resolution, config.ratio),
        n: config.pageCount,
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
      void saveGenerationToLibrary(
        'viral-hero',
        t('Detail Page Images'),
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
      ...createDefaultDetailPageConfig(),
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
  const languageOptions = tr(DETAIL_TEXT_LANGUAGES)
  const modelOptions = imageModels.map((name) => ({ label: name, value: name }))
  const resolutionOptions = TRY_ON_SIZES.map((size) => ({
    label: size,
    value: size,
  }))
  const pageCountOptions = DETAIL_PAGE_COUNTS.map((count) => ({
    label: String(count),
    value: String(count),
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
        <div className='min-w-0 space-y-3 xl:min-h-0 xl:overflow-y-auto'>
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
            <div className='space-y-1'>
              <h2 className='text-sm font-medium'>
                {t('Product relationship modeling')}
              </h2>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'The feature relation model is built automatically after product images are uploaded.'
                )}
              </p>
            </div>
            <FieldGroup className='grid gap-3 sm:grid-cols-2'>
              <Field className='min-w-0 gap-1.5'>
                <FieldLabel htmlFor='detail-name'>
                  {t('Product name')}
                </FieldLabel>
                <Input
                  id='detail-name'
                  value={config.name}
                  placeholder={t(
                    'Auto-filled after recognition; you can also generate without it.'
                  )}
                  onChange={(event) => update('name', event.target.value)}
                />
              </Field>
              <Field className='min-w-0 gap-1.5'>
                <FieldLabel htmlFor='detail-audience'>
                  {t('Target audience')}
                </FieldLabel>
                <Input
                  id='detail-audience'
                  value={config.audience}
                  onChange={(event) => update('audience', event.target.value)}
                />
              </Field>
              <Field className='min-w-0 gap-1.5'>
                <FieldLabel htmlFor='detail-selling'>
                  {t('Core selling points and requirements')}
                </FieldLabel>
                <Textarea
                  id='detail-selling'
                  rows={2}
                  value={config.selling}
                  placeholder={t(
                    'Only fill in what is truly visible or confirmed.'
                  )}
                  onChange={(event) => update('selling', event.target.value)}
                />
              </Field>
              <Field className='min-w-0 gap-1.5'>
                <FieldLabel htmlFor='detail-scene'>
                  {t('Use scenes')}
                </FieldLabel>
                <Textarea
                  id='detail-scene'
                  rows={2}
                  value={config.scene}
                  onChange={(event) => update('scene', event.target.value)}
                />
              </Field>
            </FieldGroup>
            <Collapsible className='border-border border-t pt-3'>
              <CollapsibleTrigger className='group focus-visible:ring-ring flex w-full items-center gap-2 rounded-sm py-1 text-left text-xs outline-none focus-visible:ring-2'>
                <span className='font-medium'>
                  {t('SKU color and style classification')}
                </span>
                <span className='text-muted-foreground ml-auto'>
                  {t('Single style')}
                </span>
                <ChevronDown
                  aria-hidden='true'
                  className='size-3.5 shrink-0 group-aria-expanded:rotate-180'
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className='text-muted-foreground space-y-1 pt-2 text-xs'>
                  <p>
                    {t('One product sample group is recognized currently.')}
                  </p>
                  <p>
                    {t(
                      'Image 1 / Image 2 only mark upload order so the model can cite the right shot; styles and colors stay editable.'
                    )}
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </section>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <fieldset className='space-y-3'>
              <legend className='float-left w-full text-sm font-medium'>
                {t('Content and materials')}
                <span className='text-muted-foreground ml-2 text-xs font-normal'>
                  {t('Multiple choices supported')}
                </span>
              </legend>
              <FieldGroup className='clear-both grid grid-cols-2 gap-2 sm:grid-cols-4'>
                {DETAIL_CONTENT_ELEMENTS.map((element) => (
                  <Field
                    key={element.value}
                    orientation='horizontal'
                    className='gap-2'
                  >
                    <Checkbox
                      id={`detail-element-${element.value}`}
                      checked={config.elements.includes(element.value)}
                      onCheckedChange={(checked) =>
                        toggleElement(element.value, checked === true)
                      }
                    />
                    <FieldLabel
                      htmlFor={`detail-element-${element.value}`}
                      className='font-normal'
                    >
                      {t(element.label)}
                    </FieldLabel>
                  </Field>
                ))}
              </FieldGroup>
            </fieldset>
            <FieldGroup className='grid gap-3 sm:grid-cols-2'>
              <Field className='min-w-0 gap-1.5'>
                <FieldLabel htmlFor='detail-language'>
                  {t('Image text language')}
                </FieldLabel>
                <Select
                  items={languageOptions}
                  value={config.textLanguage}
                  onValueChange={(value) =>
                    update('textLanguage', value ?? 'zh')
                  }
                >
                  <SelectTrigger id='detail-language' className='w-full'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {languageOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <ChipGroup
                label={t('Scene warehouse')}
                options={tr(DETAIL_SCENE_MODES)}
                value={config.sceneMode}
                onChange={(value) => update('sceneMode', value)}
              />
            </FieldGroup>
          </section>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <div className='flex flex-wrap justify-between gap-3'>
              <ChipGroup
                label={t('Detail page planning')}
                options={pageCountOptions}
                value={String(config.pageCount)}
                onChange={(value) => update('pageCount', Number(value))}
              />
              <ChipGroup
                label={t('Resolution')}
                options={resolutionOptions}
                value={config.resolution}
                onChange={(value) => update('resolution', value)}
              />
            </div>
            <p className='text-muted-foreground text-xs'>
              {t('Pages follow the checked content modules in order.')}
            </p>
            <ChipGroup
              label={t('Aspect ratio')}
              options={ratioOptions}
              value={config.ratio}
              onChange={(value) => update('ratio', value)}
            />
            <div className='flex items-center justify-between gap-3'>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Total {{count}} independent detail pages, generated page by page with live results.',
                  { count: config.pageCount }
                )}
              </p>
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
            count={config.pageCount}
            onCountChange={() => {}}
            loading={phase === 'loading'}
            disabled={config.products.length === 0}
            countHidden
            onGenerate={() => void handleGenerate()}
          />
        </div>

        <div className='flex min-w-0 flex-col xl:min-h-0 xl:overflow-y-auto'>
          {phase === 'idle' ? (
            <DetailShowcase />
          ) : (
            <ResultPanel
              phase={phase}
              results={results}
              error={error}
              count={config.pageCount}
              loadingLabel={t('Generating detail pages...')}
            />
          )}
        </div>
      </div>
    </div>
  )
}
