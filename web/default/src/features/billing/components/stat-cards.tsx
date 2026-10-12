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
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export type BillingStatItem = {
  label: string
  value: string | number
  accent?: string
}

interface BillingStatCardsProps {
  items: BillingStatItem[]
  isLoading?: boolean
}

export function BillingStatCards({ items, isLoading }: BillingStatCardsProps) {
  if (isLoading) {
    return (
      <div className='grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4'>
        {items.map((item) => (
          <Skeleton
            key={item.label}
            className='bg-muted/40 h-[68px] rounded-xl'
          />
        ))}
      </div>
    )
  }

  return (
    <div className='grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4'>
      {items.map((item) => (
        <div
          key={item.label}
          className='border-border/60 bg-card rounded-xl border p-3 shadow-xs'
        >
          <div className='flex items-center gap-2'>
            <span
              className={cn(
                'h-3.5 w-0.5 shrink-0 rounded-full',
                item.accent ?? 'bg-sky-500/70'
              )}
            />
            <span className='text-muted-foreground truncate text-xs'>
              {item.label}
            </span>
          </div>
          <div className='text-foreground/90 mt-1.5 font-mono text-base font-semibold tabular-nums sm:text-lg'>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  )
}
