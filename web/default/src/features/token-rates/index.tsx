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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { OrgTokenRatesTable } from './components/org-token-rates-table'
import { TokenRatesTable } from './components/token-rates-table'

type RateScope = 'users' | 'organizations'

/**
 * System-administrator token-rate management. Setting a rate multiplies the
 * tokens consumed on seedance video tasks before billing, without touching the
 * pricing system itself. Rates can be scoped per user or per organization;
 * saving an organization rate overwrites every member's personal rate.
 */
export function TokenRates() {
  const { t } = useTranslation()
  const [scope, setScope] = useState<RateScope>('users')

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>
        {t('Token Rate Management')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex h-full min-h-0 flex-col gap-4'>
          <Tabs
            value={scope}
            onValueChange={(value) => setScope(value as RateScope)}
          >
            <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'>
              <TabsTrigger value='users'>{t('Users')}</TabsTrigger>
              <TabsTrigger value='organizations'>
                {t('Organization')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className='min-h-0 flex-1'>
            {scope === 'users' ? <TokenRatesTable /> : <OrgTokenRatesTable />}
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
