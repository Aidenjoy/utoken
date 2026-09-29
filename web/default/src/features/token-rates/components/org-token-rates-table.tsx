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
import type { Organization } from '@/features/organization/types'
import {
  getAdminOrganizations,
  updateAdminOrganizationTokenRate,
} from '@/features/organizations/api'

import { useOrgTokenRateColumns } from './org-token-rate-columns'
import { SetOrgTokenRateDialog } from './set-org-token-rate-dialog'

/**
 * Enterprise token-rate list: set a rate per organization and it is applied to
 * every member's personal rate (last setting wins). Clearing restores 1.0x for
 * the whole enterprise.
 */
export function OrgTokenRatesTable() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')

  const [rateTarget, setRateTarget] = useState<Organization | null>(null)
  const [clearTarget, setClearTarget] = useState<Organization | null>(null)
  const [isWorking, setIsWorking] = useState(false)

  const trimmedKeyword = keyword.trim()

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['org-token-rates', pageIndex, pageSize, trimmedKeyword],
    queryFn: async () => {
      const result = await getAdminOrganizations({
        p: pageIndex + 1,
        page_size: pageSize,
        keyword: trimmedKeyword,
      })
      if (!result.success) {
        toast.error(result.message || t('Failed to load organizations'))
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
    void queryClient.invalidateQueries({ queryKey: ['org-token-rates'] })
    void queryClient.invalidateQueries({ queryKey: ['token-rates'] })
  }, [queryClient])

  const columns = useOrgTokenRateColumns(
    useMemo(
      () => ({
        onSetRate: (org: Organization) => setRateTarget(org),
        onClearRate: (org: Organization) => setClearTarget(org),
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
      const result = await updateAdminOrganizationTokenRate(clearTarget.id, 0)
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
        emptyTitle={t('No Organizations Found')}
        emptyDescription={t(
          'Select an organization to set the token consumption rate.'
        )}
        skeletonKeyPrefix='org-token-rates-skeleton'
        applyHeaderSize
        toolbarProps={{
          searchPlaceholder: t('Search by name or display name...'),
          searchDebounceMs: 300,
        }}
      />

      <SetOrgTokenRateDialog
        open={rateTarget !== null}
        organization={rateTarget}
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
                'Clear the token rate for {{name}}? It restores the default 1.0x multiplier for every member of this organization.',
                {
                  name:
                    clearTarget?.display_name || clearTarget?.name || '',
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
