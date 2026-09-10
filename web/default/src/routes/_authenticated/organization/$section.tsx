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
import { createFileRoute, redirect } from '@tanstack/react-router'

import { Organization } from '@/features/organization'
import {
  ORG_DEFAULT_SECTION,
  isOrgSectionId,
} from '@/features/organization/constants'
import { ORG_ROLE } from '@/features/organization/types'
import { isSidebarModuleEnabled } from '@/lib/nav-modules'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/organization/$section')({
  beforeLoad: ({ params }) => {
    if (!isSidebarModuleEnabled('personal', 'organization')) {
      throw redirect({ to: '/dashboard' })
    }

    if (!isOrgSectionId(params.section)) {
      throw redirect({
        to: '/organization/$section',
        params: { section: ORG_DEFAULT_SECTION },
      })
    }

    // Members (and users without an organization) only reach the overview; the
    // page itself renders the empty-state guide when `org_id` is 0.
    const { auth } = useAuthStore.getState()
    const isOrgAdmin =
      (auth.user?.org_id ?? 0) > 0 && auth.user?.org_role === ORG_ROLE.ADMIN
    if (!isOrgAdmin && params.section !== ORG_DEFAULT_SECTION) {
      throw redirect({
        to: '/organization/$section',
        params: { section: ORG_DEFAULT_SECTION },
      })
    }
  },
  component: Organization,
})
