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
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { SubscriptionBilling } from '@/features/billing/components/subscription-billing'
import {
  ADMIN_MENU_ACTIONS,
  hasAdminMenuPermission,
} from '@/lib/admin-permissions'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/subscription-billing/')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()
    if (!hasAdminMenuPermission(auth.user, ADMIN_MENU_ACTIONS.SUBSCRIPTIONS)) {
      throw redirect({ to: '/403' })
    }
  },
  component: SubscriptionBillingPage,
})

/** Dedicated administrator page; shares subscription-management authorization with its read-only API. */
function SubscriptionBillingPage() {
  const { t } = useTranslation()
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Subscription Points Billing')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <SubscriptionBilling />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
