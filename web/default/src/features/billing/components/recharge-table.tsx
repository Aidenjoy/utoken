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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  DataTablePage,
  TruncatedCell,
  useDataTable,
} from '@/components/data-table'
import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import { Button } from '@/components/ui/button'
import { formatLocalCurrencyAmount } from '@/lib/currency'
import { formatLogQuota, formatTimestampToDate } from '@/lib/format'

import { downloadBillingRecharge, getBillingRecharge } from '../api'
import type { BillingFilter, BillingRechargeRecord } from '../types'
import { BillingStatCards, type BillingStatItem } from './stat-cards'

const SOURCE_META: Record<string, { label: string; variant: StatusVariant }> = {
  online_topup: { label: 'Online Top-up', variant: 'success' },
  user_adjust: { label: 'User Adjust', variant: 'info' },
  org_adjust: { label: 'Org Adjust', variant: 'warning' },
  wallet_transfer_in: { label: 'Wallet Transfer In', variant: 'neutral' },
  wallet_transfer_out: { label: 'Wallet Transfer Out', variant: 'neutral' },
}

/** Sources whose target account is the organization pool rather than a user. */
const ORG_TARGET_SOURCES = new Set(['org_adjust', 'wallet_transfer_in'])

function formatMoney(money: number): string {
  return money > 0 ? formatLocalCurrencyAmount(money) : '-'
}

interface RechargeTableProps {
  filter: BillingFilter
}

export function RechargeTable({ filter }: RechargeTableProps) {
  const { t } = useTranslation()
  const [exporting, setExporting] = useState(false)

  const queryKey = useMemo(
    () => [
      'billing-recharge',
      filter.userSel,
      filter.orgSel,
      filter.start,
      filter.end,
    ],
    [filter.userSel, filter.orgSel, filter.start, filter.end]
  )

  const { data, isLoading, isFetching } = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await getBillingRecharge(filter)
      if (!result.success) {
        toast.error(result.message || t('Failed to load records'))
        return { records: [], stat: undefined }
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

  const columns = useMemo<ColumnDef<BillingRechargeRecord>[]>(
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
        accessorKey: 'source',
        header: t('Type'),
        cell: ({ row }) => {
          const meta = SOURCE_META[row.original.source]
          return (
            <StatusBadge variant={meta?.variant ?? 'neutral'} copyable={false}>
              {meta ? t(meta.label) : row.original.source}
            </StatusBadge>
          )
        },
        size: 120,
      },
      {
        id: 'target',
        header: t('Target'),
        cell: ({ row }) => {
          const record = row.original
          const isOrg = ORG_TARGET_SOURCES.has(record.source)
          // 转移记录在副行标出对手方，一眼看出钱从谁的钱包搬进了哪个企业池
          let secondary: string
          if (record.source === 'wallet_transfer_in') {
            secondary = `← ${record.username}`
          } else if (record.source === 'wallet_transfer_out') {
            secondary = `→ ${record.org_name}`
          } else if (isOrg) {
            secondary = `${t('Organization')} #${record.org_id}`
          } else {
            secondary = `${t('User')} #${record.user_id}`
          }
          return (
            <div className='flex min-w-[140px] flex-col gap-0.5'>
              <TruncatedCell cellClassName='font-medium'>
                {isOrg ? record.org_name : record.username}
              </TruncatedCell>
              <span className='text-muted-foreground text-xs'>{secondary}</span>
            </div>
          )
        },
        size: 180,
      },
      {
        accessorKey: 'quota',
        header: t('Quota Change'),
        cell: ({ row }) => {
          const quota = row.original.quota
          return (
            <span
              className={
                quota < 0
                  ? 'font-mono text-sm font-semibold text-rose-500 tabular-nums'
                  : 'font-mono text-sm font-semibold text-emerald-600 tabular-nums dark:text-emerald-400'
              }
            >
              {quota > 0 ? '+' : ''}
              {formatLogQuota(quota)}
            </span>
          )
        },
        size: 150,
      },
      {
        accessorKey: 'money',
        header: t('Payment Amount'),
        cell: ({ row }) => (
          <span className='font-mono text-sm tabular-nums'>
            {formatMoney(row.original.money)}
          </span>
        ),
        size: 120,
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
      {
        accessorKey: 'operator',
        header: t('Operator'),
        cell: ({ row }) => (
          <TruncatedCell>{row.original.operator || '-'}</TruncatedCell>
        ),
        size: 130,
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
      label: t('Online Recharged'),
      value: formatLogQuota(stat?.online_inflow_quota ?? 0),
      accent: 'bg-emerald-500/70',
    },
    {
      label: t('Offline Recharged'),
      value: formatLogQuota(stat?.offline_inflow_quota ?? 0),
      accent: 'bg-teal-500/70',
    },
    {
      label: t('Transferred to Pool'),
      value: formatLogQuota(stat?.transfer_in_quota ?? 0),
      accent: 'bg-sky-500/70',
    },
    {
      label: t('Total Deducted'),
      value: formatLogQuota(stat?.outflow_quota ?? 0),
      accent: 'bg-rose-500/65',
    },
    {
      label: t('Net Increase'),
      value: formatLogQuota(stat?.total_quota ?? 0),
      accent: 'bg-indigo-500/70',
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
      await downloadBillingRecharge(filter)
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
        skeletonKeyPrefix='billing-recharge-skeleton'
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
    </div>
  )
}
