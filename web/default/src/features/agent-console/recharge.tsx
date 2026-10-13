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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  DataTablePage,
  TruncatedCell,
  useDataTable,
} from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { TableId } from '@/components/table-id'
import { formatTimestampToDate } from '@/lib/format'

import { listMyRecharge } from '@/features/agents/api'
import type { AgentRechargeRecord } from '@/features/agents/types'

// Amount / Money are both stored in currency units (face value vs. paid),
// so they render as plain money — never through the quota formatter.
function formatMoney(value: number): string {
  return value > 0 ? value.toFixed(2) : '-'
}

/**
 * Successful top-ups made by this agent's members (users bound to the
 * agent's invite codes), newest first.
 */
export function AgentRecharge() {
  const { t } = useTranslation()

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(20)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['my-agent-recharge', pageIndex, pageSize],
    queryFn: async () => {
      const result = await listMyRecharge({
        p: pageIndex + 1,
        page_size: pageSize,
      })
      if (!result.success) {
        toast.error(result.message || t('Failed to load records'))
        return { items: [] as AgentRechargeRecord[], total: 0 }
      }
      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
      }
    },
    placeholderData: (previous) => previous,
  })

  const columns = useMemo<ColumnDef<AgentRechargeRecord>[]>(
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
        id: 'member',
        header: t('Member'),
        cell: ({ row }) => (
          <div className='flex min-w-[140px] flex-col gap-0.5'>
            <TruncatedCell cellClassName='font-medium'>
              {row.original.display_name || row.original.username}
            </TruncatedCell>
            <span className='text-muted-foreground text-xs'>
              {row.original.username} · #{row.original.user_id}
            </span>
          </div>
        ),
        size: 160,
      },
      {
        accessorKey: 'amount',
        header: t('Recharge Amount'),
        cell: ({ row }) => (
          <span className='font-mono text-sm font-semibold tabular-nums'>
            {formatMoney(row.original.amount)}
          </span>
        ),
        size: 140,
      },
      {
        accessorKey: 'money',
        header: t('Payment Amount'),
        cell: ({ row }) => (
          <span className='font-mono text-sm tabular-nums'>
            {formatMoney(row.original.money)}
          </span>
        ),
        size: 130,
      },
      {
        accessorKey: 'payment_method',
        header: t('Payment Method'),
        cell: ({ row }) => (
          <TruncatedCell>{row.original.payment_method || '-'}</TruncatedCell>
        ),
        size: 130,
      },
      {
        accessorKey: 'trade_no',
        header: t('Trade No.'),
        cell: ({ row }) => {
          const tradeNo = row.original.trade_no
          if (!tradeNo) return <span className='text-muted-foreground'>-</span>
          return <TableId value={tradeNo} className='w-[150px] text-xs' />
        },
        size: 170,
      },
    ],
    [t]
  )

  const { table } = useDataTable({
    data: data?.items ?? [],
    columns,
    pagination: { pageIndex, pageSize },
    onPaginationChange: (updater) => {
      const next =
        typeof updater === 'function'
          ? updater({ pageIndex, pageSize })
          : updater
      setPageIndex(next.pageIndex)
      setPageSize(next.pageSize)
    },
    manualPagination: true,
    totalCount: data?.total ?? 0,
  })

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Recharge Records')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <DataTablePage
          table={table}
          columns={columns}
          isLoading={isLoading}
          isFetching={isFetching}
          emptyTitle={t('No Records Found')}
          emptyDescription={t(
            'Successful recharges made by your members will appear here.'
          )}
          skeletonKeyPrefix='my-agent-recharge-skeleton'
          applyHeaderSize
          toolbarProps={{ hideViewOptions: true }}
        />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
