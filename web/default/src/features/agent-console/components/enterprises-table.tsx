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
import {
  Ban,
  CircleCheck,
  Edit,
  Percent,
  Plus,
  Trash2,
  Users,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { DataTableRowActionMenu } from '@/components/data-table/core/row-action-menu'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  deleteMyEnterprise,
  listMyEnterprises,
  updateMyEnterpriseStatus,
} from '@/features/agents/api'
import type { AgentOrganization } from '@/features/agents/types'
import { ORG_STATUSES } from '@/features/organization/constants'
import { ORG_STATUS } from '@/features/organization/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatModelDiscount } from '@/lib/discount'
import { formatQuota, formatTimestamp } from '@/lib/format'

import { EnterpriseDiscountDialog } from './enterprise-discount-dialog'
import { EnterpriseMembersDialog } from './enterprise-members-dialog'
import { EnterpriseMutateDialog } from './enterprise-mutate-dialog'

type PendingAction =
  | { kind: 'status'; enterprise: AgentOrganization }
  | { kind: 'delete'; enterprise: AgentOrganization }
  | null

/**
 * The enterprises (organizations) this agent develops, laid out like the
 * system-administrator organization list so both consoles read the same way.
 * The agent gets every management affordance except pool funding: edit the two
 * name fields, set the enterprise-wide per-model discount within its own
 * floors, manage the roster, toggle status and delete an emptied enterprise.
 * Funding arrives via an admin's offline adjustment or the enterprise admin's
 * own online top-up, so there is deliberately no quota control here.
 */
export function EnterprisesTable() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  // Intl 只认 BCP-47，'zhCN' 直接传给 Intl.NumberFormat 会抛 RangeError。
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')

  const [mutateOpen, setMutateOpen] = useState(false)
  const [editing, setEditing] = useState<AgentOrganization | null>(null)
  const [discountTarget, setDiscountTarget] =
    useState<AgentOrganization | null>(null)
  const [membersTarget, setMembersTarget] = useState<AgentOrganization | null>(
    null
  )
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [isWorking, setIsWorking] = useState(false)

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['my-agent-enterprises'] })
  }, [queryClient])

  const openEdit = useCallback((enterprise: AgentOrganization | null) => {
    setEditing(enterprise)
    setMutateOpen(true)
  }, [])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['my-agent-enterprises', pageIndex, pageSize, keyword],
    queryFn: async () => {
      const result = await listMyEnterprises({
        p: pageIndex + 1,
        page_size: pageSize,
        keyword: keyword.trim() || undefined,
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
        accessorKey: 'id',
        header: t('ID'),
        meta: { mobileHidden: true },
        cell: ({ row }) => (
          <TableId value={row.original.id} className='w-[60px]' />
        ),
        size: 80,
      },
      {
        accessorKey: 'name',
        header: t('Enterprise'),
        meta: { mobileTitle: true },
        cell: ({ row }) => (
          <div className='flex flex-col'>
            <span className='max-w-[220px] truncate font-medium'>
              {row.original.display_name || row.original.name}
            </span>
            {row.original.display_name ? (
              <span className='text-muted-foreground max-w-[220px] truncate font-mono text-xs'>
                {row.original.name}
              </span>
            ) : null}
          </div>
        ),
        size: 220,
      },
      {
        accessorKey: 'group',
        header: t('Group'),
        meta: { mobileBadge: true },
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
        accessorKey: 'status',
        header: t('Status'),
        meta: { mobileBadge: true },
        cell: ({ row }) => {
          const config = ORG_STATUSES[row.original.status]
          if (!config) return <span className='text-muted-foreground'>-</span>
          return (
            <StatusBadge
              label={t(config.labelKey)}
              variant={config.variant}
              copyable={false}
            />
          )
        },
        size: 110,
      },
      {
        accessorKey: 'quota',
        header: t('Pool Quota'),
        cell: ({ row }) => (
          <div className='flex flex-col text-xs'>
            <span className='tabular-nums'>
              {t('Balance:')} {formatQuota(row.original.quota ?? 0)}
            </span>
            <span className='text-muted-foreground tabular-nums'>
              {t('Used:')} {formatQuota(row.original.used_quota ?? 0)}
            </span>
          </div>
        ),
        size: 170,
      },
      {
        id: 'model_discounts',
        accessorKey: 'model_discounts',
        header: t('Model Discounts'),
        meta: { mobileHidden: true },
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
        meta: { mobileHidden: true },
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
        accessorKey: 'created_at',
        header: t('Created At'),
        meta: { mobileHidden: true },
        cell: ({ row }) => (
          <span className='text-muted-foreground text-xs'>
            {row.original.created_at
              ? formatTimestamp(row.original.created_at)
              : '-'}
          </span>
        ),
        size: 170,
      },
      {
        id: 'actions',
        cell: ({ row }) => {
          const enterprise = row.original
          const isEnabled = enterprise.status === ORG_STATUS.ENABLED
          return (
            <DataTableRowActionMenu ariaLabel={t('Open menu')} modal={false}>
              <DropdownMenuItem onClick={() => openEdit(enterprise)}>
                {t('Edit')}
                <Edit size={16} />
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDiscountTarget(enterprise)}>
                {t('Model Discounts')}
                <Percent size={16} />
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setMembersTarget(enterprise)}>
                {t('View Members')}
                <Users size={16} />
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setPendingAction({ kind: 'status', enterprise })}
              >
                {isEnabled ? t('Disable') : t('Enable')}
                {isEnabled ? <Ban size={16} /> : <CircleCheck size={16} />}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setPendingAction({ kind: 'delete', enterprise })}
                className='text-destructive focus:text-destructive'
              >
                {t('Delete')}
                <Trash2 size={16} />
              </DropdownMenuItem>
            </DataTableRowActionMenu>
          )
        },
        enableSorting: false,
        enableHiding: false,
        meta: { align: 'right' },
        size: 90,
      },
    ],
    [t, locale, openEdit]
  )

  const { table } = useDataTable({
    data: data?.items ?? [],
    columns,
    globalFilter: keyword,
    onGlobalFilterChange: (value) => {
      setKeyword(value)
      setPageIndex(0)
    },
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

  const runPendingAction = async () => {
    if (!pendingAction) return
    const { kind, enterprise } = pendingAction
    setIsWorking(true)
    try {
      if (kind === 'status') {
        const nextStatus =
          enterprise.status === ORG_STATUS.ENABLED
            ? ORG_STATUS.DISABLED
            : ORG_STATUS.ENABLED
        const result = await updateMyEnterpriseStatus(enterprise.id, nextStatus)
        if (!result.success) {
          toast.error(result.message || t('Failed to update enterprise status'))
          return
        }
        toast.success(t('Updated successfully'))
      } else {
        const result = await deleteMyEnterprise(enterprise.id)
        if (!result.success) {
          toast.error(result.message || t('Failed to delete enterprise'))
          return
        }
        toast.success(t('Deleted successfully'))
      }
      setPendingAction(null)
      refresh()
    } finally {
      setIsWorking(false)
    }
  }

  const primaryButtons = (
    <Button size='sm' onClick={() => openEdit(null)}>
      <Plus className='size-4' />
      {t('Create Enterprise')}
    </Button>
  )

  const isDelete = pendingAction?.kind === 'delete'
  const pendingName =
    pendingAction?.enterprise.display_name ||
    pendingAction?.enterprise.name ||
    ''
  const isEnabled = pendingAction?.enterprise.status === ORG_STATUS.ENABLED

  // One dialog covers the three confirmations; resolve the copy up front so the
  // JSX below stays flat.
  let pendingDescription = ''
  let pendingConfirmLabel = t('Enable')
  if (isDelete) {
    pendingDescription = t(
      'Delete {{name}}? Only enterprises without members can be deleted; remove every member first.',
      { name: pendingName }
    )
    pendingConfirmLabel = t('Delete')
  } else if (isEnabled) {
    pendingDescription = t(
      'Disable {{name}}? Member requests stop using the shared pool immediately.',
      { name: pendingName }
    )
    pendingConfirmLabel = t('Disable')
  } else {
    pendingDescription = t('Enable {{name}}?', { name: pendingName })
    pendingConfirmLabel = t('Enable')
  }

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
          searchPlaceholder: t('Search by name or display name...'),
          searchDebounceMs: 300,
          preActions: primaryButtons,
        }}
      />

      <EnterpriseMutateDialog
        open={mutateOpen}
        enterprise={editing}
        onOpenChange={setMutateOpen}
        onSuccess={refresh}
      />

      <EnterpriseDiscountDialog
        open={discountTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDiscountTarget(null)
        }}
        enterprise={discountTarget}
        onSuccess={refresh}
      />

      <EnterpriseMembersDialog
        open={membersTarget !== null}
        onOpenChange={(open) => {
          if (!open) setMembersTarget(null)
        }}
        enterprise={membersTarget}
      />

      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isDelete ? t('Delete Enterprise') : t('Change Status')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isWorking}>
              {t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isWorking}
              onClick={(event) => {
                event.preventDefault()
                void runPendingAction()
              }}
            >
              {isWorking ? t('Processing...') : pendingConfirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
