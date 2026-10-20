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

import { deleteAgent, listAgents, updateAgent } from '../api'
import { AGENT_STATUS, type Agent } from '../types'
import { useAgentColumns } from './agent-columns'
import { SetAgentDialog } from './set-agent-dialog'

type PendingAction =
  | { kind: 'status'; agent: Agent }
  | { kind: 'delete'; agent: Agent }
  | null

/**
 * System-administrator reseller list: promote a user to an agent, edit which
 * models they may resell (and the deepest discount allowed for each), toggle
 * status and delete. Deletion is a hard confirm because it drops the agent's
 * authority to manage invite codes and unbinds every member they recruited,
 * restoring those members' full model access.
 */
export function AgentsTable() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(20)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Agent | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [isWorking, setIsWorking] = useState(false)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['agents', pageIndex, pageSize],
    queryFn: async () => {
      const result = await listAgents({ p: pageIndex + 1, page_size: pageSize })
      if (!result.success) {
        toast.error(result.message || t('Failed to load agents'))
        return { items: [] as Agent[], total: 0 }
      }
      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
      }
    },
    placeholderData: (previous) => previous,
  })

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['agents'] })
  }, [queryClient])

  const openEdit = useCallback((agent: Agent | null) => {
    setEditing(agent)
    setDialogOpen(true)
  }, [])

  const columns = useAgentColumns(
    useMemo(
      () => ({
        onEdit: (agent: Agent) => openEdit(agent),
        onToggleStatus: (agent: Agent) =>
          setPendingAction({ kind: 'status', agent }),
        onDelete: (agent: Agent) => setPendingAction({ kind: 'delete', agent }),
      }),
      [openEdit]
    ),
    t,
    i18n.language
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
    const { kind, agent } = pendingAction
    setIsWorking(true)
    try {
      if (kind === 'status') {
        const nextStatus =
          agent.status === AGENT_STATUS.ENABLED
            ? AGENT_STATUS.DISABLED
            : AGENT_STATUS.ENABLED
        const result = await updateAgent(agent.id, { status: nextStatus })
        if (!result.success) {
          toast.error(result.message || t('Failed to update agent'))
          return
        }
        toast.success(t('Agent updated'))
      } else {
        const result = await deleteAgent(agent.id)
        if (!result.success) {
          toast.error(result.message || t('Failed to delete agent'))
          return
        }
        toast.success(t('Agent deleted'))
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
      {t('Promote User to Agent')}
    </Button>
  )

  const isDelete = pendingAction?.kind === 'delete'
  const pendingName =
    pendingAction?.agent.display_name || pendingAction?.agent.username || ''
  const isEnabled = pendingAction?.agent.status === AGENT_STATUS.ENABLED

  let pendingDescription = ''
  let pendingConfirmLabel = t('Enable')
  if (isDelete) {
    pendingDescription = t(
      'Delete agent {{name}}? They will lose access to the agent console and can no longer manage invite codes.',
      { name: pendingName }
    )
    pendingConfirmLabel = t('Delete')
  } else if (isEnabled) {
    pendingDescription = t('Disable agent {{name}}?', { name: pendingName })
    pendingConfirmLabel = t('Disable')
  } else {
    pendingDescription = t('Enable agent {{name}}?', { name: pendingName })
    pendingConfirmLabel = t('Enable')
  }

  return (
    <>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={isLoading}
        isFetching={isFetching}
        emptyTitle={t('No Agents Found')}
        emptyDescription={t(
          'Promote a registered user to an agent so they can issue invite codes and resell the models you authorize.'
        )}
        emptyAction={primaryButtons}
        skeletonKeyPrefix='agents-skeleton'
        applyHeaderSize
        toolbarProps={{
          hideViewOptions: true,
          preActions: primaryButtons,
        }}
      />

      <SetAgentDialog
        open={dialogOpen}
        agent={editing}
        onOpenChange={setDialogOpen}
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
              {isDelete ? t('Delete Agent') : t('Change Status')}
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
