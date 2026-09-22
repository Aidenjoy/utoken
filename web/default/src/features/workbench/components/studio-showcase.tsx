import { Plus, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

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
import composeResult from '@/assets/studio/compose-result.webp'
import composeSources from '@/assets/studio/compose-sources.webp'
import existingResult from '@/assets/studio/existing-result.webp'
import existingSources from '@/assets/studio/existing-sources.webp'
import restyleResult from '@/assets/studio/restyle-result.webp'
import restyleSource from '@/assets/studio/restyle-source.webp'

import type { ModelStudioMode } from '../types'
import { ShowcaseHint } from './showcase-hint'

interface StudioShowcaseProps {
  mode: ModelStudioMode
}

/** A single face cropped out of a 3-up contact sheet via background position. */
function Crop(props: {
  src: string
  /** 0-based column of the contact sheet; omit for a full-bleed image. */
  column?: number
  className: string
}) {
  const column = props.column ?? 0
  return (
    <div
      aria-hidden='true'
      className={props.className}
      style={{
        backgroundImage: `url(${props.src})`,
        backgroundSize: props.column === undefined ? 'cover' : '300% auto',
        backgroundPosition:
          props.column === undefined ? '50% 30%' : `${column * 50}% 30%`,
      }}
    />
  )
}

function SourceBadge() {
  return (
    <span className='absolute -right-1.5 -bottom-1.5 flex size-6 items-center justify-center rounded-full bg-slate-900/90 text-white shadow'>
      <Plus className='size-3.5' />
    </span>
  )
}

function SlotChip(props: { label: string; className?: string }) {
  return (
    <span
      className={`absolute rounded-md bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300 ${props.className ?? ''}`}
    >
      {props.label}
    </span>
  )
}

function FlowArrow() {
  return (
    <svg
      viewBox='0 0 24 24'
      aria-hidden='true'
      className='size-9 shrink-0 fill-current text-violet-500 drop-shadow-sm'
    >
      <path d='M7 4v16l13-8z' />
    </svg>
  )
}

/** The tilted, violet-matted polaroid that anchors the casting board. */
function ResultFrame(props: {
  src: string
  label: string
  tall?: boolean
  compact?: boolean
}) {
  let imgSize = 'h-56 w-40'
  if (props.tall) imgSize = 'h-64 w-40'
  else if (props.compact) imgSize = 'h-44 w-32'
  return (
    <div className='bg-card relative rotate-2 rounded-2xl p-2 shadow-xl ring-2 ring-violet-400/70 transition-transform duration-300 hover:rotate-0'>
      <img
        src={props.src}
        alt=''
        className={`rounded-xl object-cover ${imgSize}`}
      />
      <SlotChip label={props.label} className='-top-3 -right-2 rotate-2' />
    </div>
  )
}

/**
 * Idle-state casting board for the dedicated model studio: shows, per mode,
 * the source portraits flowing into the generated model as an illustrated
 * image+text explainer instead of a plain placeholder card.
 */
export function StudioShowcase(props: StudioShowcaseProps) {
  const { t } = useTranslation()

  let sources: React.ReactNode = null
  let result: React.ReactNode = null
  let caption = ''
  let note: string | null = null

  if (props.mode === 'compose') {
    sources = (
      <div className='flex items-end -space-x-3'>
        {[0, 1, 2].map((column) => (
          <div
            key={column}
            className={`relative ${column === 1 ? 'translate-y-2' : ''}`}
          >
            <Crop
              src={composeSources}
              column={column}
              className='border-card bg-muted h-36 w-24 rounded-xl border-4 shadow-md'
            />
            <SourceBadge />
            <SlotChip
              label={t('Portrait {{index}}', { index: column + 1 })}
              className='-top-3 -left-2 -rotate-3'
            />
          </div>
        ))}
      </div>
    )
    result = (
      <ResultFrame src={composeResult} label={t('Generated result')} compact />
    )
    caption = t(
      'Upload 3 portraits to compose one stable person identity; hairstyle is optional.'
    )
    note = t('Hairstyle reference (optional)')
  } else if (props.mode === 'restyle') {
    sources = (
      <div className='relative'>
        <Crop
          src={restyleSource}
          className='border-card bg-muted h-40 w-32 rounded-xl border-4 shadow-md'
        />
        <SourceBadge />
        <SlotChip
          label={t('Model image')}
          className='-top-3 -left-2 -rotate-3'
        />
      </div>
    )
    result = <ResultFrame src={restyleResult} label={t('Generated result')} />
    caption = t('Upload one face and pick a hairstyle to recompose it.')
    note = t('Hairstyle reference (optional)')
  } else {
    sources = (
      <div className='flex items-center gap-2'>
        {[
          { column: 0, label: t('Front view') },
          { column: 1, label: t('Left profile') },
          { column: 2, label: t('Right profile') },
        ].map((slot) => (
          <div
            key={slot.label}
            className='bg-card relative rounded-lg p-1.5 shadow-md'
          >
            <Crop
              src={existingSources}
              column={slot.column}
              className='bg-muted h-24 w-16 rounded-md'
            />
            <span className='text-muted-foreground mt-1 block text-center text-[11px]'>
              {slot.label}
            </span>
          </div>
        ))}
      </div>
    )
    result = <ResultFrame src={existingResult} label={t('Model result')} tall />
    caption = t(
      'Upload 3 angles of the same model to register the person as-is.'
    )
  }

  return (
    <div className='dark:bg-muted/30 border-border relative flex min-h-[420px] flex-1 flex-col items-center justify-center overflow-hidden rounded-xl border bg-[#edf3f0] p-6'>
      <div className='flex flex-wrap items-center justify-center gap-4 sm:gap-6'>
        {sources}
        <FlowArrow />
        {result}
      </div>

      {note ? (
        <span className='mt-6 rounded-md bg-violet-500/15 px-3 py-1 text-xs font-medium text-violet-700 dark:text-violet-300'>
          {note}
        </span>
      ) : null}

      <ShowcaseHint
        className='mt-5'
        icon={UserRound}
        title={t('Dedicated Model')}
        description={caption}
        badges={[
          t('Face-composed model'),
          t('Model restyle'),
          t('Upload existing model'),
        ]}
      />
    </div>
  )
}
