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
import { Link } from '@tanstack/react-router'
import { Building2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { isSidebarModuleEnabled } from '@/lib/nav-modules'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Shown when `org_id === 0`, which is a normal state rather than an error.
 * Membership is granted by an organization admin or a system administrator —
 * there is no self-service application flow — so the guide only points at the
 * admin management page when the current user can reach it.
 */
export function OrganizationEmpty() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const canManageOrganizations =
    (user?.role ?? 0) >= ROLE.ADMIN &&
    isSidebarModuleEnabled('admin', 'organization')

  return (
    <EmptyState
      icon={Building2}
      bordered
      title={t('No Organization Yet')}
      description={t(
        'You are not part of an organization. Organizations share one quota pool, and membership is granted by an organization admin.'
      )}
      action={
        canManageOrganizations ? (
          <Button size='sm' render={<Link to='/organizations' />}>
            {t('Manage Organizations')}
          </Button>
        ) : undefined
      }
    />
  )
}
