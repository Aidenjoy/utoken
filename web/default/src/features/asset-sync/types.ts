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

/** 已开启素材上传协议的启用渠道（源/目标下拉用）。 */
export interface AssetChannel {
  id: number
  name: string
  protocol: string
}

export type AssetType = 'Image' | 'Video' | 'Audio'
export type AssetStatus = 'pending' | 'active' | 'failed'

/** 某渠道下的素材副本（跨用户，管理员视图）。 */
export interface ChannelAsset {
  id: number
  user_id: number
  username: string
  channel_id: number
  asset_id: string
  name: string
  asset_type: AssetType
  status: AssetStatus
  source_url: string
  preview_url: string
  error_msg: string
  created_at: number
}

/** 单个素材的同步结果。 */
export interface SyncTaskResult {
  channel_id: number
  channel_name?: string
  status: 'active' | 'pending' | 'failed' | 'skipped'
  asset_id?: string
  asset_db_id?: number
  name?: string
  error?: string
}
