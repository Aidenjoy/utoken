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
import { CalendarDays } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import dayjs from '@/lib/dayjs'
import { cn } from '@/lib/utils'

export interface OrgDateRange {
  start: Date
  end: Date
}

// 企业报表与计费以自然月/自然日为口径，选择器只到天粒度：
// 起始取所选日 00:00:00，结束取所选日 23:59:59。后端 SQL 为
// created_at >= start AND created_at <= end 的双闭区间，因此结束日
// 必须落到当日 23:59:59（而不是次日 0 点），否则结束日整天会漏算。
export function defaultOrgDateRange(): OrgDateRange {
  const now = dayjs()
  return { start: now.startOf('month').toDate(), end: now.endOf('day').toDate() }
}

function toInputValue(date: Date): string {
  return dayjs(date).format('YYYY-MM-DD')
}

// 拼接 T00:00 让解析走本地时区；裸 'YYYY-MM-DD' 会被解析成 UTC 零点。
function dayStart(value: string): Date | undefined {
  if (!value) return undefined
  const date = dayjs(`${value}T00:00`)
  return date.isValid() ? date.startOf('day').toDate() : undefined
}

function dayEnd(value: string): Date | undefined {
  if (!value) return undefined
  const date = dayjs(`${value}T00:00`)
  return date.isValid() ? date.endOf('day').toDate() : undefined
}

interface OrgDateRangePickerProps {
  value: OrgDateRange
  onChange: (range: OrgDateRange) => void
  className?: string
}

export function OrgDateRangePicker({
  value,
  onChange,
  className,
}: OrgDateRangePickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draftStart, setDraftStart] = useState(toInputValue(value.start))
  const [draftEnd, setDraftEnd] = useState(toInputValue(value.end))

  const label = useMemo(
    () =>
      `${dayjs(value.start).format('YYYY-MM-DD')} ~ ${dayjs(value.end).format('YYYY-MM-DD')}`,
    [value.end, value.start]
  )

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDraftStart(toInputValue(value.start))
      setDraftEnd(toInputValue(value.end))
    }
    setOpen(nextOpen)
  }

  const applyDraft = () => {
    let start = dayStart(draftStart)
    let end = dayEnd(draftEnd)
    if (start && end && start.getTime() > end.getTime()) {
      // 起止填反时按日期交换，保证 start <= end
      start = dayStart(draftEnd)
      end = dayEnd(draftStart)
    }
    onChange({ start: start ?? value.start, end: end ?? value.end })
    setOpen(false)
  }

  const applyPreset = (
    kind: 'today' | '7d' | '30d' | 'month' | 'lastMonth'
  ) => {
    const now = dayjs()
    const presets = {
      today: {
        start: now.startOf('day'),
        end: now.endOf('day'),
      },
      '7d': {
        start: now.subtract(6, 'day').startOf('day'),
        end: now.endOf('day'),
      },
      '30d': {
        start: now.subtract(29, 'day').startOf('day'),
        end: now.endOf('day'),
      },
      month: {
        start: now.startOf('month'),
        end: now.endOf('month'),
      },
      lastMonth: {
        start: now.startOf('month').subtract(1, 'month'),
        end: now.startOf('month').subtract(1, 'month').endOf('month'),
      },
    }
    const range = presets[kind]
    const next = { start: range.start.toDate(), end: range.end.toDate() }
    setDraftStart(toInputValue(next.start))
    setDraftEnd(toInputValue(next.end))
    onChange(next)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='outline'
            className={cn(
              'w-full justify-start gap-2 px-2.5 text-sm leading-5 font-normal tabular-nums',
              className
            )}
          />
        }
      >
        <CalendarDays className='text-muted-foreground size-4 shrink-0' />
        <span className='truncate'>{label}</span>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='w-[min(440px,calc(100vw-2rem))] p-3'
      >
        <div className='space-y-3'>
          <div className='grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-end'>
            <div className='space-y-1.5'>
              <div className='text-muted-foreground text-xs'>
                {t('Start Time')}
              </div>
              <Input
                type='date'
                value={draftStart}
                onChange={(e) => setDraftStart(e.target.value)}
                className='h-8 text-sm leading-5 tabular-nums'
              />
            </div>
            <span className='text-muted-foreground hidden pb-2 text-xs sm:block'>
              ~
            </span>
            <div className='space-y-1.5'>
              <div className='text-muted-foreground text-xs'>
                {t('End Time')}
              </div>
              <Input
                type='date'
                value={draftEnd}
                onChange={(e) => setDraftEnd(e.target.value)}
                className='h-8 text-sm leading-5 tabular-nums'
              />
            </div>
          </div>

          <div className='flex flex-wrap gap-1.5'>
            <Button
              type='button'
              variant='secondary'
              size='sm'
              className='h-7 flex-1 px-2 text-xs'
              onClick={() => applyPreset('today')}
            >
              {t('Today')}
            </Button>
            <Button
              type='button'
              variant='secondary'
              size='sm'
              className='h-7 flex-1 px-2 text-xs'
              onClick={() => applyPreset('7d')}
            >
              {t('7 Days')}
            </Button>
            <Button
              type='button'
              variant='secondary'
              size='sm'
              className='h-7 flex-1 px-2 text-xs'
              onClick={() => applyPreset('30d')}
            >
              {t('30 Days')}
            </Button>
            <Button
              type='button'
              variant='secondary'
              size='sm'
              className='h-7 flex-1 px-2 text-xs'
              onClick={() => applyPreset('month')}
            >
              {t('This month')}
            </Button>
            <Button
              type='button'
              variant='secondary'
              size='sm'
              className='h-7 flex-1 px-2 text-xs'
              onClick={() => applyPreset('lastMonth')}
            >
              {t('Previous month')}
            </Button>
          </div>

          <div className='flex justify-end'>
            <Button size='sm' className='h-8' onClick={applyDraft}>
              {t('Confirm')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
