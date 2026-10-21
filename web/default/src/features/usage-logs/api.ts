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

import { buildQueryParams } from './lib/utils'
import type {
  GetLogsParams,
  GetLogsResponse,
  GetLogStatsParams,
  GetLogStatsResponse,
  GetLogBodiesResponse,
  GetMidjourneyLogsParams,
  GetTaskLogsParams,
  UserInfo,
} from './types'

// ============================================================================
// Generic API Helpers
// ============================================================================

function buildApiPath(endpoint: string, isAdmin: boolean): string {
  return isAdmin ? endpoint : `${endpoint}/self`
}

// Path-based fetchers: the agent endpoints live under /api/agent/* rather than
// the admin/self pair, so they resolve their own full path.
async function fetchLogsFromPath<T>(
  path: string,
  params: T
): Promise<GetLogsResponse> {
  const paramRecord = params as unknown as Record<string, unknown>
  const queryParams = buildQueryParams({
    p: paramRecord.p || 1,
    page_size: paramRecord.page_size || 20,
    ...params,
  })
  const res = await api.get(`${path}?${queryParams}`)
  return res.data
}

async function fetchStatsFromPath<T>(
  path: string,
  params: T
): Promise<GetLogStatsResponse> {
  const queryParams = buildQueryParams(
    params as unknown as Record<string, unknown>
  )
  const res = await api.get(`${path}?${queryParams}`)
  return res.data
}

async function fetchLogs<T>(
  endpoint: string,
  params: T,
  isAdmin: boolean
): Promise<GetLogsResponse> {
  return fetchLogsFromPath(buildApiPath(endpoint, isAdmin), params)
}

async function fetchLogStats<T>(
  endpoint: string,
  params: T,
  isAdmin: boolean
): Promise<GetLogStatsResponse> {
  return fetchStatsFromPath(`${buildApiPath(endpoint, isAdmin)}/stat`, params)
}

// ============================================================================
// Common Log APIs
// ============================================================================

export const getAllLogs = (params: GetLogsParams = {}) =>
  fetchLogs('/api/log', params, true)

export const getUserLogs = (
  params: Omit<GetLogsParams, 'username' | 'channel'> = {}
) => fetchLogs('/api/log', params, false)

export const getLogStats = (params: GetLogStatsParams = {}) =>
  fetchLogStats('/api/log', params, true)

export const getUserLogStats = (
  params: Omit<GetLogStatsParams, 'username' | 'channel'> = {}
) => fetchLogStats('/api/log', params, false)

// Agent-scoped: the server restricts results to the agent's members (+ self)
// and returns the reduced (self-equivalent) field set. `user_ids` narrows
// further within that range; the server intersects it and drops foreign ids.
export const getAgentLogs = (params: GetLogsParams = {}) =>
  fetchLogsFromPath('/api/agent/logs', params)

export const getAgentLogStats = (params: GetLogStatsParams = {}) =>
  fetchStatsFromPath('/api/agent/logs/stat', params)

export async function getUserInfo(
  userId: number
): Promise<{ success: boolean; message?: string; data?: UserInfo }> {
  const res = await api.get(`/api/user/${userId}`)
  return res.data
}

// 使用日志详情：按 request_id 拉取请求/返回体快照（base64 已脱敏、超限已截断）。
// 可见范围在服务端强制（管理员任意 / 本人自己的 / 代理商名下成员），越权返回空。
export async function getLogBodies(
  requestId: string
): Promise<GetLogBodiesResponse> {
  const res = await api.get(
    `/api/log/bodies?request_id=${encodeURIComponent(requestId)}`
  )
  return res.data
}

// ============================================================================
// MjProxy (Drawing) Logs API
// ============================================================================

export const getAllMidjourneyLogs = (params: GetMidjourneyLogsParams) =>
  fetchLogs('/api/mj', params, true)

export const getUserMidjourneyLogs = (params: GetMidjourneyLogsParams) =>
  fetchLogs('/api/mj', params, false)

export const getAgentMidjourneyLogs = (params: GetMidjourneyLogsParams) =>
  fetchLogsFromPath('/api/agent/mj', params)

// ============================================================================
// Task Logs API
// ============================================================================

export const getAllTaskLogs = (params: GetTaskLogsParams) =>
  fetchLogs('/api/task', params, true)

export const getUserTaskLogs = (params: GetTaskLogsParams) =>
  fetchLogs('/api/task', params, false)

export const getAgentTaskLogs = (params: GetTaskLogsParams) =>
  fetchLogsFromPath('/api/agent/tasks', params)

// 管理员手动补录：重新回源上游并结算单个任务（找回被超时清扫丢弃的结果）。
// data.result 为后端结算摘要码（settled_adjusted/settled_exact/refunded/
// already_settled/no_terminal/status_changed），供 UI 如实提示补录结果。
export interface TaskRefetchData {
  task?: unknown
  result?: string
}

export async function refetchTaskLog(taskId: string): Promise<{
  success: boolean
  message?: string
  data?: TaskRefetchData
}> {
  const res = await api.post(`/api/task/${encodeURIComponent(taskId)}/refetch`)
  return res.data
}
