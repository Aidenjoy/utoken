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
import type {
  ApiResponse,
  Organization,
  OrganizationDetail,
  OrgMemberDetail,
  PageInfo,
} from '@/features/organization/types'
import { api, type ApiRequestConfig } from '@/lib/api'

// 本模块所有调用方都会自行 toast 业务错误（result.success === false），
// 关闭全局响应拦截器的重复提示，避免同一条错误弹出两次。
const orgRequestConfig: ApiRequestConfig = { skipBusinessError: true }

/**
 * System-administrator payloads for `/api/org/admin`.
 *
 * `name` is the stable unique identifier and cannot be changed after creation,
 * so it only appears on create. `group` decides billing ratios and is therefore
 * admin-only — an organization admin must not be able to pick its own ratio.
 * Admins are appointed after creation from the member list, because the future
 * admin typically has no account yet at creation time.
 */
export interface AdminCreateOrganizationPayload {
  name: string
  display_name?: string
  group: string
  quota: number
  warning_threshold: number
  notify_type: string
  notify_target?: string
  daily_usage_alert: number
  cache_enabled: boolean
  cache_ttl: number
  allow_wallet_fallback: boolean
  hide_pool_quota: boolean
}

export interface AdminUpdateOrganizationPayload {
  display_name?: string
  group?: string
  warning_threshold?: number
  notify_type?: string
  notify_target?: string
  daily_usage_alert?: number
  cache_enabled?: boolean
  cache_ttl?: number
  allow_wallet_fallback?: boolean
  hide_pool_quota?: boolean
}

export interface AdminOrganizationsParams {
  p?: number
  page_size?: number
  keyword?: string
}

export async function getAdminOrganizations(
  params: AdminOrganizationsParams = {}
): Promise<ApiResponse<PageInfo<Organization>>> {
  const res = await api.get(
    `/api/org/admin/?p=${params.p ?? 1}&page_size=${params.page_size ?? 20}${
      params.keyword ? `&keyword=${encodeURIComponent(params.keyword)}` : ''
    }`,
    orgRequestConfig
  )
  return res.data
}

export async function getAdminOrganization(
  id: number
): Promise<ApiResponse<OrganizationDetail>> {
  const res = await api.get(`/api/org/admin/${id}`, orgRequestConfig)
  return res.data
}

export async function createAdminOrganization(
  data: AdminCreateOrganizationPayload
): Promise<ApiResponse<Organization>> {
  const res = await api.post('/api/org/admin/', data, orgRequestConfig)
  return res.data
}

export async function updateAdminOrganization(
  id: number,
  data: AdminUpdateOrganizationPayload
): Promise<ApiResponse<Organization>> {
  const res = await api.put(`/api/org/admin/${id}`, data, orgRequestConfig)
  return res.data
}

/**
 * Pool top-up / adjustment. `quota` is a signed delta; a negative delta that
 * would push the balance below zero is rejected by the backend.
 */
export async function adjustAdminOrganizationQuota(
  id: number,
  quota: number
): Promise<ApiResponse<{ quota: number }>> {
  const res = await api.post(
    `/api/org/admin/${id}/quota`,
    { quota },
    orgRequestConfig
  )
  return res.data
}

export async function updateAdminOrganizationStatus(
  id: number,
  status: number
): Promise<ApiResponse<null>> {
  const res = await api.patch(
    `/api/org/admin/${id}/status`,
    { status },
    orgRequestConfig
  )
  return res.data
}

/** Only organizations without members can be deleted. */
export async function deleteAdminOrganization(
  id: number
): Promise<ApiResponse<null>> {
  const res = await api.delete(`/api/org/admin/${id}`, orgRequestConfig)
  return res.data
}

export async function getAdminOrganizationMembers(
  id: number,
  params: { p?: number; page_size?: number; keyword?: string } = {}
): Promise<ApiResponse<PageInfo<OrgMemberDetail>>> {
  const res = await api.get(
    `/api/org/admin/${id}/members?p=${params.p ?? 1}&page_size=${
      params.page_size ?? 100
    }`,
    orgRequestConfig
  )
  return res.data
}
