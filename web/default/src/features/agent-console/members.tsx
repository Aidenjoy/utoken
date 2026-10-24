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
import { Percent, Plus, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  DataTablePage,
  TruncatedCell,
  useDataTable,
} from '@/components/data-table'
import { DataTableRowActionMenu } from '@/components/data-table/core/row-action-menu'
import { SectionPageLayout } from '@/components/layout'
import { StatusBadge } from '@/components/status-badge'
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
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { kickMember, listMyMembers } from '@/features/agents/api'
import type { AgentMember } from '@/features/agents/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatModelDiscount } from '@/lib/discount'
import { formatQuota, formatTimestampToDate } from '@/lib/format'

import { MemberCreateDialog } from './components/member-create-dialog'
import { MemberDiscountDialog } from './components/member-discount-dialog'

/**
 * This agent's individual members: accounts the agent created for them plus
 * users who registered with one of its invite codes. Each row carries the
 * per-model discounts granted to it and its lifetime successful recharge (face
 * value). Membership is what confines these users to the agent's authorized
 * models, so the discount editor is offered right here.
 */
export function AgentMembers() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  // Intl 只认 BCP-47，'zhCN' 直接传给 Intl.NumberFormat 会抛 RangeError。
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [editing, setEditing] = useState<AgentMember | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [kickTarget, setKickTarget] = useState<AgentMember | null>(null)
  const [isWorking, setIsWorking] = useState(false)

  const openDiscountEditor = useCallback((member: AgentMember) => {
    setEditing(member)
    setDialogOpen(true)
  }, [])

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['my-agent-members'] })
  }, [queryClient])

  // 踢出个人成员：解绑其代理商归属并清零授权清单内折扣。企业成员归属随企业，
  // 后端会拒绝并回显文案，这里不额外区分。
  const confirmKick = useCallback(async () => {
    if (!kickTarget) return
    setIsWorking(true)
    try {
      const result = await kickMember(kickTarget.user_id)
      if (!result.success) {
        toast.error(result.message || t('Failed to remove member'))
        return
      }
      toast.success(t('Member removed'))
      setKickTarget(null)
      refresh()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('Failed to remove member'))
    } finally {
      setIsWorking(false)
    }
  }, [kickTarget, refresh, t])

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
        id: 'model_discounts',
        accessorKey: 'model_discounts',
        header: t('Model Discounts'),
        cell: ({ row }) => {
          // 只列本代理有权设置的折扣（后端已按授权清单过滤），排序以免每次渲染换序。
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
      {
        accessorKey: 'quota',
        header: t('Balance'),
        cell: ({ row }) => (
          <span className='font-mono text-sm font-semibold tabular-nums'>
            {/* quota is in quota units; formatQuota renders it as currency. */}
            {formatQuota(row.original.quota ?? 0)}
          </span>
        ),
        size: 130,
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <DataTableRowActionMenu ariaLabel={t('Open menu')} modal={false}>
            <DropdownMenuItem onClick={() => openDiscountEditor(row.original)}>
              {t('Set Discounts')}
              <Percent size={16} />
            </DropdownMenuItem>
            <DropdownMenuItem
              variant='destructive'
              onClick={() => setKickTarget(row.original)}
            >
              {t('Remove')}
              <Trash2 size={16} />
            </DropdownMenuItem>
          </DataTableRowActionMenu>
        ),
        enableSorting: false,
        enableHiding: false,
        meta: { align: 'right' },
        size: 70,
      },
    ],
    [t, locale, openDiscountEditor]
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

  const addMemberButton = (
    <Button size='sm' onClick={() => setCreateOpen(true)}>
      <Plus className='size-4' />
      {t('Add Member')}
    </Button>
  )

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
            'Add a member account, or share your invite code — users who register with it land here.'
          )}
          emptyAction={addMemberButton}
          skeletonKeyPrefix='my-agent-members-skeleton'
          applyHeaderSize
          toolbarProps={{ hideViewOptions: true, preActions: addMemberButton }}
        />
        {/* 必须待在 Content 里：SectionPageLayout 只认自己的四个插槽子节点，
            放在它旁边会被静默丢弃，弹窗永远不会挂载（弹窗自身 portal 到 body，
            不受这里的 overflow-auto 影响）。 */}
        <MemberDiscountDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          member={editing}
          onSuccess={refresh}
        />
        <MemberCreateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSuccess={refresh}
        />
        <AlertDialog
          open={kickTarget !== null}
          onOpenChange={(open) => {
            if (!open) setKickTarget(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('Remove Member')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('Remove {{name}} from your members?', {
                  name: kickTarget?.display_name || kickTarget?.username || '',
                })}
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
                  void confirmKick()
                }}
              >
                {isWorking ? t('Processing...') : t('Remove')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
