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
  CanvasDraft,
  CanvasGenerateRequest,
  CanvasGeneration,
  CanvasProject,
  CanvasScriptScene,
} from './types'

const BASE = '/api/canvas'

interface ApiResponse<T> {
  success: boolean
  message?: string
  data?: T
}

interface PageResult<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

export async function getCanvasProjects(params: {
  keyword?: string
  p?: number
  page_size?: number
}) {
  const res = await api.get<ApiResponse<PageResult<CanvasProject>>>(
    `${BASE}/project/list`,
    { params }
  )
  return res.data
}

export async function getCanvasProject(id: number) {
  const res = await api.get<ApiResponse<CanvasProject>>(`${BASE}/project`, {
    params: { id },
  })
  return res.data
}

export async function createCanvasProject(title?: string) {
  const res = await api.post<ApiResponse<CanvasProject>>(`${BASE}/project`, {
    title,
  })
  return res.data
}

export async function updateCanvasProject(body: {
  id: number
  title?: string
  document?: string
}) {
  const res = await api.put<ApiResponse<{ id: number; updatedAt: number }>>(
    `${BASE}/project`,
    body
  )
  return res.data
}

export async function deleteCanvasProject(id: number) {
  const res = await api.delete<ApiResponse<null>>(`${BASE}/project`, {
    params: { id },
  })
  return res.data
}

export async function duplicateCanvasProject(id: number) {
  const res = await api.post<ApiResponse<CanvasProject>>(
    `${BASE}/project/duplicate`,
    { id }
  )
  return res.data
}

export async function getCanvasRecycleProjects() {
  const res = await api.get<
    ApiResponse<{ list: CanvasProject[]; total: number }>
  >(`${BASE}/project/recycle`)
  return res.data
}

export async function restoreCanvasProject(id: number) {
  const res = await api.post<ApiResponse<null>>(`${BASE}/project/restore`, {
    id,
  })
  return res.data
}

export async function permanentDeleteCanvasProject(id: number) {
  const res = await api.delete<ApiResponse<null>>(`${BASE}/project/permanent`, {
    params: { id },
  })
  return res.data
}

export async function optimizeCanvasPrompt(prompt: string) {
  const res = await api.post<ApiResponse<{ prompt: string }>>(
    `${BASE}/prompt/optimize`,
    { prompt }
  )
  return res.data
}

// 分镜脚本 AI 拆分：后端文本模型把剧本拆为镜头行（同步端点）
export async function splitCanvasScript(body: {
  script: string
  totalDuration?: number
  perShotDuration?: number
}) {
  const res = await api.post<
    ApiResponse<{
      shots: Omit<CanvasScriptScene, 'id'>[]
    }>
  >(`${BASE}/script/split`, body)
  return res.data
}

export async function submitCanvasGeneration(req: CanvasGenerateRequest) {
  const res = await api.post<ApiResponse<{ generationId: number }>>(
    `${BASE}/generate`,
    req
  )
  return res.data
}

export async function getCanvasGeneration(id: number) {
  const res = await api.get<ApiResponse<CanvasGeneration>>(
    `${BASE}/generation`,
    { params: { id }, disableDuplicate: true }
  )
  return res.data
}

export async function cancelCanvasGeneration(id: number) {
  const res = await api.post<ApiResponse<null>>(`${BASE}/generation/cancel`, {
    id,
  })
  return res.data
}

export async function getCanvasGenerations(params: {
  projectId?: number
  p?: number
  page_size?: number
}) {
  const res = await api.get<ApiResponse<PageResult<CanvasGeneration>>>(
    `${BASE}/generation/list`,
    { params }
  )
  return res.data
}

export async function submitCanvasAgentDraft(
  projectId: number,
  prompt: string
) {
  const res = await api.post<ApiResponse<CanvasDraft>>(`${BASE}/agent/draft`, {
    projectId,
    prompt,
  })
  return res.data
}

export async function uploadCanvasFile(file: File) {
  const form = new FormData()
  form.append('file', file)
  const res = await api.post<ApiResponse<{ url: string }>>(
    `${BASE}/upload`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  )
  return res.data
}
