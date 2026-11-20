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
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { formatLocalCurrencyAmount } from '@/lib/currency'
import {
  formatLogQuota,
  formatSubscriptionPoints,
  formatTimestampToDate,
} from '@/lib/format'

import { billingScopeToParam, type BillingFilter } from '../types'
import { BillingStatCards } from './stat-cards'

type Kind = 'instances' | 'usage' | 'orders'
interface LedgerRow {
  id: number
  created_at: number
  user_id: number
  username: string
  plan_id: number
  plan_title: string
  subscription_id: number
  status: string
  source: string
  total: number
  used: number
  remaining: number
  unlimited: boolean
  end_time: number
  points: number
  type: number
  model_name: string
  request_id: string
  money: number
  payment_method: string
  trade_no: string
  points_ratio?: number
  gross_profit_percent?: number
  base_quota?: number
}
interface LedgerData {
  items: LedgerRow[]
  total: number
  stat: {
    request_count: number
    consumed: number
    refunded: number
    current_remaining: number
    unlimited_count: number
    paid_money: number
  }
}
interface Props {
  filter?: BillingFilter
}

/** Subscription ledger reads already-settled records; it never recalculates or writes charges. */
export function SubscriptionBilling(props: Props) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<Kind>('usage')
  const [draft, setDraft] = useState({
    user: '',
    plan: '',
    subscription: '',
    status: '',
    start: '',
    end: '',
  })
  const [applied, setApplied] = useState(draft)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [exporting, setExporting] = useState(false)
  const path = props.filter
    ? '/api/billing/subscription'
    : '/api/subscription/admin/billing'
  const params = useMemo(() => {
    const result: Record<string, string | number | undefined> = { kind }
    if (props.filter) {
      result.user_ids = billingScopeToParam(props.filter.userSel)
      result.org_ids = billingScopeToParam(props.filter.orgSel)
      result.start_timestamp = props.filter.start
      result.end_timestamp = props.filter.end
    } else {
      result.user_ids = applied.user || undefined
      result.start_timestamp = applied.start
        ? Math.floor(new Date(`${applied.start}T00:00:00`).getTime() / 1000)
        : undefined
      result.end_timestamp = applied.end
        ? Math.floor(new Date(`${applied.end}T23:59:59`).getTime() / 1000)
        : undefined
    }
    result.plan_id = applied.plan || undefined
    result.subscription_id =
      kind === 'orders' ? undefined : applied.subscription || undefined
    result.status = kind === 'usage' ? undefined : applied.status || undefined
    return result
  }, [kind, props.filter, applied])
  // A filter change remounts the paginated view so an old page cannot hide matching records.
  const query = useQuery({
    queryKey: ['subscription-billing', path, params, pagination],
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await api.get<{
        success: boolean
        message: string
        data: LedgerData
      }>(path, {
        params: {
          ...params,
          p: pagination.pageIndex + 1,
          page_size: pagination.pageSize,
        },
        disableDuplicate: true,
      })
      if (!res.data.success) throw new Error(res.data.message)
      return res.data.data
    },
  })
  const points = useCallback(
    (value: number) =>
      t('{{value}} points', { value: formatSubscriptionPoints(value) }),
    [t]
  )
  const columns = useMemo<ColumnDef<LedgerRow>[]>(() => {
    const base: ColumnDef<LedgerRow>[] = [
      {
        accessorKey: 'id',
        header: t('ID'),
        cell: ({ row }) => `#${row.original.id}`,
      },
      {
        accessorKey: 'created_at',
        header: t('Time'),
        cell: ({ row }) => formatTimestampToDate(row.original.created_at),
        size: 170,
      },
      {
        accessorKey: 'username',
        header: t('User'),
        cell: ({ row }) =>
          `${row.original.username || '—'} (#${row.original.user_id})`,
      },
      {
        accessorKey: 'plan_title',
        header: t('Subscription Plan'),
        cell: ({ row }) =>
          row.original.plan_title ||
          (row.original.plan_id
            ? `#${row.original.plan_id}`
            : t('Historical information unavailable')),
      },
    ]
    if (kind !== 'orders') {
      base.push({
        accessorKey: 'subscription_id',
        header: t('Subscription ID'),
        cell: ({ row }) => row.original.subscription_id || '—',
      })
    }
    if (kind !== 'orders') {
      base.push(
        {
          accessorKey: 'points_ratio',
          header: t('Points Ratio'),
          cell: ({ row }) => row.original.points_ratio ?? '—',
        },
        {
          accessorKey: 'gross_profit_percent',
          header: t('Expected Gross Profit (%)'),
          cell: ({ row }) =>
            row.original.gross_profit_percent == null
              ? '—'
              : `${row.original.gross_profit_percent}%`,
        }
      )
    }
    if (kind === 'instances') {
      base.push(
        {
          accessorKey: 'status',
          header: t('Status'),
          cell: ({ row }) => t(row.original.status),
        },
        {
          accessorKey: 'source',
          header: t('Source'),
          cell: ({ row }) => t(row.original.source),
        },
        {
          accessorKey: 'total',
          header: t('Total Points'),
          cell: ({ row }) =>
            row.original.unlimited
              ? t('Unlimited')
              : points(row.original.total),
        },
        {
          accessorKey: 'used',
          header: t('Used Points'),
          cell: ({ row }) => points(row.original.used),
        },
        {
          accessorKey: 'remaining',
          header: t('Remaining Points'),
          cell: ({ row }) =>
            row.original.unlimited
              ? t('Unlimited')
              : points(row.original.remaining),
        },
        {
          accessorKey: 'end_time',
          header: t('Expiration Time'),
          cell: ({ row }) => formatTimestampToDate(row.original.end_time),
        }
      )
    }
    if (kind === 'usage') {
      base.push(
        { accessorKey: 'model_name', header: t('Model') },
        {
          accessorKey: 'type',
          header: t('Type'),
          cell: ({ row }) =>
            row.original.type === 6 ? t('Refund') : t('Consume'),
        },
        {
          accessorKey: 'points',
          header: t('Subscription Points'),
          cell: ({ row }) => points(row.original.points),
        },
        {
          accessorKey: 'base_quota',
          header: t('Subscription Base Charge'),
          cell: ({ row }) =>
            row.original.base_quota == null
              ? '—'
              : formatLogQuota(row.original.base_quota),
        },
        { accessorKey: 'request_id', header: t('Request ID') }
      )
    }
    if (kind === 'orders') {
      base.push(
        {
          accessorKey: 'status',
          header: t('Status'),
          cell: ({ row }) => t(row.original.status),
        },
        {
          accessorKey: 'money',
          header: t('Order Amount'),
          cell: ({ row }) => formatLocalCurrencyAmount(row.original.money),
        },
        { accessorKey: 'payment_method', header: t('Payment Method') },
        { accessorKey: 'trade_no', header: t('Order Number') }
      )
    }
    return base
  }, [kind, t, points]) // Point conversion reads the same global display settings as existing subscription views.
  const { table } = useDataTable({
    data: query.data?.items ?? [],
    columns,
    pagination,
    onPaginationChange: setPagination,
    manualPagination: true,
    totalCount: query.data?.total ?? 0,
    autoResetPageIndex: false,
  })
  const stat = query.data?.stat
  const stats =
    kind === 'usage'
      ? [
          { label: t('Requests'), value: stat?.request_count ?? 0 },
          { label: t('Consumed'), value: points(stat?.consumed ?? 0) },
          { label: t('Refunded'), value: points(stat?.refunded ?? 0) },
          {
            label: t('Actual Consumption'),
            value: points((stat?.consumed ?? 0) - (stat?.refunded ?? 0)),
          },
        ]
      : [
          {
            label:
              kind === 'orders'
                ? t('Paid Amount')
                : t('Current Active Remaining Points'),
            value:
              kind === 'orders'
                ? formatLocalCurrencyAmount(stat?.paid_money ?? 0)
                : points(stat?.current_remaining ?? 0),
          },
        ]
  const exportRecords = async () => {
    setExporting(true)
    try {
      const res = await api.get<Blob>(path, {
        params: { ...params, export: 'csv' },
        responseType: 'blob',
        disableDuplicate: true,
      })
      if (res.data.type.includes('json')) {
        const error = JSON.parse(await res.data.text()) as { message?: string }
        throw new Error(error.message || t('Export failed'))
      }
      const url = URL.createObjectURL(res.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `subscription-${kind}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Export failed'))
    } finally {
      setExporting(false)
    }
  }
  return (
    <div className='space-y-3'>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Point spending does not change wallet balances or monetary usage. Historical missing data cannot be reconstructed.'
        )}
      </p>
      <div className='flex flex-wrap items-center gap-2'>
        <Tabs
          value={kind}
          onValueChange={(value) => {
            setKind(value as Kind)
            setDraft({ ...draft, status: '' })
            setApplied({ ...applied, status: '' })
            setPagination({ ...pagination, pageIndex: 0 })
          }}
        >
          <TabsList>
            <TabsTrigger value='usage'>{t('Point Usage Details')}</TabsTrigger>
            <TabsTrigger value='instances'>{t('Plan Points')}</TabsTrigger>
            <TabsTrigger value='orders'>{t('Purchase Records')}</TabsTrigger>
          </TabsList>
        </Tabs>
        {!props.filter && (
          <Input
            className='w-32'
            aria-label={t('User ID')}
            placeholder={t('User ID')}
            type='number'
            min='1'
            value={draft.user}
            onChange={(e) => setDraft({ ...draft, user: e.target.value })}
          />
        )}
        <Input
          className='w-32'
          aria-label={t('Plan ID')}
          placeholder={t('Plan ID')}
          type='number'
          min='1'
          value={draft.plan}
          onChange={(e) => setDraft({ ...draft, plan: e.target.value })}
        />
        {kind !== 'orders' && (
          <Input
            className='w-36'
            aria-label={t('Subscription ID')}
            placeholder={t('Subscription ID')}
            type='number'
            min='1'
            value={draft.subscription}
            onChange={(e) =>
              setDraft({ ...draft, subscription: e.target.value })
            }
          />
        )}
        {kind !== 'usage' && (
          <NativeSelect
            aria-label={t('Status')}
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value })}
          >
            <NativeSelectOption value=''>{t('All Status')}</NativeSelectOption>
            {(kind === 'instances'
              ? ['active', 'expired', 'cancelled']
              : ['pending', 'success', 'expired', 'failed']
            ).map((status) => (
              <NativeSelectOption key={status} value={status}>
                {t(status)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
        {!props.filter && (
          <>
            <Input
              className='w-40'
              aria-label={t('Start Date')}
              type='date'
              value={draft.start}
              onChange={(e) => setDraft({ ...draft, start: e.target.value })}
            />
            <Input
              className='w-40'
              aria-label={t('End Date')}
              type='date'
              value={draft.end}
              onChange={(e) => setDraft({ ...draft, end: e.target.value })}
            />
          </>
        )}
        <Button
          variant='outline'
          onClick={() => {
            setApplied(draft)
            setPagination({ ...pagination, pageIndex: 0 })
          }}
        >
          {t('Search')}
        </Button>
        <Button
          variant='outline'
          disabled={exporting || !query.data?.total}
          onClick={exportRecords}
        >
          {t('Export CSV')}
        </Button>
      </div>
      <Button
        variant='outline'
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        {t('Refresh')}
      </Button>
      {query.isError && (
        <p role='alert' className='text-destructive'>
          {query.error.message}
        </p>
      )}
      {kind === 'instances' && (stat?.unlimited_count ?? 0) > 0 && (
        <p className='text-muted-foreground text-sm'>
          {t('Unlimited plans are excluded from the remaining points total.')}
        </p>
      )}
      <BillingStatCards items={stats} isLoading={query.isLoading} />
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={query.isLoading}
        isFetching={query.isFetching}
        fixedHeight={false}
        paginationInFooter={false}
        emptyTitle={t('No Records Found')}
        toolbarProps={{ hideViewOptions: true }}
      />
    </div>
  )
}
