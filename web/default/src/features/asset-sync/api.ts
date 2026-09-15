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

import type { AssetChannel, ChannelAsset, SyncTaskResult } from './types'

// 后端错误体形如 { error: { message, type } }，与全局拦截器取的 data.message 不一致，
// 因此这些请求统一 skipErrorHandler，由调用方提取 message 自行提示。
function assetSyncErrorMessage(error: unknown): string {
  const resp = (error as { response?: { data?: unknown } })?.response
  const data = resp?.data as { error?: { message?: string } } | undefined
  if (data?.error?.message) return data.error.message
  if (error instanceof Error) return error.message
  return String(error)
}

/** 列出已开启素材协议的启用渠道。 */
export async function listAssetChannels(): Promise<AssetChannel[]> {
  try {
    const res = await api.get('/api/asset/channels', {
      skipErrorHandler: true,
    })
    return Array.isArray(res.data?.providers) ? res.data.providers : []
  } catch {
    return []
  }
}

/** 跨用户列出某渠道下的素材副本。 */
export async function listChannelAssets(
  channelId: number
): Promise<ChannelAsset[]> {
  try {
    const res = await api.get(`/api/asset/channel/${channelId}/assets`, {
      skipErrorHandler: true,
    })
    return Array.isArray(res.data?.assets) ? res.data.assets : []
  } catch (error) {
    throw new Error(assetSyncErrorMessage(error))
  }
}

/** 把源渠道下勾选的素材批量同步到目标渠道。 */
export async function syncChannelAssets(payload: {
  source_channel_id: number
  target_channel_id: number
  asset_ids: number[]
}): Promise<SyncTaskResult[]> {
  try {
    const res = await api.post('/api/asset/channel-sync', payload, {
      skipErrorHandler: true,
    })
    return Array.isArray(res.data?.sync_tasks) ? res.data.sync_tasks : []
  } catch (error) {
    throw new Error(assetSyncErrorMessage(error))
  }
}
