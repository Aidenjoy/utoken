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

// A reseller (agent) is a registered user promoted by an admin with a set of
// authorized models. `model_discounts` maps an exact model name to the deepest
// discount (pay multiplier in (0, 1]) the agent may grant for it: 0.8 means the
// agent may price that model anywhere in [80%, 100%]. The keys double as the
// allowlist — users bound to this agent can only call those models.
export interface Agent {
  id: number
  user_id: number
  model_discounts: Record<string, number>
  status: number
  remark?: string
  created_by?: number
  created_at?: number
  updated_at?: number
  /**
   * Sidebar feature menus this agent may see. Empty/absent = all hidden (the
   * default, since agents only develop customers). Keys come from
   * `AGENT_MENU_KEYS`; the server rejects unknown keys.
   */
  menu_visibility?: string[]
  // Backfilled for display, not persisted
  username?: string
  display_name?: string
  email?: string
  invite_count?: number
}

// An invite code only binds a registering user to its owner; it carries no
// discount of its own. `used_count` is therefore the number of users who
// successfully registered with it.
export interface InviteCode {
  id: number
  code: string
  owner_type: string
  owner_user_id: number
  max_uses: number
  used_count: number
  expires_at: number
  status: number
  remark?: string
  created_at?: number
  updated_at?: number
  // Backfilled for display, not persisted
  owner_username?: string
  owner_email?: string
}

export interface AgentProfile {
  /** Authorized models mapped to the deepest discount the agent may grant. */
  model_discounts: Record<string, number>
  /** Same key set as `model_discounts`, pre-sorted for stable dropdowns. */
  allowed_models: string[]
  code_count: number
  total_used: number
  member_count: number
  total_recharge: number
}

// A member is a user bound to this agent at registration.
export interface AgentMember {
  user_id: number
  username: string
  display_name: string
  model_discounts: Record<string, number>
  created_at: number
  total_recharge: number
  /** Current wallet balance in quota units; format with formatQuota for money. */
  quota: number
}

/**
 * Lightweight member option for the agent-scoped filter pickers (usage logs /
 * billing center). Carries only identity + display name, never the discount or
 * recharge fields that the full AgentMember exposes.
 */
export interface AgentMemberOption {
  user_id: number
  username: string
  display_name: string
}

// A successful top-up made by one of the agent's members.
export interface AgentRechargeRecord {
  created_at: number
  user_id: number
  username: string
  display_name: string
  amount: number
  money: number
  payment_method: string
  trade_no: string
}

/** A member's per-model discounts plus the floors the agent must stay above. */
export interface AgentMemberDiscounts {
  discounts: Record<string, number>
  floors: Record<string, number>
}

/**
 * An enterprise (organization) this agent develops. `agent_id` is always this
 * agent for the self-service list; `model_discounts` is the enterprise-wide
 * per-model discount the agent may set within its own floors, and
 * `disable_personal_wallet` mirrors the admin-controlled wallet lockdown.
 */
export interface AgentOrganization {
  id: number
  name: string
  display_name: string
  group: string
  status: number
  quota: number
  used_quota: number
  agent_id: number
  agent_username?: string
  model_discounts: Record<string, number>
  disable_personal_wallet: boolean
  allow_wallet_fallback: boolean
  hide_pool_quota: boolean
  created_at?: number
}

/** An enterprise member row (read-only for the agent). */
export interface AgentOrganizationMember {
  id: number
  org_id: number
  user_id: number
  org_role: string
  quota_limit: number
  quota_used: number
  status: number
  sub_user: boolean
  username: string
  display_name: string
  email?: string
  user_status?: number
  user_quota?: number
  used_quota?: number
}

/**
 * The configurable sidebar menus an admin may reveal for an agent. `key` must
 * stay in sync with the backend `model.AgentMenuKeys`; `labelKey` reuses the
 * existing sidebar i18n source string so labels never drift.
 */
export interface AgentMenuItem {
  key: string
  labelKey: string
}

export const AGENT_MENU_KEYS: AgentMenuItem[] = [
  { key: 'experience', labelKey: 'Test Models' },
  { key: 'video_factory', labelKey: 'Video Factory' },
  { key: 'model_styling', labelKey: 'Model Styling' },
  { key: 'viral_hero', labelKey: 'Viral Hero Image' },
  { key: 'viral_design', labelKey: 'Viral Design' },
  { key: 'asset_library', labelKey: 'Asset Library' },
  { key: 'prompt_library', labelKey: 'Prompt Library' },
  { key: 'enterprises', labelKey: 'My Enterprises' },
]

export const AGENT_STATUS = {
  ENABLED: 1,
  DISABLED: 2,
} as const

export const INVITE_CODE_STATUS = {
  ENABLED: 1,
  DISABLED: 2,
} as const

export const OWNER_TYPE = {
  AGENT: 'agent',
  ADMIN: 'admin',
} as const

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export interface PaginatedResponse<T> {
  success: boolean
  message?: string
  data?: {
    items: T[]
    total: number
    page: number
    page_size: number
  }
}
