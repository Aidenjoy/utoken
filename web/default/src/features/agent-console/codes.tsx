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
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { getAgentProfile } from '@/features/agents/api'

import { AgentCodesTable } from './components/agent-codes-table'

/**
 * The promoted agent's own discount codes. Creation is clamped to the
 * allowed discount range reported by the agent profile.
 */
export function AgentCodes() {
  const { t } = useTranslation()

  const { data: profile } = useQuery({
    queryKey: ['agent-profile'],
    queryFn: async () => {
      const res = await getAgentProfile()
      return res.success ? res.data : undefined
    },
  })

  const range = {
    min: profile?.min_discount ?? 0.01,
    max: profile?.max_discount ?? 1,
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Discount Codes')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <AgentCodesTable range={range} />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
