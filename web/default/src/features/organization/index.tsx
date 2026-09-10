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
import { getRouteApi } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'

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
  ORG_SECTION_TITLES,
  isOrgSectionId,
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

/**
 * The sections double as sidebar entries (see `useSidebarData`), so the page
 * itself only renders the active one; the route guard already keeps members
 * and organization-less users on the overview.
 */
function OrganizationContent() {
  const { t } = useTranslation()
  const { summary, isLoading } = useOrganization()
  const params = route.useParams()

  const activeSection = isOrgSectionId(params.section)
    ? params.section
    : ORG_DEFAULT_SECTION

  const orgName = summary?.display_name || summary?.name
  const hasOrganization = (summary?.org_id ?? 0) > 0
  const showEmptyState = !isLoading && !hasOrganization
  const showSections = !isLoading && hasOrganization

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>
        {t(ORG_SECTION_TITLES[activeSection])}
        {hasOrganization && orgName ? (
          <span className='text-muted-foreground ml-2 text-sm font-normal'>
            {orgName}
          </span>
        ) : null}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        {showEmptyState ? <OrganizationEmpty /> : null}
        {showSections ? (
          <div className='h-full min-h-0'>{SECTION_CONTENT[activeSection]}</div>
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
