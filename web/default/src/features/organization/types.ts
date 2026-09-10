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
// ============================================================================
// Shared API envelope
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export interface PageInfo<T> {
  page: number
  page_size: number
  total: number
  items: T[]
}

// ============================================================================
// Organization & member (mirrors model/organization.go)
// ============================================================================

/** Organization status values. Keep in sync with `model.OrgStatus*`. */
export const ORG_STATUS = {
  ENABLED: 1,
  DISABLED: 2,
} as const

/** Organization-scoped roles. Not system roles — see `middleware/org.go`. */
export const ORG_ROLE = {
  ADMIN: 'admin',
  MEMBER: 'member',
} as const

export type OrgRole = (typeof ORG_ROLE)[keyof typeof ORG_ROLE]

/** Member status values. Keep in sync with `model.OrgMemberStatus*`. */
export const ORG_MEMBER_STATUS = {
  ENABLED: 1,
  DISABLED: 2,
} as const

export interface Organization {
  id: number
  name: string
  display_name: string
  group: string
  status: number
  owner_user_id: number
  quota: number
  used_quota: number
  warning_threshold: number
  notify_type: string
  notify_target: string
  daily_usage_alert: number
  last_alert_at: number
  last_daily_alert_at: number
  cache_enabled: boolean
  cache_ttl: number
  allow_wallet_fallback: boolean
  hide_pool_quota: boolean
  created_at: number
  updated_at: number
}

export interface OrgMemberDetail {
  id: number
  org_id: number
  user_id: number
  org_role: string
  quota_limit: number
  quota_used: number
  status: number
  joined_at: number
  username: string
  display_name: string
  email: string
  user_status: number
  user_quota: number
  used_quota: number
}

/** `GET /api/org/summary` — `org_id` is 0 when the user belongs to no org. */
export interface OrgSummary {
  org_id: number
  name?: string
  display_name?: string
  group?: string
  org_role?: string
  member_status?: number
  quota_limit?: number
  quota_used?: number
  quota_remain?: number
  pool_quota?: number
  pool_used_quota?: number
  pool_quota_hidden?: boolean
  member_count?: number
  cache_enabled?: boolean
}

export interface OrganizationDetail {
  organization: Organization
  member_count: number
  /** False when Redis is unavailable, i.e. the cache switch cannot be turned on. */
  cache_supported: boolean
}

/** Only the fields an organization admin may change (`PUT /api/org/`). */
export interface UpdateOrganizationPayload {
  display_name?: string
  warning_threshold?: number
  notify_type?: string
  notify_target?: string
  daily_usage_alert?: number
  cache_enabled?: boolean
  cache_ttl?: number
  allow_wallet_fallback?: boolean
  hide_pool_quota?: boolean
}

export interface CreateOrgMemberPayload {
  username: string
  password: string
  display_name?: string
  email?: string
  org_role: string
  quota_limit: number
}

export interface InviteOrgMemberPayload {
  username: string
  org_role: string
  quota_limit: number
}

export interface UpdateOrgMemberPayload {
  org_role?: string
  quota_limit?: number
  status?: number
}

// ============================================================================
// Usage report (mirrors model/org_usage.go)
// ============================================================================

export interface OrgUsageTotal {
  count: number
  quota: number
  token_used: number
  cache_hits: number
  cache_saved_quota: number
}

export interface OrgUsageByDay extends OrgUsageTotal {
  date: number
}

export interface OrgUsageByMember {
  user_id: number
  username: string
  org_role: string
  quota_limit: number
  quota_used: number
  count: number
  quota: number
  token_used: number
}

export interface OrgUsageByModel {
  model_name: string
  count: number
  quota: number
  token_used: number
}

export interface OrgUsageReport {
  total: OrgUsageTotal
  by_day: OrgUsageByDay[]
  by_member: OrgUsageByMember[]
  by_model: OrgUsageByModel[]
}

export interface OrgUsageResponse {
  start_timestamp: number
  end_timestamp: number
  report: OrgUsageReport
}

// ============================================================================
// Consume logs & member keys
// ============================================================================

/** Subset of `model.Log` consumed by the organization billing view. */
export interface OrgLog {
  id: number
  user_id: number
  created_at: number
  type: number
  content: string
  username: string
  token_name: string
  model_name: string
  quota: number
  prompt_tokens: number
  completion_tokens: number
  use_time: number
  is_stream: boolean
  channel: number
  group: string
  other?: string
}

/**
 * Masked key of a member plus its owner. `controller.tokenOwnerResponse`
 * embeds `*model.Token` anonymously, so the token fields are serialized flat
 * alongside `username`. The plaintext key is never returned.
 */
export interface OrgTokenItem {
  id: number
  user_id: number
  name: string
  key: string
  status: number
  group: string
  model_limits_enabled: boolean
  model_limits: string
  remain_quota: number
  used_quota: number
  unlimited_quota: boolean
  created_time: number
  accessed_time: number
  expired_time: number
  username: string
}

// ============================================================================
// Dialog types
// ============================================================================

export type OrganizationDialogType =
  | 'create-member'
  | 'invite-member'
  | 'edit-member'
  | 'remove-member'
