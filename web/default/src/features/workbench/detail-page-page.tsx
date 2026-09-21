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
import { Boxes, Eraser, LayoutGrid } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SECTION_PAGE_TITLE_CLASS } from '@/components/layout'
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
import { Textarea } from '@/components/ui/textarea'
import { getUserModels } from '@/lib/api'
import { getModelCategory } from '@/lib/model-category'

import { generateTryOnImages } from './api'
import { ChipGroup } from './components/chip-group'
import { GenerateBar } from './components/generate-bar'
import { NumberedHead } from './components/numbered-head'
import { ResolutionCards } from './components/resolution-cards'
import { ResultPanel, type ResultPhase } from './components/result-panel'
import { UploadTile } from './components/upload-tile'
import {
  createDefaultDetailPageConfig,
  DETAIL_CONTENT_ELEMENTS,
  DETAIL_PAGE_COUNTS,
  DETAIL_SCENE_MODES,
  DETAIL_TEXT_LANGUAGES,
  TRY_ON_RATIOS,
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

  const focusUploads = () => {
    uploadsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const tr = (options: ChipOption[]) =>
    options.map((option) => ({ ...option, label: t(option.label) }))
  const ratioOptions = TRY_ON_RATIOS.map((option) => ({
    ...option,
    label: option.value === 'smart' ? t('Smart') : option.label,
  }))
  const languageOptions = tr(DETAIL_TEXT_LANGUAGES)
  const modelOptions = imageModels.map((name) => ({ label: name, value: name }))
  const idleSteps = [
    t('Upload product images'),
    t('Fill selling points and pick content modules'),
    t('Generate the detail page set'),
  ]

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:p-6'>
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

      <div className='grid gap-4 xl:grid-cols-2'>
        <div ref={uploadsRef} className='space-y-4'>
          <div>
            <p className='text-primary text-xs font-medium'>
              {t('Product relation set')}
            </p>
            <h2 className='mt-1 text-lg font-semibold'>{t('Product set')}</h2>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Compare same-category samples to link selling points, scenes and page structure.'
              )}
            </p>
          </div>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <NumberedHead
              index={1}
              title={t('Upload product images')}
              aside={`${config.products.length}/5`}
            />
            <UploadTile
              label={t('Add product images')}
              hint={t('Supports 1 to 5 images')}
              max={5}
              multiple
              value={config.products}
              onChange={(next) => update('products', next)}
            />
          </section>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <NumberedHead
              index={2}
              title={t('Product relationship modeling')}
            />
            <p className='bg-muted text-muted-foreground rounded-md p-2 text-xs'>
              {t(
                'The feature relation model is built automatically after product images are uploaded.'
              )}
            </p>
            <div className='space-y-1.5'>
              <span className='text-sm font-medium'>{t('Product name')}</span>
              <Input
                value={config.name}
                placeholder={t(
                  'Auto-filled after recognition; you can also generate without it.'
                )}
                onChange={(event) => update('name', event.target.value)}
              />
            </div>
            <div className='space-y-1.5'>
              <span className='text-sm font-medium'>
                {t('Core selling points and requirements')}
              </span>
              <Textarea
                rows={3}
                value={config.selling}
                placeholder={t(
                  'Only fill in what is truly visible or confirmed.'
                )}
                onChange={(event) => update('selling', event.target.value)}
              />
            </div>
            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-1.5'>
                <span className='text-sm font-medium'>
                  {t('Target audience')}
                </span>
                <Input
                  value={config.audience}
                  onChange={(event) => update('audience', event.target.value)}
                />
              </div>
              <div className='space-y-1.5'>
                <span className='text-sm font-medium'>{t('Use scenes')}</span>
                <Input
                  value={config.scene}
                  onChange={(event) => update('scene', event.target.value)}
                />
              </div>
            </div>
          </section>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <NumberedHead
              index={3}
              title={t('SKU color and style classification')}
              aside={t('Single style')}
            />
            <div className='bg-muted/50 border-border space-y-1 rounded-lg border p-3'>
              <span className='text-sm font-medium'>{t('Single style')}</span>
              <p className='text-muted-foreground text-xs'>
                {t('One product sample group is recognized currently.')}
              </p>
            </div>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Image 1 / Image 2 only mark upload order so the model can cite the right shot; styles and colors stay editable.'
              )}
            </p>
          </section>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <NumberedHead
              index={4}
              title={t('Content and materials')}
              aside={t('Multiple choices supported')}
            />
            <div className='grid gap-2 sm:grid-cols-2'>
              {DETAIL_CONTENT_ELEMENTS.map((element) => (
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
            <div className='space-y-1.5'>
              <span className='text-sm font-medium'>
                {t('Image text language')}
              </span>
              <Select
                items={languageOptions}
                value={config.textLanguage}
                onValueChange={(value) => update('textLanguage', value ?? 'zh')}
              >
                <SelectTrigger className='w-40'>
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
            </div>
            <div className='border-border space-y-2 rounded-lg border p-3'>
              <div className='flex items-center gap-2'>
                <Boxes className='size-4' />
                <span className='text-sm font-medium'>
                  {t('Scene warehouse')}
                </span>
              </div>
              <div className='grid grid-cols-2 gap-2'>
                {tr(DETAIL_SCENE_MODES).map((option) => {
                  const selected = option.value === config.sceneMode
                  return (
                    <button
                      key={option.value}
                      type='button'
                      aria-pressed={selected}
                      className={`rounded-md border py-2 text-sm transition-colors ${
                        selected
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border hover:border-primary/40'
                      }`}
                      onClick={() => update('sceneMode', option.value)}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          <section className='border-border bg-card space-y-3 rounded-lg border p-4'>
            <NumberedHead index={5} title={t('Detail page planning')} />
            <div className='flex flex-wrap gap-1.5'>
              {DETAIL_PAGE_COUNTS.map((count) => {
                const selected = count === config.pageCount
                return (
                  <button
                    key={count}
                    type='button'
                    aria-pressed={selected}
                    className={`size-9 rounded-md border text-sm transition-colors ${
                      selected
                        ? 'border-primary bg-primary/10 text-primary font-semibold'
                        : 'border-border hover:border-primary/40'
                    }`}
                    onClick={() => update('pageCount', count)}
                  >
                    {count}
                  </button>
                )
              })}
            </div>
            <p className='text-muted-foreground text-xs'>
              {t('Pages follow the checked content modules in order.')}
            </p>
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
                'Total {{count}} independent detail pages, generated page by page with live results.',
                { count: config.pageCount }
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
            count={config.pageCount}
            onCountChange={() => {}}
            loading={phase === 'loading'}
            disabled={config.products.length === 0}
            countHidden
            onGenerate={() => void handleGenerate()}
          />
        </div>

        <ResultPanel
          phase={phase}
          results={results}
          error={error}
          count={config.pageCount}
          onStartUpload={focusUploads}
          idleTitle={t('Waiting for the detail page plan')}
          idleDescription={t(
            'AI shows 1 to 10 detail page plans and results here.'
          )}
          idleSteps={idleSteps}
          loadingLabel={t('Generating detail pages...')}
        />
      </div>
    </div>
  )
}
