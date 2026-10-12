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
import { Copy, Link2, Ticket, Users, WalletCards } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { getAgentProfile, listMyCodes } from '@/features/agents/api'
import { DISCOUNT_CODE_STATUS } from '@/features/agents/types'
import { formatDiscount } from '@/lib/discount'

import { AgentCodesTable } from './components/agent-codes-table'

/**
 * Self-service console for a promoted reseller: shows the allowed discount
 * range, referral statistics, an invite-link generator, and management of the
 * agent's own discount codes. Access is gated by `is_agent` (not by role).
 */
export function AgentConsole() {
  const { t, i18n } = useTranslation()
  const [selectedCode, setSelectedCode] = useState<string>('')

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['agent-profile'],
    queryFn: async () => {
      const res = await getAgentProfile()
      return res.success ? res.data : undefined
    },
  })

  const { data: codesData } = useQuery({
    queryKey: ['my-agent-codes', 'selector'],
    queryFn: async () => {
      const res = await listMyCodes({ p: 1, page_size: 100 })
      return res.success ? (res.data?.items ?? []) : []
    },
  })

  const enabledCodes = useMemo(
    () =>
      (codesData ?? []).filter(
        (code) => code.status === DISCOUNT_CODE_STATUS.ENABLED
      ),
    [codesData]
  )

  const inviteLink = selectedCode
    ? `${window.location.origin}/sign-up?discount=${selectedCode}`
    : ''

  const range = {
    min: profile?.min_discount ?? 0.01,
    max: profile?.max_discount ?? 1,
  }

  const copyLink = async () => {
    if (!inviteLink) return
    try {
      await navigator.clipboard.writeText(inviteLink)
      toast.success(t('Invite link copied'))
    } catch {
      toast.error(t('Failed to copy'))
    }
  }

  const stats = [
    {
      label: t('Allowed Discount'),
      value: `${formatDiscount(profile?.min_discount, i18n.language, t)} – ${formatDiscount(profile?.max_discount, i18n.language, t)}`,
      icon: Ticket,
    },
    {
      label: t('Invited Users'),
      value: (profile?.invited_users ?? 0).toLocaleString(),
      icon: Users,
    },
    {
      label: t('Total Recharge'),
      value: (profile?.total_recharge ?? 0).toLocaleString(),
      icon: WalletCards,
    },
  ]

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Agent Console')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex flex-col gap-4'>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Share your invite link. Users who register with it keep the discount on every future recharge.'
            )}
          </p>
          <div className='overflow-hidden rounded-lg border'>
            <div className='divide-border/60 grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0'>
              {stats.map((item) => (
                <div key={item.label} className='px-3 py-3 sm:px-5 sm:py-4'>
                  <div className='flex items-center gap-2'>
                    <item.icon className='text-muted-foreground/60 size-3.5 shrink-0' />
                    <div className='text-muted-foreground truncate text-xs font-medium tracking-wider uppercase'>
                      {item.label}
                    </div>
                  </div>
                  {profileLoading ? (
                    <Skeleton className='mt-2 h-7 w-28' />
                  ) : (
                    <div className='text-foreground mt-1.5 font-mono text-base font-bold tracking-tight break-all tabular-nums sm:mt-2 sm:text-xl'>
                      {item.value}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className='rounded-lg border p-4'>
            <div className='mb-3 flex items-center gap-2 text-sm font-medium'>
              <Link2 className='size-4' />
              {t('Invite Link')}
            </div>
            <div className='flex flex-col gap-2 sm:flex-row'>
              <Select value={selectedCode} onValueChange={(v) => setSelectedCode(v ?? '')}>
                <SelectTrigger className='sm:w-[220px]'>
                  <SelectValue placeholder={t('Select a code')} />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {enabledCodes.length === 0 ? (
                    <SelectItem value='__empty__' disabled>
                      {t('No enabled codes')}
                    </SelectItem>
                  ) : (
                    enabledCodes.map((code) => (
                      <SelectItem key={code.id} value={code.code}>
                        {code.code} ·{' '}
                        {formatDiscount(code.discount, i18n.language, t)}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <div className='bg-muted/50 flex-1 truncate rounded-md px-3 py-2 font-mono text-xs'>
                {inviteLink || t('Select a code to generate your invite link')}
              </div>
              <Button
                variant='outline'
                size='sm'
                disabled={!inviteLink}
                onClick={() => void copyLink()}
              >
                <Copy className='size-4' />
                {t('Copy')}
              </Button>
            </div>
          </div>

          <AgentCodesTable range={range} />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
