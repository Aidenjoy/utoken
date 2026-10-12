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

// A reseller (agent) is a registered user promoted by an admin with an allowed
// discount range. Discounts are pay multipliers in (0, 1]: 0.6 means pay 60%.
export interface Agent {
  id: number
  user_id: number
  min_discount: number
  max_discount: number
  status: number
  remark?: string
  created_by?: number
  created_at?: number
  updated_at?: number
  // Backfilled for display, not persisted
  username?: string
  display_name?: string
  email?: string
  code_count?: number
}

export interface DiscountCode {
  id: number
  code: string
  owner_type: string
  owner_user_id: number
  discount: number
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
  invited_user_count?: number
  invited_recharge?: number
}

export interface AgentProfile {
  min_discount: number
  max_discount: number
  code_count: number
  total_used: number
  invited_users: number
  total_recharge: number
}

export const AGENT_STATUS = {
  ENABLED: 1,
  DISABLED: 2,
} as const

export const DISCOUNT_CODE_STATUS = {
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
