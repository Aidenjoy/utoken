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
  CanvasAsset,
  CanvasProject,
  CanvasProjectListResponse,
  CanvasTask,
  CanvasTaskListResponse,
  CanvasUpload,
  CapabilitiesResponse,
  CreateTaskPayload,
  SaveDocumentResponse,
  ToolParams,
} from './types'

// 画布调用方自行处理业务错误（例如 revision 冲突要就地提示并重载），
// 关闭全局拦截器的重复 toast。
const canvasRequestConfig: ApiRequestConfig = { skipBusinessError: true }

/** 画布 API 错误：携带后端稳定 code，便于区分冲突与普通失败 */
export class CanvasApiError extends Error {
  code: string
  status?: number

  constructor(message: string, code: string, status?: number) {
    super(message)
    this.name = 'CanvasApiError'
    this.code = code
    this.status = status
  }
}

function toCanvasError(error: unknown, fallback: string): CanvasApiError {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (
      error as {
        response?: {
          status?: number
          data?: { message?: string; code?: string }
        }
      }
    ).response
    const message = response?.data?.message || fallback
    const code = response?.data?.code || 'request_failed'
    return new CanvasApiError(message, code, response?.status)
  }
  if (error instanceof Error) {
    return new CanvasApiError(error.message, 'network_error')
  }
  return new CanvasApiError(fallback, 'unknown_error')
}

async function unwrap<T>(
  request: Promise<{ data: ApiResponse<T> }>,
  fallback: string
): Promise<T> {
  try {
    const response = await request
    if (!response.data?.success) {
      throw new CanvasApiError(
        response.data?.message || fallback,
        response.data?.code || 'request_failed'
      )
    }
    return response.data.data
  } catch (error) {
    if (error instanceof CanvasApiError) throw error
    throw toCanvasError(error, fallback)
  }
}

export function getCapabilities(): Promise<CapabilitiesResponse> {
  return unwrap(
    api.get('/api/canvas/capabilities', canvasRequestConfig),
    '读取工具能力失败'
  )
}

export function listProjects(params: {
  p?: number
  page_size?: number
  keyword?: string
}): Promise<CanvasProjectListResponse> {
  return unwrap(
    api.get('/api/canvas/projects', { ...canvasRequestConfig, params }),
    '读取画布列表失败'
  )
}

export function createProject(payload: {
  title: string
  width: number
  height: number
  background?: string
}): Promise<CanvasProject> {
  return unwrap(
    api.post('/api/canvas/projects', payload, canvasRequestConfig),
    '新建画布失败'
  )
}

export function getProject(id: number): Promise<CanvasProject> {
  return unwrap(
    api.get(`/api/canvas/projects/${id}`, canvasRequestConfig),
    '读取画布失败'
  )
}

export function renameProject(
  id: number,
  title: string
): Promise<CanvasProject> {
  return unwrap(
    api.put(`/api/canvas/projects/${id}`, { title }, canvasRequestConfig),
    '重命名失败'
  )
}

export function deleteProject(id: number): Promise<null> {
  return unwrap(
    api.delete(`/api/canvas/projects/${id}`, canvasRequestConfig),
    '删除画布失败'
  )
}

export function saveDocument(
  id: number,
  payload: {
    revision: number
    document: unknown
    thumbnail?: string
    background?: string
  }
): Promise<SaveDocumentResponse> {
  return unwrap(
    api.put(
      `/api/canvas/projects/${id}/document`,
      payload,
      canvasRequestConfig
    ),
    '保存画布失败'
  )
}

export function listAssets(params: {
  start_idx?: number
}): Promise<{ items: CanvasAsset[] }> {
  return unwrap(
    api.get('/api/canvas/assets', { ...canvasRequestConfig, params }),
    '读取素材库失败'
  )
}

// 上传本地图片：返回对象存储地址与原始像素尺寸
export function uploadImage(
  file: File,
  projectId?: number
): Promise<CanvasUpload> {
  const form = new FormData()
  form.append('file', file)
  if (projectId) form.append('projectId', String(projectId))
  return unwrap(
    api.post('/api/canvas/upload', form, canvasRequestConfig),
    '上传图片失败'
  )
}

// 同源图片代理：跨域素材经后端转发后再画进 canvas，避免画布被污染导致导出失败
export function proxyImageUrl(url: string): string {
  if (!url) return url
  if (
    url.startsWith('/') ||
    url.startsWith('data:') ||
    url.startsWith('blob:')
  ) {
    return url
  }
  return `/api/canvas/image?url=${encodeURIComponent(url)}`
}

export function createTask(payload: CreateTaskPayload): Promise<{
  task: CanvasTask
  reused: boolean
}> {
  return unwrap(
    api.post('/api/canvas/tasks', payload, canvasRequestConfig),
    '提交任务失败'
  )
}

export function listTasks(params: {
  projectId?: number
  tool?: string
  status?: string
  p?: number
  page_size?: number
}): Promise<CanvasTaskListResponse> {
  return unwrap(
    api.get('/api/canvas/tasks', { ...canvasRequestConfig, params }),
    '读取任务历史失败'
  )
}

export function getTask(id: number): Promise<CanvasTask> {
  return unwrap(
    api.get(`/api/canvas/tasks/${id}`, canvasRequestConfig),
    '读取任务失败'
  )
}

export function cancelTask(id: number): Promise<CanvasTask> {
  return unwrap(
    api.post(`/api/canvas/tasks/${id}/cancel`, {}, canvasRequestConfig),
    '取消失败'
  )
}

export function repersistTask(id: number): Promise<CanvasTask> {
  return unwrap(
    api.post(`/api/canvas/tasks/${id}/repersist`, {}, canvasRequestConfig),
    '补存失败'
  )
}

export function saveTaskToAsset(
  id: number,
  payload: { index?: number; name?: string }
): Promise<CanvasAsset> {
  return unwrap(
    api.post(
      `/api/canvas/tasks/${id}/save-asset`,
      payload,
      canvasRequestConfig
    ),
    '保存到素材库失败'
  )
}

export function taskDownloadUrl(id: number, index = 0): string {
  return `/api/canvas/tasks/${id}/download?index=${index}`
}

export type { ToolParams }
