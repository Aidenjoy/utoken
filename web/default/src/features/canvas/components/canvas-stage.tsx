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
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { proxyImageUrl } from '../api'
import type { StageTool } from '../constants'
import {
  canvasToViewportPoint,
  hitTestLayer,
  layerCenter,
  layerLocalToCanvasPoint,
  type Point,
  type Viewport,
  viewportToCanvasPoint,
  zoomViewportAt,
} from '../lib/geometry'
import {
  paintBrushSegment,
  paintRectSelection,
  type MaskSurface,
} from '../lib/mask'
import type { CanvasDocument, CanvasLayer } from '../types'

// 智能画布：舞台
// 舞台容器坐标系 = 视口坐标系（1 单位 = 1 CSS 像素），内部通过 translate+scale
// 承载「画布平面」，图层再用 translate/rotate/scale 表达自身变换。
// 所有指针输入都先换算成视口坐标，再交给几何工具逐级映射到原图像素。

const HANDLE_SIZE = 10
const ROTATE_HANDLE_GAP = 28
const MIN_LAYER_SCALE = 0.02
const MAX_LAYER_SCALE = 20

interface CanvasStageProps {
  doc: CanvasDocument
  selectedId: string | null
  viewport: Viewport
  tool: StageTool
  brushSize: number
  maskSurface: MaskSurface | null
  maskLayerId: string | null
  onSelect: (layerId: string | null) => void
  onViewportChange: (viewport: Viewport) => void
  onLayerPatch: (layerId: string, patch: Partial<CanvasLayer>) => void
  onInteractionStart: () => void
  onInteractionEnd: () => void
  onMaskPainted?: () => void
  onDropFiles?: (files: File[]) => void
}

type DragState =
  | {
      kind: 'move'
      layerId: string
      startCanvas: Point
      startX: number
      startY: number
    }
  | {
      kind: 'scale'
      layerId: string
      center: Point
      startDistance: number
      startScale: number
    }
  | {
      kind: 'rotate'
      layerId: string
      center: Point
      startAngle: number
      startRotation: number
    }
  | { kind: 'pan'; startClient: Point; startViewport: Viewport }
  | { kind: 'mask'; lastViewport: Point }

/** 图层盒四个角在视口坐标系中的位置（绘制选择框 + 命中手柄） */
function layerCorners(layer: CanvasLayer, viewport: Viewport): Point[] {
  return [
    { x: 0, y: 0 },
    { x: layer.width, y: 0 },
    { x: layer.width, y: layer.height },
    { x: 0, y: layer.height },
  ].map((point) =>
    canvasToViewportPoint(layerLocalToCanvasPoint(point, layer), viewport)
  )
}

function angleOf(center: Point, point: Point): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI
}

/** 旋转柄位置：沿「中心 → 上边中点」方向外扩一段固定视口距离 */
function rotateHandlePoint(layer: CanvasLayer, viewport: Viewport): Point {
  const center = canvasToViewportPoint(layerCenter(layer), viewport)
  const topCenter = canvasToViewportPoint(
    layerLocalToCanvasPoint({ x: layer.width / 2, y: 0 }, layer),
    viewport
  )
  const dx = topCenter.x - center.x
  const dy = topCenter.y - center.y
  const length = Math.hypot(dx, dy) || 1
  return {
    x: topCenter.x + (dx / length) * ROTATE_HANDLE_GAP,
    y: topCenter.y + (dy / length) * ROTATE_HANDLE_GAP,
  }
}

/**
 * 图片图层渲染：裁剪窗口在图层本地坐标中铺满整个图层盒，
 * 因此内层 img 按「原图 / 裁窗」比例放大，并把裁窗起点偏移到盒外。
 */
function LayerImage(props: { layer: CanvasLayer }) {
  const { layer } = props
  const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(
    null
  )
  const crop = layer.crop
  const style: React.CSSProperties = {
    position: 'absolute',
    userSelect: 'none',
    pointerEvents: 'none',
    maxWidth: 'none',
  }
  if (crop && natural && crop.width > 0 && crop.height > 0) {
    style.width = `${(natural.w / crop.width) * 100}%`
    style.height = `${(natural.h / crop.height) * 100}%`
    style.left = `${(-crop.x / crop.width) * 100}%`
    style.top = `${(-crop.y / crop.height) * 100}%`
  } else {
    style.width = '100%'
    style.height = '100%'
    style.left = 0
    style.top = 0
  }
  return (
    <img
      src={proxyImageUrl(layer.url ?? '')}
      alt={layer.name}
      draggable={false}
      onLoad={(event) => {
        const img = event.currentTarget
        setNatural({ w: img.naturalWidth, h: img.naturalHeight })
      }}
      style={style}
    />
  )
}

export function CanvasStage(props: CanvasStageProps) {
  const { t } = useTranslation()
  const {
    doc,
    selectedId,
    viewport,
    tool,
    brushSize,
    maskSurface,
    maskLayerId,
  } = props

  const stageRef = React.useRef<HTMLDivElement | null>(null)
  const maskHostRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<DragState | null>(null)
  const propsRef = React.useRef(props)
  propsRef.current = props
  const [spacePressed, setSpacePressed] = React.useState(false)

  const selectedLayer = React.useMemo(
    () => doc.layers.find((layer) => layer.id === selectedId) ?? null,
    [doc.layers, selectedId]
  )

  // 蒙版画布以原生尺寸挂到当前图层盒上：浏览器负责拉伸到图层显示尺寸，
  // mix-blend-mode: screen 让白色笔迹可见、黑色区域完全不改动底图。
  React.useEffect(() => {
    const host = maskHostRef.current
    if (!host || !maskSurface) return
    const canvas = maskSurface.canvas
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    canvas.style.mixBlendMode = 'screen'
    canvas.style.pointerEvents = 'none'
    host.replaceChildren(canvas)
    return () => host.replaceChildren()
  }, [maskSurface, maskLayerId])

  // 空格键临时切到平移（设计工具通用习惯）
  React.useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      if (!el || !el.tagName) return false
      return (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
      )
    }
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isTypingTarget(event.target)) {
        event.preventDefault()
        setSpacePressed(true)
      }
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpacePressed(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // 滚轮：Ctrl/⌘ 以指针为锚缩放，其余情况平移。
  // 需要非 passive 监听才能阻止页面跟随滚动。
  React.useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = stage.getBoundingClientRect()
      const anchor = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }
      const current = propsRef.current.viewport
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY / 320)
        propsRef.current.onViewportChange(
          zoomViewportAt(current, anchor, current.scale * factor)
        )
        return
      }
      propsRef.current.onViewportChange({
        scale: current.scale,
        offsetX: current.offsetX - event.deltaX,
        offsetY: current.offsetY - event.deltaY,
      })
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [])

  const toViewportPoint = (event: {
    clientX: number
    clientY: number
  }): Point => {
    const stage = stageRef.current
    if (!stage) return { x: 0, y: 0 }
    const rect = stage.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  /** 命中最上层的可见且未锁定图层 */
  const hitLayer = (canvasPoint: Point): CanvasLayer | null => {
    for (let i = doc.layers.length - 1; i >= 0; i -= 1) {
      const layer = doc.layers[i]
      if (!layer.visible || layer.locked) continue
      if (hitTestLayer(canvasPoint, layer)) return layer
    }
    return null
  }

  /** 手柄命中：角点 → 等比缩放，旋转柄 → 旋转 */
  const hitHandle = (viewportPoint: Point): 'scale' | 'rotate' | null => {
    if (!selectedLayer || selectedLayer.locked) return null
    const rotateHandle = rotateHandlePoint(selectedLayer, viewport)
    if (
      Math.hypot(
        viewportPoint.x - rotateHandle.x,
        viewportPoint.y - rotateHandle.y
      ) <= HANDLE_SIZE
    ) {
      return 'rotate'
    }
    const corners = layerCorners(selectedLayer, viewport)
    for (const corner of corners) {
      if (
        Math.hypot(viewportPoint.x - corner.x, viewportPoint.y - corner.y) <=
        HANDLE_SIZE
      ) {
        return 'scale'
      }
    }
    return null
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current
    if (!stage || event.button === 2) return
    stage.setPointerCapture(event.pointerId)
    const viewportPoint = toViewportPoint(event)
    const canvasPoint = viewportToCanvasPoint(viewportPoint, viewport)
    const wantsPan = spacePressed || tool === 'pan' || event.button === 1

    // 1) 蒙版绘制优先：笔迹直接落到当前图层对应原图的蒙版画布上
    if (
      !wantsPan &&
      maskSurface &&
      maskLayerId &&
      (tool === 'mask-brush' || tool === 'mask-rect')
    ) {
      dragRef.current = { kind: 'mask', lastViewport: viewportPoint }
      return
    }

    // 2) 平移
    if (wantsPan) {
      dragRef.current = {
        kind: 'pan',
        startClient: { x: event.clientX, y: event.clientY },
        startViewport: viewport,
      }
      return
    }

    // 3) 选中图层的变换手柄
    const handle = hitHandle(viewportPoint)
    if (handle && selectedLayer) {
      const center = layerCenter(selectedLayer)
      props.onInteractionStart()
      if (handle === 'scale') {
        dragRef.current = {
          kind: 'scale',
          layerId: selectedLayer.id,
          center,
          startDistance:
            Math.hypot(canvasPoint.x - center.x, canvasPoint.y - center.y) || 1,
          startScale: selectedLayer.scale || 1,
        }
      } else {
        dragRef.current = {
          kind: 'rotate',
          layerId: selectedLayer.id,
          center,
          startAngle: angleOf(center, canvasPoint),
          startRotation: selectedLayer.rotation || 0,
        }
      }
      return
    }

    // 4) 选中并拖动图层
    const layer = hitLayer(canvasPoint)
    if (layer) {
      props.onSelect(layer.id)
      dragRef.current = {
        kind: 'move',
        layerId: layer.id,
        startCanvas: canvasPoint,
        startX: layer.x,
        startY: layer.y,
      }
      props.onInteractionStart()
      return
    }

    props.onSelect(null)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const viewportPoint = toViewportPoint(event)

    if (drag.kind === 'pan') {
      props.onViewportChange({
        scale: drag.startViewport.scale,
        offsetX:
          drag.startViewport.offsetX + (event.clientX - drag.startClient.x),
        offsetY:
          drag.startViewport.offsetY + (event.clientY - drag.startClient.y),
      })
      return
    }

    if (drag.kind === 'mask') {
      if (!maskSurface || !maskLayerId) return
      const maskLayer = doc.layers.find((layer) => layer.id === maskLayerId)
      if (!maskLayer) return
      if (tool === 'mask-brush') {
        paintBrushSegment(
          maskSurface,
          drag.lastViewport,
          viewportPoint,
          viewport,
          maskLayer,
          brushSize
        )
      } else {
        // 框选按增量矩形叠加：拖动过程中即可看到选区范围，松手即定型
        paintRectSelection(
          maskSurface,
          drag.lastViewport,
          viewportPoint,
          viewport,
          maskLayer
        )
      }
      drag.lastViewport = viewportPoint
      return
    }

    const canvasPoint = viewportToCanvasPoint(viewportPoint, viewport)

    if (drag.kind === 'move') {
      props.onLayerPatch(drag.layerId, {
        x: drag.startX + (canvasPoint.x - drag.startCanvas.x),
        y: drag.startY + (canvasPoint.y - drag.startCanvas.y),
      })
      return
    }

    if (drag.kind === 'scale') {
      const distance = Math.hypot(
        canvasPoint.x - drag.center.x,
        canvasPoint.y - drag.center.y
      )
      const next = Math.min(
        Math.max(
          (drag.startScale * distance) / drag.startDistance,
          MIN_LAYER_SCALE
        ),
        MAX_LAYER_SCALE
      )
      props.onLayerPatch(drag.layerId, { scale: Number(next.toFixed(4)) })
      return
    }

    if (drag.kind === 'rotate') {
      const delta = angleOf(drag.center, canvasPoint) - drag.startAngle
      let rotation = (drag.startRotation + delta) % 360
      if (rotation > 180) rotation -= 360
      if (rotation < -180) rotation += 360
      props.onLayerPatch(drag.layerId, {
        rotation: Number(rotation.toFixed(2)),
      })
    }
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (stageRef.current?.hasPointerCapture?.(event.pointerId)) {
      stageRef.current.releasePointerCapture(event.pointerId)
    }
    if (!drag) return
    // 平移与蒙版绘制不改文档，不产生撤销步骤
    if (drag.kind === 'mask') {
      props.onMaskPainted?.()
      return
    }
    if (
      drag.kind === 'move' ||
      drag.kind === 'scale' ||
      drag.kind === 'rotate'
    ) {
      props.onInteractionEnd()
    }
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!props.onDropFiles) return
    event.preventDefault()
    const files = [...event.dataTransfer.files].filter((file) =>
      file.type.startsWith('image/')
    )
    if (files.length > 0) props.onDropFiles(files)
  }

  const corners = selectedLayer ? layerCorners(selectedLayer, viewport) : []
  const rotateHandle = selectedLayer
    ? rotateHandlePoint(selectedLayer, viewport)
    : null
  const showMask = Boolean(maskSurface && maskLayerId)
  let cursor: string = 'default'
  if (spacePressed || tool === 'pan') cursor = 'grab'
  else if (tool === 'mask-brush' || tool === 'mask-rect') cursor = 'crosshair'

  return (
    <div
      ref={stageRef}
      className='relative h-full w-full overflow-hidden select-none'
      style={{
        cursor,
        touchAction: 'none',
        backgroundImage:
          'linear-gradient(45deg, rgba(120,120,120,0.08) 25%, transparent 25%, transparent 75%, rgba(120,120,120,0.08) 75%), linear-gradient(45deg, rgba(120,120,120,0.08) 25%, transparent 25%, transparent 75%, rgba(120,120,120,0.08) 75%)',
        backgroundSize: '24px 24px',
        backgroundPosition: '0 0, 12px 12px',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={(event) => event.preventDefault()}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <div
        className='absolute top-0 left-0 origin-top-left'
        style={{
          width: doc.width,
          height: doc.height,
          transform: `translate(${viewport.offsetX}px, ${viewport.offsetY}px) scale(${viewport.scale})`,
          backgroundColor: doc.background,
          boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
        }}
      >
        {doc.layers.map((layer) => {
          const isMaskTarget = showMask && layer.id === maskLayerId
          return (
            <div
              key={layer.id}
              data-layer-id={layer.id}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: layer.width,
                height: layer.height,
                transform: `translate(${layer.x}px, ${layer.y}px) rotate(${layer.rotation}deg) scale(${layer.scale})`,
                transformOrigin: 'center center',
                opacity: layer.visible ? layer.opacity : 0,
                overflow: 'hidden',
                pointerEvents: 'none',
              }}
            >
              {layer.type === 'image' ? (
                <LayerImage layer={layer} />
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    fontSize: layer.fontSize ?? 32,
                    lineHeight: 1.3,
                    color: layer.color ?? '#111827',
                    fontFamily: 'sans-serif',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {layer.text}
                </div>
              )}
              {isMaskTarget ? (
                <div
                  ref={maskHostRef}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    pointerEvents: 'none',
                  }}
                />
              ) : null}
            </div>
          )
        })}
      </div>

      {selectedLayer ? (
        <svg className='pointer-events-none absolute inset-0 h-full w-full'>
          <polygon
            points={corners.map((point) => `${point.x},${point.y}`).join(' ')}
            fill='none'
            stroke='var(--primary, #2563eb)'
            strokeWidth={1.5}
          />
          {!selectedLayer.locked && rotateHandle ? (
            <>
              <line
                x1={(corners[0].x + corners[1].x) / 2}
                y1={(corners[0].y + corners[1].y) / 2}
                x2={rotateHandle.x}
                y2={rotateHandle.y}
                stroke='var(--primary, #2563eb)'
                strokeWidth={1}
                strokeDasharray='3 3'
              />
              <circle
                cx={rotateHandle.x}
                cy={rotateHandle.y}
                r={HANDLE_SIZE / 2}
                fill='var(--background, #fff)'
                stroke='var(--primary, #2563eb)'
                strokeWidth={1.5}
              />
              {corners.map((point) => (
                <rect
                  key={`${point.x}-${point.y}`}
                  x={point.x - HANDLE_SIZE / 2}
                  y={point.y - HANDLE_SIZE / 2}
                  width={HANDLE_SIZE}
                  height={HANDLE_SIZE}
                  fill='var(--background, #fff)'
                  stroke='var(--primary, #2563eb)'
                  strokeWidth={1.5}
                />
              ))}
            </>
          ) : null}
        </svg>
      ) : null}

      {doc.layers.length === 0 && props.onDropFiles ? (
        <div className='text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm'>
          {t('Drop an image here, or upload / import from the right panel')}
        </div>
      ) : null}
    </div>
  )
}
