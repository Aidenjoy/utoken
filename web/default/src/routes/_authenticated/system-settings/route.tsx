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

import { SystemSettings } from '@/features/system-settings'
import {
  ADMIN_PERMISSION_RESOURCES,
  SYSTEM_SETTINGS_SECTIONS,
  getFirstGrantedSettingsSection,
  hasPermission,
} from '@/lib/admin-permissions'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

const SETTINGS_INDEX_PATH = {
  site: '/system-settings/site',
  auth: '/system-settings/auth',
  billing: '/system-settings/billing',
  models: '/system-settings/models',
  security: '/system-settings/security',
  content: '/system-settings/content',
  operations: '/system-settings/operations',
} as const

export const Route = createFileRoute('/_authenticated/system-settings')({
  beforeLoad: ({ location }) => {
    const { auth } = useAuthStore.getState()
    const user = auth.user

    if (!user || user.role < ROLE.ADMIN) {
      throw redirect({ to: '/403' })
    }
    if (user.role === ROLE.SUPER_ADMIN) {
      return
    }

    const firstGrantedSection = getFirstGrantedSettingsSection(user)
    if (!firstGrantedSection) {
      throw redirect({ to: '/403' })
    }

    const requestedPath = location.pathname.split('/')[2]
    const requestedSection = SYSTEM_SETTINGS_SECTIONS.find(
      (section) => section.path === requestedPath
    )
    const canOpenRequestedSection =
      requestedSection &&
      hasPermission(
        user,
        ADMIN_PERMISSION_RESOURCES.SETTINGS,
        requestedSection.action
      )
    if (!canOpenRequestedSection) {
      throw redirect({
        to: SETTINGS_INDEX_PATH[firstGrantedSection],
      })
    }
  },
  component: SystemSettings,
})
