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
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getTopupInfo } from '@/features/wallet/api'
import {
  ADMIN_MENU_ACTIONS,
  hasAdminMenuPermission,
} from '@/lib/admin-permissions'
import { useAuthStore } from '@/stores/auth-store'

import {
  getMembershipAccount,
  getPublicPlans,
  getSelfSubscriptionFull,
} from './api'
import { ChannelQuotaSummary } from './components/channel-quota-summary'
import { SubscriptionPurchaseDialog } from './components/dialogs/subscription-purchase-dialog'
import { MembershipKeyDialog } from './components/membership-key-dialog'
import { formatDuration } from './lib'
import type { ChannelQuota, PlanRecord } from './types'

/** User-facing channel membership hub; all purchases reuse the existing checkout dialog. */
export function ChannelMemberships() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const queryClient = useQueryClient()
  const plans = useQuery({
    queryKey: ['membership-plans'],
    queryFn: getPublicPlans,
  })
  const subscriptions = useQuery({
    queryKey: ['membership-self'],
    queryFn: getSelfSubscriptionFull,
  })
  const account = useQuery({
    queryKey: ['membership-account'],
    queryFn: getMembershipAccount,
  })
  const topup = useQuery({
    queryKey: ['membership-checkout-options'],
    queryFn: getTopupInfo,
  })
  const [selectedPlan, setSelectedPlan] = useState<PlanRecord | null>(null)
  const [selectedGrant, setSelectedGrant] = useState<ChannelQuota | null>(null)
  const rights = (subscriptions.data?.data?.all_subscriptions ?? []).filter(
    (record) => ['channel', 'shared_tokens'].includes(record.subscription.meter_type ?? '')
  )
  const offers = (plans.data?.data ?? []).filter(
    (record) => record.plan.meter_type === 'channel' || record.plan.meter_type === 'shared_tokens'
  )
  const payment = topup.data?.data
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['membership-self'] }),
      queryClient.invalidateQueries({ queryKey: ['membership-account'] }),
    ])
  }
  const failed =
    plans.isError ||
    subscriptions.isError ||
    account.isError ||
    plans.data?.success === false ||
    subscriptions.data?.success === false ||
    account.data?.success === false
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Membership Center')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button variant='outline' onClick={() => void refresh()}>
          {t('Refresh')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='space-y-6 pb-6'>
          {hasAdminMenuPermission(user, ADMIN_MENU_ACTIONS.SUBSCRIPTIONS) && (
            <Button variant='outline' render={<Link to='/subscriptions' />}>
              {t('Subscription Management')}
            </Button>
          )}
          <Alert>
            <AlertDescription>
              {t('Channel membership never falls back to wallet balance.')}
            </AlertDescription>
          </Alert>
          {failed && (
            <Alert variant='destructive'>
              <AlertDescription>
                {t('Failed to load memberships')}
              </AlertDescription>
            </Alert>
          )}
          {(plans.isPending || subscriptions.isPending) && (
            <Skeleton className='h-32 w-full' />
          )}
          <section className='space-y-3'>
            <h2 className='text-lg font-semibold'>{t('My memberships')}</h2>
            {!subscriptions.isPending && !failed && rights.length === 0 && (
              <p className='text-muted-foreground'>
                {t('No channel memberships yet')}
              </p>
            )}
            {rights.map((record) => {
              const active =
                record.subscription.status === 'active' &&
                record.subscription.end_time * 1000 > Date.now()
              return (
                <Card key={record.subscription.id}>
                  <CardHeader>
                    <CardTitle>
                      {t('Subscription')} #{record.subscription.id} ·{' '}
                      {active ? t('Active') : t('Expired')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-3'>
                    <p>
                      {t('Expires')}:{' '}
                      {new Date(
                        record.subscription.end_time * 1000
                      ).toLocaleString()}
                    </p>
                    {(record.channel_quotas ?? []).map((grant) => (
                      <div key={grant.channel_id} className='space-y-2'>
                        {grant.channel_id > 0 ? (
                          <>
                            <ChannelQuotaSummary quotas={[grant]} />
                            <Button
                              variant='outline'
                              disabled={!active || grant.available === false}
                              onClick={() => setSelectedGrant(grant)}
                            >
                              {t('Create membership Key')}
                            </Button>
                          </>
                        ) : (
                          <span>{t('Input / output tokens')}</span>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )
            })}
          </section>
          <section className='space-y-3'>
            <h2 className='text-lg font-semibold'>{t('Membership plans')}</h2>
            {!plans.isPending && !failed && offers.length === 0 && (
              <p className='text-muted-foreground'>
                {t('No channel membership plans available')}
              </p>
            )}
            <div className='grid gap-4 lg:grid-cols-2'>
              {offers.map((record) => (
                <Card key={record.plan.id}>
                  <CardHeader>
                    <CardTitle>{record.plan.title}</CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-3'>
                    <p>{record.plan.subtitle}</p>
                    <p>
                      {record.plan.price_amount.toFixed(2)}{' '}
                      {record.plan.currency} · {formatDuration(record.plan, t)}
                    </p>
                    <ChannelQuotaSummary
                      quotas={record.plan.channel_quotas ?? []}
                    />
                    <Button onClick={() => setSelectedPlan(record)}>
                      {t('Subscribe Now')}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        </div>
        <SubscriptionPurchaseDialog
          open={selectedPlan !== null}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedPlan(null)
              void refresh()
            }
          }}
          plan={selectedPlan}
          userQuota={account.data?.data?.quota ?? 0}
          enableStripe={payment?.enable_stripe_topup}
          enableCreem={payment?.enable_creem_topup}
          enableWaffoPancake={payment?.enable_waffo_pancake_topup}
          enableOnlineTopUp={payment?.enable_online_topup}
          epayMethods={payment?.pay_methods?.filter(
            (method) => !['stripe', 'creem'].includes(method.type)
          )}
          onPurchaseSuccess={refresh}
        />
        {selectedGrant && (
          <MembershipKeyDialog
            grant={selectedGrant}
            onClose={() => setSelectedGrant(null)}
          />
        )}
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
