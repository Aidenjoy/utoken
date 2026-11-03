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
  ADMIN_PERMISSION_ACTIONS,
  ADMIN_PERMISSION_RESOURCES,
  hasPermission,
} from '@/lib/admin-permissions'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

// 被授予「模型定价」权限的管理员（非超管）只能进入这一个页面，其余系统设置一律重定向到此。
const MODEL_PRICING_PATH = '/system-settings/billing/model-pricing'

export const Route = createFileRoute('/_authenticated/system-settings')({
  beforeLoad: ({ location }) => {
    const { auth } = useAuthStore.getState()
    const user = auth.user

    if (user?.role === ROLE.SUPER_ADMIN) {
      return
    }

    if (
      !hasPermission(
        user,
        ADMIN_PERMISSION_RESOURCES.BILLING,
        ADMIN_PERMISSION_ACTIONS.MODEL_PRICING
      )
    ) {
      throw redirect({
        to: '/403',
      })
    }

    if (location.pathname.replace(/\/+$/, '') !== MODEL_PRICING_PATH) {
      throw redirect({
        to: '/system-settings/billing/$section',
        params: { section: 'model-pricing' },
      })
    }
  },
  component: SystemSettings,
})
