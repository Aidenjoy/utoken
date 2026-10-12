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
  AgentProfile,
  ApiResponse,
  DiscountCode,
  PaginatedResponse,
} from './types'

export interface ListParams {
  p?: number
  page_size?: number
}

export interface AgentPayload {
  user_id: number
  min_discount: number
  max_discount: number
  remark?: string
}

export interface AgentUpdatePayload {
  min_discount?: number
  max_discount?: number
  status?: number
  remark?: string
}

export interface CodePayload {
  discount: number
  max_uses?: number
  expires_at?: number
  remark?: string
}

export interface CodeUpdatePayload {
  // `discount` is immutable after creation (bound users keep their snapshot),
  // so it is intentionally absent here; create a new code for a new discount.
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
  const res = await api.get(`/api/agent/admin/agents?p=${p}&page_size=${page_size}`)
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
// Admin: discount codes (no range restriction)
// ============================================================================

export async function listAllCodes(
  params: ListParams & { owner_user_id?: number; owner_type?: string } = {}
): Promise<PaginatedResponse<DiscountCode>> {
  const { p = 1, page_size = 20, owner_user_id, owner_type } = params
  const query = new URLSearchParams()
  query.set('p', String(p))
  query.set('page_size', String(page_size))
  if (owner_user_id) query.set('owner_user_id', String(owner_user_id))
  if (owner_type) query.set('owner_type', owner_type)
  const res = await api.get(`/api/agent/admin/codes?${query.toString()}`)
  return res.data
}

export async function createAdminCode(
  payload: CodePayload
): Promise<ApiResponse<DiscountCode>> {
  const res = await api.post('/api/agent/admin/codes', payload)
  return res.data
}

export async function updateAdminCode(
  id: number,
  payload: CodeUpdatePayload
): Promise<ApiResponse> {
  const res = await api.put(`/api/agent/admin/codes/${id}`, payload)
  return res.data
}

export async function deleteAdminCode(id: number): Promise<ApiResponse> {
  const res = await api.delete(`/api/agent/admin/codes/${id}`)
  return res.data
}

// ============================================================================
// Agent self-service (requires the caller to be a promoted agent)
// ============================================================================

export async function getAgentProfile(): Promise<ApiResponse<AgentProfile>> {
  const res = await api.get('/api/agent/profile')
  return res.data
}

export async function listMyCodes(
  params: ListParams = {}
): Promise<PaginatedResponse<DiscountCode>> {
  const { p = 1, page_size = 20 } = params
  const res = await api.get(`/api/agent/codes?p=${p}&page_size=${page_size}`)
  return res.data
}

export async function createMyCode(
  payload: CodePayload
): Promise<ApiResponse<DiscountCode>> {
  const res = await api.post('/api/agent/codes', payload)
  return res.data
}

export async function updateMyCode(
  id: number,
  payload: CodeUpdatePayload
): Promise<ApiResponse> {
  const res = await api.put(`/api/agent/codes/${id}`, payload)
  return res.data
}

export async function deleteMyCode(id: number): Promise<ApiResponse> {
  const res = await api.delete(`/api/agent/codes/${id}`)
  return res.data
}
