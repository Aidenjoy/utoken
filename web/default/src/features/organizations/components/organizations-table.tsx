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
import { ORG_STATUS, type Organization } from '@/features/organization/types'

import {
  deleteAdminOrganization,
  getAdminOrganizations,
  updateAdminOrganizationStatus,
} from '../api'
import {
  ORG_ADMIN_ERROR_MESSAGES,
  ORG_ADMIN_SUCCESS_MESSAGES,
} from '../constants'
import { useOrganizationColumns } from './organization-columns'
import { OrganizationMembersDialog } from './organization-members-dialog'
import { OrganizationMutateDrawer } from './organization-mutate-drawer'
import { OrganizationQuotaDialog } from './organization-quota-dialog'

type PendingAction =
  | { kind: 'status'; organization: Organization }
  | { kind: 'delete'; organization: Organization }
  | null

/**
 * System-administrator organization list: create, edit, fund the pool, toggle
 * status, inspect members and delete. Deletion is only offered for
 * organizations that already have no members — the backend rejects the rest.
 */
export function OrganizationsTable() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<Organization | null>(null)
  const [quotaTarget, setQuotaTarget] = useState<Organization | null>(null)
  const [membersTarget, setMembersTarget] = useState<Organization | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [isWorking, setIsWorking] = useState(false)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin-organizations', pageIndex, pageSize, keyword],
    queryFn: async () => {
      const result = await getAdminOrganizations({
        p: pageIndex + 1,
        page_size: pageSize,
        keyword: keyword.trim() || undefined,
      })
      if (!result.success) {
        toast.error(result.message || t(ORG_ADMIN_ERROR_MESSAGES.LOAD_FAILED))
        return { items: [] as Organization[], total: 0 }
      }
      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
      }
    },
    placeholderData: (previous) => previous,
  })

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['admin-organizations'] })
  }, [queryClient])

  const openEdit = useCallback((organization: Organization | null) => {
    setEditing(organization)
    setDrawerOpen(true)
  }, [])

  const columns = useOrganizationColumns(
    useMemo(
      () => ({
        onEdit: (organization: Organization) => openEdit(organization),
        onAdjustQuota: (organization: Organization) =>
          setQuotaTarget(organization),
        onViewMembers: (organization: Organization) =>
          setMembersTarget(organization),
        onToggleStatus: (organization: Organization) =>
          setPendingAction({ kind: 'status', organization }),
        onDelete: (organization: Organization) =>
          setPendingAction({ kind: 'delete', organization }),
      }),
      [openEdit]
    )
  )

  const { table } = useDataTable({
    data: data?.items ?? [],
    columns,
    globalFilter: keyword,
    onGlobalFilterChange: setKeyword,
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
    const { kind, organization } = pendingAction
    setIsWorking(true)
    try {
      if (kind === 'status') {
        const nextStatus =
          organization.status === ORG_STATUS.ENABLED
            ? ORG_STATUS.DISABLED
            : ORG_STATUS.ENABLED
        const result = await updateAdminOrganizationStatus(
          organization.id,
          nextStatus
        )
        if (!result.success) {
          toast.error(
            result.message || t(ORG_ADMIN_ERROR_MESSAGES.STATUS_FAILED)
          )
          return
        }
        toast.success(t(ORG_ADMIN_SUCCESS_MESSAGES.STATUS_UPDATED))
      } else {
        const result = await deleteAdminOrganization(organization.id)
        if (!result.success) {
          toast.error(
            result.message || t(ORG_ADMIN_ERROR_MESSAGES.DELETE_FAILED)
          )
          return
        }
        toast.success(t(ORG_ADMIN_SUCCESS_MESSAGES.DELETED))
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
      {t('Create Organization')}
    </Button>
  )

  const isDelete = pendingAction?.kind === 'delete'
  const pendingName =
    pendingAction?.organization.display_name ||
    pendingAction?.organization.name ||
    ''
  const isEnabled = pendingAction?.organization.status === ORG_STATUS.ENABLED

  // One dialog covers three destructive actions; resolve the copy up front so
  // the JSX below stays flat.
  let pendingDescription = ''
  let pendingConfirmLabel = t('Enable')
  if (isDelete) {
    pendingDescription = t(
      'Delete {{name}}? Only organizations without members can be deleted; remove every member first.',
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
        emptyTitle={t('No Organizations Found')}
        emptyDescription={t(
          'Create an organization to give a team one shared quota pool.'
        )}
        emptyAction={primaryButtons}
        skeletonKeyPrefix='admin-organizations-skeleton'
        applyHeaderSize
        toolbarProps={{
          searchPlaceholder: t('Search by name or display name...'),
          searchDebounceMs: 300,
          preActions: primaryButtons,
        }}
      />

      <OrganizationMutateDrawer
        open={drawerOpen}
        organization={editing}
        onOpenChange={setDrawerOpen}
      />

      <OrganizationQuotaDialog
        open={quotaTarget !== null}
        organization={quotaTarget}
        onOpenChange={(open) => {
          if (!open) setQuotaTarget(null)
        }}
      />

      <OrganizationMembersDialog
        open={membersTarget !== null}
        organization={membersTarget}
        onOpenChange={(open) => {
          if (!open) setMembersTarget(null)
        }}
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
              {isDelete ? t('Delete Organization') : t('Change Status')}
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
