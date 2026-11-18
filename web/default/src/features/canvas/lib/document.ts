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
import type { CanvasDocument, CanvasLayer } from '../types'

/** 撤销栈保留的历史步数 */
export const MAX_HISTORY_STEPS = 60

export interface History<T> {
  past: T[]
  present: T
  future: T[]
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

/** 提交一次新的文档状态（清空 redo 分支） */
export function commitHistory<T>(history: History<T>, next: T): History<T> {
  const past = [...history.past, history.present]
  if (past.length > MAX_HISTORY_STEPS) past.shift()
  return { past, present: next, future: [] }
}

/**
 * 提交一次「交互结束」的历史：交互过程中（拖动/缩放/旋转）present 一直在变，
 * 但不该每一步都进撤销栈；松手时只把交互开始前的快照压入 past。
 * previous 与 present 相同表示这一轮没有真正改动，返回原对象以跳过重渲染。
 */
export function commitTransient<T>(
  history: History<T>,
  previous: T
): History<T> {
  if (previous === history.present) return history
  const past = [...history.past, previous]
  if (past.length > MAX_HISTORY_STEPS) past.shift()
  return { past, present: history.present, future: [] }
}

/** 撤销；没有历史时原样返回（调用方据此判断是否真的发生了变化） */
export function undoHistory<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history
  const past = [...history.past]
  const previous = past.pop() as T
  return {
    past,
    present: previous,
    future: [history.present, ...history.future],
  }
}

export function redoHistory<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history
  const [next, ...rest] = history.future
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
  }
}

export function createLayerId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `ly_${crypto.randomUUID()}`
  }
  return `ly_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

/** 默认图层变换：摆放在画布左上角，保持源图尺寸 */
export function createImageLayer(params: {
  url: string
  name: string
  width: number
  height: number
  x?: number
  y?: number
  assetId?: string
}): CanvasLayer {
  return {
    id: createLayerId(),
    type: 'image',
    name: params.name,
    url: params.url,
    assetId: params.assetId,
    x: params.x ?? 0,
    y: params.y ?? 0,
    width: params.width,
    height: params.height,
    scale: 1,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  }
}

export function createTextLayer(params: {
  text: string
  canvasWidth: number
  canvasHeight: number
  color?: string
}): CanvasLayer {
  const fontSize = Math.max(Math.round(params.canvasWidth / 16), 16)
  return {
    id: createLayerId(),
    type: 'text',
    name: params.text.slice(0, 20) || '文字',
    text: params.text,
    x: params.canvasWidth * 0.1,
    y: params.canvasHeight * 0.45,
    width: params.canvasWidth * 0.8,
    height: fontSize * 1.6,
    scale: 1,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fontSize,
    color: params.color ?? '#111827',
  }
}

export function findLayer(
  doc: CanvasDocument,
  layerId: string | null
): CanvasLayer | undefined {
  if (!layerId) return undefined
  return doc.layers.find((layer) => layer.id === layerId)
}

export function updateLayer(
  doc: CanvasDocument,
  layerId: string,
  patch: Partial<CanvasLayer>
): CanvasDocument {
  return {
    ...doc,
    layers: doc.layers.map((layer) =>
      layer.id === layerId ? { ...layer, ...patch, id: layer.id } : layer
    ),
  }
}

export function addLayer(
  doc: CanvasDocument,
  layer: CanvasLayer
): CanvasDocument {
  return { ...doc, layers: [...doc.layers, layer] }
}

export function removeLayer(
  doc: CanvasDocument,
  layerId: string
): CanvasDocument {
  return { ...doc, layers: doc.layers.filter((layer) => layer.id !== layerId) }
}

/**
 * 调整图层层级。数组顺序即叠放顺序（末尾在最上层），
 * direction=1 上移一层，=0 置顶，=-1 下移一层，=-2 置底。
 */
export function reorderLayer(
  doc: CanvasDocument,
  layerId: string,
  direction: 'up' | 'down' | 'top' | 'bottom'
): CanvasDocument {
  const index = doc.layers.findIndex((layer) => layer.id === layerId)
  if (index < 0) return doc
  const layers = [...doc.layers]
  const [layer] = layers.splice(index, 1)
  let target = index
  switch (direction) {
    case 'up':
      target = Math.min(index + 1, layers.length)
      break
    case 'down':
      target = Math.max(index - 1, 0)
      break
    case 'top':
      target = layers.length
      break
    case 'bottom':
      target = 0
      break
  }
  layers.splice(target, 0, layer)
  if (layers.every((item, i) => item.id === doc.layers[i]?.id)) return doc
  return { ...doc, layers }
}

/** 解析后端返回的文档字符串；损坏时回退到空文档，避免编辑器白屏 */
export function parseDocument(
  raw: string | undefined,
  fallback: { width: number; height: number; background: string }
): CanvasDocument {
  if (!raw) {
    return {
      version: 1,
      width: fallback.width,
      height: fallback.height,
      background: fallback.background,
      layers: [],
    }
  }
  try {
    const parsed = JSON.parse(raw) as CanvasDocument
    if (!parsed || !Array.isArray(parsed.layers)) {
      throw new Error('bad document')
    }
    return {
      version: parsed.version ?? 1,
      width: parsed.width || fallback.width,
      height: parsed.height || fallback.height,
      background: parsed.background || fallback.background,
      layers: parsed.layers.map((layer) => ({
        ...layer,
        scale: layer.scale || 1,
        rotation: layer.rotation || 0,
        opacity: typeof layer.opacity === 'number' ? layer.opacity : 1,
        visible: layer.visible !== false,
        locked: layer.locked === true,
      })),
    }
  } catch {
    return {
      version: 1,
      width: fallback.width,
      height: fallback.height,
      background: fallback.background,
      layers: [],
    }
  }
}

/** 图片图层对应的原图像素尺寸（考虑裁剪） */
export function layerSourceSize(layer: CanvasLayer): {
  width: number
  height: number
} {
  if (layer.crop) {
    return { width: layer.crop.width, height: layer.crop.height }
  }
  return { width: layer.width, height: layer.height }
}

/** 生成一次任务用的幂等键：同一操作重复点击只提交一个任务 */
export function newIdempotencyKey(tool: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  return `${tool}_${random}`
}
