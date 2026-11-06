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
import { z } from 'zod'

// ============================================================================
// API Key Schema & Types
// ============================================================================

export const apiKeySchema = z.object({
  id: z.number(),
  name: z.string(),
  key: z.string(),
  status: z.number(), // 1: enabled, 2: disabled, 3: expired, 4: exhausted
  remain_quota: z.number(),
  used_quota: z.number(),
  unlimited_quota: z.boolean(),
  expired_time: z.number(), // -1 for never expires
  created_time: z.number(),
  accessed_time: z.number(),
  group: z.string().nullish().default(''),
  // 绑定渠道：>0 时该密钥的视频生成与素材上传强制走此渠道（B端可控路由），0=未绑定。
  // 仅超管可配置，路由/进价对下游保密。
  channel_id: z.number().nullish().default(0),
  cross_group_retry: z
    .preprocess((v) => {
      if (v === 1) return true
      if (v === 0) return false
      return v
    }, z.boolean())
    .optional()
    .default(false),
  model_limits_enabled: z.boolean(),
  model_limits: z.string().nullish().default(''),
  allow_ips: z.string().nullish().default(''),
  // Ark 官方兼容 API 凭证：access_key 是标识符（列表原样展示），
  // secret_key 列表为掩码值，明文仅经 /api/token/:id/access-key 拉取
  access_key: z.string().nullish().default(''),
  secret_key: z.string().nullish().default(''),
  // 归属用户：列表恒返回 user_id；username 仅管理员跨用户查看时附加
  user_id: z.number().optional(),
  username: z.string().optional(),
  // 软删时间：仅管理员带 includeDeleted 查询时可能非空，用于标注「已删除」
  deleted_at: z.string().nullish(),
})

export type ApiKey = z.infer<typeof apiKeySchema>

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export interface GetApiKeysParams {
  p?: number
  size?: number
  // 管理员归属过滤：缺省=自己，0=全部用户，N=指定用户；非管理员后端忽略
  userId?: number
  // 管理员专属：连同已删除的密钥一起返回；非管理员后端忽略
  includeDeleted?: boolean
}

export interface GetApiKeysResponse {
  success: boolean
  message?: string
  data?: {
    items: ApiKey[]
    total: number
    page: number
    page_size: number
  }
}

export interface SearchApiKeysParams {
  keyword?: string
  token?: string
  p?: number
  size?: number
  userId?: number
}

export interface ApiKeyFormData {
  name: string
  remain_quota: number
  expired_time: number
  unlimited_quota: boolean
  model_limits_enabled: boolean
  model_limits: string
  allow_ips: string
  group: string
  channel_id?: number
  cross_group_retry: boolean
}

// ============================================================================
// Dialog Types
// ============================================================================

export type ApiKeysDialogType =
  | 'create'
  | 'update'
  | 'delete'
  | 'batch-delete'
  | 'cc-switch'
  | 'access-key'
