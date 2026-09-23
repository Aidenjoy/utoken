import { Download, Loader2, Sparkles } from 'lucide-react'
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
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { ZoomableImage } from '@/components/zoomable-image'
import { cn } from '@/lib/utils'

export type ResultPhase = 'idle' | 'loading' | 'error' | 'done'

interface ResultPanelProps {
  phase: ResultPhase
  results: string[]
  error: string
  /** Skeleton count while loading. */
  count: number
  /** When omitted the idle card hides the upload shortcut button. */
  onStartUpload?: () => void
  /** Idle copy overrides for the structured try-on pages. */
  idleTitle?: string
  idleDescription?: string
  /** Optional workflow strip rendered under the idle description. */
  idleSteps?: string[]
  /** Loading copy override; defaults to the try-on wording. */
  loadingLabel?: string
  /** 调用方在开始生成时清空结果，并在本轮生成过程中逐张追加。 */
  progressive?: boolean
  /** 详情页按原图比例、同宽无间隔纵向预览，其他工作台仍使用网格。 */
  layout?: 'grid' | 'continuous'
}

/** Right-hand canvas: empty state, loading skeletons or the result grid. */
export function ResultPanel(props: ResultPanelProps) {
  const { t } = useTranslation()
  const isLoading = props.phase === 'loading'
  const continuous = props.layout === 'continuous'
  const visibleResults = isLoading && !props.progressive ? [] : props.results
  // 结果按完成顺序追加，尚未完成的槽位保留占位，不因首张返回而消失。
  const pendingIds = Array.from(
    {
      length: isLoading ? Math.max(0, props.count - visibleResults.length) : 0,
    },
    (_, index) => `pending-${visibleResults.length + index}`
  )

  if (props.phase === 'idle') {
    return (
      <div className='border-border bg-muted/30 flex min-h-[420px] items-center justify-center rounded-lg border p-6'>
        <div className='border-border bg-card max-w-sm rounded-lg border p-8 text-center shadow-sm'>
          <span className='mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-emerald-600 text-white'>
            <Sparkles className='size-5' />
          </span>
          <h3 className='text-base font-semibold'>
            {props.idleTitle ?? t('Start from a set of clear materials')}
          </h3>
          <p className='text-muted-foreground mt-2 text-sm'>
            {props.idleDescription ??
              t(
                'Upload garment, model and reference images; results appear here as one coherent try-on set.'
              )}
          </p>
          {props.idleSteps && props.idleSteps.length > 0 ? (
            <div className='mt-5 grid grid-cols-2 gap-2'>
              {props.idleSteps.map((step, index) => (
                <div
                  key={step}
                  className='border-border text-muted-foreground rounded-md border border-dashed px-2 py-2 text-xs'
                >
                  <span className='text-foreground font-medium'>
                    {index + 1}.{' '}
                  </span>
                  {step}
                </div>
              ))}
            </div>
          ) : null}
          {props.onStartUpload ? (
            <Button className='mt-5' onClick={props.onStartUpload}>
              {t('Start uploading')}
            </Button>
          ) : null}
        </div>
      </div>
    )
  }

  if (props.phase === 'error') {
    return (
      <div className='border-destructive/40 bg-destructive/5 flex min-h-[420px] items-center justify-center rounded-lg border p-6'>
        <p
          role='alert'
          className='text-destructive max-w-sm text-center text-sm'
        >
          {props.error}
        </p>
      </div>
    )
  }

  return (
    <div
      className='border-border bg-muted/30 rounded-lg border p-4'
      aria-busy={isLoading}
    >
      {continuous ? (
        <p className='text-muted-foreground mb-3 text-xs'>
          {t(
            'Continuous preview. Download each image to assemble your detail page.'
          )}
        </p>
      ) : null}
      {isLoading ? (
        <p
          role='status'
          className='text-muted-foreground mb-3 flex items-center gap-2 text-sm'
        >
          <Loader2 className='size-4 animate-spin motion-reduce:animate-none' />
          {props.loadingLabel ?? t('Generating try-on shots...')}
          <span className='tabular-nums'>
            {visibleResults.length}/{props.count}
          </span>
        </p>
      ) : null}
      {!isLoading && props.error ? (
        <p role='alert' className='text-destructive mb-3 text-sm'>
          {t('Generation stopped; completed images have been kept.')}{' '}
          {props.error}
        </p>
      ) : null}
      <div className={continuous ? 'flex flex-col' : 'grid grid-cols-2 gap-3'}>
        {visibleResults.map((src, index) => (
          <div
            // eslint-disable-next-line react/no-array-index-key -- 结果只追加、不重排；索引用于区分重复 URL。
            key={`${index}-${src}`}
            className={cn(
              'group relative',
              continuous
                ? 'w-full'
                : 'border-border bg-card overflow-hidden rounded-md border'
            )}
          >
            <ZoomableImage
              src={src}
              alt={
                continuous
                  ? t('Detail page segment {{index}}', { index: index + 1 })
                  : t('Try-on result {{index}}', { index: index + 1 })
              }
              className={
                continuous
                  ? 'focus-visible:outline-primary w-full focus-visible:relative focus-visible:z-10 focus-visible:outline-2 [&>img]:h-auto'
                  : 'aspect-square w-full'
              }
              fit='contain'
            />
            <a
              href={src}
              download={`${continuous ? 'detail' : 'try-on'}-${index + 1}.png`}
              aria-label={
                continuous
                  ? t('Download image {{index}}', { index: index + 1 })
                  : t('Download')
              }
              className={cn(
                'absolute top-2 right-2 flex size-8 items-center justify-center rounded-md bg-black/50 text-white transition-opacity hover:bg-black/70 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-primary',
                continuous
                  ? 'opacity-100'
                  : 'opacity-100 md:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
              )}
            >
              <Download className='size-4' />
            </a>
          </div>
        ))}
        {pendingIds.map((id) => (
          <div
            key={id}
            aria-hidden='true'
            className={cn(
              'bg-muted animate-pulse motion-reduce:animate-none',
              continuous ? 'aspect-[3/4] w-full' : 'aspect-square rounded-md'
            )}
          />
        ))}
      </div>
    </div>
  )
}
