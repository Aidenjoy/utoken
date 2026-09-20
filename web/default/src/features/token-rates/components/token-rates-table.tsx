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
import {
  getUsers,
  searchUsers,
  updateUserTokenRate,
} from '@/features/users/api'
import type { User } from '@/features/users/types'

import { SetTokenRateDialog } from './set-token-rate-dialog'
import { useTokenRateColumns } from './token-rate-columns'

/**
 * Token-rate management list: pick a system user and set the multiplier applied
 * to the tokens they consume on seedance video tasks. Rates are shown inline;
 * clearing a rate restores the default 1.0x.
 */
export function TokenRatesTable() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')

  const [rateTarget, setRateTarget] = useState<User | null>(null)
  const [clearTarget, setClearTarget] = useState<User | null>(null)
  const [isWorking, setIsWorking] = useState(false)

  const trimmedKeyword = keyword.trim()

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['token-rates', pageIndex, pageSize, trimmedKeyword],
    queryFn: async () => {
      const result =
        trimmedKeyword === ''
          ? await getUsers({ p: pageIndex + 1, page_size: pageSize })
          : await searchUsers({
              keyword: trimmedKeyword,
              p: pageIndex + 1,
              page_size: pageSize,
            })
      if (!result.success) {
        toast.error(result.message || t('Failed to load users'))
        return { items: [] as User[], total: 0 }
      }
      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
      }
    },
    placeholderData: (previous) => previous,
  })

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['token-rates'] })
  }, [queryClient])

  const columns = useTokenRateColumns(
    useMemo(
      () => ({
        onSetRate: (user: User) => setRateTarget(user),
        onClearRate: (user: User) => setClearTarget(user),
      }),
      []
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

  const runClearRate = async () => {
    if (!clearTarget) return
    setIsWorking(true)
    try {
      const result = await updateUserTokenRate(clearTarget.id, 0)
      if (!result.success) {
        toast.error(result.message || t('Failed to update token rate'))
        return
      }
      toast.success(t('Token rate cleared'))
      setClearTarget(null)
      refresh()
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={isLoading}
        isFetching={isFetching}
        emptyTitle={t('No Users Found')}
        emptyDescription={t(
          'Select a system user to set the token consumption rate.'
        )}
        skeletonKeyPrefix='token-rates-skeleton'
        applyHeaderSize
        toolbarProps={{
          searchPlaceholder: t('Search by username or display name...'),
          searchDebounceMs: 300,
        }}
      />

      <SetTokenRateDialog
        open={rateTarget !== null}
        user={rateTarget}
        onOpenChange={(open) => {
          if (!open) setRateTarget(null)
        }}
      />

      <AlertDialog
        open={clearTarget !== null}
        onOpenChange={(open) => {
          if (!open) setClearTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Clear Token Rate')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'Clear the token rate for {{name}}? It restores the default 1.0x multiplier.',
                {
                  name:
                    clearTarget?.display_name || clearTarget?.username || '',
                }
              )}
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
                void runClearRate()
              }}
            >
              {isWorking ? t('Processing...') : t('Clear Rate')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
