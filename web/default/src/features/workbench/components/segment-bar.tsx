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
  /** 保持单行，窄屏或长翻译可横向滚动，不改变旧页面默认布局。 */
  singleRow?: boolean
}

/**
 * Even-width segmented control (outfit structure, pairing relation, garment
 * style). Column count follows the option count, so long option sets wrap
 * inside their cell instead of overflowing.
 */
export function SegmentBar(props: SegmentBarProps) {
  const columns = props.options.length > 4 ? 'max-sm:grid-cols-4!' : ''
  return (
    <div className='space-y-1.5'>
      {props.label ? (
        <span className='text-sm font-medium'>{props.label}</span>
      ) : null}
      <div
        className={`bg-muted gap-1 rounded-lg p-1 ${props.singleRow ? 'flex overflow-x-auto' : `grid ${columns}`}`}
        style={
          props.singleRow
            ? undefined
            : {
                gridTemplateColumns: `repeat(${props.options.length}, minmax(0, 1fr))`,
              }
        }
      >
        {props.options.map((option) => {
          const selected = option.value === props.value
          return (
            <button
              key={option.value}
              type='button'
              aria-pressed={selected}
              className={`rounded-md py-2 text-sm transition-colors disabled:opacity-50 ${props.singleRow ? 'focus-visible:outline-ring min-w-max flex-1 px-2 whitespace-nowrap focus-visible:outline-2 focus-visible:-outline-offset-2' : ''} ${
                selected
                  ? 'bg-primary text-primary-foreground font-medium'
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
