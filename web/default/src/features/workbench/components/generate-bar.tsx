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
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { TRY_ON_COUNTS } from '../constants'
import type { ChipOption } from '../types'

interface GenerateBarProps {
  modelOptions: ChipOption[]
  imageModel: string
  onModelChange: (value: string) => void
  count: number
  onCountChange: (value: number) => void
  loading: boolean
  disabled?: boolean
  /** Batch mode fixes one output per input image, so hide the count pick. */
  countHidden?: boolean
  /** Overrides the default button copy for non-generation actions. */
  generateLabel?: string
  onGenerate: () => void
}

/** Bottom action bar: image model, output count and the generate button. */
export function GenerateBar(props: GenerateBarProps) {
  const { t } = useTranslation()
  const countOptions = TRY_ON_COUNTS.map((count) => ({
    label: String(count),
    value: String(count),
  }))

  return (
    <section className='border-border bg-card flex flex-wrap items-center gap-2 rounded-lg border p-3'>
      <span className='text-sm font-medium'>{t('Image model')}</span>
      <Select
        items={props.modelOptions}
        value={props.imageModel}
        onValueChange={(value) => props.onModelChange(value ?? '')}
      >
        <SelectTrigger className='w-44'>
          <SelectValue placeholder={t('Select an image model')} />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {props.modelOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {props.countHidden ? null : (
        <Select
          items={countOptions}
          value={String(props.count)}
          onValueChange={(value) =>
            props.onCountChange(Number(value ?? props.count))
          }
        >
          <SelectTrigger className='w-24'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {countOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
      <Button
        className='ml-auto'
        disabled={props.loading || props.disabled}
        onClick={props.onGenerate}
      >
        {props.loading ? <Loader2 className='size-4 animate-spin' /> : null}
        {props.generateLabel ?? t('Generate images')}
      </Button>
    </section>
  )
}
