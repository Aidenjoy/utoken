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
// 智能画布：坐标变换（纯函数，无依赖）
//
// 三层坐标系：
//   1. 视口坐标（viewer）：浏览器事件里的 clientX/Y 相对画布容器左上角；
//   2. 画布坐标（canvas）：文档坐标系，0..doc.width / 0..doc.height；
//   3. 图层本地坐标（layer）：图层自身未缩放未旋转的盒内坐标 0..layer.width；
//   4. 原图像素坐标（source）：素材图片自身的像素坐标，蒙版必须落在这个坐标系。
//
// 蒙版由「视口点 → 画布点 → 图层本地 → 原图像素」逐级映射，因此无论画布如何缩放、
// 平移、图层如何缩放旋转裁剪，提交给上游的蒙版都严格等于原图像素尺寸。

export interface Point {
  x: number
  y: number
}

export interface Viewport {
  scale: number
  offsetX: number
  offsetY: number
}

export interface SourceRect {
  x: number
  y: number
  width: number
  height: number
}

export interface TransformableLayer {
  x: number
  y: number
  width: number
  height: number
  scale: number
  rotation: number
  crop?: SourceRect
}

/** 绕任意中心旋转（角度制，正值为顺时针，与 CSS rotate 一致） */
export function rotatePoint(
  point: Point,
  center: Point,
  degrees: number
): Point {
  if (!degrees) return { x: point.x, y: point.y }
  const rad = (degrees * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = point.x - center.x
  const dy = point.y - center.y
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  }
}

/** 视口坐标 → 画布坐标（去掉平移与视口缩放） */
export function viewportToCanvasPoint(point: Point, viewport: Viewport): Point {
  const scale = viewport.scale || 1
  return {
    x: (point.x - viewport.offsetX) / scale,
    y: (point.y - viewport.offsetY) / scale,
  }
}

/** 画布坐标 → 视口坐标 */
export function canvasToViewportPoint(point: Point, viewport: Viewport): Point {
  const scale = viewport.scale || 1
  return {
    x: point.x * scale + viewport.offsetX,
    y: point.y * scale + viewport.offsetY,
  }
}

/** 图层中心（画布坐标） */
export function layerCenter(layer: TransformableLayer): Point {
  return { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 }
}

/** 画布坐标 → 图层本地坐标（先反旋转，再反缩放） */
export function canvasPointToLayerLocal(
  point: Point,
  layer: TransformableLayer
): Point {
  const center = layerCenter(layer)
  const unRotated = rotatePoint(point, center, -layer.rotation)
  const scale = layer.scale || 1
  return {
    x: layer.width / 2 + (unRotated.x - center.x) / scale,
    y: layer.height / 2 + (unRotated.y - center.y) / scale,
  }
}

/** 图层本地坐标 → 画布坐标（先缩放，再旋转） */
export function layerLocalToCanvasPoint(
  point: Point,
  layer: TransformableLayer
): Point {
  const center = layerCenter(layer)
  const scale = layer.scale || 1
  const scaled = {
    x: center.x + (point.x - layer.width / 2) * scale,
    y: center.y + (point.y - layer.height / 2) * scale,
  }
  return rotatePoint(scaled, center, layer.rotation)
}

/** 图层本地坐标 → 原图像素坐标（考虑裁剪窗口） */
export function layerLocalToSourcePoint(
  point: Point,
  layer: TransformableLayer
): Point {
  const crop = layer.crop
  if (!crop) return { x: point.x, y: point.y }
  return {
    x: crop.x + (point.x * crop.width) / layer.width,
    y: crop.y + (point.y * crop.height) / layer.height,
  }
}

/** 原图像素坐标 → 图层本地坐标 */
export function sourceToLayerLocalPoint(
  point: Point,
  layer: TransformableLayer
): Point {
  const crop = layer.crop
  if (!crop) return { x: point.x, y: point.y }
  return {
    x: ((point.x - crop.x) * layer.width) / crop.width,
    y: ((point.y - crop.y) * layer.height) / crop.height,
  }
}

/** 视口坐标 → 原图像素坐标（蒙版绘制与选区命中的唯一入口） */
export function viewportToSourcePoint(
  point: Point,
  viewport: Viewport,
  layer: TransformableLayer
): Point {
  return layerLocalToSourcePoint(
    canvasPointToLayerLocal(viewportToCanvasPoint(point, viewport), layer),
    layer
  )
}

/** 原图像素坐标 → 视口坐标（把结果图摆回画布时用） */
export function sourceToViewportPoint(
  point: Point,
  viewport: Viewport,
  layer: TransformableLayer
): Point {
  return canvasToViewportPoint(
    layerLocalToCanvasPoint(sourceToLayerLocalPoint(point, layer), layer),
    viewport
  )
}

/**
 * 一个视口像素对应多少个原图像素。
 * 蒙版画笔半径用视口像素表达，落到原图坐标系时要乘这个系数。
 */
export function viewportPixelToSourcePixel(
  viewport: Viewport,
  layer: TransformableLayer
): number {
  const cropScale = layer.crop ? layer.crop.width / layer.width : 1
  return 1 / ((viewport.scale || 1) * (layer.scale || 1) * cropScale)
}

/** 让画布整幅可见的视口参数（居中 + 留白） */
export function fitViewport(
  canvasWidth: number,
  canvasHeight: number,
  containerWidth: number,
  containerHeight: number,
  padding = 48
): Viewport {
  if (
    canvasWidth <= 0 ||
    canvasHeight <= 0 ||
    containerWidth <= 0 ||
    containerHeight <= 0
  ) {
    return { scale: 1, offsetX: 0, offsetY: 0 }
  }
  const availableWidth = Math.max(containerWidth - padding * 2, 1)
  const availableHeight = Math.max(containerHeight - padding * 2, 1)
  const scale = Math.min(
    availableWidth / canvasWidth,
    availableHeight / canvasHeight,
    1
  )
  return {
    scale,
    offsetX: (containerWidth - canvasWidth * scale) / 2,
    offsetY: (containerHeight - canvasHeight * scale) / 2,
  }
}

/** 限制视口缩放范围 */
export const MIN_VIEWPORT_SCALE = 0.05
export const MAX_VIEWPORT_SCALE = 8

export function clampViewportScale(scale: number): number {
  return Math.min(Math.max(scale, MIN_VIEWPORT_SCALE), MAX_VIEWPORT_SCALE)
}

/** 以某个视口点为锚点缩放（滚轮缩放不跑偏） */
export function zoomViewportAt(
  viewport: Viewport,
  anchor: Point,
  nextScale: number
): Viewport {
  const scale = clampViewportScale(nextScale)
  const canvasPoint = viewportToCanvasPoint(anchor, viewport)
  return {
    scale,
    offsetX: anchor.x - canvasPoint.x * scale,
    offsetY: anchor.y - canvasPoint.y * scale,
  }
}

/** 点是否落在图层盒内（用于点击选中，忽略旋转外接框带来的误选） */
export function hitTestLayer(point: Point, layer: TransformableLayer): boolean {
  const local = canvasPointToLayerLocal(point, layer)
  return (
    local.x >= 0 &&
    local.y >= 0 &&
    local.x <= layer.width &&
    local.y <= layer.height
  )
}
