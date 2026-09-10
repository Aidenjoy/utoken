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
import { api, type ApiRequestConfig } from '@/lib/api'

import type {
  ApiResponse,
  CreateOrgMemberPayload,
  InviteOrgMemberPayload,
  OrgLog,
  OrgMemberDetail,
  OrgSummary,
  OrgTokenItem,
  OrgUsageResponse,
  OrganizationDetail,
  PageInfo,
  UpdateOrgMemberPayload,
  UpdateOrganizationPayload,
} from './types'

// 本模块所有调用方都会自行 toast 业务错误（result.success === false），
// 关闭全局响应拦截器的重复提示，避免同一条错误弹出两次。
const orgRequestConfig: ApiRequestConfig = { skipBusinessError: true }

function buildQuery(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === '') return
    query.set(key, String(value))
  })
  const search = query.toString()
  return search ? `?${search}` : ''
}

// ============================================================================
// Member view
// ============================================================================

/**
 * The caller's organization overview. `org_id === 0` means "no organization",
 * which is a normal state — the page renders an empty-state guide instead.
 */
export async function getOrgSummary(): Promise<ApiResponse<OrgSummary>> {
  const res = await api.get('/api/org/summary', orgRequestConfig)
  return res.data
}

// ============================================================================
// Organization admin view
// ============================================================================

export async function getOrganization(): Promise<
  ApiResponse<OrganizationDetail>
> {
  const res = await api.get('/api/org/', orgRequestConfig)
  return res.data
}

export async function updateOrganization(
  data: UpdateOrganizationPayload
): Promise<ApiResponse<null>> {
  const res = await api.put('/api/org/', data, orgRequestConfig)
  return res.data
}

export interface OrgMembersParams {
  p?: number
  page_size?: number
  keyword?: string
}

export async function getOrgMembers(
  params: OrgMembersParams = {}
): Promise<ApiResponse<PageInfo<OrgMemberDetail>>> {
  const res = await api.get(
    `/api/org/members${buildQuery({
      p: params.p ?? 1,
      page_size: params.page_size ?? 20,
      keyword: params.keyword,
    })}`,
    orgRequestConfig
  )
  return res.data
}

/**
 * `orgId` 仅在系统管理员代管某企业时传入（后端 OrgScopeId 读 org_id 查询参数）；
 * 企业管理员操作本企业时留空，由鉴权上下文自动定位。
 */
export async function createOrgMember(
  data: CreateOrgMemberPayload,
  orgId?: number
): Promise<ApiResponse<{ id: number; user_id: number; username: string }>> {
  const res = await api.post(
    `/api/org/members/create${buildQuery({ org_id: orgId })}`,
    data,
    orgRequestConfig
  )
  return res.data
}

/** Invite an existing user by username; users already in any org are rejected. */
export async function inviteOrgMember(
  data: InviteOrgMemberPayload,
  orgId?: number
): Promise<ApiResponse<{ id: number; user_id: number; username: string }>> {
  const res = await api.post(
    `/api/org/members/invite${buildQuery({ org_id: orgId })}`,
    data,
    orgRequestConfig
  )
  return res.data
}

export async function updateOrgMember(
  id: number,
  data: UpdateOrgMemberPayload,
  orgId?: number
): Promise<ApiResponse<null>> {
  const res = await api.put(
    `/api/org/members/${id}${buildQuery({ org_id: orgId })}`,
    data,
    orgRequestConfig
  )
  return res.data
}

/** Unbind a member from the organization. The account itself is kept. */
export async function removeOrgMember(
  id: number,
  orgId?: number
): Promise<ApiResponse<null>> {
  const res = await api.delete(
    `/api/org/members/${id}${buildQuery({ org_id: orgId })}`,
    orgRequestConfig
  )
  return res.data
}

export type OrgTimeRangeParams = {
  start_timestamp?: number
  end_timestamp?: number
}

export async function getOrgUsage(
  params: OrgTimeRangeParams = {}
): Promise<ApiResponse<OrgUsageResponse>> {
  const res = await api.get(
    `/api/org/usage${buildQuery(params)}`,
    orgRequestConfig
  )
  return res.data
}

export interface OrgLogsParams extends OrgTimeRangeParams {
  p?: number
  page_size?: number
  model_name?: string
  user_id?: number
}

export async function getOrgLogs(
  params: OrgLogsParams = {}
): Promise<ApiResponse<PageInfo<OrgLog>>> {
  const res = await api.get(
    `/api/org/logs${buildQuery({
      p: params.p ?? 1,
      page_size: params.page_size ?? 20,
      model_name: params.model_name,
      user_id: params.user_id,
      start_timestamp: params.start_timestamp,
      end_timestamp: params.end_timestamp,
    })}`,
    orgRequestConfig
  )
  return res.data
}

export interface OrgTokensParams {
  p?: number
  page_size?: number
  keyword?: string
  user_id?: number
}

export async function getOrgTokens(
  params: OrgTokensParams = {}
): Promise<ApiResponse<PageInfo<OrgTokenItem>>> {
  const res = await api.get(
    `/api/org/tokens${buildQuery({
      p: params.p ?? 1,
      page_size: params.page_size ?? 20,
      keyword: params.keyword,
      user_id: params.user_id,
    })}`,
    orgRequestConfig
  )
  return res.data
}
