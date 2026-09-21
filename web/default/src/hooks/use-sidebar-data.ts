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
import {
  Activity,
  BarChart3,
  BookOpen,
  Box,
  Building,
  Calculator,
  Camera,
  Clapperboard,
  CreditCard,
  FileText,
  FlaskConical,
  FolderSync,
  Image as ImageIcon,
  Images,
  Key,
  Layers,
  LayoutDashboard,
  ListTodo,
  Megaphone,
  MessageSquare,
  Package,
  Percent,
  Radio,
  Scissors,
  ScrollText,
  ServerCog,
  Settings,
  Settings2,
  Shirt,
  ShoppingCart,
  Ticket,
  User,
  UserRound,
  Users,
  Wallet,
  ZoomIn,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { SidebarData } from '@/components/layout/types'
import { ORG_ROLE } from '@/features/organization/types'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Root navigation groups for the application sidebar.
 *
 * These are shown when the URL does not match any nested sidebar view
 * registered in `layout/lib/sidebar-view-registry.ts`.
 */
export function useSidebarData(): SidebarData {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)

  // The organization workspace only exists for users inside an organization;
  // everyone else keeps the sidebar free of a group they cannot open.
  const hasOrganization = (user?.org_id ?? 0) > 0
  const isOrgAdmin = hasOrganization && user?.org_role === ORG_ROLE.ADMIN

  return {
    navGroups: [
      {
        id: 'chat',
        title: t('Test Models'),
        items: [
          {
            title: t('New Chat'),
            url: '/playground',
            icon: FlaskConical,
          },
          {
            title: t('Virtual Human Library'),
            url: '/asset-library',
            icon: Images,
          },
          {
            title: t('Prompt Library'),
            url: '/prompts',
            icon: BookOpen,
          },
          {
            title: t('Cost Calculator'),
            url: '/cost-calculator',
            icon: Calculator,
          },
          {
            title: t('Chat'),
            icon: MessageSquare,
            type: 'chat-presets',
          },
        ],
      },
      {
        id: 'director',
        title: t('Video Factory'),
        items: [
          {
            title: t('Short Drama'),
            url: '/director/drama',
            icon: Clapperboard,
          },
          {
            title: t('E-commerce Video'),
            url: '/director/ecommerce',
            icon: ShoppingCart,
          },
          {
            title: t('Ad Video'),
            url: '/director/ad',
            icon: Megaphone,
          },
          {
            title: t('Daily Video'),
            url: '/director/daily',
            icon: Camera,
          },
        ],
      },
      {
        id: 'try-on',
        title: t('Model Styling'),
        items: [
          {
            title: t('Dedicated Model'),
            url: '/try-on/model-studio',
            icon: UserRound,
          },
          {
            title: t('Free Try-On'),
            url: '/try-on/free',
            icon: Shirt,
          },
          {
            title: t('Multi-Item Try-On'),
            url: '/try-on/multi',
            icon: Layers,
          },
          {
            title: t('Duo Try-On'),
            url: '/try-on/duo',
            icon: Users,
          },
        ],
      },
      {
        id: 'viral-hero',
        title: t('Viral Hero Image'),
        items: [
          {
            title: t('Hero Image Design'),
            url: '/viral-hero/hero-design',
            icon: ImageIcon,
          },
          {
            title: t('Hero Image Set'),
            url: '/viral-hero/hero-set',
            icon: Images,
          },
          {
            title: t('Detail Page Images'),
            url: '/viral-hero/detail-page',
            icon: FileText,
          },
          {
            title: t('Detail Images'),
            url: '/viral-hero/detail-images',
            icon: ZoomIn,
          },
        ],
      },
      {
        id: 'viral-design',
        title: t('Viral Design'),
        items: [
          {
            title: t('Fashion Design'),
            url: '/viral-design/fashion',
            icon: Scissors,
          },
          {
            title: t('Merchandise Design'),
            url: '/viral-design/merchandise',
            icon: Package,
          },
        ],
      },
      {
        id: 'general',
        title: t('General'),
        items: [
          {
            title: t('Overview'),
            url: '/dashboard/overview',
            icon: Activity,
          },
          {
            title: t('Dashboard'),
            url: '/dashboard/models',
            icon: LayoutDashboard,
          },
          {
            title: t('API Keys'),
            url: '/keys',
            icon: Key,
          },
          {
            title: t('Usage Logs'),
            url: '/usage-logs/common',
            icon: FileText,
          },
          {
            title: t('Task Logs'),
            url: '/usage-logs/task',
            activeUrls: ['/usage-logs/drawing'],
            configUrls: ['/usage-logs/drawing', '/usage-logs/task'],
            icon: ListTodo,
          },
        ],
      },
      {
        id: 'personal',
        title: t('Personal'),
        items: [
          {
            title: t('Wallet'),
            url: '/wallet',
            icon: Wallet,
          },
          {
            title: t('Profile'),
            url: '/profile',
            icon: User,
          },
          {
            title: t('Asset Library'),
            url: '/director/assets',
            icon: Images,
          },
          {
            title: t('Model Settings'),
            url: '/director/settings',
            icon: Settings2,
          },
        ],
      },
      ...(hasOrganization
        ? [
            {
              id: 'organization',
              title: t('Organization'),
              items: [
                {
                  title: t('Overview'),
                  url: '/organization/overview',
                  icon: Activity,
                },
                // Members only ever reach the overview (the route guard
                // redirects the rest), so the remaining entries are
                // admin-only — mirroring the sections they can open.
                ...(isOrgAdmin
                  ? [
                      {
                        title: t('Members'),
                        url: '/organization/members',
                        icon: Users,
                      },
                      {
                        title: t('Usage Report'),
                        url: '/organization/usage',
                        icon: BarChart3,
                      },
                      {
                        title: t('Billing Details'),
                        url: '/organization/billing',
                        icon: CreditCard,
                      },
                      {
                        title: t('Organization Settings'),
                        url: '/organization/settings',
                        icon: Settings,
                      },
                    ]
                  : []),
              ],
            },
          ]
        : []),
      {
        id: 'admin',
        title: t('Admin'),
        items: [
          {
            title: t('Channels'),
            url: '/channels',
            icon: Radio,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('Asset Sync'),
            url: '/asset-sync',
            icon: FolderSync,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('Models'),
            url: '/models/metadata',
            icon: Box,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('Users'),
            url: '/users',
            icon: Users,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('Organization Management'),
            url: '/organizations',
            icon: Building,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('Token Rate Management'),
            url: '/token-rates',
            icon: Percent,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('Statistics Data'),
            url: '/statistics',
            icon: BarChart3,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('Statistics Logs'),
            url: '/statistics-logs',
            icon: ScrollText,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('Redemption Codes'),
            url: '/redemption-codes',
            icon: Ticket,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('Subscriptions'),
            url: '/subscriptions',
            icon: CreditCard,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('System Info'),
            url: '/system-info',
            icon: ServerCog,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('System Settings'),
            url: '/system-settings/site',
            activeUrls: ['/system-settings'],
            icon: Settings,
            requiredRole: ROLE.ADMIN,
          },
        ],
      },
    ],
  }
}
