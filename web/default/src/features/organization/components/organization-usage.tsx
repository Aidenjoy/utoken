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
import { Coins, Hash, Sparkles, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StatusBadge } from '@/components/status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatNumber, formatQuota, formatTimestampToDate } from '@/lib/format'

import { getOrgUsage } from '../api'
import { ORG_ERROR_MESSAGES, ORG_ROLES } from '../constants'
import {
  defaultOrgDateRange,
  OrgDateRangePicker,
  type OrgDateRange,
} from './org-date-range-picker'

function TotalCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  hint?: string
}) {
  return (
    <Card>
      <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
        <CardTitle className='text-muted-foreground text-sm font-medium'>
          {label}
        </CardTitle>
        <Icon className='text-muted-foreground size-4' />
      </CardHeader>
      <CardContent>
        <div className='text-2xl font-semibold tabular-nums'>{value}</div>
        {hint ? (
          <p className='text-muted-foreground mt-1 text-xs'>{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <TableRow>
      <TableCell
        colSpan={colSpan}
        className='text-muted-foreground py-10 text-center'
      >
        {label}
      </TableCell>
    </TableRow>
  )
}

/**
 * Organization usage report over a rolling window: totals, per-day, per-member
 * and per-model breakdowns. Cache hits and the quota they saved are reported
 * separately because a cached request is logged with `quota = 0`.
 */
export function OrganizationUsage() {
  const { t } = useTranslation()
  const [range, setRange] = useState<OrgDateRange>(() => defaultOrgDateRange())

  const { startTimestamp, endTimestamp } = useMemo(() => {
    return {
      startTimestamp: Math.floor(range.start.getTime() / 1000),
      endTimestamp: Math.floor(range.end.getTime() / 1000),
    }
  }, [range])

  const { data } = useQuery({
    queryKey: ['org-usage', startTimestamp, endTimestamp],
    queryFn: async () => {
      const result = await getOrgUsage({
        start_timestamp: startTimestamp,
        end_timestamp: endTimestamp,
      })
      if (!result.success) {
        toast.error(result.message || t(ORG_ERROR_MESSAGES.LOAD_FAILED))
        return undefined
      }
      return result.data?.report
    },
  })

  const total = data?.total
  const cacheHitRate =
    total && total.count > 0 ? (total.cache_hits / total.count) * 100 : 0

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-end gap-3'>
        <div className='flex flex-col gap-1'>
          <label className='text-muted-foreground text-xs'>
            {t('Time Range')}
          </label>
          <OrgDateRangePicker
            value={range}
            onChange={setRange}
            className='w-full sm:w-[240px]'
          />
        </div>
      </div>

      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5'>
        <TotalCard
          icon={Coins}
          label={t('Total Quota')}
          value={formatQuota(total?.quota ?? 0)}
        />
        <TotalCard
          icon={Hash}
          label={t('Request Count')}
          value={formatNumber(total?.count ?? 0)}
        />
        <TotalCard
          icon={TrendingUp}
          label={t('Total Tokens')}
          value={formatNumber(total?.token_used ?? 0)}
        />
        <TotalCard
          icon={Sparkles}
          label={t('Cache Hits')}
          value={formatNumber(total?.cache_hits ?? 0)}
          hint={
            (total?.count ?? 0) > 0
              ? t('Hit rate {{rate}}%', { rate: cacheHitRate.toFixed(1) })
              : undefined
          }
        />
        <TotalCard
          icon={Coins}
          label={t('Quota Saved by Cache')}
          value={formatQuota(total?.cache_saved_quota ?? 0)}
          hint={t('Cache hits are billed at zero quota')}
        />
      </div>

      <div className='grid grid-cols-1 gap-4 xl:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle className='text-sm font-medium'>
              {t('Daily Breakdown')}
            </CardTitle>
          </CardHeader>
          <CardContent className='overflow-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Date')}</TableHead>
                  <TableHead className='text-right'>
                    {t('Request Count')}
                  </TableHead>
                  <TableHead className='text-right'>{t('Quota')}</TableHead>
                  <TableHead className='text-right'>
                    {t('Cache Hits')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.by_day ?? []).length === 0 ? (
                  <EmptyRow colSpan={4} label={t('No data available')} />
                ) : (
                  (data?.by_day ?? []).map((row) => (
                    <TableRow key={row.date}>
                      <TableCell className='text-xs'>
                        {formatTimestampToDate(row.date)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatNumber(row.count)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatQuota(row.quota)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatNumber(row.cache_hits)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='text-sm font-medium'>
              {t('Top Models')}
            </CardTitle>
          </CardHeader>
          <CardContent className='overflow-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('Model')}</TableHead>
                  <TableHead className='text-right'>
                    {t('Request Count')}
                  </TableHead>
                  <TableHead className='text-right'>{t('Quota')}</TableHead>
                  <TableHead className='text-right'>
                    {t('Percentage')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.by_model ?? []).length === 0 ? (
                  <EmptyRow colSpan={4} label={t('No data available')} />
                ) : (
                  (data?.by_model ?? []).map((row) => (
                    <TableRow key={row.model_name}>
                      <TableCell className='max-w-[200px] truncate font-mono text-xs'>
                        {row.model_name}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatNumber(row.count)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatQuota(row.quota)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {(total?.quota ?? 0) > 0
                          ? `${((row.quota / (total?.quota ?? 1)) * 100).toFixed(1)}%`
                          : '-'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className='text-sm font-medium'>
            {t('Member Breakdown')}
          </CardTitle>
        </CardHeader>
        <CardContent className='overflow-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Username')}</TableHead>
                <TableHead>{t('Organization Role')}</TableHead>
                <TableHead className='text-right'>{t('Sub-quota')}</TableHead>
                <TableHead className='text-right'>
                  {t('Request Count')}
                </TableHead>
                <TableHead className='text-right'>{t('Tokens')}</TableHead>
                <TableHead className='text-right'>{t('Quota')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.by_member ?? []).length === 0 ? (
                <EmptyRow colSpan={6} label={t('No data available')} />
              ) : (
                (data?.by_member ?? []).map((row) => {
                  const roleConfig = ORG_ROLES[row.org_role]
                  return (
                    <TableRow key={row.user_id}>
                      <TableCell className='font-medium'>
                        {row.username || `#${row.user_id}`}
                      </TableCell>
                      <TableCell>
                        {roleConfig ? (
                          <StatusBadge
                            label={t(roleConfig.labelKey)}
                            variant={roleConfig.variant}
                            copyable={false}
                          />
                        ) : (
                          <span className='text-muted-foreground'>-</span>
                        )}
                      </TableCell>
                      <TableCell className='text-right text-xs tabular-nums'>
                        {row.quota_limit > 0
                          ? `${formatQuota(row.quota_used)} / ${formatQuota(row.quota_limit)}`
                          : t('Unlimited')}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatNumber(row.count)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatNumber(row.token_used)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatQuota(row.quota)}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
