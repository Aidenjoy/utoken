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
  BadgePercent,
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
  Gift,
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
  ReceiptText,
  Scissors,
  ServerCog,
  Settings,
  Settings2,
  Shirt,
  ShoppingCart,
  Ticket,
  User,
  UserRound,
  Users,
  Utensils,
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
// Sidebar entries an admin can hide for a reseller (agent) account. Agents only
// develop customers, so every gated menu is hidden unless the agent's
// `menu_visibility` (configured in Agent Management) explicitly lists its key.
// Keys mirror `model.AgentMenuKeys` / `AGENT_MENU_KEYS`.
const AGENT_GATED_GROUP: Record<string, string> = {
  chat: 'experience',
  director: 'video_factory',
  'try-on': 'model_styling',
  'viral-hero': 'viral_hero',
  'viral-design': 'viral_design',
}
// Individual items hidden unless the agent's `menu_visibility` lists their key.
// Covers both the personal group (asset/prompt libraries) and the agent
// workspace, where only the enterprise console is opt-in — codes, members,
// recharge and billing stay always-on for any promoted agent.
const AGENT_GATED_ITEM: Record<string, string> = {
  '/director/assets': 'asset_library',
  '/prompts': 'prompt_library',
  '/agent/enterprises': 'enterprises',
}

// Groups whose items are individually gated by `AGENT_GATED_ITEM`.
const AGENT_ITEM_GATED_GROUP = new Set(['personal', 'agent'])

/**
 * Drop reseller-gated menus for an agent account. `visibleKeys` is null for
 * non-agents (nothing is ever hidden); for agents it holds the menu keys their
 * admin enabled, and any gated group / gated item whose key is absent is
 * removed. Ungated entries (Wallet, Profile, the always-on agent workspace
 * items, admin tools) are kept.
 */
function gateAgentMenus(
  navGroups: SidebarData['navGroups'],
  visibleKeys: Set<string> | null
): SidebarData['navGroups'] {
  if (visibleKeys === null) return navGroups
  return navGroups
    .map((group) =>
      AGENT_ITEM_GATED_GROUP.has(group.id ?? '')
        ? {
            ...group,
            items: group.items.filter((item) => {
              const key = AGENT_GATED_ITEM[item.url ?? '']
              return !key || visibleKeys.has(key)
            }),
          }
        : group
    )
    .filter((group) => {
      const key = AGENT_GATED_GROUP[group.id ?? '']
      return !key || visibleKeys.has(key)
    })
}

export function useSidebarData(): SidebarData {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)

  // The organization workspace only exists for users inside an organization;
  // everyone else keeps the sidebar free of a group they cannot open.
  const hasOrganization = (user?.org_id ?? 0) > 0
  const isOrgAdmin = hasOrganization && user?.org_role === ORG_ROLE.ADMIN

  // Only agents get menus gated; everyone else sees the full sidebar.
  const agentVisibleKeys = user?.is_agent
    ? new Set(user.agent_menu_visibility ?? [])
    : null

  return {
    navGroups: gateAgentMenus([
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
          {
            title: t('Model Settings'),
            url: '/director/settings',
            icon: Settings2,
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
          {
            title: t('Food Design'),
            url: '/viral-design/food',
            icon: Utensils,
          },
          {
            title: t('Packaging Design'),
            url: '/viral-design/packaging',
            icon: Gift,
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
            title: t('Prompt Library'),
            url: '/prompts',
            icon: BookOpen,
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
      // The reseller workspace is gated by the `is_agent` flag rather than a
      // system role, so any promoted user sees it regardless of role.
      ...(user?.is_agent
        ? [
            {
              id: 'agent',
              title: t('Agent'),
              items: [
                {
                  title: t('Invite Codes'),
                  url: '/agent/codes',
                  icon: Ticket,
                },
                {
                  title: t('Members'),
                  url: '/agent/members',
                  icon: Users,
                },
                {
                  title: t('My Enterprises'),
                  url: '/agent/enterprises',
                  icon: Building,
                },
                {
                  title: t('Recharge Records'),
                  url: '/agent/recharge',
                  icon: ReceiptText,
                },
                {
                  title: t('Billing Center'),
                  url: '/billing',
                  icon: CreditCard,
                },
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
            requiredRole: ROLE.USER_MANAGER,
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
            title: t('Agent Management'),
            url: '/agents',
            icon: BadgePercent,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('Billing Center'),
            url: '/billing',
            icon: ReceiptText,
            requiredRole: ROLE.ADMIN,
          },
          {
            title: t('Cost Calculator'),
            url: '/cost-calculator',
            icon: Calculator,
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
    ], agentVisibleKeys),
  }
}
