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
import type {
  ColumnFiltersState,
  OnChangeFn,
  SortingState,
  Row,
} from '@tanstack/react-table'
import { Eye, EyeOff } from 'lucide-react'
import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DISABLED_ROW_DESKTOP,
  DISABLED_ROW_MOBILE,
  DataTablePage,
  useDebouncedColumnFilter,
  useDataTable,
} from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useMediaQuery } from '@/hooks'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { getLobeIcon } from '@/lib/lobe-icon'

import { getChannels, searchChannels, getGroups } from '../api'
import {
  DEFAULT_PAGE_SIZE,
  CHANNEL_STATUS,
  CHANNEL_STATUS_OPTIONS,
} from '../constants'
import {
  channelsQueryKeys,
  aggregateChannelsByTag,
  isTagAggregateRow,
  getChannelTypeIcon,
  getChannelTypeLabel,
  getChannelModelKinds,
} from '../lib'
import type { Channel, ChannelSortBy } from '../types'
import type { ChannelModelKind } from '../lib'
import { ChannelCard } from './channel-card'
import { useChannelsColumns } from './channels-columns'
import { useChannels } from './channels-provider'
import { DataTableBulkActions } from './data-table-bulk-actions'

const route = getRouteApi('/_authenticated/channels/')
const CHANNELS_COLUMN_VISIBILITY_STORAGE_KEY = 'channels:column-visibility'
const CHANNELS_COLUMN_SIZING_STORAGE_KEY = 'channels:column-sizing'
const CHANNELS_VIEW_MODE_STORAGE_KEY = 'channels:view-mode'
const CHANNELS_STATUS_FILTER_STORAGE_KEY = 'channel-status-filter'
// When quick kind/disabled toggles are active we fetch every page (server caps
// page_size at 100) and filter client-side so counts/pagination stay consistent.
const CLIENT_FILTER_FETCH_SIZE = 100

const CHANNEL_SORTABLE_COLUMNS = new Set<ChannelSortBy>([
  'id',
  'name',
  'priority',
  'balance',
  'response_time',
  'test_time',
])

function isDisabledChannelRow(channel: Channel) {
  return (
    !isTagAggregateRow(channel) && channel.status !== CHANNEL_STATUS.ENABLED
  )
}

export function ChannelsTable() {
  const { t } = useTranslation()
  const {
    enableTagMode,
    idSort,
    batchMode,
    sensitiveVisible,
    setSensitiveVisible,
  } = useChannels()
  const isMobile = useMediaQuery('(max-width: 640px)')

  // Table state
  const [sorting, setSorting] = useState<SortingState>([])

  // Quick kind / disabled toggles (client-side post-filter over a full fetch)
  const [kindFilters, setKindFilters] = useState<ChannelModelKind[]>([])
  const [hideDisabled, setHideDisabled] = useState(false)
  const clientFilterActive = kindFilters.length > 0 || hideDisabled

  const toggleKind = (kind: ChannelModelKind, on: boolean) => {
    setKindFilters((prev) =>
      on ? [...prev, kind] : prev.filter((k) => k !== kind)
    )
  }

  // URL state management
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
    pagination: {
      defaultPage: 1,
      defaultPageSize: isMobile ? 10 : DEFAULT_PAGE_SIZE,
    },
    globalFilter: { enabled: true, key: 'filter' },
    columnFilters: [
      {
        columnId: 'status',
        searchKey: 'status',
        type: 'array',
        deserialize: (value) => {
          if (value !== undefined) return value
          const stored = localStorage.getItem(
            CHANNELS_STATUS_FILTER_STORAGE_KEY
          )
          return stored === 'enabled' || stored === 'disabled' ? [stored] : []
        },
      },
      { columnId: 'type', searchKey: 'type', type: 'array' },
      { columnId: 'group', searchKey: 'group', type: 'array' },
      { columnId: 'model', searchKey: 'model', type: 'string' },
    ],
  })

  const handleColumnFiltersChange: OnChangeFn<ColumnFiltersState> = (
    updater
  ) => {
    onColumnFiltersChange((previous) => {
      const next = typeof updater === 'function' ? updater(previous) : updater
      const status = next.find((f) => f.id === 'status')?.value as
        | string[]
        | undefined
      localStorage.setItem(
        CHANNELS_STATUS_FILTER_STORAGE_KEY,
        status?.[0] ?? 'all'
      )
      return next
    })
  }

  // Extract filters from column filters
  const statusFilter =
    (columnFilters.find((f) => f.id === 'status')?.value as string[]) || []
  const typeFilter = useMemo(
    () => (columnFilters.find((f) => f.id === 'type')?.value as string[]) || [],
    [columnFilters]
  )
  const groupFilter =
    (columnFilters.find((f) => f.id === 'group')?.value as string[]) || []
  const {
    value: modelFilter,
    inputValue: modelFilterInput,
    onChange: onModelFilterInputChange,
    onCompositionStart: onModelFilterCompositionStart,
    onCompositionEnd: onModelFilterCompositionEnd,
    resetInput: resetModelFilterInput,
  } = useDebouncedColumnFilter({
    columnFilters,
    columnId: 'model',
    onColumnFiltersChange,
  })

  // Determine whether to use search or regular list API
  const shouldSearch = Boolean(globalFilter?.trim() || modelFilter.trim())

  // Effective server pagination: fetch a full page when quick toggles are on.
  const effectivePage = clientFilterActive ? 1 : pagination.pageIndex + 1
  const effectivePageSize = clientFilterActive
    ? CLIENT_FILTER_FETCH_SIZE
    : pagination.pageSize

  const sortParams = useMemo(() => {
    const activeSort = sorting[0]
    if (
      !activeSort ||
      !CHANNEL_SORTABLE_COLUMNS.has(activeSort.id as ChannelSortBy)
    ) {
      return {}
    }

    return {
      sort_by: activeSort.id as ChannelSortBy,
      sort_order: activeSort.desc ? 'desc' : 'asc',
    } as const
  }, [sorting])

  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    setSorting((previous) => {
      const next = typeof updater === 'function' ? updater(previous) : updater
      if (pagination.pageIndex > 0) {
        onPaginationChange({ ...pagination, pageIndex: 0 })
      }
      return next
    })
  }

  // Fetch groups for filter
  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
  })

  const groupOptions = useMemo(
    () =>
      (groupsData?.data || []).map((g) => ({
        label: g,
        value: g,
      })),
    [groupsData]
  )

  // Fetch channels data
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const { data, isLoading, isFetching } = useQuery({
    queryKey: channelsQueryKeys.list({
      keyword: globalFilter,
      model: modelFilter,
      group:
        groupFilter.length > 0 && !groupFilter.includes('all')
          ? groupFilter[0]
          : undefined,
      status:
        statusFilter.length > 0 && !statusFilter.includes('all')
          ? statusFilter[0]
          : undefined,
      type:
        typeFilter.length > 0 && !typeFilter.includes('all')
          ? Number(typeFilter[0])
          : undefined,
      tag_mode: enableTagMode,
      id_sort: idSort,
      ...sortParams,
      p: effectivePage,
      page_size: effectivePageSize,
    }),
    queryFn: async () => {
      const baseParams = {
        group:
          groupFilter.length > 0 && !groupFilter.includes('all')
            ? groupFilter[0]
            : undefined,
        status:
          statusFilter.length > 0 && !statusFilter.includes('all')
            ? statusFilter[0]
            : undefined,
        type:
          typeFilter.length > 0 && !typeFilter.includes('all')
            ? Number(typeFilter[0])
            : undefined,
        tag_mode: enableTagMode,
        id_sort: idSort,
        ...sortParams,
      }
      const fetchPage = (p: number, pageSize: number) =>
        shouldSearch
          ? searchChannels({
              keyword: globalFilter,
              model: modelFilter,
              ...baseParams,
              p,
              page_size: pageSize,
            })
          : getChannels({ ...baseParams, p, page_size: pageSize })

      if (!clientFilterActive) {
        return fetchPage(pagination.pageIndex + 1, pagination.pageSize)
      }

      // Quick toggles filter client-side, so pull every page to see the full
      // channel set (the server caps page_size at 100).
      const first = await fetchPage(1, CLIENT_FILTER_FETCH_SIZE)
      const total = first?.data?.total || 0
      const items = [...(first?.data?.items || [])]
      const pageCount = Math.ceil(total / CLIENT_FILTER_FETCH_SIZE)
      if (pageCount > 1) {
        const rest = await Promise.all(
          Array.from({ length: pageCount - 1 }, (_, i) =>
            fetchPage(i + 2, CLIENT_FILTER_FETCH_SIZE)
          )
        )
        for (const page of rest) items.push(...(page?.data?.items || []))
      }
      return { ...first, data: { ...first.data, items, total } }
    },
    placeholderData: (previousData) => previousData,
  })

  // Apply quick kind/disabled toggles client-side over the full fetch.
  const filteredChannels = useMemo(() => {
    const rawChannels = data?.data?.items || []
    if (!clientFilterActive) return rawChannels
    return rawChannels.filter((channel) => {
      if (hideDisabled && channel.status !== CHANNEL_STATUS.ENABLED) {
        return false
      }
      if (kindFilters.length > 0) {
        const kinds = getChannelModelKinds(channel)
        if (!kindFilters.some((k) => kinds.includes(k))) return false
      }
      return true
    })
  }, [data, clientFilterActive, hideDisabled, kindFilters])

  // Apply tag aggregation if tag mode is enabled, then slice for client paging.
  const channels = useMemo(() => {
    let rows = filteredChannels
    if (enableTagMode && rows.length > 0) {
      rows = aggregateChannelsByTag(rows)
    }
    if (clientFilterActive) {
      const start = pagination.pageIndex * pagination.pageSize
      rows = rows.slice(start, start + pagination.pageSize)
    }
    return rows
  }, [
    filteredChannels,
    enableTagMode,
    clientFilterActive,
    pagination.pageIndex,
    pagination.pageSize,
  ])

  const totalCount = useMemo(() => {
    if (!clientFilterActive) return data?.data?.total || 0
    if (enableTagMode && filteredChannels.length > 0) {
      return aggregateChannelsByTag(filteredChannels).length
    }
    return filteredChannels.length
  }, [clientFilterActive, data, enableTagMode, filteredChannels])

  // Jump back to the first page when the quick toggles turn on.
  useEffect(() => {
    if (clientFilterActive && pagination.pageIndex !== 0) {
      onPaginationChange((prev) => ({ ...prev, pageIndex: 0 }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientFilterActive])
  const typeCounts = data?.data?.type_counts

  // Columns configuration
  const columns = useChannelsColumns({ enableSelection: batchMode })

  // React Table instance
  const { table } = useDataTable({
    data: channels,
    columns,
    totalCount,
    sorting,
    initialColumnVisibility: {
      models: false,
      tag: false,
    },
    columnVisibilityStorageKey: CHANNELS_COLUMN_VISIBILITY_STORAGE_KEY,
    columnSizingStorageKey: isMobile
      ? false
      : CHANNELS_COLUMN_SIZING_STORAGE_KEY,
    columnFilters,
    pagination,
    globalFilter,
    enableRowSelection: batchMode
      ? (row: Row<Channel>) => !isTagAggregateRow(row.original)
      : false,
    onSortingChange: handleSortingChange,
    onColumnFiltersChange: handleColumnFiltersChange,
    onPaginationChange,
    onGlobalFilterChange,
    getSubRows: (row: Channel & { children?: Channel[] }) => row.children,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    withExpandedRowModel: true,
    enableColumnResizing: !isMobile,
    ensurePageInRange,
  })

  useEffect(() => {
    if (!batchMode) {
      table.resetRowSelection()
    }
  }, [batchMode, table])

  // Prepare filter options from existing channel types only.
  const typeFilterOptions = useMemo(() => {
    const counts = typeCounts || {}
    const typeIds = Object.entries(counts)
      .map(([type, count]) => ({
        type: Number(type),
        count: Number(count) || 0,
      }))
      .filter((item) => item.type > 0 && item.count > 0)
      .sort((a, b) => {
        const labelA = t(getChannelTypeLabel(a.type))
        const labelB = t(getChannelTypeLabel(b.type))
        return labelA.localeCompare(labelB)
      })

    const selectedType = typeFilter.find((value) => value !== 'all')
    if (selectedType) {
      const selectedTypeId = Number(selectedType)
      const alreadyIncluded = typeIds.some(
        (item) => item.type === selectedTypeId
      )
      if (selectedTypeId > 0 && !alreadyIncluded) {
        typeIds.push({
          type: selectedTypeId,
          count: Number(counts[selectedType]) || 0,
        })
      }
    }

    const totalTypes = Object.values(counts).reduce(
      (sum, count) => sum + (Number(count) || 0),
      0
    )

    return [
      {
        label: 'All Types',
        value: 'all',
        count: totalTypes,
      },
      ...typeIds.map((item) => {
        const iconName = getChannelTypeIcon(item.type)
        return {
          label: getChannelTypeLabel(item.type),
          value: String(item.type),
          count: item.count,
          iconNode: getLobeIcon(`${iconName}.Color`, 16),
        }
      }),
    ]
  }, [t, typeCounts, typeFilter])

  const groupFilterOptions = [
    { label: t('All Groups'), value: 'all' },
    ...groupOptions.map((option) => ({
      ...option,
      label: sensitiveVisible ? option.label : '••••',
    })),
  ]

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      isFetching={isFetching}
      emptyTitle={t('No Channels Found')}
      emptyDescription={t(
        'No channels available. Create your first channel to get started.'
      )}
      skeletonKeyPrefix='channel-skeleton'
      enableCardView
      viewModeStorageKey={CHANNELS_VIEW_MODE_STORAGE_KEY}
      renderCard={(row, { isSelected }) => (
        <ChannelCard row={row} isSelected={isSelected} />
      )}
      cardGridClassName='grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-3'
      applyHeaderSize
      toolbarProps={{
        searchPlaceholder: t('Filter by name, ID, or key...'),
        searchDebounceMs: 500,
        onReset: () => {
          resetModelFilterInput()
        },
        additionalSearch: (
          <Input
            placeholder={t('Filter by model...')}
            value={modelFilterInput}
            onChange={onModelFilterInputChange}
            onCompositionStart={onModelFilterCompositionStart}
            onCompositionEnd={onModelFilterCompositionEnd}
            className='w-full sm:w-[150px] lg:w-[180px]'
          />
        ),
        filters: [
          {
            columnId: 'status',
            title: t('Status'),
            options: [...CHANNEL_STATUS_OPTIONS],
            singleSelect: true,
          },
          {
            columnId: 'type',
            title: t('Type'),
            options: typeFilterOptions,
            singleSelect: true,
          },
          {
            columnId: 'group',
            title: t('Group'),
            options: groupFilterOptions,
            singleSelect: true,
          },
        ],
        afterFilters: (
          <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
            <label className='text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1.5 text-xs select-none'>
              <Checkbox
                checked={kindFilters.includes('llm')}
                onCheckedChange={(v) => toggleKind('llm', v === true)}
              />
              {t('Language Model')}
            </label>
            <label className='text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1.5 text-xs select-none'>
              <Checkbox
                checked={kindFilters.includes('image')}
                onCheckedChange={(v) => toggleKind('image', v === true)}
              />
              {t('Image Model')}
            </label>
            <label className='text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1.5 text-xs select-none'>
              <Checkbox
                checked={kindFilters.includes('video')}
                onCheckedChange={(v) => toggleKind('video', v === true)}
              />
              {t('Video Model')}
            </label>
            <label className='text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1.5 text-xs select-none'>
              <Checkbox
                checked={hideDisabled}
                onCheckedChange={(v) => setHideDisabled(v === true)}
              />
              {t('Hide Disabled')}
            </label>
          </div>
        ),
        preActions: (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => setSensitiveVisible(!sensitiveVisible)}
                  aria-label={sensitiveVisible ? t('Hide') : t('Show')}
                  className='text-muted-foreground hover:text-foreground size-8'
                />
              }
            >
              {sensitiveVisible ? <Eye /> : <EyeOff />}
            </TooltipTrigger>
            <TooltipContent>
              {sensitiveVisible ? t('Hide') : t('Show')}
            </TooltipContent>
          </Tooltip>
        ),
      }}
      getRowClassName={(row, { isMobile }) => {
        if (!isDisabledChannelRow(row.original)) {
          return undefined
        }
        if (isMobile) {
          return DISABLED_ROW_MOBILE
        }
        return DISABLED_ROW_DESKTOP
      }}
      bulkActions={batchMode ? <DataTableBulkActions table={table} /> : null}
    />
  )
}
