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
import { Download } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  DataTablePage,
  TruncatedCell,
  useDataTable,
} from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import { Button } from '@/components/ui/button'
import { formatNumber, formatTimestampToDate } from '@/lib/format'

import { exportChannelBillingDetails, fetchChannelBillingDetails } from '../api'
import type { ChannelBillingDetailRow, ChannelBillingFilter } from '../types'

const LOG_TYPE_REFUND = 6

/**
 * Upstream reconciliation usage for a raw log row, mirroring the backend
 * `Log.UpstreamTokenUsage`: settle rows count 0 (their usage is already carried
 * by the pre-consume backfill row), other rows prefer the upstream column and
 * fall back to the billed column when upstream is 0 (unscaled / legacy rows).
 */
function upstreamUsage(row: ChannelBillingDetailRow): {
  prompt: number
  completion: number
} {
  if (row.task_settle) return { prompt: 0, completion: 0 }
  return {
    prompt:
      row.upstream_prompt_tokens > 0
        ? row.upstream_prompt_tokens
        : row.prompt_tokens,
    completion:
      row.upstream_completion_tokens > 0
        ? row.upstream_completion_tokens
        : row.completion_tokens,
  }
}

interface ChannelBillingDetailsTableProps {
  filter: ChannelBillingFilter
}

export function ChannelBillingDetailsTable({
  filter,
}: ChannelBillingDetailsTableProps) {
  const { t } = useTranslation()
  const [exporting, setExporting] = useState(false)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })

  useEffect(() => {
    setPagination((current) => ({ ...current, pageIndex: 0 }))
  }, [filter.channelSel, filter.modelName, filter.start, filter.end])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'channel-billing-details',
      filter.channelSel,
      filter.modelName,
      filter.start,
      filter.end,
      pagination.pageIndex + 1,
      pagination.pageSize,
    ],
    queryFn: async () => {
      const result = await fetchChannelBillingDetails({
        ...filter,
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      })
      if (!result.success) {
        toast.error(result.message || t('Failed to load records'))
        return { items: [] as ChannelBillingDetailRow[], total: 0 }
      }
      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
      }
    },
    placeholderData: (previousData) => previousData,
  })

  const items = data?.items ?? []

  const columns = useMemo<ColumnDef<ChannelBillingDetailRow>[]>(
    () => [
      {
        accessorKey: 'created_at',
        header: t('Time'),
        cell: ({ row }) => (
          <span className='text-muted-foreground font-mono text-xs whitespace-nowrap'>
            {formatTimestampToDate(row.original.created_at)}
          </span>
        ),
        size: 165,
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
              #{row.original.channel}
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
        accessorKey: 'type',
        header: t('Type'),
        cell: ({ row }) => {
          const isRefund = row.original.type === LOG_TYPE_REFUND
          return (
            <div className='flex flex-col gap-0.5'>
              <StatusBadge
                variant={isRefund ? 'warning' : 'neutral'}
                copyable={false}
              >
                {isRefund ? t('Refund') : t('Consume')}
              </StatusBadge>
              {row.original.task_settle && (
                <span className='text-muted-foreground text-[10px] whitespace-nowrap'>
                  {t('Settle row (not counted)')}
                </span>
              )}
            </div>
          )
        },
        size: 130,
      },
      {
        id: 'upstream_tokens',
        header: t('Upstream Tokens'),
        cell: ({ row }) => {
          const usage = upstreamUsage(row.original)
          return (
            <span className='font-mono text-xs font-medium whitespace-nowrap tabular-nums'>
              {formatNumber(usage.prompt)} / {formatNumber(usage.completion)}
            </span>
          )
        },
        size: 150,
      },
      {
        id: 'billed_tokens',
        header: t('Billed Tokens'),
        meta: { mobileHidden: true },
        cell: ({ row }) => {
          const log = row.original
          const usage = upstreamUsage(log)
          // Highlight rows where the billed (rate-scaled) tokens differ from the
          // real upstream usage — exactly the rows reconciliation must catch.
          const differs =
            usage.prompt !== log.prompt_tokens ||
            usage.completion !== log.completion_tokens
          return (
            <span
              className={
                differs
                  ? 'font-mono text-xs whitespace-nowrap text-amber-600 tabular-nums dark:text-amber-400'
                  : 'text-muted-foreground font-mono text-xs whitespace-nowrap tabular-nums'
              }
            >
              {formatNumber(log.prompt_tokens)} /{' '}
              {formatNumber(log.completion_tokens)}
            </span>
          )
        },
        size: 150,
      },
      {
        accessorKey: 'request_id',
        header: t('Request ID'),
        cell: ({ row }) => {
          const requestId = row.original.request_id
          if (!requestId) {
            return <span className='text-muted-foreground'>-</span>
          }
          return <TableId value={requestId} className='w-[150px] text-xs' />
        },
        size: 170,
      },
    ],
    [t]
  )

  const { table } = useDataTable({
    data: items,
    columns,
    pagination,
    onPaginationChange: setPagination,
    manualPagination: true,
    totalCount: data?.total ?? 0,
    autoResetPageIndex: false,
  })

  const handleExport = async () => {
    setExporting(true)
    try {
      await exportChannelBillingDetails(filter)
    } catch {
      toast.error(t('Export failed'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      isFetching={isFetching}
      fixedHeight={false}
      paginationInFooter={false}
      applyHeaderSize
      emptyTitle={t('No Records Found')}
      emptyDescription={t('No records for the current filter.')}
      skeletonKeyPrefix='channel-billing-details-skeleton'
      toolbarProps={{
        hideViewOptions: true,
        preActions: (
          <Button
            variant='outline'
            size='sm'
            onClick={handleExport}
            disabled={exporting || items.length === 0}
          >
            <Download />
            {exporting ? t('Exporting...') : t('Export CSV')}
          </Button>
        ),
      }}
    />
  )
}
