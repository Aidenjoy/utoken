import { ArrowRight } from 'lucide-react'

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
import type { BoardGlyphKind } from '../types'

const CELL = 'rounded-[3px] bg-muted-foreground/20'

function cells(count: number): React.ReactNode[] {
  return Array.from({ length: count }, (_, index) => (
    <div key={index} className={CELL} />
  ))
}

/** Board area layout per glyph kind; purely decorative, aria-hidden. */
function BoardCells({ kind }: { kind: BoardGlyphKind }) {
  switch (kind) {
    case 'grid9':
      return (
        <div className='grid size-full grid-cols-3 grid-rows-3 gap-1'>
          {cells(9)}
        </div>
      )
    case 'compare':
      return <div className='grid size-full grid-cols-2 gap-1'>{cells(2)}</div>
    case 'strip':
      return <div className='grid size-full grid-cols-4 gap-1'>{cells(4)}</div>
    case 'steps':
      return (
        <div className='grid size-full grid-cols-1 grid-rows-3 gap-1'>
          {cells(3)}
        </div>
      )
    case 'quad':
      return (
        <div className='grid size-full grid-cols-2 grid-rows-2 gap-1'>
          {cells(4)}
        </div>
      )
    case 'swatch':
      return (
        <div className='flex size-full flex-col gap-1'>
          <div className='flex gap-1'>
            {Array.from({ length: 4 }, (_, index) => (
              <div
                key={index}
                className='bg-muted-foreground/25 size-3 rounded-full'
              />
            ))}
          </div>
          <div className='grid min-h-0 flex-1 grid-cols-2 gap-1'>
            {cells(2)}
          </div>
        </div>
      )
    case 'scene':
      return (
        <div className='grid size-full grid-cols-3 grid-rows-2 gap-1'>
          <div className={`${CELL} col-span-2 row-span-2`} />
          {cells(2)}
        </div>
      )
    case 'collage':
      return (
        <div className='grid size-full grid-cols-3 grid-rows-2 gap-1'>
          <div className={`${CELL} col-span-2`} />
          {cells(3)}
        </div>
      )
    case 'spread':
      return (
        <div className='grid size-full grid-cols-4 grid-rows-2 gap-1'>
          <div className={`${CELL} row-span-2`} />
          {cells(6)}
        </div>
      )
  }
}

/**
 * Abstract source-to-board mockup shown on template cards: one source cell,
 * an arrow, then the board layout of the preset family.
 */
export function BoardGlyph({ kind }: { kind: BoardGlyphKind }) {
  return (
    <div
      aria-hidden
      className='border-border bg-muted/40 flex items-stretch gap-2 rounded-md border p-2'
    >
      <div className={`${CELL} bg-muted-foreground/30 w-1/4 shrink-0`} />
      <span className='text-muted-foreground flex items-center'>
        <ArrowRight className='size-3.5' />
      </span>
      <div className='h-20 min-w-0 flex-1'>
        <BoardCells kind={kind} />
      </div>
    </div>
  )
}
