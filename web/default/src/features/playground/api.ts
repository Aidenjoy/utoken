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

import {
  API_ENDPOINTS,
  ASSET_API_ENDPOINTS,
  VIDEO_API_ENDPOINTS,
  VIDEO_DURATION_DEFAULT_MAX,
} from './constants'
import type {
  Asset,
  AssetProvider,
  AssetType,
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
      error: d.fail_reason ? { message: d.fail_reason, code: '' } : undefined,
    }
  }

  // Fallback: already in the expected flat format
  return raw as VideoTaskResponse
}

/**
 * Fetch the max video duration (seconds) for the given model/group.
 * Seedance 2.5 served by Ark official-protocol channels allows 30s;
 * everything else stays at the default 15s.
 */
export async function getVideoModelCaps(
  model: string,
  group: string
): Promise<number> {
  try {
    const res = await api.get(VIDEO_API_ENDPOINTS.MODEL_CAPS, {
      params: { model, group },
      skipErrorHandler: true,
    } as Record<string, unknown>)
    const max = res.data?.data?.max_duration
    return typeof max === 'number' && max > 0 ? max : VIDEO_DURATION_DEFAULT_MAX
  } catch {
    return VIDEO_DURATION_DEFAULT_MAX
  }
}

/**
 * Upload a file to the Volcengine Files API via the backend proxy.
 *
 * The backend forwards the multipart file to {channel baseURL}/api/v3/files
 * and returns the file ID + content_url. The content_url is then used as
 * a reference URL in the video generation request.
 *
 * @param file     The file to upload
 * @param model    The model name (used by Distribute middleware to select a channel)
 * @param group    The user's group
 * @param batchId  A shared UUID that groups all files uploaded for the same video task
 * @param onProgress Optional progress callback (0-100)
 */
export async function uploadFile(
  file: File,
  model: string,
  group: string,
  batchId: string,
  onProgress?: (percent: number) => void
): Promise<{ id: string; url: string }> {
  const formData = new FormData()
  formData.append('purpose', 'user_data')
  formData.append('file', file)

  const res = await api.post(VIDEO_API_ENDPOINTS.FILE_UPLOAD, formData, {
    params: { model, group, batch_id: batchId },
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e: { loaded: number; total?: number }) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    },
    skipErrorHandler: true,
  } as Record<string, unknown>)

  const fileId = res.data.id
  // Use content_url from backend if available; otherwise construct it
  const url =
    res.data.content_url ||
    `https://ark.cn-beijing.volces.com/api/v3/files/${fileId}/content`
  return { id: fileId, url }
}

/**
 * Extract the error message from an asset API failure response.
 * The backend returns `{ error: { message, type } }` on /pg/assets/*.
 */
function assetErrorMessage(error: unknown): string {
  const axiosErr = error as {
    response?: { data?: { error?: { message?: string } } }
  }
  return (
    axiosErr?.response?.data?.error?.message ||
    (error instanceof Error ? error.message : String(error))
  )
}

/**
 * List channels that have an asset upload protocol enabled.
 */
export async function getAssetProviders(): Promise<AssetProvider[]> {
  try {
    const res = await api.get(ASSET_API_ENDPOINTS.PROVIDERS, {
      skipErrorHandler: true,
    } as Record<string, unknown>)
    return Array.isArray(res.data?.providers) ? res.data.providers : []
  } catch {
    return []
  }
}

/**
 * Register an asset by public URL on the given channel.
 * Throws with the upstream error message on failure.
 */
export async function registerAsset(payload: {
  channel_id: number
  url: string
  asset_type: AssetType
  name: string
}): Promise<Asset> {
  try {
    const res = await api.post(ASSET_API_ENDPOINTS.UPLOAD, payload, {
      skipErrorHandler: true,
    } as Record<string, unknown>)
    return res.data as Asset
  } catch (error) {
    throw new Error(assetErrorMessage(error))
  }
}

/**
 * List the current user's assets (optionally filtered by channel).
 * When model/group are given, the backend only returns assets whose
 * channel can serve that model in the group (assets are per-channel).
 */
export async function listAssets(
  channelId?: number,
  model?: string,
  group?: string
): Promise<Asset[]> {
  try {
    const params: Record<string, unknown> = {}
    if (channelId) params.channel_id = channelId
    if (model) params.model = model
    if (group) params.group = group
    const res = await api.get(ASSET_API_ENDPOINTS.LIST, {
      params: Object.keys(params).length > 0 ? params : undefined,
      skipErrorHandler: true,
    } as Record<string, unknown>)
    return Array.isArray(res.data?.assets) ? res.data.assets : []
  } catch {
    return []
  }
}

/**
 * Delete an asset record (local record only; upstream keeps the asset).
 */
export async function deleteAsset(id: number): Promise<void> {
  try {
    await api.delete(ASSET_API_ENDPOINTS.DETAIL(id), {
      skipErrorHandler: true,
    } as Record<string, unknown>)
  } catch (error) {
    throw new Error(assetErrorMessage(error))
  }
}
