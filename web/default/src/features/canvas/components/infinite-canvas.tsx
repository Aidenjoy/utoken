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

import type { CanvasTheme } from '../canvas-theme'
import {
  CANVAS_MAX_SCALE,
  CANVAS_MIN_SCALE,
  type CanvasBackgroundMode,
  type CanvasPosition,
  type ViewportTransform,
} from '../types'

// ===== 无限画布视口（移植自 BeefTV infinite-canvas 的手势/缩放算法） =====
// 手势期间直接写 CSS 变量与 world 层 transform（rAF 合帧），空闲后才提交 React
// 状态，保证平移/缩放不触发整棵节点树重渲染。

const WHEEL_IGNORE_SELECTOR = '[data-canvas-no-zoom],[data-canvas-wheel-scroll]'
const POINTER_IGNORE_SELECTOR =
  '[data-canvas-no-zoom],[data-connection-create-menu],[data-canvas-menu]'
const WHEEL_ZOOM_DELTA = 72
const TRACKPAD_PINCH_ZOOM_DELTA = 24
const MIN_SCALE = CANVAS_MIN_SCALE
const MAX_SCALE = CANVAS_MAX_SCALE

function clampScale(scale: number) {
  return Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE)
}

function wheelDeltaToPixels(delta: number, deltaMode: number) {
  if (deltaMode === 1) return delta * 16
  if (deltaMode === 2) return delta * 720
  return delta
}

// 滚轮意图启发式（与 BeefTV 一致）：ctrl/meta 捏合恒缩放；shift/横向恒平移；
// 行模式或整十步长视为滚轮缩放，小步长视为触控板平移；200ms 内沿用上一次意图。
function canvasWheelIntent(
  event: WheelEvent,
  previous: { intent: 'pan' | 'zoom'; at: number } | null,
  now: number
): 'pan' | 'zoom' {
  if (event.ctrlKey || event.metaKey) return 'zoom'
  if (event.shiftKey || Math.abs(event.deltaX) > 0) return 'pan'
  if (previous && now - previous.at < 200) return previous.intent
  const magnitude = Math.abs(event.deltaY)
  return event.deltaMode !== 0 || (magnitude >= 40 && magnitude % 20 === 0)
    ? 'zoom'
    : 'pan'
}

type TouchPoint = { x: number; y: number }

interface InfiniteCanvasProps {
  containerRef: React.RefObject<HTMLDivElement | null>
  viewport: ViewportTransform
  theme: CanvasTheme
  background: CanvasBackgroundMode
  tool: 'select' | 'hand'
  onViewportChange: (viewport: ViewportTransform) => void
  onBackgroundClick?: () => void
  onDoubleClick?: (world: CanvasPosition) => void
  onDropFiles?: (files: File[], world: CanvasPosition) => void
  onBoxSelect?: (
    rect: { x: number; y: number; width: number; height: number },
    additive: boolean
  ) => void
  onContextMenu?: (
    event: React.MouseEvent<HTMLDivElement>,
    world: CanvasPosition
  ) => void
  dropHint: string
  graphicsLayer?: React.ReactNode
  // 屏幕空间覆盖层（world 层兄弟）：节点下方面板等借 --canvas-live-* 变量实时跟随手势
  overlayLayer?: React.ReactNode
  children: React.ReactNode
}

export function InfiniteCanvas(props: InfiniteCanvasProps) {
  const {
    containerRef,
    viewport,
    theme,
    background,
    tool,
    onViewportChange,
    onBackgroundClick,
    onDoubleClick,
    onDropFiles,
    onBoxSelect,
    onContextMenu,
    dropHint,
    graphicsLayer,
    overlayLayer,
    children,
  } = props

  const worldLayerRef = React.useRef<HTMLDivElement | null>(null)
  const viewportRef = React.useRef(viewport)
  const interactingRef = React.useRef(false)
  const frameRef = React.useRef<number | null>(null)
  const nextViewportRef = React.useRef<ViewportTransform | null>(null)
  const syncTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const rectRef = React.useRef<DOMRect | null>(null)
  const wheelGestureRef = React.useRef<{
    intent: 'pan' | 'zoom'
    at: number
  } | null>(null)
  const panState = React.useRef({
    isPanning: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
    hasMoved: false,
  })
  const touchPointsRef = React.useRef(new Map<number, TouchPoint>())
  const pinchStateRef = React.useRef({
    active: false,
    pointerIds: [-1, -1] as [number, number],
    initialDistance: 1,
    worldX: 0,
    worldY: 0,
    initialScale: viewport.k,
  })
  const spacePressedRef = React.useRef(false)
  const [isSpacePressed, setIsSpacePressed] = React.useState(false)
  const [isPanning, setIsPanning] = React.useState(false)
  const [isDragOver, setIsDragOver] = React.useState(false)
  // 选择工具下的背景框选（屏幕坐标矩形，提交时换算世界坐标）
  const boxStateRef = React.useRef({
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    additive: false,
  })
  const [boxRect, setBoxRect] = React.useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)

  // 把视口直接画到 DOM（手势期间每帧调用，不走 React）
  const paintViewport = React.useCallback(
    (v: ViewportTransform) => {
      const container = containerRef.current
      const world = worldLayerRef.current
      if (!container || !world) return
      container.style.setProperty('--canvas-live-x', `${v.x}px`)
      container.style.setProperty('--canvas-live-y', `${v.y}px`)
      container.style.setProperty('--canvas-live-scale', String(v.k))
      container.style.setProperty(
        '--canvas-live-inverse-scale',
        String(1 / Math.max(v.k, MIN_SCALE))
      )
      world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`
    },
    [containerRef]
  )

  const flushViewport = React.useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    const pending = nextViewportRef.current
    nextViewportRef.current = null
    if (pending) paintViewport(pending)
  }, [paintViewport])

  const syncViewport = React.useCallback(() => {
    flushViewport()
    interactingRef.current = false
    onViewportChange(viewportRef.current)
  }, [flushViewport, onViewportChange])

  const scheduleViewportChange = React.useCallback(
    (next: ViewportTransform, commitAfterIdle = false) => {
      viewportRef.current = next
      nextViewportRef.current = next
      interactingRef.current = true
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(flushViewport)
      }
      if (!commitAfterIdle) return
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      const finishIdle = () => {
        if (frameRef.current !== null) {
          syncTimerRef.current = setTimeout(finishIdle, 64)
          return
        }
        syncTimerRef.current = null
        syncViewport()
      }
      syncTimerRef.current = setTimeout(finishIdle, 120)
    },
    [flushViewport, syncViewport]
  )

  // React 提交的视口（缩放按钮/适配视图/初始加载）在非手势期同步到 DOM
  React.useLayoutEffect(() => {
    if (!interactingRef.current) {
      viewportRef.current = viewport
      paintViewport(viewport)
    }
  }, [viewport, paintViewport])

  React.useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    },
    []
  )

  // Space 抓手
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      if (
        event.target instanceof Element &&
        event.target.closest(
          "input,textarea,select,button,[contenteditable='true']"
        )
      ) {
        return
      }
      event.preventDefault()
      spacePressedRef.current = true
      setIsSpacePressed(true)
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      spacePressedRef.current = false
      setIsSpacePressed(false)
    }
    const handleBlur = () => {
      spacePressedRef.current = false
      setIsSpacePressed(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  // 滚轮：capture + passive:false，缩放围绕鼠标世界坐标
  const handleWheel = React.useCallback(
    (event: WheelEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const deltaX = wheelDeltaToPixels(event.deltaX, event.deltaMode)
      const deltaY = wheelDeltaToPixels(event.deltaY, event.deltaMode)
      const absX = Math.abs(deltaX)
      const absY = Math.abs(deltaY)
      const isPinchZoom = event.ctrlKey || event.metaKey
      if (target?.closest(WHEEL_IGNORE_SELECTOR) && !isPinchZoom) {
        // 内部滚动区保留纵向滚动，但横向手势不能泄漏为浏览器前进/后退
        if (event.shiftKey || absX > absY) event.preventDefault()
        return
      }
      event.preventDefault()
      const current = viewportRef.current
      const now = performance.now()
      const intent = canvasWheelIntent(event, wheelGestureRef.current, now)
      wheelGestureRef.current = { intent, at: now }

      if (intent === 'pan') {
        const panX = event.shiftKey && absX < 1 ? deltaY : deltaX
        scheduleViewportChange(
          {
            x: current.x - panX,
            y: current.y - (event.shiftKey && absX < 1 ? 0 : deltaY),
            k: current.k,
          },
          true
        )
        return
      }

      const rect =
        rectRef.current || containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const mouseX = event.clientX - rect.left
      const mouseY = event.clientY - rect.top
      const zoomDelta =
        isPinchZoom && event.deltaMode === 0 && absY < 40
          ? TRACKPAD_PINCH_ZOOM_DELTA
          : WHEEL_ZOOM_DELTA
      const factor = Math.pow(1.1, -deltaY / zoomDelta)
      const newScale = clampScale(current.k * factor)
      const worldX = (mouseX - current.x) / current.k
      const worldY = (mouseY - current.y) / current.k
      scheduleViewportChange(
        {
          x: mouseX - worldX * newScale,
          y: mouseY - worldY * newScale,
          k: newScale,
        },
        true
      )
    },
    [containerRef, scheduleViewportChange]
  )

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.addEventListener('wheel', handleWheel, {
      passive: false,
      capture: true,
    })
    return () => {
      container.removeEventListener('wheel', handleWheel, { capture: true })
    }
  }, [containerRef, handleWheel])

  // 容器矩形缓存（缩放定位用）
  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const updateRect = () => {
      rectRef.current = container.getBoundingClientRect()
    }
    updateRect()
    const observer = new ResizeObserver(updateRect)
    observer.observe(container)
    window.addEventListener('resize', updateRect)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateRect)
    }
  }, [containerRef])

  const toWorld = (clientX: number, clientY: number): CanvasPosition => {
    const rect =
      rectRef.current || containerRef.current?.getBoundingClientRect()
    const v = viewportRef.current
    if (!rect) return { x: 0, y: 0 }
    return {
      x: (clientX - rect.left - v.x) / v.k,
      y: (clientY - rect.top - v.y) / v.k,
    }
  }
  // window 级指针事件里复用最新 toWorld（避免闭包捕获旧视口）
  const toWorldRef = React.useRef(toWorld)
  toWorldRef.current = toWorld

  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = viewportRef.current
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    interactingRef.current = true
    panState.current = {
      isPanning: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initialX: current.x,
      initialY: current.y,
      hasMoved: false,
    }
    setIsPanning(true)
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest(POINTER_IGNORE_SELECTOR)) return
    const isBackgroundClick = !target?.closest(
      '[data-node-id],[data-connection-id]'
    )
    const isTouch = event.pointerType === 'touch'

    if (isTouch) {
      touchPointsRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      })
      if (touchPointsRef.current.size >= 2) {
        const [[firstId, first], [secondId, second]] = [
          ...touchPointsRef.current.entries(),
        ]
        event.preventDefault()
        event.currentTarget.setPointerCapture(firstId)
        event.currentTarget.setPointerCapture(secondId)
        const rect =
          rectRef.current || event.currentTarget.getBoundingClientRect()
        const current = viewportRef.current
        const centerX = (first.x + second.x) / 2 - rect.left
        const centerY = (first.y + second.y) / 2 - rect.top
        pinchStateRef.current = {
          active: true,
          pointerIds: [firstId, secondId],
          initialDistance: Math.max(
            Math.hypot(second.x - first.x, second.y - first.y),
            1
          ),
          worldX: (centerX - current.x) / current.k,
          worldY: (centerY - current.y) / current.k,
          initialScale: current.k,
        }
        if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
        panState.current.isPanning = false
        interactingRef.current = true
        return
      }
      if (!isBackgroundClick) return
      if (!event.isPrimary) return
      startPan(event)
      return
    }

    // 中键 / Space / 抓手工具 → 平移；选择工具背景左键拖拽 → 框选
    const wantsPan =
      event.button === 1 || spacePressedRef.current || tool === 'hand'
    if (wantsPan) {
      startPan(event)
      return
    }
    if (event.button === 0 && isBackgroundClick) {
      if (onBoxSelect) {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        boxStateRef.current = {
          active: true,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          additive: event.shiftKey,
        }
        return
      }
      startPan(event)
    }
  }

  React.useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (
        event.pointerType === 'touch' &&
        touchPointsRef.current.has(event.pointerId)
      ) {
        touchPointsRef.current.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
        })
        const pinch = pinchStateRef.current
        if (pinch.active) {
          const first = touchPointsRef.current.get(pinch.pointerIds[0])
          const second = touchPointsRef.current.get(pinch.pointerIds[1])
          const rect =
            rectRef.current || containerRef.current?.getBoundingClientRect()
          if (!first || !second || !rect) return
          event.preventDefault()
          const centerX = (first.x + second.x) / 2 - rect.left
          const centerY = (first.y + second.y) / 2 - rect.top
          const distance = Math.max(
            Math.hypot(second.x - first.x, second.y - first.y),
            1
          )
          const scale = clampScale(
            pinch.initialScale * (distance / pinch.initialDistance)
          )
          scheduleViewportChange({
            x: centerX - pinch.worldX * scale,
            y: centerY - pinch.worldY * scale,
            k: scale,
          })
          return
        }
      }

      if (
        boxStateRef.current.active &&
        boxStateRef.current.pointerId === event.pointerId
      ) {
        const box = boxStateRef.current
        const rect =
          rectRef.current || containerRef.current?.getBoundingClientRect()
        if (!rect) return
        setBoxRect({
          left: Math.min(box.startX, event.clientX) - rect.left,
          top: Math.min(box.startY, event.clientY) - rect.top,
          width: Math.abs(event.clientX - box.startX),
          height: Math.abs(event.clientY - box.startY),
        })
        return
      }

      if (
        !panState.current.isPanning ||
        panState.current.pointerId !== event.pointerId
      ) {
        return
      }
      const dx = event.clientX - panState.current.startX
      const dy = event.clientY - panState.current.startY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        panState.current.hasMoved = true
      }
      scheduleViewportChange({
        x: panState.current.initialX + dx,
        y: panState.current.initialY + dy,
        k: viewportRef.current.k,
      })
    }

    const handlePointerEnd = (event: PointerEvent) => {
      const pinch = pinchStateRef.current
      if (
        event.pointerType === 'touch' &&
        pinch.active &&
        pinch.pointerIds.includes(event.pointerId)
      ) {
        pinch.active = false
        touchPointsRef.current.clear()
        panState.current.isPanning = false
        panState.current.pointerId = -1
        if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
        syncViewport()
        setIsPanning(false)
        return
      }
      if (event.pointerType === 'touch') {
        touchPointsRef.current.delete(event.pointerId)
      }
      if (
        boxStateRef.current.active &&
        boxStateRef.current.pointerId === event.pointerId
      ) {
        const box = boxStateRef.current
        box.active = false
        box.pointerId = -1
        setBoxRect(null)
        const dx = Math.abs(event.clientX - box.startX)
        const dy = Math.abs(event.clientY - box.startY)
        if (dx < 4 && dy < 4) {
          if (event.type === 'pointerup') onBackgroundClick?.()
          return
        }
        const first = toWorldRef.current(box.startX, box.startY)
        const second = toWorldRef.current(event.clientX, event.clientY)
        onBoxSelect?.(
          {
            x: Math.min(first.x, second.x),
            y: Math.min(first.y, second.y),
            width: Math.abs(second.x - first.x),
            height: Math.abs(second.y - first.y),
          },
          box.additive
        )
        return
      }
      if (
        !panState.current.isPanning ||
        panState.current.pointerId !== event.pointerId
      ) {
        return
      }
      if (event.type === 'pointerup' && !panState.current.hasMoved) {
        onBackgroundClick?.()
      }
      panState.current.isPanning = false
      panState.current.pointerId = -1
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      syncViewport()
      setIsPanning(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerEnd)
    window.addEventListener('pointercancel', handlePointerEnd)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)
    }
  }, [
    containerRef,
    onBackgroundClick,
    onBoxSelect,
    scheduleViewportChange,
    syncViewport,
  ])

  const grabCursor = isSpacePressed || tool === 'hand'

  return (
    <div
      ref={containerRef}
      data-canvas-viewport
      className={`relative h-full w-full touch-none overflow-hidden select-none ${grabCursor ? 'cursor-grab' : 'cursor-default'}`}
      style={
        {
          background: theme.canvas.background,
          overscrollBehavior: 'none',
          '--canvas-live-x': `${viewport.x}px`,
          '--canvas-live-y': `${viewport.y}px`,
          '--canvas-live-scale': viewport.k,
          '--canvas-live-inverse-scale': 1 / Math.max(viewport.k, MIN_SCALE),
        } as React.CSSProperties
      }
      onPointerDown={handlePointerDown}
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu?.(event, toWorld(event.clientX, event.clientY))
      }}
      onDoubleClick={(event) => {
        const target = event.target instanceof Element ? event.target : null
        if (
          !target?.closest(
            '[data-node-id],[data-connection-id],[data-canvas-no-zoom]'
          )
        ) {
          onDoubleClick?.(toWorld(event.clientX, event.clientY))
        }
      }}
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          setIsDragOver(true)
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsDragOver(false)
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault()
      }}
      onDrop={(event) => {
        setIsDragOver(false)
        const files = [...event.dataTransfer.files]
        if (files.length === 0) return
        event.preventDefault()
        onDropFiles?.(files, toWorld(event.clientX, event.clientY))
      }}
    >
      {/* 装饰网格固定在屏幕坐标，避免缩放时改变密度或亚像素闪烁 */}
      {background !== 'blank' && (
        <div
          aria-hidden='true'
          className='pointer-events-none absolute inset-0'
          style={{
            backgroundImage:
              background === 'dots'
                ? `radial-gradient(circle, ${theme.canvas.dot} 0.8px, transparent 1px)`
                : `linear-gradient(${theme.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.line} 1px, transparent 1px)`,
            backgroundSize: '48px 48px',
            opacity: background === 'dots' ? 0.34 : 0.46,
          }}
        />
      )}
      <div
        ref={worldLayerRef}
        data-canvas-world-layer
        className='absolute origin-top-left'
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`,
          // 抓手/Space 期间屏蔽节点命中，保证从任意位置拖拽都能平移
          pointerEvents: grabCursor ? 'none' : undefined,
        }}
      >
        {graphicsLayer}
        {children}
      </div>
      {/* 屏幕空间覆盖层：不随 world transform 缩放，内部用 CSS 变量自行定位 */}
      {overlayLayer}
      {/* 框选矩形（屏幕坐标） */}
      {boxRect && (
        <div
          aria-hidden='true'
          className='pointer-events-none absolute z-40 rounded-[3px]'
          style={{
            left: boxRect.left,
            top: boxRect.top,
            width: boxRect.width,
            height: boxRect.height,
            border: `1px solid ${theme.accent.primary}`,
            background: theme.accent.primarySoft,
          }}
        />
      )}
      {/* 平移期间用透明命中层统一光标，避免逐个子元素改样式 */}
      <div
        aria-hidden='true'
        className='absolute inset-0 cursor-grabbing'
        style={{ pointerEvents: isPanning ? 'auto' : 'none', zIndex: 40 }}
      />
      {isDragOver && (
        <div
          className='pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed'
          style={{
            borderColor: theme.accent.primary,
            background: theme.accent.primarySoft,
          }}
        >
          <span
            className='text-sm font-medium'
            style={{ color: theme.node.text }}
          >
            {dropHint}
          </span>
        </div>
      )}
    </div>
  )
}
