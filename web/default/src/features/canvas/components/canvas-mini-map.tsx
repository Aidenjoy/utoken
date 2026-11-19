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

import type { CanvasTheme } from '../canvas-theme'
import type { CanvasNode, ViewportTransform } from '../types'

// ===== 小地图（移植自 BeefTV canvas-mini-map：世界包围盒/类型着色/视口框拖拽导航） =====

const MAP_WIDTH = 240
const MAP_HEIGHT = 160
const WORLD_PADDING = 500
const MAX_IMAGE_PREVIEWS = 24

const NODE_COLORS: Partial<Record<CanvasNode['type'], string>> = {
  image: '#10b981',
  video: '#f97316',
  audio: '#a855f7',
}

interface CanvasMiniMapProps {
  theme: CanvasTheme
  nodes: CanvasNode[]
  viewport: ViewportTransform
  containerWidth: number
  containerHeight: number
  onNavigate: (worldX: number, worldY: number) => void
}

export function CanvasMiniMap(props: CanvasMiniMapProps) {
  const {
    theme,
    nodes,
    viewport,
    containerWidth,
    containerHeight,
    onNavigate,
  } = props
  const { t } = useTranslation()
  const mapRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef(false)

  // 世界包围盒：节点范围 + 当前视口范围，外扩固定 padding，保证空画布也有稳定比例
  const viewWorldX = -viewport.x / viewport.k
  const viewWorldY = -viewport.y / viewport.k
  const viewWorldW = containerWidth / viewport.k
  const viewWorldH = containerHeight / viewport.k
  let minX = viewWorldX
  let minY = viewWorldY
  let maxX = viewWorldX + viewWorldW
  let maxY = viewWorldY + viewWorldH
  for (const node of nodes) {
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + node.width)
    maxY = Math.max(maxY, node.position.y + node.height)
  }
  minX -= WORLD_PADDING
  minY -= WORLD_PADDING
  maxX += WORLD_PADDING
  maxY += WORLD_PADDING
  const boundsW = Math.max(maxX - minX, 1)
  const boundsH = Math.max(maxY - minY, 1)
  const scale = Math.min(MAP_WIDTH / boundsW, MAP_HEIGHT / boundsH)
  const offsetX = (MAP_WIDTH - boundsW * scale) / 2
  const offsetY = (MAP_HEIGHT - boundsH * scale) / 2

  const toMapX = (worldX: number) => (worldX - minX) * scale + offsetX
  const toMapY = (worldY: number) => (worldY - minY) * scale + offsetY

  const navigateFromEvent = (clientX: number, clientY: number) => {
    const rect = mapRef.current?.getBoundingClientRect()
    if (!rect) return
    const worldX = (clientX - rect.left - offsetX) / scale + minX
    const worldY = (clientY - rect.top - offsetY) / scale + minY
    onNavigate(worldX, worldY)
  }

  let imagePreviews = 0

  return (
    <div
      ref={mapRef}
      data-canvas-no-zoom
      role='application'
      aria-label={t('Minimap')}
      className='absolute bottom-16 left-4 z-40 cursor-crosshair overflow-hidden rounded-xl'
      style={{
        width: MAP_WIDTH,
        height: MAP_HEIGHT,
        background: theme.toolbar.panel,
        border: `1px solid ${theme.toolbar.border}`,
        boxShadow: theme.node.hoverShadow,
        backdropFilter: 'blur(12px)',
        touchAction: 'none',
      }}
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        dragRef.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
        navigateFromEvent(event.clientX, event.clientY)
      }}
      onPointerMove={(event) => {
        if (!dragRef.current) return
        navigateFromEvent(event.clientX, event.clientY)
      }}
      onPointerUp={(event) => {
        dragRef.current = false
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }}
      onPointerCancel={() => {
        dragRef.current = false
      }}
    >
      {nodes.map((node) => {
        const color = NODE_COLORS[node.type] ?? theme.node.muted
        const showPreview =
          node.type === 'image' &&
          node.metadata.url &&
          imagePreviews < MAX_IMAGE_PREVIEWS
        if (showPreview) imagePreviews += 1
        return (
          <div
            key={node.id}
            className='absolute overflow-hidden rounded-[2px]'
            style={{
              left: toMapX(node.position.x),
              top: toMapY(node.position.y),
              width: Math.max(node.width * scale, 3),
              height: Math.max(node.height * scale, 3),
              background: showPreview ? 'transparent' : color,
              opacity: node.type === 'folder' ? 0.25 : 0.85,
              border: node.type === 'folder' ? `1px solid ${color}` : undefined,
            }}
          >
            {showPreview && (
              <img
                src={node.metadata.url}
                alt=''
                draggable={false}
                className='size-full object-cover'
              />
            )}
          </div>
        )
      })}
      {/* 当前视口框 */}
      <div
        aria-hidden='true'
        className='pointer-events-none absolute rounded-[3px]'
        style={{
          left: toMapX(viewWorldX),
          top: toMapY(viewWorldY),
          width: viewWorldW * scale,
          height: viewWorldH * scale,
          border: `1.5px solid ${theme.node.activeStroke}`,
          boxShadow: `inset 0 0 0 999px ${theme.node.activeStroke}14`,
        }}
      />
    </div>
  )
}
