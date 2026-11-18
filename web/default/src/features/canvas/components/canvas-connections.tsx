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
import type { CanvasConnection, CanvasNode, CanvasPosition } from '../types'

import '../canvas.css'

// ===== 画布连线（移植自 BeefTV canvas-connections 的贝塞尔算法与多层视觉） =====

// 单端口节点连接 Y 恒取边垂直中心，避免同端口多线沿边散开成“伪端口”
function connectionHandleY(node: CanvasNode) {
  return node.position.y + node.height / 2
}

function canvasConnectionPath(from: CanvasNode, to: CanvasNode) {
  const startX = from.position.x + from.width
  const startY = connectionHandleY(from)
  const endX = to.position.x
  const endY = connectionHandleY(to)
  const curvature = Math.max(Math.abs(endX - startX) * 0.5, 50)
  return {
    pathD: `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`,
    startX,
    startY,
    endX,
    endY,
  }
}

// 拖拽中的临时连线：源节点右缘 → 鼠标世界坐标（吸附目标时取目标左缘中心）
function activeConnectionPath(
  node: CanvasNode,
  mouseWorld: CanvasPosition,
  target?: CanvasNode
) {
  const startX = node.position.x + node.width
  const startY = connectionHandleY(node)
  const endX = target ? target.position.x : mouseWorld.x
  const endY = target ? connectionHandleY(target) : mouseWorld.y
  const curvature = Math.max(Math.abs(endX - startX) * 0.5, 50)
  return `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`
}

const ConnectionPath = React.memo(function ConnectionPath(props: {
  connection: CanvasConnection
  from: CanvasNode
  to: CanvasNode
  active: boolean
  theme: CanvasTheme
  onSelect: (connectionId: string) => void
}) {
  const { connection, from, to, active, theme, onSelect } = props
  const { pathD, startX, startY, endX, endY } = React.useMemo(
    () => canvasConnectionPath(from, to),
    [from, to]
  )
  const gradientId = `canvas-flow-${connection.id.replaceAll(/[^a-zA-Z0-9_-]/g, '')}`

  return (
    <g data-connection-id={connection.id}>
      {active && (
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits='userSpaceOnUse'
            x1={startX}
            y1={startY}
            x2={endX}
            y2={endY}
          >
            <stop offset='0%' stopColor={theme.node.muted} stopOpacity={0.18} />
            <stop
              offset='48%'
              stopColor={theme.accent.primary}
              stopOpacity={0.58}
            />
            <stop
              offset='100%'
              stopColor={theme.accent.primary}
              stopOpacity={0.34}
            />
          </linearGradient>
          {/* 流光头部软化渐变：两端透明中间亮，避免短划线看起来是硬色块 */}
          <linearGradient
            id={`${gradientId}-comet`}
            x1='0'
            y1='0'
            x2='1'
            y2='0'
          >
            <stop
              offset='0%'
              stopColor={theme.accent.primary}
              stopOpacity={0}
            />
            <stop
              offset='45%'
              stopColor={theme.accent.primary}
              stopOpacity={0.95}
            />
            <stop
              offset='100%'
              stopColor={theme.accent.primary}
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
      )}
      {/* 选中光晕 */}
      {active && (
        <path
          d={pathD}
          stroke={theme.accent.primary}
          strokeWidth={8}
          vectorEffect='non-scaling-stroke'
          strokeOpacity={0.18}
          fill='none'
          strokeLinecap='round'
          style={{ pointerEvents: 'none', filter: 'blur(3px)' }}
        />
      )}
      {/* 透明命中层：细线也能轻松点中 */}
      <path
        data-connection-id={connection.id}
        d={pathD}
        stroke='transparent'
        strokeWidth={16}
        vectorEffect='non-scaling-stroke'
        fill='none'
        style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
        onClick={(event) => {
          event.stopPropagation()
          onSelect(connection.id)
        }}
      />
      {/* 底线（加宽淡色，增强可读性） */}
      <path
        d={pathD}
        stroke={theme.node.muted}
        strokeWidth={active ? 5 : 2.5}
        vectorEffect='non-scaling-stroke'
        strokeOpacity={active ? 0.18 : 0.1}
        fill='none'
        strokeLinecap='round'
        strokeLinejoin='round'
        style={{ pointerEvents: 'none' }}
      />
      {/* 主线 */}
      <path
        d={pathD}
        stroke={active ? theme.accent.primary : theme.node.muted}
        strokeWidth={active ? 2.8 : 1.5}
        vectorEffect='non-scaling-stroke'
        strokeOpacity={active ? 0.95 : 0.62}
        fill='none'
        strokeLinecap='round'
        strokeLinejoin='round'
        style={{ pointerEvents: 'none' }}
      />
      <circle
        cx={startX}
        cy={startY}
        r={active ? 3.5 : 2}
        fill={active ? theme.accent.primary : theme.node.muted}
        fillOpacity={active ? 0.9 : 0.56}
        style={{ pointerEvents: 'none' }}
      />
      <circle
        cx={endX}
        cy={endY}
        r={active ? 3.5 : 2}
        fill={active ? theme.accent.primary : theme.node.muted}
        fillOpacity={active ? 0.9 : 0.56}
        style={{ pointerEvents: 'none' }}
      />
      {/* 选中态：虚线流动 + 流光错拍（1.25s vs 2.1s），像有光在走 */}
      {active && (
        <path
          className='canvas-connection-flow'
          d={pathD}
          stroke={`url(#${gradientId})`}
          strokeWidth={2.2}
          vectorEffect='non-scaling-stroke'
          strokeOpacity={0.84}
          strokeDasharray='18 26'
          fill='none'
          strokeLinecap='round'
          strokeLinejoin='round'
          style={{ pointerEvents: 'none' }}
        />
      )}
      {active && (
        <path
          className='canvas-connection-comet'
          d={pathD}
          stroke={`url(#${gradientId}-comet)`}
          strokeWidth={2.6}
          vectorEffect='non-scaling-stroke'
          strokeDasharray='16 118'
          fill='none'
          strokeLinecap='round'
          style={{ pointerEvents: 'none' }}
        />
      )}
    </g>
  )
})

export interface ConnectingState {
  fromNodeId: string
  mouse: CanvasPosition
  targetNodeId?: string
}

export function CanvasConnections(props: {
  nodes: CanvasNode[]
  connections: CanvasConnection[]
  selectedId: string | null
  connecting: ConnectingState | null
  theme: CanvasTheme
  onSelect: (connectionId: string) => void
}) {
  const { nodes, connections, selectedId, connecting, theme, onSelect } = props
  const nodeMap = React.useMemo(() => {
    const map = new Map<string, CanvasNode>()
    for (const node of nodes) map.set(node.id, node)
    return map
  }, [nodes])

  const connectingFrom = connecting
    ? nodeMap.get(connecting.fromNodeId)
    : undefined
  const connectingTarget = connecting?.targetNodeId
    ? nodeMap.get(connecting.targetNodeId)
    : undefined

  return (
    <svg
      data-canvas-connections
      className='absolute overflow-visible'
      style={{ left: 0, top: 0, width: 1, height: 1, pointerEvents: 'none' }}
    >
      {connections.map((connection) => {
        const from = nodeMap.get(connection.fromNodeId)
        const to = nodeMap.get(connection.toNodeId)
        if (!from || !to) return null
        return (
          <ConnectionPath
            key={connection.id}
            connection={connection}
            from={from}
            to={to}
            active={selectedId === connection.id}
            theme={theme}
            onSelect={onSelect}
          />
        )
      })}
      {connecting && connectingFrom && (
        <path
          d={activeConnectionPath(
            connectingFrom,
            connecting.mouse,
            connectingTarget
          )}
          stroke={theme.accent.primary}
          strokeWidth={2}
          vectorEffect='non-scaling-stroke'
          strokeOpacity={0.8}
          strokeDasharray='6 6'
          fill='none'
          strokeLinecap='round'
          style={{ pointerEvents: 'none' }}
        />
      )}
    </svg>
  )
}
