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
// 智能画布：与后端 /api/canvas 的契约类型

export interface ApiResponse<T> {
  success: boolean
  message?: string
  code?: string
  data: T
}

export interface LayerCrop {
  x: number
  y: number
  width: number
  height: number
}

export type CanvasLayerType = 'image' | 'text'

export interface CanvasLayer {
  id: string
  type: CanvasLayerType
  name: string
  url?: string
  assetId?: string
  text?: string
  x: number
  y: number
  width: number
  height: number
  scale: number
  rotation: number
  opacity: number
  visible: boolean
  locked: boolean
  crop?: LayerCrop
  fontSize?: number
  color?: string
}

export interface CanvasDocument {
  version: number
  width: number
  height: number
  background: string
  layers: CanvasLayer[]
}

export interface CanvasProject {
  id: number
  createdAt: number
  updatedAt: number
  title: string
  width: number
  height: number
  background: string
  thumbnail: string
  layerCount: number
  revision: number
  document?: string
  userId?: number
}

export interface CanvasProjectListResponse {
  items: CanvasProject[]
  total: number
  page: number
  pageSize: number
}

export interface ToolLimits {
  tiers?: string[]
  minPixels?: number
  maxPixels?: number
  aspectMin?: number
  aspectMax?: number
  maxRefImages: number
  minMultiRefImages?: number
  maxPromptRunes: number
  maxFileBytes: number
  maxSidePixels?: number
}

export interface ToolParam {
  name: string
  label: string
  type: 'string' | 'int' | 'float' | 'bool' | 'enum'
  enum?: string[]
  min?: number
  max?: number
  default?: unknown
  help?: string
}

export interface ToolCapability {
  tool: string
  label: string
  description: string
  upstream: 'ark' | 'mediakit'
  available: boolean
  unavailableReason?: string
  model?: string
  channelId?: number
  channelName?: string
  supportsMask: 'none' | 'required' | 'optional'
  maskHint?: string
  requiresImage: boolean
  minImages: number
  maxImages: number
  requiresPrompt: boolean
  cancelable: boolean
  unitPrice: number
  limits: ToolLimits
  params: ToolParam[]
}

export interface CapabilitiesResponse {
  tools: ToolCapability[]
  maxSide: number
  maxDocMB: number
}

export interface CanvasAsset {
  refId: string
  name: string
  url: string
  assetType: string
  createdAt: number
}

// 本地图片上传结果：url 已落对象存储，宽高即原图像素尺寸
export interface CanvasUpload {
  url: string
  name: string
  width: number
  height: number
  format: string
  bytes: number
}

export interface ResultImage {
  url: string
  width: number
  height: number
  format: string
}

export interface ToolParams {
  [key: string]: string | number | boolean
}

export interface CreateTaskPayload {
  projectId: number
  tool: string
  idempotencyKey: string
  prompt?: string
  images?: string[]
  mask?: string
  size?: string
  params?: ToolParams
}

export interface CanvasTaskInput {
  tool: string
  prompt?: string
  images?: string[]
  maskUrl?: string
  maskWidth?: number
  maskHeight?: number
  size?: string
  params?: ToolParams
  sourceWidth?: number
  sourceHeight?: number
  model?: string
  projectWidth?: number
  projectHeight?: number
}

export type CanvasTaskStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'reviewing'

export interface CanvasTask {
  id: number
  projectId: number
  tool: string
  toolLabel: string
  status: CanvasTaskStatus
  stage: string
  progress: number
  model?: string
  quota: number
  settledQuota: number
  billingState: string
  cancelable: boolean
  cancelRequested: boolean
  createdAt: number
  updatedAt: number
  startedAt: number
  finishedAt: number
  errorCode?: string
  errorMsg?: string
  input?: CanvasTaskInput
  result?: {
    images: ResultImage[]
    warnings?: string[]
    sources?: string[]
  }
}

export interface CanvasTaskListResponse {
  items: CanvasTask[]
  total: number
  page: number
  pageSize: number
}

export interface SaveDocumentResponse {
  id: number
  revision: number
  updatedAt: number
  layerCount: number
  thumbnail: string
}
