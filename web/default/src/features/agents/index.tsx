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

import { AgentsTable } from './components/agents-table'
import { CodesTable } from './components/codes-table'

type AgentScope = 'agents' | 'codes'

/**
 * System-administrator reseller management. Promote registered users to agents
 * with a set of authorized models (each with the deepest discount the agent may
 * grant), and manage every invite code (admin- and agent-issued).
 */
export function Agents() {
  const { t } = useTranslation()
  const [scope, setScope] = useState<AgentScope>('agents')

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('Agent Management')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex h-full min-h-0 flex-col gap-4'>
          <Tabs
            value={scope}
            onValueChange={(value) => setScope(value as AgentScope)}
          >
            <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'>
              <TabsTrigger value='agents'>{t('Agents')}</TabsTrigger>
              <TabsTrigger value='codes'>{t('Invite Codes')}</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className='min-h-0 flex-1'>
            {scope === 'agents' ? <AgentsTable /> : <CodesTable />}
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
