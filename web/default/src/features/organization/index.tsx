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
import { type ReactNode, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { OrganizationBilling } from './components/organization-billing'
import {
  OrganizationProvider,
  useOrganization,
} from './components/organization-context'
import { OrganizationEmpty } from './components/organization-empty'
import { OrganizationMembers } from './components/organization-members'
import { OrganizationOverview } from './components/organization-overview'
import { OrganizationSettings } from './components/organization-settings'
import { OrganizationUsage } from './components/organization-usage'
import {
  ORG_DEFAULT_SECTION,
  ORG_SECTION_IDS,
  ORG_SECTION_TITLES,
  type OrgSectionId,
} from './constants'

const route = getRouteApi('/_authenticated/organization/$section')

/**
 * Section bodies are prop-less, so a flat lookup keeps the render path free of
 * chained ternaries.
 */
const SECTION_CONTENT: Record<OrgSectionId, ReactNode> = {
  overview: <OrganizationOverview />,
  members: <OrganizationMembers />,
  usage: <OrganizationUsage />,
  billing: <OrganizationBilling />,
  settings: <OrganizationSettings />,
}

function OrganizationContent() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { summary, isLoading, isOrgAdmin } = useOrganization()
  const params = route.useParams()

  // Members only ever see the overview; the route guard already redirects other
  // sections, this keeps the tab strip consistent with it.
  const sections: readonly OrgSectionId[] = isOrgAdmin
    ? ORG_SECTION_IDS
    : ['overview']
  const activeSection = sections.includes(params.section as OrgSectionId)
    ? (params.section as OrgSectionId)
    : ORG_DEFAULT_SECTION

  const handleSectionChange = useCallback(
    (section: string) => {
      void navigate({
        to: '/organization/$section',
        params: { section: section as OrgSectionId },
      })
    },
    [navigate]
  )

  const orgName = summary?.display_name || summary?.name
  const title = orgName || t(ORG_SECTION_TITLES[activeSection])

  const hasOrganization = (summary?.org_id ?? 0) > 0
  const showEmptyState = !isLoading && !hasOrganization
  const showSections = !isLoading && hasOrganization

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{title}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        {showEmptyState ? <OrganizationEmpty /> : null}
        {showSections ? (
          <div className='flex h-full min-h-0 flex-col gap-4'>
            {isOrgAdmin ? (
              <Tabs value={activeSection} onValueChange={handleSectionChange}>
                <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'>
                  {sections.map((section) => (
                    <TabsTrigger key={section} value={section}>
                      {t(ORG_SECTION_TITLES[section])}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : null}
            <div className='min-h-0 flex-1'>
              {SECTION_CONTENT[activeSection]}
            </div>
          </div>
        ) : null}
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

export function Organization() {
  return (
    <OrganizationProvider>
      <OrganizationContent />
    </OrganizationProvider>
  )
}
