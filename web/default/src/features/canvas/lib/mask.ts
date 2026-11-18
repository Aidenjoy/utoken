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
import {
  type Point,
  type TransformableLayer,
  type Viewport,
  viewportPixelToSourcePixel,
  viewportToSourcePoint,
} from './geometry'

// 智能画布：蒙版
// 蒙版画布的原生尺寸就是**原图像素尺寸**，所有笔迹都通过
// viewportToSourcePoint 逐点换算后画在上面。这样提交给上游的 PNG
// 天然与工具要求的尺寸一致，不需要事后缩放（缩放会破坏边缘对齐）。

export interface MaskSurface {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  width: number
  height: number
}

/**
 * 新建蒙版画布：官方要求「白色为需擦除区域」，所以底色取纯黑。
 * 纯黑既表达「非蒙版区域」，又让 CSS mix-blend-mode: screen 叠加时
 * 完全不改变底图，用户看到的高亮就是真实擦除范围。
 */
export function createMaskSurface(width: number, height: number): MaskSurface {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持 Canvas 2D')
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  return { canvas, ctx, width: canvas.width, height: canvas.height }
}

export function clearMaskSurface(surface: MaskSurface): void {
  surface.ctx.fillStyle = '#000000'
  surface.ctx.fillRect(0, 0, surface.width, surface.height)
}

/** 画笔：视口坐标的连续两点 → 原图坐标的一条圆头线段 */
export function paintBrushSegment(
  surface: MaskSurface,
  fromViewport: Point,
  toViewport: Point,
  viewport: Viewport,
  layer: TransformableLayer,
  brushViewportSize: number
): void {
  const from = viewportToSourcePoint(fromViewport, viewport, layer)
  const to = viewportToSourcePoint(toViewport, viewport, layer)
  const radius =
    (brushViewportSize / 2) * viewportPixelToSourcePixel(viewport, layer)
  const { ctx } = surface
  ctx.save()
  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = '#ffffff'
  ctx.lineWidth = Math.max(radius * 2, 1)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()
  // 单击（起止点重合）时 lineTo 不产生可见笔迹，补一个实心圆
  if (Math.abs(from.x - to.x) < 0.01 && Math.abs(from.y - to.y) < 0.01) {
    ctx.beginPath()
    ctx.arc(from.x, from.y, Math.max(radius, 0.5), 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** 框选：视口矩形的两个对角点 → 原图坐标的白色矩形 */
export function paintRectSelection(
  surface: MaskSurface,
  fromViewport: Point,
  toViewport: Point,
  viewport: Viewport,
  layer: TransformableLayer
): void {
  const from = viewportToSourcePoint(fromViewport, viewport, layer)
  const to = viewportToSourcePoint(toViewport, viewport, layer)
  const x = Math.min(from.x, to.x)
  const y = Math.min(from.y, to.y)
  const width = Math.abs(from.x - to.x)
  const height = Math.abs(from.y - to.y)
  const { ctx } = surface
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(
    Math.max(0, x),
    Math.max(0, y),
    Math.min(width, surface.width - Math.max(0, x)),
    Math.min(height, surface.height - Math.max(0, y))
  )
  ctx.restore()
}

/**
 * 是否已经画过内容。用 64x64 缩略采样判断（比全图 getImageData 便宜得多），
 * 只要有一个采样点的红色通道非零就算有蒙版。
 */
export function maskSurfaceHasContent(surface: MaskSurface): boolean {
  const sample = document.createElement('canvas')
  sample.width = 64
  sample.height = 64
  const ctx = sample.getContext('2d')
  if (!ctx) return false
  ctx.drawImage(surface.canvas, 0, 0, 64, 64)
  const { data } = ctx.getImageData(0, 0, 64, 64)
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 8) return true
  }
  return false
}

/** 导出为 PNG data URL（尺寸 = 原图像素尺寸） */
export function maskSurfaceToDataURL(surface: MaskSurface): string {
  return surface.canvas.toDataURL('image/png')
}
