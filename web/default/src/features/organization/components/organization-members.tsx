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
import { UserPlus, Users } from 'lucide-react'
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

import { getOrgMembers, removeOrgMember } from '../api'
import { ORG_ERROR_MESSAGES, ORG_SUCCESS_MESSAGES } from '../constants'
import type { OrgMemberDetail } from '../types'
import { MemberKeysDialog } from './member-keys-dialog'
import {
  MemberMutateDrawer,
  type MemberDrawerMode,
} from './member-mutate-drawer'
import { useOrgMemberColumns } from './org-member-columns'
import { useOrganization } from './organization-context'

/**
 * Organization member management: paged search plus create / invite / edit /
 * remove. Removal only unbinds the account from the organization; the account,
 * its keys and its history are kept.
 */
export function OrganizationMembers() {
  const { t } = useTranslation()
  const { triggerRefresh } = useOrganization()

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<MemberDrawerMode>('create')
  const [currentMember, setCurrentMember] = useState<OrgMemberDetail | null>(
    null
  )
  const [pendingRemoval, setPendingRemoval] = useState<OrgMemberDetail | null>(
    null
  )
  const [keysMember, setKeysMember] = useState<OrgMemberDetail | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['org-members', pageIndex, pageSize, keyword],
    queryFn: async () => {
      const result = await getOrgMembers({
        p: pageIndex + 1,
        page_size: pageSize,
        keyword: keyword.trim() || undefined,
      })
      if (!result.success) {
        toast.error(result.message || t(ORG_ERROR_MESSAGES.LOAD_FAILED))
        return { items: [] as OrgMemberDetail[], total: 0 }
      }
      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
      }
    },
    placeholderData: (previous) => previous,
  })

  const openDrawer = useCallback(
    (mode: MemberDrawerMode, member: OrgMemberDetail | null) => {
      setDrawerMode(mode)
      setCurrentMember(member)
      setDrawerOpen(true)
    },
    []
  )

  const columns = useOrgMemberColumns(
    useMemo(
      () => ({
        onEdit: (member: OrgMemberDetail) => openDrawer('edit', member),
        onViewKeys: (member: OrgMemberDetail) => setKeysMember(member),
        onRemove: (member: OrgMemberDetail) => setPendingRemoval(member),
      }),
      [openDrawer]
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

  const confirmRemove = async () => {
    if (!pendingRemoval) return
    setIsRemoving(true)
    try {
      const result = await removeOrgMember(pendingRemoval.id)
      if (!result.success) {
        toast.error(
          result.message || t(ORG_ERROR_MESSAGES.MEMBER_REMOVE_FAILED)
        )
        return
      }
      toast.success(t(ORG_SUCCESS_MESSAGES.MEMBER_REMOVED))
      setPendingRemoval(null)
      triggerRefresh()
    } finally {
      setIsRemoving(false)
    }
  }

  const primaryButtons = (
    <div className='flex flex-wrap items-center gap-2'>
      <Button size='sm' onClick={() => openDrawer('create', null)}>
        <UserPlus className='size-4' />
        {t('Create Member')}
      </Button>
      <Button
        size='sm'
        variant='outline'
        onClick={() => openDrawer('invite', null)}
      >
        <Users className='size-4' />
        {t('Add Existing User')}
      </Button>
    </div>
  )

  return (
    <>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={isLoading}
        isFetching={isFetching}
        emptyTitle={t('No Members Found')}
        emptyDescription={t(
          'Create an account or add an existing user to start sharing the pool.'
        )}
        emptyAction={primaryButtons}
        skeletonKeyPrefix='org-members-skeleton'
        applyHeaderSize
        toolbarProps={{
          searchPlaceholder: t('Search by username or display name...'),
          searchDebounceMs: 300,
          preActions: primaryButtons,
        }}
      />

      <MemberMutateDrawer
        open={drawerOpen}
        mode={drawerMode}
        member={currentMember}
        onOpenChange={setDrawerOpen}
      />

      <MemberKeysDialog
        open={keysMember !== null}
        member={keysMember}
        onOpenChange={(open) => {
          if (!open) setKeysMember(null)
        }}
      />

      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Remove Member')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'Remove {{username}} from this organization? The account, its keys and its history are kept; it simply stops consuming the shared pool.',
                { username: pendingRemoval?.username ?? '' }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemoving}>
              {t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isRemoving}
              onClick={(event) => {
                event.preventDefault()
                void confirmRemove()
              }}
            >
              {isRemoving ? t('Removing...') : t('Remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
