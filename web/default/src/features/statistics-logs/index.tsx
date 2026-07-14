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
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import dayjs from 'dayjs'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatQuota, formatNumber } from '@/lib/format'
import { getAllLogs, getLogStats } from '@/features/usage-logs/api'

const route = getRouteApi('/_authenticated/statistics-logs/')

const LOG_TYPES = [
  { value: '', label: 'All Types' },
  { value: '1', label: 'TopUp' },
  { value: '2', label: 'Consume' },
  { value: '3', label: 'Manage' },
  { value: '4', label: 'System' },
  { value: '5', label: 'Error' },
  { value: '6', label: 'Refund' },
  { value: '7', label: 'Login' },
]

function getDefaultTimeRange() {
  const now = new Date()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(now.getTime() + 3600 * 1000)
  return { start, end }
}

export function StatisticsLogs() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const search = route.useSearch()

  const [localUsername, setLocalUsername] = useState(search.username ?? '')
  const [localModel, setLocalModel] = useState(search.model ?? '')
  const [localToken, setLocalToken] = useState(search.token ?? '')
  const [localType, setLocalType] = useState(search.type ?? '')

  const page = search.page ?? 1
  const pageSize = search.pageSize ?? 20

  const defaultRange = getDefaultTimeRange()
  const startTime = search.startTime ?? defaultRange.start.getTime()
  const endTime = search.endTime ?? defaultRange.end.getTime()

  const startTimestamp = Math.floor(startTime / 1000)
  const endTimestamp = Math.floor(endTime / 1000)

  // Fetch logs
  const { data: logsData, isLoading } = useQuery({
    queryKey: [
      'statistics-logs',
      page,
      pageSize,
      search.username,
      search.model,
      search.token,
      search.type,
      startTime,
      endTime,
    ],
    queryFn: async () => {
      const result = await getAllLogs({
        p: page,
        page_size: pageSize,
        username: search.username || undefined,
        model_name: search.model || undefined,
        token_name: search.token || undefined,
        type: search.type ? Number(search.type) : undefined,
        start_timestamp: startTimestamp,
        end_timestamp: endTimestamp,
      })
      if (!result?.success) {
        toast.error(result?.message || t('Failed to load logs'))
        return { items: [], total: 0 }
      }
      return result.data || { items: [], total: 0 }
    },
  })

  // Fetch stats
  const { data: stat } = useQuery({
    queryKey: [
      'statistics-logs-stat',
      search.username,
      search.model,
      search.token,
      search.type,
      startTime,
      endTime,
    ],
    queryFn: async () => {
      const result = await getLogStats({
        username: search.username || undefined,
        model_name: search.model || undefined,
        token_name: search.token || undefined,
        type: search.type ? Number(search.type) : undefined,
        start_timestamp: startTimestamp,
        end_timestamp: endTimestamp,
      })
      if (!result?.success) return { quota: 0, rpm: 0, tpm: 0 }
      return result.data || { quota: 0, rpm: 0, tpm: 0 }
    },
  })

  const handleSearch = useCallback(() => {
    navigate({
      to: '/statistics-logs',
      search: {
        ...search,
        page: 1,
        username: localUsername,
        model: localModel,
        token: localToken,
        type: localType,
      },
    })
  }, [navigate, search, localUsername, localModel, localToken, localType])

  const handlePageChange = useCallback(
    (newPage: number) => {
      navigate({
        to: '/statistics-logs',
        search: { ...search, page: newPage },
      })
    },
    [navigate, search]
  )

  const logs = logsData?.items || []
  const total = logsData?.total || 0
  const totalPages = Math.ceil(total / pageSize)

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>
        {t('Statistics Logs')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex h-full min-h-0 flex-col gap-4'>
          {/* Filter Bar */}
          <div className='flex flex-wrap items-end gap-3'>
            <div className='flex flex-col gap-1'>
              <label className='text-xs text-muted-foreground'>
                {t('User')}
              </label>
              <Input
                value={localUsername}
                onChange={(e) => setLocalUsername(e.target.value)}
                placeholder={t('Username')}
                className='w-40'
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch()
                }}
              />
            </div>
            <div className='flex flex-col gap-1'>
              <label className='text-xs text-muted-foreground'>
                {t('Model')}
              </label>
              <Input
                value={localModel}
                onChange={(e) => setLocalModel(e.target.value)}
                placeholder={t('Model Name')}
                className='w-40'
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch()
                }}
              />
            </div>
            <div className='flex flex-col gap-1'>
              <label className='text-xs text-muted-foreground'>
                {t('Token')}
              </label>
              <Input
                value={localToken}
                onChange={(e) => setLocalToken(e.target.value)}
                placeholder={t('Token Name')}
                className='w-40'
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch()
                }}
              />
            </div>
            <div className='flex flex-col gap-1'>
              <label className='text-xs text-muted-foreground'>
                {t('Type')}
              </label>
              <Select
                value={localType}
                onValueChange={(v) => setLocalType(v === 'all' ? '' : v)}
              >
                <SelectTrigger className='w-32'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>{t('All Types')}</SelectItem>
                  {LOG_TYPES.slice(1).map((lt) => (
                    <SelectItem key={lt.value} value={lt.value}>
                      {t(lt.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleSearch}>{t('Search')}</Button>
          </div>

          {/* Stat Tags */}
          <div className='flex flex-wrap gap-3'>
            <div className='flex items-center gap-2 rounded-lg border px-4 py-2'>
              <span className='text-xs text-muted-foreground'>
                {t('Quota')}:
              </span>
              <span className='font-semibold tabular-nums'>
                {formatQuota(stat?.quota ?? 0)}
              </span>
            </div>
            <div className='flex items-center gap-2 rounded-lg border px-4 py-2'>
              <span className='text-xs text-muted-foreground'>RPM:</span>
              <span className='font-semibold tabular-nums'>
                {formatNumber(stat?.rpm ?? 0)}
              </span>
            </div>
            <div className='flex items-center gap-2 rounded-lg border px-4 py-2'>
              <span className='text-xs text-muted-foreground'>TPM:</span>
              <span className='font-semibold tabular-nums'>
                {formatNumber(stat?.tpm ?? 0)}
              </span>
            </div>
          </div>

          {/* Table */}
          <div className='min-h-0 flex-1 overflow-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-40'>{t('Time')}</TableHead>
                  <TableHead className='w-28'>{t('User')}</TableHead>
                  <TableHead className='w-40'>{t('Model')}</TableHead>
                  <TableHead className='w-28'>{t('Token')}</TableHead>
                  <TableHead className='w-24 text-right'>
                    {t('Prompt')}
                  </TableHead>
                  <TableHead className='w-24 text-right'>
                    {t('Completion')}
                  </TableHead>
                  <TableHead className='w-24 text-right'>{t('Quota')}</TableHead>
                  <TableHead className='w-20'>{t('Channel')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={`skeleton-${i}`}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <TableCell key={j}>
                          <div className='h-4 animate-pulse rounded bg-muted' />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className='py-12 text-center text-muted-foreground'
                    >
                      {t('No Logs Found')}
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className='font-mono text-xs'>
                        {dayjs
                          .unix(log.created_at)
                          .format('MM-DD HH:mm:ss')}
                      </TableCell>
                      <TableCell className='truncate'>
                        {log.username || '-'}
                      </TableCell>
                      <TableCell className='truncate text-xs'>
                        {log.model_name || '-'}
                      </TableCell>
                      <TableCell className='truncate text-xs'>
                        {log.token_name || '-'}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {log.prompt_tokens > 0
                          ? formatNumber(log.prompt_tokens)
                          : '-'}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {log.completion_tokens > 0
                          ? formatNumber(log.completion_tokens)
                          : '-'}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {log.quota > 0
                          ? formatQuota(log.quota)
                          : '-'}
                      </TableCell>
                      <TableCell className='truncate text-xs'>
                        {log.channel_name || log.channel || '-'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className='flex items-center justify-between'>
              <span className='text-sm text-muted-foreground'>
                {t('Total')}: {formatNumber(total)}
              </span>
              <div className='flex items-center gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={page <= 1}
                  onClick={() => handlePageChange(page - 1)}
                >
                  {t('Previous')}
                </Button>
                <span className='text-sm tabular-nums'>
                  {page} / {totalPages}
                </span>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={page >= totalPages}
                  onClick={() => handlePageChange(page + 1)}
                >
                  {t('Next')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
