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
import type { ChipOption } from '../types'

interface ChipGroupProps {
  label?: string
  /** Labels must already be translated (or numeric, rendered as-is). */
  options: ChipOption[]
  value: string
  onChange: (value: string) => void
}

/** Single-select chip row shared by the structured try-on forms. */
export function ChipGroup(props: ChipGroupProps) {
  return (
    <div className='space-y-1.5'>
      {props.label ? (
        <span className='text-sm font-medium'>{props.label}</span>
      ) : null}
      <div className='flex flex-wrap gap-1.5'>
        {props.options.map((option) => {
          const selected = option.value === props.value
          return (
            <button
              key={option.value}
              type='button'
              aria-pressed={selected}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                selected
                  ? 'border-primary/50 bg-primary/10 text-primary font-medium'
                  : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
              }`}
              onClick={() => props.onChange(option.value)}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
