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
import { formatTimestampToDate } from '@/lib/format'
import { formatDiscount } from '@/lib/discount'

import { listMyMembers } from '@/features/agents/api'
import type { AgentMember } from '@/features/agents/types'

/**
 * Users who registered with one of this agent's invite codes, together with
 * each member's lifetime successful recharge (face value).
 */
export function AgentMembers() {
  const { t, i18n } = useTranslation()

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(20)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['my-agent-members', pageIndex, pageSize],
    queryFn: async () => {
      const result = await listMyMembers({
        p: pageIndex + 1,
        page_size: pageSize,
      })
      if (!result.success) {
        toast.error(result.message || t('Failed to load members'))
        return { items: [] as AgentMember[], total: 0 }
      }
      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
      }
    },
    placeholderData: (previous) => previous,
  })

  const columns = useMemo<ColumnDef<AgentMember>[]>(
    () => [
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
        size: 200,
      },
      {
        accessorKey: 'discount',
        header: t('Discount'),
        cell: ({ row }) => (
          <span className='font-mono text-sm tabular-nums'>
            {formatDiscount(row.original.discount, i18n.language, t)}
          </span>
        ),
        size: 110,
      },
      {
        accessorKey: 'code',
        header: t('Invite Code'),
        cell: ({ row }) => (
          <span className='font-mono text-xs'>{row.original.code}</span>
        ),
        size: 130,
      },
      {
        accessorKey: 'created_at',
        header: t('Joined'),
        cell: ({ row }) => (
          <span className='text-muted-foreground font-mono text-xs whitespace-nowrap'>
            {formatTimestampToDate(row.original.created_at)}
          </span>
        ),
        size: 165,
      },
      {
        accessorKey: 'total_recharge',
        header: t('Total Recharge'),
        cell: ({ row }) => (
          <span className='font-mono text-sm font-semibold tabular-nums'>
            {/* total_recharge is a currency-unit sum of face values, not quota. */}
            {row.original.total_recharge.toFixed(2)}
          </span>
        ),
        size: 150,
      },
    ],
    [t, i18n.language]
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
      <SectionPageLayout.Title>{t('Members')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <DataTablePage
          table={table}
          columns={columns}
          isLoading={isLoading}
          isFetching={isFetching}
          emptyTitle={t('No Members Found')}
          emptyDescription={t(
            'Users who register with your invite code will appear here.'
          )}
          skeletonKeyPrefix='my-agent-members-skeleton'
          applyHeaderSize
          toolbarProps={{ hideViewOptions: true }}
        />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
