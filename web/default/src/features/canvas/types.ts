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
// ===== 智能画布类型（移植自 BeefTV 画布数据结构的子集） =====

export type CanvasNodeType = 'text' | 'image' | 'video'

// 节点默认标题的 i18n key（静态 key 便于翻译提取）
export const CANVAS_NODE_TITLE_KEYS: Record<CanvasNodeType, string> = {
  text: 'Text node',
  image: 'Image node',
  video: 'Video node',
}

export type CanvasNodeStatus = 'idle' | 'loading' | 'success' | 'error'

export interface CanvasPosition {
  x: number
  y: number
}

export interface CanvasNodeMetadata {
  prompt?: string
  content?: string
  url?: string
  status?: CanvasNodeStatus
  error?: string
  generationId?: number
  size?: string
  aspectRatio?: string
  resolution?: string
  duration?: number
  naturalWidth?: number
  naturalHeight?: number
}

export interface CanvasNode {
  id: string
  type: CanvasNodeType
  title: string
  position: CanvasPosition
  width: number
  height: number
  metadata: CanvasNodeMetadata
}

export interface CanvasConnection {
  id: string
  fromNodeId: string
  toNodeId: string
}

export interface ViewportTransform {
  x: number
  y: number
  k: number
}

export type CanvasBackgroundMode = 'dots' | 'lines' | 'blank'
export type CanvasColorTheme = 'light' | 'dark'

export interface CanvasDocument {
  version: number
  nodes: CanvasNode[]
  connections: CanvasConnection[]
  viewport: ViewportTransform
  background: CanvasBackgroundMode
  theme: CanvasColorTheme
}

export interface CanvasProject {
  id: number
  userId: number
  title: string
  document?: string
  nodeCount: number
  coverUrl: string
  createdAt: number
  updatedAt: number
}

export interface CanvasGeneration {
  id: number
  projectId: number
  nodeId: string
  kind: 'image' | 'video'
  prompt: string
  model: string
  status: 'processing' | 'success' | 'failed'
  taskId: string
  resultUrl: string
  errorMsg: string
  createdAt: number
  completedAt: number | null
}

export interface CanvasGenerateRequest {
  projectId: number
  nodeId: string
  kind: 'image' | 'video'
  prompt: string
  size?: string
  aspectRatio?: string
  resolution?: string
  duration?: number
  referenceImages?: string[]
}

export const CANVAS_DEFAULT_VIEWPORT: ViewportTransform = { x: 0, y: 0, k: 1 }

export function createEmptyCanvasDocument(): CanvasDocument {
  return {
    version: 1,
    nodes: [],
    connections: [],
    viewport: { ...CANVAS_DEFAULT_VIEWPORT },
    background: 'dots',
    theme: 'dark',
  }
}

// 解析服务端文档字符串；空/损坏文档回退为空画布，保证编辑器总能打开
export function parseCanvasDocument(raw?: string): CanvasDocument {
  const fallback = createEmptyCanvasDocument()
  if (!raw) return fallback
  try {
    const doc = JSON.parse(raw) as Partial<CanvasDocument>
    if (!doc || !Array.isArray(doc.nodes)) return fallback
    return {
      version: doc.version ?? 1,
      nodes: doc.nodes.filter(
        (n): n is CanvasNode =>
          Boolean(n) &&
          typeof n.id === 'string' &&
          (n.type === 'text' || n.type === 'image' || n.type === 'video')
      ),
      connections: Array.isArray(doc.connections)
        ? doc.connections.filter(
            (c): c is CanvasConnection =>
              Boolean(c) &&
              typeof c.fromNodeId === 'string' &&
              typeof c.toNodeId === 'string'
          )
        : [],
      viewport:
        doc.viewport && typeof doc.viewport.k === 'number'
          ? doc.viewport
          : { ...CANVAS_DEFAULT_VIEWPORT },
      background: doc.background ?? 'dots',
      theme: doc.theme === 'light' ? 'light' : 'dark',
    }
  } catch {
    return fallback
  }
}

const CANVAS_NODE_SIZES: Record<
  CanvasNodeType,
  { width: number; height: number }
> = {
  text: { width: 320, height: 200 },
  image: { width: 360, height: 420 },
  video: { width: 480, height: 360 },
}

const CANVAS_NODE_DEFAULT_METADATA: Record<CanvasNodeType, CanvasNodeMetadata> =
  {
    text: { content: '' },
    image: { status: 'idle', size: '2048x2048' },
    video: {
      status: 'idle',
      aspectRatio: '16:9',
      resolution: '720p',
      duration: 5,
    },
  }

export function createCanvasNode(
  type: CanvasNodeType,
  position: CanvasPosition,
  title: string
): CanvasNode {
  return {
    id: `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    title,
    position,
    ...CANVAS_NODE_SIZES[type],
    metadata: { ...CANVAS_NODE_DEFAULT_METADATA[type] },
  }
}
