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
