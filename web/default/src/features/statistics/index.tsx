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
import { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, Coins, Hash, TrendingUp } from 'lucide-react'

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
import { getUserQuotaDates } from '@/features/dashboard/api'
import type { QuotaDataItem } from '@/features/dashboard/types'
import { formatQuota, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

const route = getRouteApi('/_authenticated/statistics/')

const DAY_OPTIONS = [1, 7, 30]

interface ModelSummary {
  model_name: string
  count: number
  quota: number
  token_used: number
}

function calculateStats(data: QuotaDataItem[]) {
  let totalQuota = 0
  let totalCount = 0
  let totalTokens = 0

  data.forEach((item) => {
    totalQuota += item.quota ?? 0
    totalCount += item.count ?? 0
    totalTokens += item.token_used ?? 0
  })

  return { totalQuota, totalCount, totalTokens }
}

function aggregateByModel(data: QuotaDataItem[]): ModelSummary[] {
  const map = new Map<string, ModelSummary>()

  data.forEach((item) => {
    const name = item.model_name || 'Unknown'
    const existing = map.get(name)
    if (existing) {
      existing.count += item.count ?? 0
      existing.quota += item.quota ?? 0
      existing.token_used += item.token_used ?? 0
    } else {
      map.set(name, {
        model_name: name,
        count: item.count ?? 0,
        quota: item.quota ?? 0,
        token_used: item.token_used ?? 0,
      })
    }
  })

  return Array.from(map.values()).sort((a, b) => b.quota - a.quota)
}

function StatCard({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border px-5 py-4',
        className
      )}
    >
      <div className='flex size-10 items-center justify-center rounded-lg bg-primary/10'>
        <Icon className='size-5 text-primary' />
      </div>
      <div className='flex flex-col'>
        <span className='text-xs text-muted-foreground'>{label}</span>
        <span className='text-lg font-semibold tabular-nums'>{value}</span>
      </div>
    </div>
  )
}

export function Statistics() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const search = route.useSearch()

  const [localUsername, setLocalUsername] = useState(search.username ?? '')

  const days = search.days ?? 7
  const username = search.username ?? ''

  const { startTimestamp, endTimestamp } = useMemo(() => {
    const now = new Date()
    const end = Math.floor(now.getTime() / 1000) + 3600
    const start = Math.floor(
      (now.getTime() - days * 24 * 60 * 60 * 1000) / 1000
    )
    return { startTimestamp: start, endTimestamp: end }
  }, [days])

  const { data: quotaData, isLoading } = useQuery({
    queryKey: ['statistics', username, days, startTimestamp, endTimestamp],
    queryFn: async () => {
      const result = await getUserQuotaDates(
        {
          start_timestamp: startTimestamp,
          end_timestamp: endTimestamp,
          username: username || undefined,
        },
        true
      )
      if (!result?.success) return []
      return result.data || []
    },
  })

  const stats = useMemo(
    () => calculateStats(quotaData ?? []),
    [quotaData]
  )

  const modelSummaries = useMemo(
    () => aggregateByModel(quotaData ?? []),
    [quotaData]
  )

  const handleSearch = useCallback(() => {
    navigate({
      to: '/statistics',
      search: { ...search, username: localUsername },
    })
  }, [navigate, search, localUsername])

  const handleDaysChange = useCallback(
    (value: string) => {
      navigate({
        to: '/statistics',
        search: { ...search, days: Number(value) },
      })
    },
    [navigate, search]
  )

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Statistics Data')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='space-y-4'>
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
                className='w-48'
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch()
                }}
              />
            </div>
            <div className='flex flex-col gap-1'>
              <label className='text-xs text-muted-foreground'>
                {t('Time Range')}
              </label>
              <Select
                value={String(days)}
                onValueChange={handleDaysChange}
              >
                <SelectTrigger className='w-32'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAY_OPTIONS.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d === 1
                        ? t('24 Hours')
                        : t('{{days}} Days', { days: d })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleSearch}>{t('Search')}</Button>
          </div>

          {/* Summary Cards */}
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
            <StatCard
              icon={Coins}
              label={t('Total Quota')}
              value={formatQuota(stats.totalQuota)}
            />
            <StatCard
              icon={Hash}
              label={t('Request Count')}
              value={formatNumber(stats.totalCount)}
            />
            <StatCard
              icon={TrendingUp}
              label={t('Total Tokens')}
              value={formatNumber(stats.totalTokens)}
            />
          </div>

          {/* Per-Model Table */}
          <div className='overflow-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-64'>{t('Model')}</TableHead>
                  <TableHead className='w-32 text-right'>
                    {t('Request Count')}
                  </TableHead>
                  <TableHead className='w-32 text-right'>
                    {t('Total Tokens')}
                  </TableHead>
                  <TableHead className='w-32 text-right'>
                    {t('Quota')}
                  </TableHead>
                  <TableHead className='w-32 text-right'>
                    {t('Percentage')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={`skeleton-${i}`}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <TableCell key={j}>
                          <div className='h-4 animate-pulse rounded bg-muted' />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : modelSummaries.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className='py-12 text-center text-muted-foreground'
                    >
                      {t('No data available for the selected period')}
                    </TableCell>
                  </TableRow>
                ) : (
                  modelSummaries.map((model) => (
                    <TableRow key={model.model_name}>
                      <TableCell className='truncate font-mono text-xs'>
                        {model.model_name}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatNumber(model.count)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatNumber(model.token_used)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatQuota(model.quota)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {stats.totalQuota > 0
                          ? (
                              (model.quota / stats.totalQuota) *
                              100
                            ).toFixed(1) + '%'
                          : '-'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Info Note */}
          {!isLoading && modelSummaries.length > 0 && (
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <Activity className='size-4' />
              <span>
                {t('{{count}} models in the last {{days}} days', {
                  count: modelSummaries.length,
                  days,
                })}
              </span>
            </div>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
