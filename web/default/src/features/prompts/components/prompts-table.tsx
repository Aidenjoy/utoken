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
import { getRouteApi } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { useMediaQuery } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { getPromptTemplateTags, getPromptTemplates } from '../api'
import {
  ERROR_MESSAGES,
  getPromptScopeOptions,
  getPromptVisibilityOptions,
} from '../constants'
import type { PromptTemplate } from '../types'
import { PromptCard } from './prompts-card'
import { usePromptsColumns } from './prompts-columns'
import { usePrompts } from './prompts-provider'

const route = getRouteApi('/_authenticated/prompts/')

function firstFilterValue(
  columnFilters: { id: string; value: unknown }[],
  id: string
): string {
  const value = columnFilters.find((filter) => filter.id === id)?.value
  if (Array.isArray(value)) return (value[0] as string) ?? ''
  return ''
}

export function PromptsTable() {
  const { t } = useTranslation()
  const columns = usePromptsColumns()
  const { refreshTrigger } = usePrompts()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const user = useAuthStore((state) => state.auth.user)

  // The management scopes are gated by role: `org` lists every template owned
  // by the caller's organization, `public` lists every public template. The
  // backend silently falls back to the personal view when the caller lacks the
  // role, so hiding the options avoids showing a control that does nothing.
  const isOrgAdmin = (user?.org_id ?? 0) > 0 && user?.org_role === 'admin'
  const isRoot = (user?.role ?? 0) >= ROLE.SUPER_ADMIN

  const {
    globalFilter,
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: { defaultPage: 1, defaultPageSize: isMobile ? 10 : 20 },
    globalFilter: { enabled: true, key: 'filter' },
    columnFilters: [
      { columnId: 'tag', searchKey: 'tag', type: 'array' },
      { columnId: 'visibility', searchKey: 'visibility', type: 'array' },
      { columnId: 'scope', searchKey: 'scope', type: 'array' },
    ],
  })

  const tagFilterValue = firstFilterValue(columnFilters, 'tag')
  const visibilityFilterValue = firstFilterValue(columnFilters, 'visibility')
  const scopeFilterValue = firstFilterValue(columnFilters, 'scope')

  const { data: tagData } = useQuery({
    queryKey: ['prompt-tags', refreshTrigger],
    queryFn: async () => {
      const result = await getPromptTemplateTags()
      return result.success ? (result.data ?? []) : []
    },
  })

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'prompts',
      pagination.pageIndex + 1,
      pagination.pageSize,
      globalFilter,
      tagFilterValue,
      visibilityFilterValue,
      scopeFilterValue,
      refreshTrigger,
    ],
    queryFn: async () => {
      const result = await getPromptTemplates({
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
        keyword: globalFilter?.trim() || undefined,
        tag: tagFilterValue || undefined,
        visibility: visibilityFilterValue || undefined,
        scope: (scopeFilterValue || undefined) as
          | ''
          | 'org'
          | 'public'
          | undefined,
      })

      if (!result.success) {
        toast.error(result.message || t(ERROR_MESSAGES.LOAD_FAILED))
        return { items: [] as PromptTemplate[], total: 0 }
      }

      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
      }
    },
    placeholderData: (previousData) => previousData,
  })

  const prompts = data?.items ?? []

  const { table } = useDataTable({
    data: prompts,
    columns,
    columnFilters,
    globalFilter,
    pagination,
    globalFilterFn: (row, _columnId, filterValue) => {
      const title = String(row.getValue('title')).toLowerCase()
      const description = String(row.original.description ?? '').toLowerCase()
      const searchValue = String(filterValue).toLowerCase()
      return title.includes(searchValue) || description.includes(searchValue)
    },
    onPaginationChange,
    onGlobalFilterChange,
    onColumnFiltersChange,
    manualPagination: true,
    manualFiltering: true,
    totalCount: data?.total ?? 0,
    ensurePageInRange,
  })

  const visibilityOptions = useMemo(() => getPromptVisibilityOptions(t), [t])
  const tagOptions = useMemo(
    () => (tagData ?? []).map((tag) => ({ label: tag, value: tag })),
    [tagData]
  )
  const scopeOptions = useMemo(() => getPromptScopeOptions(t), [t])

  const filters = useMemo(() => {
    // The literal type is spelled out because the toolbar's `FilterDef` is not
    // exported; without it the array narrows to the first element's option
    // union and rejects the tag/scope options pushed below.
    const list: {
      columnId: string
      title: string
      options: { label: string; value: string }[]
      singleSelect: boolean
    }[] = [
      {
        columnId: 'visibility',
        title: t('Visibility'),
        options: visibilityOptions,
        singleSelect: true,
      },
    ]
    if (tagOptions.length > 0) {
      list.push({
        columnId: 'tag',
        title: t('Tags'),
        options: tagOptions,
        singleSelect: true,
      })
    }
    if (isOrgAdmin || isRoot) {
      list.push({
        columnId: 'scope',
        title: t('Scope'),
        options: scopeOptions,
        singleSelect: true,
      })
    }
    return list
  }, [t, visibilityOptions, tagOptions, scopeOptions, isOrgAdmin, isRoot])

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      isFetching={isFetching}
      emptyTitle={t('No Prompt Templates Found')}
      emptyDescription={t(
        'Save a reusable prompt to share it with your organization.'
      )}
      skeletonKeyPrefix='prompts-skeleton'
      applyHeaderSize
      enableCardView
      defaultViewMode='table'
      viewModeStorageKey='prompts-view-mode'
      renderCard={(row) => <PromptCard prompt={row.original} />}
      toolbarProps={{
        searchPlaceholder: t('Filter by title or description...'),
        filters,
      }}
    />
  )
}
