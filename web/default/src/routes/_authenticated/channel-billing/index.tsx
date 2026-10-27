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

import { ChannelBillingCenter } from '@/features/billing/channel-billing-center'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/channel-billing/')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()

    // Upstream reconciliation exposes platform-confidential cost data: admins
    // only, never agents (whose billing scope is their downstream members).
    if (
      !auth.user ||
      auth.user.role < ROLE.ADMIN ||
      auth.user.is_agent === true
    ) {
      throw redirect({
        to: '/403',
      })
    }
  },
  component: ChannelBillingCenter,
})
