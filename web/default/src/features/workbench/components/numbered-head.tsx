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

/** Numbered circle plus section title, mirroring the reference workbenches. */
export function NumberedHead(props: {
  index: number
  title: string
  aside?: string
}) {
  return (
    <div className='flex items-center justify-between gap-2'>
      <div className='flex items-center gap-2'>
        <span className='bg-primary text-primary-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold'>
          {props.index}
        </span>
        <span className='text-sm font-medium'>{props.title}</span>
      </div>
      {props.aside ? (
        <span className='text-muted-foreground text-xs'>{props.aside}</span>
      ) : null}
    </div>
  )
}
