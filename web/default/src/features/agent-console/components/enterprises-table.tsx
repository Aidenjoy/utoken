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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Percent, Plus, Users } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  DataTablePage,
  TruncatedCell,
  useDataTable,
} from '@/components/data-table'
import { DataTableRowActionMenu } from '@/components/data-table/core/row-action-menu'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { listMyEnterprises } from '@/features/agents/api'
import type { AgentOrganization } from '@/features/agents/types'
import { ORG_STATUS } from '@/features/organization/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatModelDiscount } from '@/lib/discount'
import { formatQuota, formatTimestampToDate } from '@/lib/format'

import { CreateEnterpriseDialog } from './create-enterprise-dialog'
import { EnterpriseDiscountDialog } from './enterprise-discount-dialog'
import { EnterpriseMembersDialog } from './enterprise-members-dialog'

/**
 * The enterprises (organizations) this agent develops. Each row is an org bound
 * to this agent: its shared pool, the enterprise-wide per-model discount the
 * agent may set within its own floors, and the admin-controlled personal-wallet
 * lockdown. The agent prices the enterprise and views its roster, but never
 * manages membership or the pool balance directly — funding arrives via an
 * admin's offline adjustment or the enterprise admin's own online top-up.
 */
export function EnterprisesTable() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  // Intl 只认 BCP-47，'zhCN' 直接传给 Intl.NumberFormat 会抛 RangeError。
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [createOpen, setCreateOpen] = useState(false)
  const [discountTarget, setDiscountTarget] = useState<AgentOrganization | null>(
    null
  )
  const [discountOpen, setDiscountOpen] = useState(false)
  const [membersTarget, setMembersTarget] = useState<AgentOrganization | null>(
    null
  )
  const [membersOpen, setMembersOpen] = useState(false)

  const openDiscountEditor = useCallback((org: AgentOrganization) => {
    setDiscountTarget(org)
    setDiscountOpen(true)
  }, [])

  const openMembers = useCallback((org: AgentOrganization) => {
    setMembersTarget(org)
    setMembersOpen(true)
  }, [])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['my-agent-enterprises', pageIndex, pageSize],
    queryFn: async () => {
      const result = await listMyEnterprises({
        p: pageIndex + 1,
        page_size: pageSize,
      })
      if (!result.success) {
        toast.error(result.message || t('Failed to load enterprises'))
        return { items: [] as AgentOrganization[], total: 0 }
      }
      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
      }
    },
    placeholderData: (previous) => previous,
  })

  const columns = useMemo<ColumnDef<AgentOrganization>[]>(
    () => [
      {
        id: 'enterprise',
        header: t('Enterprise'),
        cell: ({ row }) => (
          <div className='flex min-w-[160px] flex-col gap-0.5'>
            <TruncatedCell cellClassName='font-medium'>
              {row.original.display_name || row.original.name}
            </TruncatedCell>
            <span className='text-muted-foreground text-xs'>
              {row.original.name} · #{row.original.id}
            </span>
          </div>
        ),
        size: 220,
      },
      {
        accessorKey: 'group',
        header: t('Group'),
        cell: ({ row }) => (
          <StatusBadge
            label={row.original.group || '-'}
            variant='neutral'
            copyable={false}
          />
        ),
        size: 120,
      },
      {
        accessorKey: 'quota',
        header: t('Pool Balance'),
        cell: ({ row }) => (
          <span className='font-mono text-sm font-semibold tabular-nums'>
            {formatQuota(row.original.quota ?? 0)}
          </span>
        ),
        size: 130,
      },
      {
        id: 'model_discounts',
        accessorKey: 'model_discounts',
        header: t('Model Discounts'),
        cell: ({ row }) => {
          const entries = Object.entries(
            row.original.model_discounts ?? {}
          ).sort(([a], [b]) => a.localeCompare(b))
          if (entries.length === 0) {
            return (
              <span className='text-muted-foreground text-xs'>
                {t('Original price')}
              </span>
            )
          }
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={<span />}>
                  <StatusBadge
                    label={t('{{total}} discounted', { total: entries.length })}
                    variant='info'
                    copyable={false}
                  />
                </TooltipTrigger>
                <TooltipContent side='top' className='max-w-xs'>
                  <ul className='space-y-0.5'>
                    {entries.map(([model, ratio]) => (
                      <li key={model} className='flex items-center gap-2'>
                        <span className='font-mono'>{model}</span>
                        <span className='text-background/70 ml-auto font-mono tabular-nums'>
                          {formatModelDiscount(ratio, locale)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )
        },
        size: 150,
      },
      {
        id: 'personal_wallet',
        header: t('Personal Wallet'),
        cell: ({ row }) =>
          row.original.disable_personal_wallet ? (
            <StatusBadge
              label={t('Disabled')}
              variant='warning'
              copyable={false}
            />
          ) : (
            <StatusBadge
              label={t('Enabled')}
              variant='neutral'
              copyable={false}
            />
          ),
        size: 130,
      },
      {
        accessorKey: 'status',
        header: t('Status'),
        cell: ({ row }) =>
          row.original.status === ORG_STATUS.ENABLED ? (
            <StatusBadge
              label={t('Enabled')}
              variant='success'
              copyable={false}
            />
          ) : (
            <StatusBadge
              label={t('Disabled')}
              variant='neutral'
              copyable={false}
            />
          ),
        size: 110,
      },
      {
        accessorKey: 'created_at',
        header: t('Created'),
        cell: ({ row }) => (
          <span className='text-muted-foreground font-mono text-xs whitespace-nowrap'>
            {row.original.created_at
              ? formatTimestampToDate(row.original.created_at)
              : '-'}
          </span>
        ),
        size: 165,
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <DataTableRowActionMenu ariaLabel={t('Open menu')} modal={false}>
            <DropdownMenuItem
              onClick={() => openDiscountEditor(row.original)}
            >
              {t('Set Discounts')}
              <Percent size={16} />
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openMembers(row.original)}>
              {t('View Members')}
              <Users size={16} />
            </DropdownMenuItem>
          </DataTableRowActionMenu>
        ),
        enableSorting: false,
        enableHiding: false,
        meta: { align: 'right' },
        size: 70,
      },
    ],
    [t, locale, openDiscountEditor, openMembers]
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

  const primaryButtons = (
    <Button size='sm' onClick={() => setCreateOpen(true)}>
      <Plus className='size-4' />
      {t('Create Enterprise')}
    </Button>
  )

  return (
    <>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={isLoading}
        isFetching={isFetching}
        emptyTitle={t('No Enterprises Found')}
        emptyDescription={t(
          'Create an enterprise to develop a team customer with a shared pool.'
        )}
        emptyAction={primaryButtons}
        skeletonKeyPrefix='my-agent-enterprises-skeleton'
        applyHeaderSize
        toolbarProps={{
          hideViewOptions: true,
          preActions: primaryButtons,
        }}
      />

      <CreateEnterpriseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() =>
          void queryClient.invalidateQueries({
            queryKey: ['my-agent-enterprises'],
          })
        }
      />
      <EnterpriseDiscountDialog
        open={discountOpen}
        onOpenChange={setDiscountOpen}
        enterprise={discountTarget}
        onSuccess={() =>
          void queryClient.invalidateQueries({
            queryKey: ['my-agent-enterprises'],
          })
        }
      />
      <EnterpriseMembersDialog
        open={membersOpen}
        onOpenChange={setMembersOpen}
        enterprise={membersTarget}
      />
    </>
  )
}
