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
import { Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DataTablePage, useDataTable } from '@/components/data-table'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { listAllCodes, updateAdminCode } from '../api'
import { DISCOUNT_CODE_STATUS, OWNER_TYPE, type DiscountCode } from '../types'
import { useCodeColumns } from './code-columns'
import { SetCodeDialog } from './set-code-dialog'

const ALL_OWNERS = 'all'

type PendingAction = { kind: 'status'; code: DiscountCode } | null

/**
 * System-administrator view of every discount invite code (admin- and
 * agent-issued), filterable by owner type. Admins may create codes with no
 * discount-range restriction.
 */
export function CodesTable() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [ownerType, setOwnerType] = useState<string>(ALL_OWNERS)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<DiscountCode | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [isWorking, setIsWorking] = useState(false)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['agent-codes', pageIndex, pageSize, ownerType],
    queryFn: async () => {
      const result = await listAllCodes({
        p: pageIndex + 1,
        page_size: pageSize,
        owner_type: ownerType === ALL_OWNERS ? undefined : ownerType,
      })
      if (!result.success) {
        toast.error(result.message || t('Failed to load codes'))
        return { items: [] as DiscountCode[], total: 0 }
      }
      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
      }
    },
    placeholderData: (previous) => previous,
  })

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['agent-codes'] })
  }, [queryClient])

  const openEdit = useCallback((code: DiscountCode | null) => {
    setEditing(code)
    setDialogOpen(true)
  }, [])

  const columns = useCodeColumns(
    useMemo(
      () => ({
        onEdit: (code: DiscountCode) => openEdit(code),
        onToggleStatus: (code: DiscountCode) =>
          setPendingAction({ kind: 'status', code }),
      }),
      [openEdit]
    ),
    t,
    i18n.language,
    { showOwner: true }
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

  const runPendingAction = async () => {
    if (!pendingAction) return
    const { code } = pendingAction
    setIsWorking(true)
    try {
      const nextStatus =
        code.status === DISCOUNT_CODE_STATUS.ENABLED
          ? DISCOUNT_CODE_STATUS.DISABLED
          : DISCOUNT_CODE_STATUS.ENABLED
      const result = await updateAdminCode(code.id, { status: nextStatus })
      if (!result.success) {
        toast.error(result.message || t('Failed to update code'))
        return
      }
      toast.success(t('Code updated'))
      setPendingAction(null)
      refresh()
    } finally {
      setIsWorking(false)
    }
  }

  const primaryButtons = (
    <Button size='sm' onClick={() => openEdit(null)}>
      <Plus className='size-4' />
      {t('Create Discount Code')}
    </Button>
  )

  const ownerFilter = (
    <Select value={ownerType} onValueChange={(v) => setOwnerType(v ?? ALL_OWNERS)}>
      <SelectTrigger className='w-[140px]'>
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectItem value={ALL_OWNERS}>{t('All Owners')}</SelectItem>
        <SelectItem value={OWNER_TYPE.ADMIN}>{t('Admin')}</SelectItem>
        <SelectItem value={OWNER_TYPE.AGENT}>{t('Agent')}</SelectItem>
      </SelectContent>
    </Select>
  )

  const isEnabled = pendingAction?.code.status === DISCOUNT_CODE_STATUS.ENABLED
  const pendingDescription = isEnabled
    ? t('Disable code {{code}}?', { code: pendingAction?.code.code ?? '' })
    : t('Enable code {{code}}?', { code: pendingAction?.code.code ?? '' })
  const pendingConfirmLabel = isEnabled ? t('Disable') : t('Enable')

  return (
    <>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={isLoading}
        isFetching={isFetching}
        emptyTitle={t('No Discount Codes Found')}
        emptyDescription={t(
          'Create a discount code to invite users with a permanent recharge discount.'
        )}
        emptyAction={primaryButtons}
        skeletonKeyPrefix='agent-codes-skeleton'
        applyHeaderSize
        toolbarProps={{
          hideViewOptions: true,
          additionalSearch: ownerFilter,
          preActions: primaryButtons,
        }}
      />

      <SetCodeDialog
        open={dialogOpen}
        code={editing}
        onOpenChange={setDialogOpen}
        mode='admin'
        queryKey='agent-codes'
      />

      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Change Status')}</AlertDialogTitle>
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
