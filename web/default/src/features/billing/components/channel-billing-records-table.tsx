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
import type { ColumnDef } from '@tanstack/react-table'
import { Download, Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  DataTablePage,
  TruncatedCell,
  useDataTable,
} from '@/components/data-table'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatLogQuota, formatNumber } from '@/lib/format'

import { exportChannelBillingRecords, fetchChannelBillingRecords } from '../api'
import type { ChannelBillingFilter, ChannelBillingRecord } from '../types'
import { ChannelPricesDialog } from './channel-prices-dialog'
import { BillingStatCards, type BillingStatItem } from './stat-cards'

interface ChannelBillingRecordsTableProps {
  filter: ChannelBillingFilter
}

export function ChannelBillingRecordsTable({
  filter,
}: ChannelBillingRecordsTableProps) {
  const { t } = useTranslation()
  const [exporting, setExporting] = useState(false)
  const [priceChannel, setPriceChannel] = useState<{
    id: number
    name: string
  } | null>(null)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'channel-billing-records',
      filter.channelSel,
      filter.modelName,
      filter.start,
      filter.end,
    ],
    queryFn: async () => {
      const result = await fetchChannelBillingRecords(filter)
      if (!result.success) {
        toast.error(result.message || t('Failed to load records'))
        return { records: [] as ChannelBillingRecord[], stat: undefined }
      }
      return {
        records: result.data?.records ?? [],
        stat: result.data?.stat,
      }
    },
    placeholderData: (previousData) => previousData,
  })

  const records = data?.records ?? []
  const stat = data?.stat

  const columns = useMemo<ColumnDef<ChannelBillingRecord>[]>(
    () => [
      {
        accessorKey: 'date',
        header: t('Date'),
        cell: ({ row }) => (
          <span className='text-muted-foreground font-mono text-xs whitespace-nowrap'>
            {/* Backend buckets by UTC day (Truncate(24h)); format in UTC so the
                shown date always matches the bucket, regardless of local tz. */}
            {new Date(row.original.date * 1000).toISOString().slice(0, 10)}
          </span>
        ),
        size: 120,
      },
      {
        accessorKey: 'channel_name',
        header: t('Channel'),
        cell: ({ row }) => (
          <div className='flex min-w-[140px] flex-col gap-0.5'>
            <TruncatedCell cellClassName='font-medium'>
              {row.original.channel_name || '-'}
            </TruncatedCell>
            <span className='text-muted-foreground text-xs'>
              #{row.original.channel_id}
            </span>
          </div>
        ),
        size: 170,
      },
      {
        accessorKey: 'model_name',
        header: t('Model'),
        cell: ({ row }) => (
          <TruncatedCell cellClassName='font-mono text-xs'>
            {row.original.model_name || '-'}
          </TruncatedCell>
        ),
        size: 170,
      },
      {
        accessorKey: 'request_count',
        header: t('Requests'),
        cell: ({ row }) => (
          <span className='font-mono text-xs tabular-nums'>
            {formatNumber(row.original.request_count)}
          </span>
        ),
        size: 100,
      },
      {
        accessorKey: 'prompt_tokens',
        header: t('Upstream Input Tokens'),
        meta: { mobileHidden: true },
        cell: ({ row }) => (
          <span className='text-muted-foreground font-mono text-xs tabular-nums'>
            {formatNumber(row.original.prompt_tokens)}
          </span>
        ),
        size: 140,
      },
      {
        accessorKey: 'completion_tokens',
        header: t('Upstream Output Tokens'),
        meta: { mobileHidden: true },
        cell: ({ row }) => (
          <span className='text-muted-foreground font-mono text-xs tabular-nums'>
            {formatNumber(row.original.completion_tokens)}
          </span>
        ),
        size: 140,
      },
      {
        accessorKey: 'total_tokens',
        header: t('Upstream Total Tokens'),
        cell: ({ row }) => (
          <span className='font-mono text-xs font-medium tabular-nums'>
            {formatNumber(row.original.total_tokens)}
          </span>
        ),
        size: 140,
      },
      {
        accessorKey: 'estimated_cost_quota',
        header: t('Estimated Cost'),
        cell: ({ row }) => {
          // Without a rate card the cost is unknown, not zero: show an explicit
          // dash + tooltip so unpriced usage is never silently counted as $0.
          if (!row.original.price_configured) {
            return (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className='text-muted-foreground/70 cursor-help font-mono text-xs' />
                    }
                  >
                    —
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('No upstream price configured for this channel/model')}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )
          }
          return (
            <span className='font-mono text-xs font-semibold text-rose-500 tabular-nums'>
              {formatLogQuota(row.original.estimated_cost_quota)}
            </span>
          )
        },
        size: 140,
      },
      {
        id: 'actions',
        header: t('Actions'),
        cell: ({ row }) => (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    onClick={() =>
                      setPriceChannel({
                        id: row.original.channel_id,
                        name: row.original.channel_name,
                      })
                    }
                  >
                    <Settings2 className='size-4' />
                  </Button>
                }
              />
              <TooltipContent>{t('Upstream Prices')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ),
        size: 70,
      },
    ],
    [t]
  )

  const { table } = useDataTable({
    data: records,
    columns,
    initialPagination: { pageIndex: 0, pageSize: 20 },
    autoResetPageIndex: true,
  })

  const statItems: BillingStatItem[] = [
    {
      label: t('Requests'),
      value: formatNumber(stat?.request_count ?? 0),
      accent: 'bg-slate-400/70',
    },
    {
      label: t('Upstream Total Tokens'),
      value: formatNumber(stat?.total_tokens ?? 0),
      accent: 'bg-sky-500/70',
    },
    {
      label: t('Estimated Cost'),
      value: formatLogQuota(stat?.estimated_cost_quota ?? 0),
      accent: 'bg-rose-500/65',
    },
    {
      label: t('Channels'),
      value: `${stat?.priced_channel_count ?? 0} / ${stat?.channel_count ?? 0}`,
      accent: 'bg-violet-500/70',
    },
    {
      label: t('Unpriced Records'),
      value: formatNumber(stat?.unpriced_record_count ?? 0),
      accent: 'bg-amber-500/70',
    },
  ]

  const handleExport = async () => {
    setExporting(true)
    try {
      await exportChannelBillingRecords(filter)
    } catch {
      toast.error(t('Export failed'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className='space-y-3'>
      <BillingStatCards items={statItems} isLoading={isLoading} />
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={isLoading}
        isFetching={isFetching}
        fixedHeight={false}
        paginationInFooter={false}
        emptyTitle={t('No Records Found')}
        emptyDescription={t('No records for the current filter.')}
        skeletonKeyPrefix='channel-billing-records-skeleton'
        toolbarProps={{
          hideViewOptions: true,
          preActions: (
            <Button
              variant='outline'
              size='sm'
              onClick={handleExport}
              disabled={exporting || records.length === 0}
            >
              <Download />
              {exporting ? t('Exporting...') : t('Export CSV')}
            </Button>
          ),
        }}
      />
      <ChannelPricesDialog
        channel={priceChannel}
        open={priceChannel !== null}
        onOpenChange={(open) => {
          if (!open) setPriceChannel(null)
        }}
      />
    </div>
  )
}
