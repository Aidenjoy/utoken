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

import { API_ENDPOINTS, VIDEO_API_ENDPOINTS } from './constants'
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelOption,
  GroupOption,
  VideoSubmitRequest,
  VideoSubmitResponse,
  VideoTaskResponse,
} from './types'

/**
 * Send chat completion request (non-streaming)
 */
export async function sendChatCompletion(
  payload: ChatCompletionRequest,
  signal?: AbortSignal
): Promise<ChatCompletionResponse> {
  const res = await api.post(API_ENDPOINTS.CHAT_COMPLETIONS, payload, {
    signal,
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return res.data
}

/**
 * Get user available models
 */
export async function getUserModels(group: string): Promise<ModelOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_MODELS, {
    params: { group },
  })
  const { data } = res

  if (!data.success || !Array.isArray(data.data)) {
    return []
  }

  return data.data.map((model: string) => ({
    label: model,
    value: model,
  }))
}

/**
 * Get user groups
 */
export async function getUserGroups(): Promise<GroupOption[]> {
  const res = await api.get(API_ENDPOINTS.USER_GROUPS)
  const { data } = res

  if (!data.success || !data.data) {
    return []
  }

  const groupData = data.data as Record<string, { desc: string; ratio: number }>

  // label is for button display (name only); desc is for dropdown content
  return Object.entries(groupData).map(([group, info]) => ({
    label: group,
    value: group,
    ratio: info.ratio,
    desc: info.desc,
  }))
}

/**
 * Submit a video generation task
 */
export async function submitVideoTask(
  payload: VideoSubmitRequest
): Promise<VideoSubmitResponse> {
  const res = await api.post(VIDEO_API_ENDPOINTS.SUBMIT, payload, {
    skipErrorHandler: true,
  } as Record<string, unknown>)
  return res.data
}

/**
 * Fetch a video generation task status
 *
 * The backend returns a wrapped response:
 *   { code: "success", data: { task_id, status, progress, result_url, fail_reason, ... } }
 * where status is uppercase ("SUCCESS", "IN_PROGRESS", etc.) and progress is a string like "50%".
 *
 * This function unwraps and normalizes the response into the flat VideoTaskResponse format
 * that the rest of the frontend expects.
 */
export async function fetchVideoTask(
  taskId: string
): Promise<VideoTaskResponse> {
  const res = await api.get(VIDEO_API_ENDPOINTS.FETCH(taskId), {
    skipErrorHandler: true,
  } as Record<string, unknown>)
  const raw = res.data

  // Wrapped format: { code: "success", data: { ... } }
  if (raw?.code === 'success' && raw?.data) {
    const d = raw.data
    const progressStr = typeof d.progress === 'string' ? d.progress : ''
    const progressNum = parseInt(progressStr) || 0
    const statusLower = (d.status || '').toLowerCase()

    return {
      id: d.task_id || taskId,
      task_id: d.task_id,
      object: 'video',
      model: d.properties?.origin_model_name || '',
      status: statusLower,
      progress: progressNum,
      created_at: d.created_at || 0,
      completed_at: d.finish_time || d.updated_at,
      metadata: d.result_url ? { url: d.result_url } : undefined,
      error: d.fail_reason
        ? { message: d.fail_reason, code: '' }
        : undefined,
    }
  }

  // Fallback: already in the expected flat format
  return raw as VideoTaskResponse
}
