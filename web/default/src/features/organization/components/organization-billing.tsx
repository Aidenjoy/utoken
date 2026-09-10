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

import { DataTablePage, useDataTable } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { parseLogOther } from '@/features/usage-logs/lib/format'
import {
  formatNumber,
  formatQuota,
  formatTimestamp,
  formatUseTime,
} from '@/lib/format'

import { getOrgLogs, getOrgMembers } from '../api'
import { ORG_ERROR_MESSAGES, ORG_USAGE_DEFAULT_RANGE_DAYS } from '../constants'
import type { OrgLog, OrgMemberDetail } from '../types'

const ALL_MEMBERS = '0'
const RANGE_OPTIONS = [1, 7, 30, 90] as const

/**
 * Organization billing detail: the consume logs of every member in the pool.
 * A cached response is logged with `quota = 0` and `other.cache_hit`, so those
 * rows are marked instead of looking like free requests.
 */
export function OrganizationBilling() {
  const { t } = useTranslation()

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(20)

  // Draft filters are committed by the Search button, matching the usage page.
  const [draftMember, setDraftMember] = useState(ALL_MEMBERS)
  const [draftModel, setDraftModel] = useState('')
  const [draftDays, setDraftDays] = useState<number>(
    ORG_USAGE_DEFAULT_RANGE_DAYS
  )
  const [applied, setApplied] = useState({
    member: ALL_MEMBERS,
    model: '',
    days: ORG_USAGE_DEFAULT_RANGE_DAYS as number,
  })

  const membersQuery = useQuery({
    queryKey: ['org-members', 'all'],
    queryFn: async () => {
      const result = await getOrgMembers({ p: 1, page_size: 1000 })
      return result.success ? (result.data?.items ?? []) : []
    },
  })

  const timeRange = useMemo(() => {
    const now = Math.floor(Date.now() / 1000)
    return {
      start_timestamp: now - applied.days * 86400,
      end_timestamp: now,
    }
  }, [applied.days])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'org-logs',
      pageIndex,
      pageSize,
      applied.member,
      applied.model,
      timeRange.start_timestamp,
      timeRange.end_timestamp,
    ],
    queryFn: async () => {
      const result = await getOrgLogs({
        p: pageIndex + 1,
        page_size: pageSize,
        user_id: Number(applied.member) || undefined,
        model_name: applied.model.trim() || undefined,
        ...timeRange,
      })
      if (!result.success) {
        toast.error(result.message || t(ORG_ERROR_MESSAGES.LOAD_FAILED))
        return { items: [] as OrgLog[], total: 0 }
      }
      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
      }
    },
    placeholderData: (previous) => previous,
  })

  const applyFilters = () => {
    setPageIndex(0)
    setApplied({ member: draftMember, model: draftModel, days: draftDays })
  }

  const resetFilters = () => {
    setDraftMember(ALL_MEMBERS)
    setDraftModel('')
    setDraftDays(ORG_USAGE_DEFAULT_RANGE_DAYS)
    setPageIndex(0)
    setApplied({
      member: ALL_MEMBERS,
      model: '',
      days: ORG_USAGE_DEFAULT_RANGE_DAYS,
    })
  }

  const columns = useMemo<ColumnDef<OrgLog>[]>(
    () => [
      {
        accessorKey: 'created_at',
        header: t('Time'),
        meta: { mobileTitle: true },
        cell: ({ row }) => (
          <span className='text-muted-foreground text-xs'>
            {formatTimestamp(row.original.created_at)}
          </span>
        ),
        size: 170,
      },
      {
        accessorKey: 'username',
        header: t('Username'),
        cell: ({ row }) => (
          <span className='max-w-[160px] truncate font-medium'>
            {row.original.username || `#${row.original.user_id}`}
          </span>
        ),
        size: 160,
      },
      {
        accessorKey: 'token_name',
        header: t('API Key'),
        meta: { mobileHidden: true },
        cell: ({ row }) => (
          <span className='text-muted-foreground max-w-[160px] truncate text-xs'>
            {row.original.token_name || '-'}
          </span>
        ),
        size: 160,
      },
      {
        accessorKey: 'model_name',
        header: t('Model'),
        cell: ({ row }) => (
          <span className='max-w-[200px] truncate font-mono text-xs'>
            {row.original.model_name || '-'}
          </span>
        ),
        size: 200,
      },
      {
        accessorKey: 'quota',
        header: t('Quota'),
        meta: { mobileBadge: true, align: 'right' },
        cell: ({ row }) => {
          const other = row.original.other
            ? parseLogOther(row.original.other)
            : null
          return (
            <div className='flex flex-col items-end gap-1'>
              <span className='text-xs tabular-nums'>
                {formatQuota(row.original.quota)}
              </span>
              {other?.cache_hit ? (
                <StatusBadge
                  label={t('Cache Hit')}
                  variant='purple'
                  copyable={false}
                />
              ) : null}
            </div>
          )
        },
        size: 130,
      },
      {
        accessorKey: 'prompt_tokens',
        header: t('Tokens'),
        meta: { mobileHidden: true },
        cell: ({ row }) => (
          <span className='text-muted-foreground text-xs tabular-nums'>
            {formatNumber(row.original.prompt_tokens)} +{' '}
            {formatNumber(row.original.completion_tokens)}
          </span>
        ),
        size: 130,
      },
      {
        accessorKey: 'use_time',
        header: t('Time Used'),
        meta: { mobileHidden: true },
        cell: ({ row }) => (
          <span className='text-muted-foreground text-xs tabular-nums'>
            {formatUseTime(row.original.use_time)}
          </span>
        ),
        size: 110,
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
    manualFiltering: true,
    totalCount: data?.total ?? 0,
  })

  const memberOptions = (membersQuery.data ?? []) as OrgMemberDetail[]
  const hasFilters =
    applied.member !== ALL_MEMBERS ||
    applied.model !== '' ||
    applied.days !== ORG_USAGE_DEFAULT_RANGE_DAYS

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      isFetching={isFetching}
      emptyTitle={t('No Billing Records')}
      emptyDescription={t(
        'Requests made by organization members with their own keys appear here.'
      )}
      skeletonKeyPrefix='org-billing-skeleton'
      applyHeaderSize
      toolbarProps={{
        customSearch: (
          <div className='flex flex-wrap items-center gap-2'>
            <Select
              value={draftMember}
              onValueChange={(value) => setDraftMember(value ?? ALL_MEMBERS)}
            >
              <SelectTrigger className='w-full sm:w-[180px]'>
                <SelectValue placeholder={t('All Members')} />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectItem value={ALL_MEMBERS}>{t('All Members')}</SelectItem>
                {memberOptions.map((member) => (
                  <SelectItem
                    key={member.user_id}
                    value={String(member.user_id)}
                  >
                    {member.username || `#${member.user_id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(draftDays)}
              onValueChange={(value) => {
                if (value) setDraftDays(Number(value))
              }}
            >
              <SelectTrigger className='w-full sm:w-[130px]'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {RANGE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option === 1
                      ? t('24 Hours')
                      : t('{{days}} Days', { days: option })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ),
        additionalSearch: (
          <Input
            placeholder={t('Filter by model...')}
            aria-label={t('Filter by model...')}
            value={draftModel}
            onChange={(event) => setDraftModel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') applyFilters()
            }}
            className='w-full sm:w-[180px]'
          />
        ),
        hasAdditionalFilters: hasFilters,
        onReset: resetFilters,
        onSearch: applyFilters,
        searchLoading: isFetching,
      }}
    />
  )
}
