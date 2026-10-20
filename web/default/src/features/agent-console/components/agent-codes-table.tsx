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
import { listMyInviteCodes, updateMyInviteCode } from '@/features/agents/api'
import { useCodeColumns } from '@/features/agents/components/code-columns'
import { SetCodeDialog } from '@/features/agents/components/set-code-dialog'
import { INVITE_CODE_STATUS, type InviteCode } from '@/features/agents/types'

type PendingAction = { kind: 'status'; code: InviteCode } | null

/**
 * The promoted agent's own invite codes. A code carries no discount — whoever
 * registers with it is bound to this agent, which both counts as a recruited
 * member and confines that user to the agent's authorized models.
 */
export function AgentCodesTable() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(20)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<InviteCode | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [isWorking, setIsWorking] = useState(false)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['my-agent-codes', pageIndex, pageSize],
    queryFn: async () => {
      const result = await listMyInviteCodes({
        p: pageIndex + 1,
        page_size: pageSize,
      })
      if (!result.success) {
        toast.error(result.message || t('Failed to load codes'))
        return { items: [] as InviteCode[], total: 0 }
      }
      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
      }
    },
    placeholderData: (previous) => previous,
  })

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['my-agent-codes'] })
    void queryClient.invalidateQueries({ queryKey: ['agent-profile'] })
  }, [queryClient])

  const openEdit = useCallback((code: InviteCode | null) => {
    setEditing(code)
    setDialogOpen(true)
  }, [])

  const columns = useCodeColumns(
    useMemo(
      () => ({
        onEdit: (code: InviteCode) => openEdit(code),
        onToggleStatus: (code: InviteCode) =>
          setPendingAction({ kind: 'status', code }),
      }),
      [openEdit]
    ),
    t
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
        code.status === INVITE_CODE_STATUS.ENABLED
          ? INVITE_CODE_STATUS.DISABLED
          : INVITE_CODE_STATUS.ENABLED
      const result = await updateMyInviteCode(code.id, { status: nextStatus })
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
      {t('Create Invite Code')}
    </Button>
  )

  const isEnabled = pendingAction?.code.status === INVITE_CODE_STATUS.ENABLED
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
        emptyTitle={t('No Invite Codes Found')}
        emptyDescription={t(
          'Create an invite code and share your invite link to bring in users.'
        )}
        emptyAction={primaryButtons}
        skeletonKeyPrefix='my-agent-codes-skeleton'
        applyHeaderSize
        toolbarProps={{
          hideViewOptions: true,
          preActions: primaryButtons,
        }}
      />

      <SetCodeDialog
        open={dialogOpen}
        code={editing}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) refresh()
        }}
        mode='agent'
        queryKey='my-agent-codes'
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
