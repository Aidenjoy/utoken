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
// ===== 智能画布类型（移植自 BeefTV 画布数据结构：多画布工作区 + 全节点类型） =====

import i18next from 'i18next'

export type CanvasNodeType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'upscale'
  | 'script'
  | 'director'
  | 'folder'
  | 'drawing'
  | 'batch'

// 节点默认标题的 i18n key（静态 key 便于翻译提取）
export const CANVAS_NODE_TITLE_KEYS: Record<CanvasNodeType, string> = {
  text: 'Text node',
  image: 'Image node',
  video: 'Video node',
  audio: 'Audio node',
  upscale: 'AI upscale',
  script: 'Storyboard script',
  director: 'Director studio',
  folder: 'Folder',
  drawing: 'Drawing',
  batch: 'Batch table',
}

export type CanvasNodeStatus = 'idle' | 'loading' | 'success' | 'error'

export interface CanvasPosition {
  x: number
  y: number
}

// 分镜脚本镜头行
export interface CanvasScriptScene {
  id: string
  title: string
  description: string
  dialogue: string
  narration?: string
  duration?: number
  assetTitle?: string
}

// 导演台机位（世界坐标 + 目标点 + 焦距）
export interface CanvasDirectorCamera {
  id: string
  presetId: string
  label: string
  position: [number, number, number]
  target: [number, number, number]
  focalLength: number
  roll?: number
}

// 导演台 3D 工作台状态（随画布文档持久化）
export interface CanvasDirectorState {
  coverUrl?: string
  sceneScale?: number
  scenePan?: [number, number, number]
  sceneRotation?: [number, number, number]
  panoramaUrl?: string
  skyColor?: string
  panoRotation?: number
  panoRadius?: number
  showLabels?: boolean
  snapToGrid?: boolean
  ambient?: number
  showGrid?: boolean
  cameras?: CanvasDirectorCamera[]
  subjectYaw?: number
  subjectPos?: [number, number, number]
}

// 节点生成历史版本（每次生成成功入栈，可回看/切换）
export interface CanvasHistoryEntry {
  id: string
  url: string
  prompt: string
  generationId?: number
  createdAt: number
}

export interface CanvasNodeMetadata {
  prompt?: string
  content?: string
  url?: string
  status?: CanvasNodeStatus
  error?: string
  generationId?: number
  size?: string
  // 图片画幅/清晰度/画质/背景（size 由 ratio+clarity 换算）
  ratio?: string
  clarity?: string
  quality?: string
  background?: string
  aspectRatio?: string
  resolution?: string
  duration?: number
  // 视频是否生成音频（默认开启）
  generateAudio?: boolean
  naturalWidth?: number
  naturalHeight?: number
  // AI 超分：待增强的源图
  sourceUrl?: string
  // 分镜脚本：场景列表
  scenes?: CanvasScriptScene[]
  // 文件夹：折叠后隐藏框内节点
  collapsed?: boolean
  // 批量创作表：提示词行
  rows?: string[]
  // 锁定：禁止拖拽/缩放/编辑
  locked?: boolean
  // 生成历史栈与当前展示索引
  history?: CanvasHistoryEntry[]
  historyIndex?: number
  // 本轮生成开始时间（任务面板计时）
  startedAt?: number
  // 文本节点字号
  fontSize?: number
  // 一次生成产出数量（文本/图片/视频）
  count?: number
  // 音频生成参数
  voice?: string
  audioFormat?: string
  speed?: number
  // 超分参数
  upscaleFactor?: number
  upscaleMode?: 'faithful' | 'creative'
  upscaleFormat?: string
  // 导演台工作台状态
  director?: CanvasDirectorState
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

// 单张画布（工作区可含多张，顶栏 tab 切换）
export interface CanvasTab {
  id: string
  title: string
  nodes: CanvasNode[]
  connections: CanvasConnection[]
  viewport: ViewportTransform
}

// 工作区文档：v2 多画布；兼容 v1（顶层 nodes/connections/viewport）
export interface CanvasDocument {
  version: number
  canvases: CanvasTab[]
  activeCanvasId: string
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
  deletedAt?: string | null
}

export interface CanvasGeneration {
  id: number
  projectId: number
  nodeId: string
  kind: 'image' | 'video' | 'text' | 'audio'
  prompt: string
  model: string
  status: 'processing' | 'success' | 'failed' | 'cancelled'
  taskId: string
  resultUrl: string
  resultText: string
  resultExtras: string
  errorMsg: string
  createdAt: number
  completedAt: number | null
}

export interface CanvasGenerateRequest {
  projectId: number
  nodeId: string
  kind: 'image' | 'video' | 'text' | 'audio'
  prompt: string
  size?: string
  quality?: string
  background?: string
  aspectRatio?: string
  resolution?: string
  duration?: number
  generateAudio?: boolean
  referenceImages?: string[]
  count?: number
  voice?: string
  audioFormat?: string
  speed?: number
}

// Agent 草案（后端文本模型产出，连线下标指向 nodes 数组）
export interface CanvasDraftNode {
  type: 'text' | 'image' | 'video'
  title: string
  prompt: string
  content: string
}

export interface CanvasDraft {
  nodes: CanvasDraftNode[]
  connections: { from: number; to: number }[]
}

// 剪贴板载荷（复制节点 + 内部连线）
export interface CanvasClipboard {
  nodes: CanvasNode[]
  connections: CanvasConnection[]
}

export const CANVAS_DEFAULT_VIEWPORT: ViewportTransform = { x: 0, y: 0, k: 1 }
export const CANVAS_MIN_SCALE = 0.05
export const CANVAS_MAX_SCALE = 8
export const CANVAS_GRID_SIZE = 24

export function canvasId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function clampCanvasScale(scale: number): number {
  return Math.min(Math.max(scale, CANVAS_MIN_SCALE), CANVAS_MAX_SCALE)
}

// 可触发生成的节点（超分按图片协议增强源图）
export function canGenerateNode(type: CanvasNodeType): boolean {
  return (
    type === 'image' ||
    type === 'video' ||
    type === 'upscale' ||
    type === 'text' ||
    type === 'audio'
  )
}

// 拥有媒体产物的节点
export function isMediaNodeType(type: CanvasNodeType): boolean {
  return (
    type === 'image' ||
    type === 'video' ||
    type === 'audio' ||
    type === 'upscale' ||
    type === 'drawing'
  )
}

export function createCanvasTab(title: string): CanvasTab {
  return {
    id: canvasId('canvas'),
    title,
    nodes: [],
    connections: [],
    viewport: { ...CANVAS_DEFAULT_VIEWPORT },
  }
}

export function createEmptyCanvasDocument(
  firstTabTitle: string
): CanvasDocument {
  const tab = createCanvasTab(firstTabTitle)
  return {
    version: 2,
    canvases: [tab],
    activeCanvasId: tab.id,
    background: 'dots',
    theme: 'dark',
  }
}

const CANVAS_NODE_TYPES = new Set<CanvasNodeType>([
  'text',
  'image',
  'video',
  'audio',
  'upscale',
  'script',
  'director',
  'folder',
  'drawing',
  'batch',
])

function sanitizeNodes(raw: unknown): CanvasNode[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (n): n is CanvasNode =>
      Boolean(n) &&
      typeof n.id === 'string' &&
      CANVAS_NODE_TYPES.has(n.type) &&
      n.position &&
      typeof n.position.x === 'number' &&
      typeof n.position.y === 'number'
  )
}

function sanitizeConnections(raw: unknown): CanvasConnection[] {
  if (!Array.isArray(raw)) return []
  // 历史文档可能残留重复边（同 id 或同 from→to）：去重避免重叠连线与重复参考 chip
  const seenIds = new Set<string>()
  const seenPairs = new Set<string>()
  const result: CanvasConnection[] = []
  for (const c of raw) {
    if (
      !c ||
      typeof c.id !== 'string' ||
      typeof c.fromNodeId !== 'string' ||
      typeof c.toNodeId !== 'string' ||
      c.fromNodeId === c.toNodeId
    ) {
      continue
    }
    const pair = `${c.fromNodeId}->${c.toNodeId}`
    if (seenIds.has(c.id) || seenPairs.has(pair)) continue
    seenIds.add(c.id)
    seenPairs.add(pair)
    result.push(c)
  }
  return result
}

function sanitizeViewport(raw: unknown): ViewportTransform {
  const v = raw as Partial<ViewportTransform> | undefined
  if (
    v &&
    typeof v.k === 'number' &&
    typeof v.x === 'number' &&
    typeof v.y === 'number'
  ) {
    return { x: v.x, y: v.y, k: clampCanvasScale(v.k) }
  }
  return { ...CANVAS_DEFAULT_VIEWPORT }
}

// 解析服务端文档字符串；空/损坏文档回退为空画布，保证编辑器总能打开。
// 同时兼容 v1 单画布与 v2 多画布结构。
export function parseCanvasDocument(
  raw: string | undefined,
  firstTabTitle: string
): CanvasDocument {
  const fallback = createEmptyCanvasDocument(firstTabTitle)
  if (!raw) return fallback
  try {
    const doc = JSON.parse(raw) as Partial<CanvasDocument> & {
      nodes?: unknown
      connections?: unknown
      viewport?: unknown
    }
    if (!doc) return fallback
    let canvases: CanvasTab[]
    if (Array.isArray(doc.canvases) && doc.canvases.length > 0) {
      canvases = doc.canvases
        .filter((cv) => Boolean(cv) && typeof cv.id === 'string')
        .map((cv) => ({
          id: cv.id,
          title: typeof cv.title === 'string' ? cv.title : firstTabTitle,
          nodes: sanitizeNodes(cv.nodes),
          connections: sanitizeConnections(cv.connections),
          viewport: sanitizeViewport(cv.viewport),
        }))
    } else if (Array.isArray(doc.nodes)) {
      canvases = [
        {
          id: canvasId('canvas'),
          title: firstTabTitle,
          nodes: sanitizeNodes(doc.nodes),
          connections: sanitizeConnections(doc.connections),
          viewport: sanitizeViewport(doc.viewport),
        },
      ]
    } else {
      return fallback
    }
    if (canvases.length === 0) return fallback
    const activeCanvasId = canvases.some((cv) => cv.id === doc.activeCanvasId)
      ? (doc.activeCanvasId as string)
      : canvases[0].id
    return {
      version: 2,
      canvases,
      activeCanvasId,
      background:
        doc.background === 'lines' || doc.background === 'blank'
          ? doc.background
          : 'dots',
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
  audio: { width: 360, height: 180 },
  upscale: { width: 360, height: 300 },
  script: { width: 780, height: 540 },
  director: { width: 420, height: 300 },
  folder: { width: 640, height: 480 },
  drawing: { width: 360, height: 360 },
  batch: { width: 480, height: 420 },
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
    audio: { status: 'idle', voice: 'alloy', audioFormat: 'mp3', speed: 1 },
    upscale: {
      status: 'idle',
      size: '2048x2048',
      upscaleFactor: 2,
      upscaleMode: 'faithful',
      upscaleFormat: 'png',
    },
    script: { scenes: [] },
    director: { director: {} },
    folder: { collapsed: false },
    drawing: { status: 'idle' },
    batch: { rows: [''] },
  }

export function createCanvasNode(
  type: CanvasNodeType,
  position: CanvasPosition,
  title: string
): CanvasNode {
  const metadata: CanvasNodeMetadata = {
    ...CANVAS_NODE_DEFAULT_METADATA[type],
  }
  // 分镜脚本默认带一行镜头；数组字段每节点独立，避免共享引用
  if (type === 'script') {
    metadata.scenes = [
      {
        id: canvasId('scene'),
        title: i18next.t('Scene {{n}}', { n: 1 }),
        description: '',
        dialogue: '',
        narration: '',
        duration: 6,
        assetTitle: '',
      },
    ]
  }
  if (type === 'batch') {
    metadata.rows = ['']
  }
  return {
    id: canvasId('node'),
    type,
    title,
    position,
    ...CANVAS_NODE_SIZES[type],
    metadata,
  }
}

// 上游文本输入：直连优先，再沿媒体链继承（文本→图片→视频 一次输入驱动全链）
export interface CanvasUpstreamText {
  id: string
  title: string
  content: string
  connectionId: string | null
}

export function collectUpstreamTexts(
  nodeId: string,
  nodes: CanvasNode[],
  connections: CanvasConnection[]
): CanvasUpstreamText[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const result: CanvasUpstreamText[] = []
  const seen = new Set<string>([nodeId])
  const queue: { id: string; connectionId: string | null }[] = []
  for (const connection of connections) {
    if (connection.toNodeId === nodeId) {
      queue.push({ id: connection.fromNodeId, connectionId: connection.id })
    }
  }
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || seen.has(current.id)) continue
    seen.add(current.id)
    const node = nodeMap.get(current.id)
    if (!node) continue
    if (node.type === 'text') {
      const content = (node.metadata.content ?? node.metadata.prompt ?? '').trim()
      if (content) {
        result.push({
          id: node.id,
          title: node.title,
          content,
          connectionId: current.connectionId,
        })
      }
    }
    for (const connection of connections) {
      if (connection.toNodeId === current.id) {
        queue.push({ id: connection.fromNodeId, connectionId: null })
      }
    }
  }
  return result.slice(0, 4)
}

// 文件夹折叠时被隐藏的节点：中心落在折叠文件夹框内的非文件夹节点
export function nodesHiddenByFolders(nodes: CanvasNode[]): Set<string> {
  const hidden = new Set<string>()
  const folders = nodes.filter(
    (n) => n.type === 'folder' && n.metadata.collapsed
  )
  if (folders.length === 0) return hidden
  for (const node of nodes) {
    if (node.type === 'folder') continue
    const cx = node.position.x + node.width / 2
    const cy = node.position.y + node.height / 2
    for (const folder of folders) {
      if (
        cx >= folder.position.x &&
        cx <= folder.position.x + folder.width &&
        cy >= folder.position.y &&
        cy <= folder.position.y + folder.height
      ) {
        hidden.add(node.id)
        break
      }
    }
  }
  return hidden
}

// 落在文件夹框内的节点 id（拖拽文件夹时随动）
export function nodesInsideFolder(
  folder: CanvasNode,
  nodes: CanvasNode[]
): string[] {
  const ids: string[] = []
  for (const node of nodes) {
    if (node.id === folder.id || node.type === 'folder') continue
    const cx = node.position.x + node.width / 2
    const cy = node.position.y + node.height / 2
    if (
      cx >= folder.position.x &&
      cx <= folder.position.x + folder.width &&
      cy >= folder.position.y &&
      cy <= folder.position.y + folder.height
    ) {
      ids.push(node.id)
    }
  }
  return ids
}
