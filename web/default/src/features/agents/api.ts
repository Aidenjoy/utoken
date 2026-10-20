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
import { api } from '@/lib/api'

import type {
  Agent,
  AgentMember,
  AgentMemberDiscounts,
  AgentProfile,
  AgentRechargeRecord,
  ApiResponse,
  InviteCode,
  PaginatedResponse,
} from './types'

export interface ListParams {
  p?: number
  page_size?: number
}

/**
 * `model_discounts` maps an exact model name to the deepest discount (pay
 * multiplier in (0, 1]) the agent may grant for it. The key set doubles as the
 * allowlist for every user bound to this agent, so the server rejects an empty
 * map and rejects wildcard names.
 */
export interface AgentPayload {
  user_id: number
  model_discounts: Record<string, number>
  remark?: string
}

/**
 * Updating replaces the whole authorization list rather than merging into it —
 * a model dropped from the map is de-authorized for all of the agent's members.
 */
export interface AgentUpdatePayload {
  model_discounts?: Record<string, number>
  status?: number
  remark?: string
}

// Invite codes carry no discount, so creating one only sets its usage limits.
export interface InviteCodePayload {
  max_uses?: number
  expires_at?: number
  remark?: string
}

export interface InviteCodeUpdatePayload {
  max_uses?: number
  expires_at?: number
  status?: number
  remark?: string
}

// ============================================================================
// Admin: agents
// ============================================================================

export async function listAgents(
  params: ListParams = {}
): Promise<PaginatedResponse<Agent>> {
  const { p = 1, page_size = 20 } = params
  const res = await api.get(
    `/api/agent/admin/agents?p=${p}&page_size=${page_size}`
  )
  return res.data
}

/**
 * Candidate model names for the authorization picker: every model currently
 * enabled on any channel. Deliberately not /api/pricing, which is filtered by
 * the caller's usable groups and would silently omit models an admin still
 * needs to be able to authorize.
 *
 * Errors are surfaced inline by the dialog (with a retry) instead of the
 * global error toast: a missing candidate list degrades the picker, it is not
 * a request the admin acted on.
 */
export async function listServableModels(): Promise<ApiResponse<string[]>> {
  const res = await api.get('/api/agent/admin/models', {
    skipErrorHandler: true,
  })
  return res.data
}

export async function createAgent(
  payload: AgentPayload
): Promise<ApiResponse<Agent>> {
  const res = await api.post('/api/agent/admin/agents', payload)
  return res.data
}

export async function updateAgent(
  id: number,
  payload: AgentUpdatePayload
): Promise<ApiResponse> {
  const res = await api.put(`/api/agent/admin/agents/${id}`, payload)
  return res.data
}

export async function deleteAgent(id: number): Promise<ApiResponse> {
  const res = await api.delete(`/api/agent/admin/agents/${id}`)
  return res.data
}

// ============================================================================
// Admin: invite codes (no owner restriction)
// ============================================================================

export async function listAllInviteCodes(
  params: ListParams & { owner_user_id?: number; owner_type?: string } = {}
): Promise<PaginatedResponse<InviteCode>> {
  const { p = 1, page_size = 20, owner_user_id, owner_type } = params
  const query = new URLSearchParams()
  query.set('p', String(p))
  query.set('page_size', String(page_size))
  if (owner_user_id) query.set('owner_user_id', String(owner_user_id))
  if (owner_type) query.set('owner_type', owner_type)
  const res = await api.get(`/api/agent/admin/codes?${query.toString()}`)
  return res.data
}

export async function createAdminInviteCode(
  payload: InviteCodePayload
): Promise<ApiResponse<InviteCode>> {
  const res = await api.post('/api/agent/admin/codes', payload)
  return res.data
}

export async function updateAdminInviteCode(
  id: number,
  payload: InviteCodeUpdatePayload
): Promise<ApiResponse> {
  const res = await api.put(`/api/agent/admin/codes/${id}`, payload)
  return res.data
}

// ============================================================================
// Agent self-service (requires the caller to be a promoted agent)
// ============================================================================

export async function getAgentProfile(): Promise<ApiResponse<AgentProfile>> {
  const res = await api.get('/api/agent/profile')
  return res.data
}

export async function listMyInviteCodes(
  params: ListParams = {}
): Promise<PaginatedResponse<InviteCode>> {
  const { p = 1, page_size = 20 } = params
  const res = await api.get(`/api/agent/codes?p=${p}&page_size=${page_size}`)
  return res.data
}

export async function createMyInviteCode(
  payload: InviteCodePayload
): Promise<ApiResponse<InviteCode>> {
  const res = await api.post('/api/agent/codes', payload)
  return res.data
}

export async function updateMyInviteCode(
  id: number,
  payload: InviteCodeUpdatePayload
): Promise<ApiResponse> {
  const res = await api.put(`/api/agent/codes/${id}`, payload)
  return res.data
}

export async function listMyMembers(
  params: ListParams = {}
): Promise<PaginatedResponse<AgentMember>> {
  const { p = 1, page_size = 20 } = params
  const res = await api.get(`/api/agent/members?p=${p}&page_size=${page_size}`)
  return res.data
}

/**
 * Read a member's per-model discounts together with the agent's own floors, so
 * the editor can clamp each percentage input before submitting.
 */
export async function getAgentMemberDiscounts(
  memberId: number
): Promise<ApiResponse<AgentMemberDiscounts>> {
  const res = await api.get(`/api/agent/members/${memberId}/model_discounts`)
  return res.data
}

/**
 * Set a member's discounts for the models this agent is authorized for.
 * Authorized models omitted from the payload revert to full price; discounts
 * the agent is not authorized for are left untouched server-side (they belong
 * to an admin's configuration).
 */
export async function updateAgentMemberDiscounts(
  memberId: number,
  discounts: Record<string, number>
): Promise<ApiResponse<{ discounts: Record<string, number> }>> {
  const res = await api.put(`/api/agent/members/${memberId}/model_discounts`, {
    discounts,
  })
  return res.data
}

export async function listMyRecharge(
  params: ListParams = {}
): Promise<PaginatedResponse<AgentRechargeRecord>> {
  const { p = 1, page_size = 20 } = params
  const res = await api.get(`/api/agent/recharge?p=${p}&page_size=${page_size}`)
  return res.data
}
