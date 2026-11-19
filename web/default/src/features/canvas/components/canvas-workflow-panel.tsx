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
  Clapperboard,
  Folder,
  Focus,
  Image as ImageIcon,
  Link2,
  Loader2,
  Music2,
  Pencil,
  Settings2,
  Table2,
  Type,
  Video,
  WandSparkles,
  Workflow,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import type { CanvasTheme } from '../canvas-theme'
import {
  CANVAS_NODE_TITLE_KEYS,
  type CanvasConnection,
  type CanvasNode,
  type CanvasNodeType,
} from '../types'
import { CanvasDrawer } from './canvas-modal'

// ===== 工作流总览侧栏（节点管线/状态/上下游关系/模型设定入口/定位节点） =====

const WORKFLOW_ICON: Record<CanvasNodeType, typeof Type> = {
  text: Type,
  image: ImageIcon,
  video: Video,
  audio: Music2,
  upscale: WandSparkles,
  script: Clapperboard,
  director: Clapperboard,
  folder: Folder,
  drawing: Pencil,
  batch: Table2,
}

const TYPE_ORDER: CanvasNodeType[] = [
  'text',
  'script',
  'director',
  'image',
  'upscale',
  'drawing',
  'video',
  'audio',
  'batch',
  'folder',
]

export function CanvasWorkflowPanel(props: {
  theme: CanvasTheme
  nodes: CanvasNode[]
  connections: CanvasConnection[]
  imageModelConfigured: boolean
  videoModelConfigured: boolean
  onClose: () => void
  onFocusNode: (id: string) => void
  onFitView: () => void
  onOpenSettings: () => void
}) {
  const {
    theme,
    nodes,
    connections,
    imageModelConfigured,
    videoModelConfigured,
    onClose,
    onFocusNode,
    onFitView,
    onOpenSettings,
  } = props
  const { t } = useTranslation()

  const upstream = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const connection of connections) {
      map.set(connection.toNodeId, (map.get(connection.toNodeId) ?? 0) + 1)
    }
    return map
  }, [connections])
  const downstream = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const connection of connections) {
      map.set(connection.fromNodeId, (map.get(connection.fromNodeId) ?? 0) + 1)
    }
    return map
  }, [connections])

  const sortedNodes = React.useMemo(
    () =>
      [...nodes].sort(
        (a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)
      ),
    [nodes]
  )
  const generatingCount = nodes.filter(
    (n) => n.metadata.status === 'loading'
  ).length

  const statusBadge = (node: CanvasNode) => {
    const status = node.metadata.status ?? 'idle'
    if (status === 'loading') {
      return (
        <span
          className='flex items-center gap-1 text-[10px]'
          style={{ color: '#fcd34d' }}
        >
          <Loader2 aria-hidden='true' className='size-2.5 animate-spin' />
          {t('Generating...')}
        </span>
      )
    }
    if (status === 'error') {
      return (
        <span className='text-[10px]' style={{ color: theme.accent.danger }}>
          {t('Failed')}
        </span>
      )
    }
    if (status === 'success' && node.metadata.url) {
      return (
        <span className='text-[10px]' style={{ color: '#10b981' }}>
          {t('Ready')}
        </span>
      )
    }
    return null
  }

  return (
    <CanvasDrawer
      theme={theme}
      title={t('Workflow')}
      onClose={onClose}
      width={360}
    >
      <div className='flex flex-col gap-3 p-4'>
        <div className='flex gap-2'>
          {[
            { label: t('Nodes'), value: nodes.length },
            { label: t('Connections'), value: connections.length },
            { label: t('Generating...'), value: generatingCount },
          ].map((stat) => (
            <div
              key={stat.label}
              className='flex-1 rounded-xl px-3 py-2'
              style={{
                background: theme.node.fill,
                border: `1px solid ${theme.toolbar.border}`,
              }}
            >
              <p
                className='text-lg font-semibold tabular-nums'
                style={{ color: theme.node.text }}
              >
                {stat.value}
              </p>
              <p className='text-[10px]' style={{ color: theme.node.faint }}>
                {stat.label}
              </p>
            </div>
          ))}
        </div>

        {(!imageModelConfigured || !videoModelConfigured) && (
          <button
            type='button'
            onClick={onOpenSettings}
            className='flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[11px] leading-relaxed'
            style={{ background: 'rgba(245,158,11,.15)', color: '#fcd34d' }}
          >
            <Settings2 aria-hidden='true' className='size-4 shrink-0' />
            {t('Model not configured, click to set up')}
          </button>
        )}

        {sortedNodes.length === 0 ? (
          <div className='flex flex-col items-center gap-2 py-12'>
            <Workflow
              aria-hidden='true'
              className='size-8'
              style={{ color: theme.node.faint }}
            />
            <p className='text-xs' style={{ color: theme.node.muted }}>
              {t('No nodes in this canvas yet')}
            </p>
          </div>
        ) : (
          <div className='flex flex-col gap-1.5'>
            {sortedNodes.map((node) => {
              const Icon = WORKFLOW_ICON[node.type]
              const up = upstream.get(node.id) ?? 0
              const down = downstream.get(node.id) ?? 0
              return (
                <button
                  key={node.id}
                  type='button'
                  onClick={() => onFocusNode(node.id)}
                  className='flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors'
                  style={{
                    background: theme.node.fill,
                    border: `1px solid ${theme.toolbar.border}`,
                    color: theme.node.text,
                  }}
                  title={t('Click to locate node')}
                >
                  <Icon
                    aria-hidden='true'
                    className='size-4 shrink-0'
                    style={{ color: theme.node.muted }}
                  />
                  <span className='min-w-0 flex-1'>
                    <span className='block truncate text-xs font-medium'>
                      {node.title}
                    </span>
                    <span
                      className='block truncate text-[10px]'
                      style={{ color: theme.node.faint }}
                    >
                      {t(CANVAS_NODE_TITLE_KEYS[node.type])}
                    </span>
                  </span>
                  {(up > 0 || down > 0) && (
                    <span
                      className='flex shrink-0 items-center gap-0.5 text-[10px] tabular-nums'
                      style={{ color: theme.node.faint }}
                    >
                      <Link2 aria-hidden='true' className='size-2.5' />
                      {up}→{down}
                    </span>
                  )}
                  {statusBadge(node)}
                </button>
              )
            })}
          </div>
        )}

        <button
          type='button'
          onClick={onFitView}
          className='flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-xl text-xs'
          style={{
            border: `1px solid ${theme.toolbar.border}`,
            color: theme.node.muted,
          }}
        >
          <Focus aria-hidden='true' className='size-3.5' />
          {t('Fit all nodes in view')}
        </button>
      </div>
    </CanvasDrawer>
  )
}
