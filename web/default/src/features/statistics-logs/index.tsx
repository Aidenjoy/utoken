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
import { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { KeyRound } from 'lucide-react'

import { SectionPageLayout } from '@/components/layout'
import { StatusBadge, type StatusBadgeProps } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import {
  formatUseTime,
  formatLogQuota,
  formatTimestampToDate,
  formatNumber,
} from '@/lib/format'
import { getAllLogs, getLogStats } from '@/features/usage-logs/api'
import type { UsageLog } from '@/features/usage-logs/data/schema'
import { ModelBadge } from '@/features/usage-logs/components/model-badge'
import {
  formatModelName,
  parseLogOther,
  renderAuditContent,
} from '@/features/usage-logs/lib/format'
import {
  getLogTypeConfig,
  isDisplayableLogType,
  isTimingLogType,
} from '@/features/usage-logs/lib/utils'
import {
  LOG_TYPE_FILTERS,
  LOG_TYPE_ALL_VALUE,
} from '@/features/usage-logs/constants'

const route = getRouteApi('/_authenticated/statistics-logs/')

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

  const { startTime, endTime, startTimestamp, endTimestamp } = useMemo(() => {
    const defaultRange = getDefaultTimeRange()
    const stTime = search.startTime ?? defaultRange.start.getTime()
    const enTime = search.endTime ?? defaultRange.end.getTime()
    return {
      startTime: stTime,
      endTime: enTime,
      startTimestamp: Math.floor(stTime / 1000),
      endTimestamp: Math.floor(enTime / 1000),
    }
  }, [search.startTime, search.endTime])

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
    staleTime: 30 * 1000,
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
    staleTime: 30 * 1000,
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

  const logs = (logsData?.items || []) as unknown as UsageLog[]
  const total = logsData?.total || 0
  const totalPages = Math.ceil(total / pageSize)

  // Column count for skeleton/empty state
  const colCount = 9

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
                value={localType || LOG_TYPE_ALL_VALUE}
                onValueChange={(v) =>
                  setLocalType(v && v !== LOG_TYPE_ALL_VALUE ? v : '')
                }
              >
                <SelectTrigger className='w-32'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOG_TYPE_FILTERS.map((lt) => (
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
                {formatLogQuota(stat?.quota ?? 0)}
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
                  <TableHead className='w-44'>{t('Time')}</TableHead>
                  <TableHead className='w-32'>{t('Channel')}</TableHead>
                  <TableHead className='w-28'>{t('User')}</TableHead>
                  <TableHead className='w-40'>{t('Token')}</TableHead>
                  <TableHead className='w-44'>{t('Model')}</TableHead>
                  <TableHead className='w-24'>{t('Timing')}</TableHead>
                  <TableHead className='w-28 text-right'>Tokens</TableHead>
                  <TableHead className='w-24 text-right'>{t('Cost')}</TableHead>
                  <TableHead className='w-48'>{t('Details')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={`skeleton-${i}`}>
                      {Array.from({ length: colCount }).map((_, j) => (
                        <TableCell key={j}>
                          <div className='h-4 animate-pulse rounded bg-muted' />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={colCount}
                      className='py-12 text-center text-muted-foreground'
                    >
                      {t('No Logs Found')}
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => {
                    const typeConfig = getLogTypeConfig(log.type)
                    const other = parseLogOther(log.other)
                    const modelInfo = formatModelName(log)
                    const auditContent = renderAuditContent(other, t)

                    return (
                      <TableRow key={log.id}>
                        {/* Time + Type badge */}
                        <TableCell>
                          <div className='flex min-w-0 flex-col gap-0.5'>
                            <span className='truncate font-mono text-xs tabular-nums'>
                              {formatTimestampToDate(log.created_at)}
                            </span>
                            <StatusBadge
                              label={t(typeConfig.label)}
                              variant={
                                typeConfig.color as StatusBadgeProps['variant']
                              }
                              size='sm'
                              copyable={false}
                              className='!text-xs [&_span]:!text-xs'
                            />
                          </div>
                        </TableCell>

                        {/* Channel */}
                        <TableCell>
                          {isDisplayableLogType(log.type) && log.channel ? (
                            <div className='flex max-w-[160px] flex-col gap-0.5'>
                              <StatusBadge
                                label={`#${log.channel}`}
                                autoColor={String(log.channel)}
                                copyText={String(log.channel)}
                                size='sm'
                                showDot={false}
                                className='font-mono'
                              />
                              {log.channel_name && (
                                <span className='text-muted-foreground/70 truncate [font-family:var(--font-body)] !text-xs'>
                                  {log.channel_name}
                                </span>
                              )}
                            </div>
                          ) : null}
                        </TableCell>

                        {/* User */}
                        <TableCell>
                          {log.username ? (
                            <div className='flex items-center gap-1.5'>
                              <Avatar className='ring-border/60 size-6 ring-1 max-sm:hidden'>
                                <AvatarFallback
                                  className='text-[11px] font-semibold'
                                  style={getUserAvatarStyle(log.username)}
                                >
                                  {getUserAvatarFallback(log.username)}
                                </AvatarFallback>
                              </Avatar>
                              <span className='text-muted-foreground max-w-[100px] truncate text-sm'>
                                {log.username}
                              </span>
                            </div>
                          ) : null}
                        </TableCell>

                        {/* Token */}
                        <TableCell>
                          {isDisplayableLogType(log.type) && log.token_name ? (
                            <div className='flex max-w-[200px] flex-col gap-0.5'>
                              <StatusBadge
                                label={log.token_name}
                                icon={KeyRound}
                                copyText={log.token_name}
                                size='sm'
                                showDot={false}
                                className='border-border/60 bg-muted/30 text-foreground h-6 max-w-full gap-1.5 overflow-hidden rounded-md border px-2 py-0.5 [font-family:var(--font-body)]'
                              />
                              {(log.group ||
                                (other?.group ?? '')) && (
                                <span className='text-muted-foreground/60 truncate [font-family:var(--font-body)] !text-xs'>
                                  {log.group || other?.group}
                                </span>
                              )}
                            </div>
                          ) : null}
                        </TableCell>

                        {/* Model */}
                        <TableCell>
                          {isDisplayableLogType(log.type) && log.model_name ? (
                            <ModelBadge
                              modelName={modelInfo.name}
                              actualModel={modelInfo.actualModel}
                            />
                          ) : null}
                        </TableCell>

                        {/* Timing */}
                        <TableCell>
                          {isTimingLogType(log.type) && log.use_time > 0 ? (
                            <div className='flex flex-col gap-0.5'>
                              <StatusBadge
                                label={formatUseTime(log.use_time)}
                                variant={
                                  log.use_time < 10
                                    ? 'success'
                                    : log.use_time < 30
                                      ? 'warning'
                                      : 'danger'
                                }
                                size='sm'
                                copyable={false}
                                className='rounded-md font-mono'
                              />
                              <span className='text-muted-foreground/60 [font-family:var(--font-body)] !text-xs leading-none'>
                                {log.is_stream ? t('Stream') : t('Non-stream')}
                              </span>
                            </div>
                          ) : null}
                        </TableCell>

                        {/* Tokens */}
                        <TableCell className='text-right'>
                          {isDisplayableLogType(log.type) ? (
                            <div className='flex flex-col gap-0.5'>
                              <span className='font-mono text-xs font-medium tabular-nums'>
                                {(log.prompt_tokens || 0).toLocaleString()} /{' '}
                                {(log.completion_tokens || 0).toLocaleString()}
                              </span>
                            </div>
                          ) : null}
                        </TableCell>

                        {/* Cost */}
                        <TableCell className='text-right'>
                          {isDisplayableLogType(log.type) && log.quota > 0 ? (
                            <span className='border-border/80 bg-muted/60 inline-flex h-6 w-fit items-center rounded-md border px-2 [font-family:var(--font-body)] text-sm leading-none font-semibold tabular-nums'>
                              {formatLogQuota(log.quota)}
                            </span>
                          ) : null}
                        </TableCell>

                        {/* Details */}
                        <TableCell>
                          {auditContent ? (
                            <span className='text-xs leading-snug'>
                              {auditContent}
                            </span>
                          ) : log.content ? (
                            <span className='text-muted-foreground truncate text-xs'>
                              {log.content}
                            </span>
                          ) : (
                            <span className='text-muted-foreground/40'>—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
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
