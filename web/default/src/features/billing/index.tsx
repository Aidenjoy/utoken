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
import { useIsFetching } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { BillingFilterBar } from './components/billing-filter-bar'
import { ConsumptionTable } from './components/consumption-table'
import { RechargeTable } from './components/recharge-table'
import {
  BILLING_SCOPE_ALL,
  type BillingFilter,
  type BillingFilterDraft,
} from './types'

type BillingTab = 'recharge' | 'consumption'

function getDefaultDraft(): BillingFilterDraft {
  const end = new Date()
  const start = new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000)
  start.setHours(0, 0, 0, 0)
  return {
    userSel: [BILLING_SCOPE_ALL],
    orgSel: [BILLING_SCOPE_ALL],
    start,
    end,
  }
}

export function BillingCenter() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<BillingTab>('recharge')
  const [draft, setDraft] = useState<BillingFilterDraft>(getDefaultDraft)
  const [applied, setApplied] = useState<BillingFilterDraft>(getDefaultDraft)

  const fetchingRecharge = useIsFetching({ queryKey: ['billing-recharge'] })
  const fetchingConsumption = useIsFetching({
    queryKey: ['billing-consumption'],
  })
  const searching = fetchingRecharge > 0 || fetchingConsumption > 0

  const filter = useMemo<BillingFilter>(
    () => ({
      userSel: applied.userSel,
      orgSel: applied.orgSel,
      start: applied.start
        ? Math.floor(applied.start.getTime() / 1000)
        : undefined,
      end: applied.end ? Math.floor(applied.end.getTime() / 1000) : undefined,
    }),
    [applied]
  )

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Billing Center')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='space-y-3'>
          <BillingFilterBar
            draft={draft}
            onDraftChange={setDraft}
            onSearch={() => setApplied(draft)}
            onReset={() => {
              const next = getDefaultDraft()
              setDraft(next)
              setApplied(next)
            }}
            searching={searching}
          />

          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as BillingTab)}
          >
            <TabsList>
              <TabsTrigger value='recharge'>
                {t('Recharge Records')}
              </TabsTrigger>
              <TabsTrigger value='consumption'>
                {t('Consumption Details')}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === 'recharge' ? (
            <RechargeTable filter={filter} />
          ) : (
            <ConsumptionTable filter={filter} />
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
