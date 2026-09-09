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
import { Coins, Gauge, Users, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { ORG_ROLES } from '@/features/organization/constants'
import { formatNumber, formatQuota } from '@/lib/format'

import { useOrganization } from './organization-context'

function MetricCard({
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

/**
 * Member-facing overview. Shows the caller's own sub-quota progress plus, when
 * the organization allows it, the shared pool balance. `pool_quota_hidden`
 * decides whether the pool cards render at all.
 */
export function OrganizationOverview() {
  const { t } = useTranslation()
  const { summary, detail, isOrgAdmin } = useOrganization()

  if (!summary || summary.org_id === 0) return null

  const quotaLimit = summary.quota_limit ?? 0
  const quotaUsed = summary.quota_used ?? 0
  // quota_limit 0 means "unlimited", which the backend signals with remain = -1
  const unlimited = quotaLimit <= 0
  const usedPercent = unlimited
    ? 0
    : Math.min(100, Math.round((quotaUsed / quotaLimit) * 100))
  const roleConfig = ORG_ROLES[summary.org_role ?? '']
  const poolHidden = summary.pool_quota_hidden === true
  const cacheEnabled =
    detail?.organization.cache_enabled ?? summary.cache_enabled

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader className='flex flex-row items-center justify-between space-y-0'>
          <CardTitle className='text-base font-semibold'>
            {summary.display_name || summary.name}
          </CardTitle>
          <div className='flex items-center gap-2'>
            {roleConfig ? (
              <StatusBadge
                label={t(roleConfig.labelKey)}
                variant={roleConfig.variant}
                copyable={false}
              />
            ) : null}
            <StatusBadge
              label={summary.group ?? ''}
              variant='neutral'
              copyable={false}
            />
          </div>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='flex items-center justify-between text-sm'>
            <span className='text-muted-foreground'>
              {t('My sub-quota usage')}
            </span>
            <span className='tabular-nums'>
              {unlimited
                ? t('Unlimited')
                : `${formatQuota(quotaUsed)} / ${formatQuota(quotaLimit)}`}
            </span>
          </div>
          {!unlimited && <Progress value={usedPercent} />}
          <p className='text-muted-foreground text-xs'>
            {unlimited
              ? t(
                  'Your organization did not cap your usage. Every request is billed against the shared pool.'
                )
              : t('Remaining: {{quota}}', {
                  quota: formatQuota(summary.quota_remain ?? 0),
                })}
          </p>
        </CardContent>
      </Card>

      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        {poolHidden ? (
          <MetricCard
            icon={Coins}
            label={t('Organization Pool')}
            value={t('Hidden')}
            hint={t('Your organization keeps the pool balance private')}
          />
        ) : (
          <>
            <MetricCard
              icon={Coins}
              label={t('Pool Balance')}
              value={formatQuota(summary.pool_quota ?? 0)}
            />
            <MetricCard
              icon={Gauge}
              label={t('Pool Used')}
              value={formatQuota(summary.pool_used_quota ?? 0)}
            />
          </>
        )}
        <MetricCard
          icon={Users}
          label={t('Members')}
          value={formatNumber(summary.member_count ?? 0)}
          hint={isOrgAdmin ? undefined : t('Ask your admin for details')}
        />
        <MetricCard
          icon={Zap}
          label={t('Response Cache')}
          value={cacheEnabled ? t('Enabled') : t('Disabled')}
          hint={
            cacheEnabled
              ? undefined
              : t('Identical requests are always sent upstream')
          }
        />
      </div>
    </div>
  )
}
