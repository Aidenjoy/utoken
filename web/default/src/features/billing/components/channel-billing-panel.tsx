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
import { useQuery } from '@tanstack/react-query'
import { RotateCcw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MultiSelect } from '@/components/multi-select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getChannels } from '@/features/channels/api'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'

import {
  BILLING_SCOPE_ALL,
  normalizeBillingScope,
  type ChannelBillingFilter,
} from '../types'
import { ChannelBillingDetailsTable } from './channel-billing-details-table'
import { ChannelBillingRecordsTable } from './channel-billing-records-table'

type ChannelBillingTab = 'records' | 'details'

interface ChannelFilterDraft {
  channelSel: string[]
  modelName: string
  start?: Date
  end?: Date
}

function getDefaultDraft(): ChannelFilterDraft {
  const end = new Date()
  const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000)
  start.setHours(0, 0, 0, 0)
  return {
    channelSel: [BILLING_SCOPE_ALL],
    modelName: '',
    start,
    end,
  }
}

/**
 * Admin-only upstream reconciliation panel. Owns its channel/model/date filters
 * (kept separate from the downstream user/org filters of the other billing tabs)
 * and switches between the aggregated records view and the raw detail view.
 */
export function ChannelBillingPanel() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<ChannelBillingTab>('records')
  const [draft, setDraft] = useState<ChannelFilterDraft>(getDefaultDraft)
  const [applied, setApplied] = useState<ChannelFilterDraft>(getDefaultDraft)

  const { data: channelOptions = [] } = useQuery({
    queryKey: ['channel-billing-channel-options'],
    queryFn: async () => {
      const result = await getChannels({ p: 1, page_size: 1000 })
      return (result.data?.items ?? []).map((channel) => ({
        label: `${channel.name} (#${channel.id})`,
        value: String(channel.id),
      }))
    },
    staleTime: 5 * 60 * 1000,
  })

  const channelScopeOptions = useMemo(
    () => [{ value: BILLING_SCOPE_ALL, label: t('All') }, ...channelOptions],
    [channelOptions, t]
  )

  const filter = useMemo<ChannelBillingFilter>(
    () => ({
      channelSel: applied.channelSel,
      modelName: applied.modelName.trim(),
      start: applied.start
        ? Math.floor(applied.start.getTime() / 1000)
        : undefined,
      end: applied.end ? Math.floor(applied.end.getTime() / 1000) : undefined,
    }),
    [applied]
  )

  return (
    <div className='space-y-3'>
      <div className='border-border/60 bg-card rounded-xl border p-3 shadow-xs'>
        <div className='flex flex-wrap items-center gap-2'>
          <MultiSelect
            className='min-w-[220px] flex-1'
            options={channelScopeOptions}
            selected={draft.channelSel}
            onChange={(values) =>
              setDraft((current) => ({
                ...current,
                channelSel: normalizeBillingScope(current.channelSel, values),
              }))
            }
            placeholder={t('Select channels')}
            maxVisibleChips={2}
          />

          <Input
            className='h-9 min-w-[160px] flex-1 text-sm'
            value={draft.modelName}
            onChange={(e) =>
              setDraft((current) => ({ ...current, modelName: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') setApplied(draft)
            }}
            placeholder={t('Model name')}
          />

          <CompactDateTimeRangePicker
            start={draft.start}
            end={draft.end}
            onChange={({ start, end }) =>
              setDraft((current) => ({ ...current, start, end }))
            }
          />

          <div className='ml-auto flex items-center gap-2'>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                const next = getDefaultDraft()
                setDraft(next)
                setApplied(next)
              }}
            >
              <RotateCcw />
              {t('Reset')}
            </Button>
            <Button size='sm' onClick={() => setApplied(draft)}>
              <Search />
              {t('Query')}
            </Button>
          </div>
        </div>
        <p className='text-muted-foreground mt-2 text-xs'>
          {t(
            'Reconcile upstream usage by channel using real tokens (never rate-scaled). Estimated cost needs a per-channel price card; without one rows stay token-only.'
          )}
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as ChannelBillingTab)}
      >
        <TabsList>
          <TabsTrigger value='records'>{t('Aggregated Records')}</TabsTrigger>
          <TabsTrigger value='details'>{t('Usage Details')}</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'records' ? (
        <ChannelBillingRecordsTable filter={filter} />
      ) : (
        <ChannelBillingDetailsTable filter={filter} />
      )}
    </div>
  )
}
