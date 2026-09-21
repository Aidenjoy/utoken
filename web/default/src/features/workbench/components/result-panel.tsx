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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

export type ResultPhase = 'idle' | 'loading' | 'error' | 'done'

interface ResultPanelProps {
  phase: ResultPhase
  results: string[]
  error: string
  /** Skeleton count while loading. */
  count: number
  onStartUpload: () => void
  /** Idle copy overrides for the structured try-on pages. */
  idleTitle?: string
  idleDescription?: string
  /** Optional workflow strip rendered under the idle description. */
  idleSteps?: string[]
  /** Loading copy override; defaults to the try-on wording. */
  loadingLabel?: string
}

/** Right-hand canvas: empty state, loading skeletons or the result grid. */
export function ResultPanel(props: ResultPanelProps) {
  const { t } = useTranslation()
  // Stable skeleton ids: array-index keys would remount every pulse frame.
  const [skeletonIds, setSkeletonIds] = useState<string[]>([])
  useEffect(() => {
    setSkeletonIds(
      Array.from({ length: props.count }, () =>
        Math.random().toString(36).slice(2)
      )
    )
  }, [props.count])

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
          <Button className='mt-5' onClick={props.onStartUpload}>
            {t('Start uploading')}
          </Button>
        </div>
      </div>
    )
  }

  if (props.phase === 'loading') {
    return (
      <div className='border-border bg-muted/30 rounded-lg border p-4'>
        <p className='text-muted-foreground mb-3 flex items-center gap-2 text-sm'>
          <Loader2 className='size-4 animate-spin' />
          {props.loadingLabel ?? t('Generating try-on shots...')}
        </p>
        <div className='grid grid-cols-2 gap-3'>
          {skeletonIds.map((id) => (
            <div
              key={id}
              className='bg-muted aspect-square animate-pulse rounded-md'
            />
          ))}
        </div>
      </div>
    )
  }

  if (props.phase === 'error') {
    return (
      <div className='border-destructive/40 bg-destructive/5 flex min-h-[420px] items-center justify-center rounded-lg border p-6'>
        <p className='text-destructive max-w-sm text-center text-sm'>
          {props.error}
        </p>
      </div>
    )
  }

  return (
    <div className='border-border bg-muted/30 rounded-lg border p-4'>
      <div className='grid grid-cols-2 gap-3'>
        {props.results.map((src, index) => (
          <div
            key={src}
            className='group border-border bg-card relative overflow-hidden rounded-md border'
          >
            <img
              src={src}
              alt={t('Try-on result {{index}}', { index: index + 1 })}
              className='aspect-square w-full object-cover'
            />
            <a
              href={src}
              download={`try-on-${index + 1}.png`}
              aria-label={t('Download')}
              className='absolute top-2 right-2 flex size-8 items-center justify-center rounded-md bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/70'
            >
              <Download className='size-4' />
            </a>
          </div>
        ))}
      </div>
    </div>
  )
}
