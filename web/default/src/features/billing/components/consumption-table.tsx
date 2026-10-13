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
import {
  formatLogQuota,
  formatNumber,
  formatTimestampToDate,
} from '@/lib/format'

import { downloadBillingConsumption, getBillingConsumption } from '../api'
import type {
  BillingConsumptionRow,
  BillingConsumptionStat,
  BillingFilter,
} from '../types'
import { BillingStatCards, type BillingStatItem } from './stat-cards'

const LOG_TYPE_REFUND = 6

// Stable references so the column memo does not re-evaluate on every render.
const EMPTY_ORG_MAP: Record<string, number> = {}
const EMPTY_ORG_NAMES: Record<string, string> = {}

interface ConsumptionTableProps {
  filter: BillingFilter
}

export function ConsumptionTable({ filter }: ConsumptionTableProps) {
  const { t } = useTranslation()
  const [exporting, setExporting] = useState(false)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })

  useEffect(() => {
    setPagination((current) => ({ ...current, pageIndex: 0 }))
  }, [filter.userSel, filter.orgSel, filter.start, filter.end])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'billing-consumption',
      filter.userSel,
      filter.orgSel,
      filter.start,
      filter.end,
      pagination.pageIndex + 1,
      pagination.pageSize,
    ],
    queryFn: async () => {
      const result = await getBillingConsumption({
        ...filter,
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      })
      if (!result.success) {
        toast.error(result.message || t('Failed to load records'))
        return {
          items: [] as BillingConsumptionRow[],
          total: 0,
          stat: undefined as BillingConsumptionStat | undefined,
          orgOf: EMPTY_ORG_MAP,
          orgNames: EMPTY_ORG_NAMES,
        }
      }
      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
        stat: result.data?.stat,
        orgOf: result.data?.user_org ?? EMPTY_ORG_MAP,
        orgNames: result.data?.org_names ?? EMPTY_ORG_NAMES,
      }
    },
    placeholderData: (previousData) => previousData,
  })

  const items = data?.items ?? []
  const stat = data?.stat
  const orgOf = data?.orgOf ?? EMPTY_ORG_MAP
  const orgNames = data?.orgNames ?? EMPTY_ORG_NAMES

  const columns = useMemo<ColumnDef<BillingConsumptionRow>[]>(
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
        accessorKey: 'username',
        header: t('User'),
        cell: ({ row }) => (
          <div className='flex min-w-[130px] flex-col gap-0.5'>
            <TruncatedCell cellClassName='font-medium'>
              {row.original.username || '-'}
            </TruncatedCell>
            <span className='text-muted-foreground text-xs'>
              #{row.original.user_id}
            </span>
          </div>
        ),
        size: 160,
      },
      {
        id: 'organization',
        header: t('Organization'),
        cell: ({ row }) => {
          const orgId = orgOf[String(row.original.user_id)]
          if (!orgId) return <span className='text-muted-foreground'>-</span>
          return (
            <TruncatedCell>
              {orgNames[String(orgId)] || `#${orgId}`}
            </TruncatedCell>
          )
        },
        size: 150,
      },
      {
        accessorKey: 'token_name',
        header: t('Token'),
        cell: ({ row }) => (
          <TruncatedCell>{row.original.token_name || '-'}</TruncatedCell>
        ),
        size: 140,
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
            <StatusBadge
              variant={isRefund ? 'warning' : 'neutral'}
              copyable={false}
            >
              {isRefund ? t('Refund') : t('Consume')}
            </StatusBadge>
          )
        },
        size: 100,
      },
      {
        accessorKey: 'quota',
        header: t('Quota Change'),
        cell: ({ row }) => {
          const isRefund = row.original.type === LOG_TYPE_REFUND
          const quota = isRefund ? -row.original.quota : row.original.quota
          return (
            <span
              className={
                quota < 0
                  ? 'font-mono text-sm font-semibold text-emerald-600 tabular-nums dark:text-emerald-400'
                  : 'font-mono text-sm font-semibold text-rose-500 tabular-nums'
              }
            >
              {quota > 0 ? '-' : '+'}
              {formatLogQuota(Math.abs(quota))}
            </span>
          )
        },
        size: 150,
      },
      {
        id: 'tokens',
        header: t('Tokens'),
        cell: ({ row }) => (
          <span className='text-muted-foreground font-mono text-xs whitespace-nowrap tabular-nums'>
            {formatNumber(row.original.prompt_tokens)} /{' '}
            {formatNumber(row.original.completion_tokens)}
          </span>
        ),
        size: 140,
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
    [orgNames, orgOf, t]
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

  const statItems: BillingStatItem[] = [
    {
      label: t('Requests'),
      value: formatNumber(stat?.request_count ?? 0),
      accent: 'bg-slate-400/70',
    },
    {
      label: t('Consumed'),
      value: formatLogQuota(stat?.consume_quota ?? 0),
      accent: 'bg-rose-500/65',
    },
    {
      label: t('Refunded'),
      value: formatLogQuota(stat?.refund_quota ?? 0),
      accent: 'bg-emerald-500/70',
    },
    {
      label: t('Actual Consumption'),
      value: formatLogQuota(
        (stat?.consume_quota ?? 0) - (stat?.refund_quota ?? 0)
      ),
      accent: 'bg-violet-500/70',
    },
    {
      label: t('Current Balance'),
      value: formatLogQuota(stat?.balance_quota ?? 0),
      accent: 'bg-amber-500/70',
    },
  ]

  const handleExport = async () => {
    setExporting(true)
    try {
      await downloadBillingConsumption(filter)
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
        applyHeaderSize
        emptyTitle={t('No Records Found')}
        emptyDescription={t('No records for the current filter.')}
        skeletonKeyPrefix='billing-consumption-skeleton'
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
    </div>
  )
}
