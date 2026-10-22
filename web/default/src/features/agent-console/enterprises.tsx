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
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'

import { EnterprisesTable } from './components/enterprises-table'

/**
 * The promoted agent's enterprise customers. An enterprise is an organization
 * bound to this agent: it shares one pool, inherits one enterprise-wide discount
 * the agent sets within its own floors, and can be locked down so members spend
 * only from the pool. Membership and pool funding are managed elsewhere, so this
 * page develops the relationship rather than administering the org.
 */
export function AgentEnterprises() {
  const { t } = useTranslation()

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('My Enterprises')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <EnterprisesTable />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
