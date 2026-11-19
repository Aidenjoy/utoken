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
import { Check, ChevronsUpDown, NetworkIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import type { PlaygroundChannel } from '../../types'

/**
 * 渠道选择器（仅超管渲染）：默认 Auto（走渠道优先级选路），
 * 选中特定渠道后提交带 channel_id，后端锁定到该渠道。
 * 放在模型选择器左侧：先选渠道，模型列表再按渠道过滤。
 */
export function PlaygroundChannelSelector({
  value,
  channels,
  onChange,
}: {
  value: number
  channels: PlaygroundChannel[]
  onChange: (value: number) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const current = channels.find((ch) => ch.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type='button'
            className='bg-background/80 hover:bg-accent/70 text-foreground flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors'
            title={t('Channel')}
            aria-label={t('Channel')}
          >
            <NetworkIcon className='text-muted-foreground size-3.5 shrink-0' />
            <span className='hidden max-w-24 truncate sm:inline'>
              {current ? current.name : t('Auto')}
            </span>
            <ChevronsUpDown className='text-muted-foreground size-3.5 shrink-0 opacity-60' />
          </button>
        }
      />
      <PopoverContent side='top' align='start' className='w-56 p-1'>
        <button
          type='button'
          className={cn(
            'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
            value === 0 ? 'bg-accent' : 'hover:bg-accent'
          )}
          onClick={() => {
            onChange(0)
            setOpen(false)
          }}
        >
          <span>{t('Auto')}</span>
          <Check
            className={cn(
              'size-3.5',
              value === 0 ? 'opacity-100' : 'opacity-0'
            )}
          />
        </button>
        {channels.map((ch) => (
          <button
            type='button'
            key={ch.id}
            className={cn(
              'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
              value === ch.id ? 'bg-accent' : 'hover:bg-accent'
            )}
            onClick={() => {
              onChange(ch.id)
              setOpen(false)
            }}
          >
            <span className='truncate'>{ch.name}</span>
            <Check
              className={cn(
                'size-3.5 shrink-0',
                value === ch.id ? 'opacity-100' : 'opacity-0'
              )}
            />
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
