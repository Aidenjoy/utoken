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

interface SegmentBarProps {
  label?: string
  /** Labels must already be translated. */
  options: ChipOption[]
  value: string
  onChange: (value: string) => void
}

/**
 * Even-width segmented control (outfit structure, pairing relation, garment
 * style). Column count follows the option count, so long option sets wrap
 * inside their cell instead of overflowing.
 */
export function SegmentBar(props: SegmentBarProps) {
  return (
    <div className='space-y-1.5'>
      {props.label ? (
        <span className='text-sm font-medium'>{props.label}</span>
      ) : null}
      <div
        className='bg-muted grid gap-1 rounded-md p-1'
        style={{
          gridTemplateColumns: `repeat(${props.options.length}, minmax(0, 1fr))`,
        }}
      >
        {props.options.map((option) => {
          const selected = option.value === props.value
          return (
            <button
              key={option.value}
              type='button'
              aria-pressed={selected}
              className={`truncate rounded px-2 py-1.5 text-sm ${
                selected
                  ? 'bg-background font-medium shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
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
