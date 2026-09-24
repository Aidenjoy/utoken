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
import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

import { TRY_ON_RATIOS, TRY_ON_SIZES } from '../constants'
import { DESIGN_CHANNELS } from '../packaging-config'
import type { ChipOption, TryOnImage } from '../types'
import { ChipGroup } from './chip-group'
import { UploadTile } from './upload-tile'

export function DesignSection(props: { title: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <section className='border-border bg-card space-y-4 rounded-lg border p-4'>
      <h2 className='text-sm font-semibold'>{t(props.title)}</h2>
      {props.children}
    </section>
  )
}

export function DesignText(props: {
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  multiline?: boolean
  maxLength?: number
  hint?: string
}) {
  const { t } = useTranslation()
  const id = useId()
  const common = {
    id,
    value: props.value,
    maxLength: props.maxLength ?? 80,
    required: props.required,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => props.onChange(event.target.value),
  }
  return (
    <div className='space-y-1.5'>
      <label htmlFor={id} className='text-sm font-medium'>
        {t(props.label)}
        {props.required ? ' *' : ''}
      </label>
      {props.multiline ? (
        <Textarea {...common} rows={3} />
      ) : (
        <Input {...common} />
      )}
      {props.hint ? (
        <p className='text-muted-foreground text-xs'>{t(props.hint)}</p>
      ) : null}
    </div>
  )
}

export function DesignChoice(props: {
  label: string
  options: readonly ChipOption[]
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <ChipGroup
      label={t(props.label)}
      options={props.options.map((option) => ({
        ...option,
        label: t(option.label),
      }))}
      value={props.value}
      onChange={props.onChange}
    />
  )
}

export function DesignUpload(props: {
  label: string
  value: TryOnImage | null
  onChange: (value: TryOnImage | null) => void
  hint?: string
}) {
  const { t } = useTranslation()
  return (
    <UploadTile
      label={t(props.label)}
      hint={props.hint ? t(props.hint) : undefined}
      max={1}
      value={props.value ? [props.value] : []}
      onChange={(images) => props.onChange(images[0] ?? null)}
    />
  )
}

export function DesignChannels(props: {
  value: string[]
  onChange: (value: string[]) => void
}) {
  const { t } = useTranslation()
  return (
    <div className='space-y-2'>
      <p className='text-sm font-medium'>{t('Output formats')}</p>
      <div className='flex flex-wrap gap-3'>
        {DESIGN_CHANNELS.map((option) => (
          <label key={option.value} className='flex items-center gap-2 text-sm'>
            <input
              type='checkbox'
              className='accent-primary size-4'
              checked={props.value.includes(option.value)}
              onChange={(event) =>
                props.onChange(
                  event.target.checked
                    ? [...props.value, option.value]
                    : props.value.filter((value) => value !== option.value)
                )
              }
            />
            {t(option.label)}
          </label>
        ))}
      </div>
      <p className='text-muted-foreground text-xs'>
        {t('General-purpose ratios, not official platform specifications.')}
      </p>
    </div>
  )
}

export function DesignOutputControls(props: {
  resolution: string
  ratio: string
  multiRatio?: boolean
  onResolution: (value: string) => void
  onRatio: (value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <ChipGroup
        label={t('Resolution')}
        options={TRY_ON_SIZES.map((value) => ({ value, label: value }))}
        value={props.resolution}
        onChange={props.onResolution}
      />
      {props.multiRatio ? null : (
        <ChipGroup
          label={t('Aspect ratio')}
          options={TRY_ON_RATIOS.map((option) => ({
            ...option,
            label: option.value === 'smart' ? t('Smart') : option.label,
          }))}
          value={props.ratio}
          onChange={props.onRatio}
        />
      )}
    </>
  )
}
