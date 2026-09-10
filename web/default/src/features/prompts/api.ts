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
  GetPromptTemplatesParams,
  GetPromptTemplatesResponse,
  PromptTemplate,
  PromptTemplateFormData,
} from './types'

// 本模块调用方均自行 toast 业务错误，关闭全局拦截器的重复提示。
const promptRequestConfig: ApiRequestConfig = { skipBusinessError: true }

// ============================================================================
// Prompt Template Library
// ============================================================================

export async function getPromptTemplates(
  params: GetPromptTemplatesParams = {}
): Promise<GetPromptTemplatesResponse> {
  const { p = 1, page_size = 20, keyword, tag, visibility, scope } = params
  const queryParams = new URLSearchParams()
  queryParams.set('p', String(p))
  queryParams.set('page_size', String(page_size))
  if (keyword) queryParams.set('keyword', keyword)
  if (tag) queryParams.set('tag', tag)
  if (visibility) queryParams.set('visibility', visibility)
  if (scope) queryParams.set('scope', scope)
  const res = await api.get(
    `/api/prompt/?${queryParams.toString()}`,
    promptRequestConfig
  )
  return res.data
}

/** Tags across all templates visible to the current user, for the filter menu. */
export async function getPromptTemplateTags(): Promise<ApiResponse<string[]>> {
  const res = await api.get('/api/prompt/tags', promptRequestConfig)
  return res.data
}

export async function getPromptTemplate(
  id: number
): Promise<ApiResponse<PromptTemplate>> {
  const res = await api.get(`/api/prompt/${id}`, promptRequestConfig)
  return res.data
}

export async function createPromptTemplate(
  data: PromptTemplateFormData
): Promise<ApiResponse<PromptTemplate>> {
  const res = await api.post('/api/prompt/', data, promptRequestConfig)
  return res.data
}

export async function updatePromptTemplate(
  id: number,
  data: Partial<PromptTemplateFormData>
): Promise<ApiResponse<PromptTemplate>> {
  const res = await api.put(`/api/prompt/${id}`, data, promptRequestConfig)
  return res.data
}

export async function deletePromptTemplate(
  id: number
): Promise<ApiResponse<null>> {
  const res = await api.delete(`/api/prompt/${id}`, promptRequestConfig)
  return res.data
}

/**
 * Duplicate a visible template into the caller's own library.
 * The copy is private by default; pass `visibility` to share it right away.
 */
export async function copyPromptTemplate(
  id: number,
  data: { title?: string; visibility?: string } = {}
): Promise<ApiResponse<PromptTemplate>> {
  const res = await api.post(`/api/prompt/${id}/copy`, data, promptRequestConfig)
  return res.data
}

/**
 * Record one "used in Playground" event. The count only drives popularity
 * ordering, so callers may ignore failures.
 *
 * Deliberately not named `usePromptTemplate`: a `use*` export inside a React
 * app is read as a custom hook by both lint rules and readers.
 */
export async function recordPromptTemplateUse(
  id: number
): Promise<ApiResponse<{ id: number; use_count: number }>> {
  const res = await api.post(`/api/prompt/${id}/use`, undefined, {
    ...promptRequestConfig,
    // 仅驱动热度排序，调用方忽略失败，HTTP 层也不应打扰用户
    skipErrorHandler: true,
  })
  return res.data
}
