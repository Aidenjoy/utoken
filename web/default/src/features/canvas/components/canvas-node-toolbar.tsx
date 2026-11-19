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
// ===== 节点悬停/选中工具条（移植 BeefTV node-hover toolbar：上下文感知快捷操作） =====

import {
  AudioLines,
  Copy,
  Crop,
  Download,
  Expand,
  FolderOpen,
  Grid3x3,
  Images,
  Info,
  Lock,
  Maximize2,
  Pencil,
  RefreshCw,
  Trash2,
  Unlock,
  WandSparkles,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import type { CanvasTheme } from '../canvas-theme'
import type { CanvasNode } from '../types'

export type CanvasNodeToolId =
  | 'info'
  | 'fullscreen'
  | 'download'
  | 'retry'
  | 'crop'
  | 'split'
  | 'upscale'
  | 'frame'
  | 'extract-audio'
  | 'edit-drawing'
  | 'edit-text'
  | 'open-folder'
  | 'lock'
  | 'duplicate'
  | 'delete'

interface ToolSpec {
  id: CanvasNodeToolId
  labelKey: string
  icon: React.ReactNode
  danger?: boolean
}

export function CanvasNodeToolbar(props: {
  node: CanvasNode
  theme: CanvasTheme
  selected: boolean
  onTool: (node: CanvasNode, tool: CanvasNodeToolId) => void
}) {
  const { node, theme, selected, onTool } = props
  const { t } = useTranslation()
  const hasMedia = Boolean(node.metadata.url)
  const locked = Boolean(node.metadata.locked)
  const status = node.metadata.status ?? 'idle'
  const generatable =
    node.type === 'image' ||
    node.type === 'video' ||
    node.type === 'upscale' ||
    node.type === 'text' ||
    node.type === 'audio'

  const tools: ToolSpec[] = []
  if (node.type === 'folder') {
    tools.push({
      id: 'open-folder',
      labelKey: 'Open folder',
      icon: <FolderOpen aria-hidden='true' className='size-3.5' />,
    })
  }
  if (node.type === 'text') {
    tools.push({
      id: 'edit-text',
      labelKey: 'Expand text editor',
      icon: <Expand aria-hidden='true' className='size-3.5' />,
    })
  }
  if (node.type === 'drawing' && hasMedia) {
    tools.push({
      id: 'edit-drawing',
      labelKey: 'Edit drawing',
      icon: <Pencil aria-hidden='true' className='size-3.5' />,
    })
  }
  if (generatable && (status === 'error' || status === 'success')) {
    tools.push({
      id: 'retry',
      labelKey: status === 'error' ? 'Retry' : 'Regenerate',
      icon: <RefreshCw aria-hidden='true' className='size-3.5' />,
    })
  }
  if (node.type === 'image' && hasMedia) {
    tools.push(
      {
        id: 'crop',
        labelKey: 'Crop image',
        icon: <Crop aria-hidden='true' className='size-3.5' />,
      },
      {
        id: 'split',
        labelKey: 'Split into grid',
        icon: <Grid3x3 aria-hidden='true' className='size-3.5' />,
      },
      {
        id: 'upscale',
        labelKey: 'AI upscale',
        icon: <WandSparkles aria-hidden='true' className='size-3.5' />,
      }
    )
  }
  if (node.type === 'video' && hasMedia) {
    tools.push(
      {
        id: 'frame',
        labelKey: 'Extract frame',
        icon: <Images aria-hidden='true' className='size-3.5' />,
      },
      {
        id: 'extract-audio',
        labelKey: 'Extract audio',
        icon: <AudioLines aria-hidden='true' className='size-3.5' />,
      }
    )
  }
  if (hasMedia) {
    tools.push(
      {
        id: 'fullscreen',
        labelKey: 'Fullscreen preview',
        icon: <Maximize2 aria-hidden='true' className='size-3.5' />,
      },
      {
        id: 'download',
        labelKey: 'Download',
        icon: <Download aria-hidden='true' className='size-3.5' />,
      }
    )
  }
  tools.push({
    id: 'info',
    labelKey: 'Node info & tags',
    icon: <Info aria-hidden='true' className='size-3.5' />,
  })
  tools.push({
    id: 'lock',
    labelKey: locked ? 'Unlock node' : 'Lock node',
    icon: locked ? (
      <Unlock aria-hidden='true' className='size-3.5' />
    ) : (
      <Lock aria-hidden='true' className='size-3.5' />
    ),
  })
  tools.push({
    id: 'duplicate',
    labelKey: 'Duplicate node',
    icon: <Copy aria-hidden='true' className='size-3.5' />,
  })
  tools.push({
    id: 'delete',
    labelKey: 'Delete node',
    icon: <Trash2 aria-hidden='true' className='size-3.5' />,
    danger: true,
  })

  return (
    <div
      data-canvas-menu
      data-no-drag
      className={`absolute -top-13 left-0 z-40 flex max-w-[560px] flex-wrap items-center gap-0.5 rounded-xl p-1 transition-opacity ${
        selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      }`}
      style={{
        transform: 'scale(var(--canvas-live-inverse-scale, 1))',
        transformOrigin: 'left bottom',
        background: theme.toolbar.panel,
        border: `1px solid ${theme.toolbar.border}`,
        boxShadow: theme.node.hoverShadow,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      role='toolbar'
      aria-label={t('Node tools')}
    >
      {tools.map((tool) => (
        <button
          key={tool.id}
          type='button'
          onClick={() => onTool(node, tool.id)}
          className='flex size-7 items-center justify-center rounded-lg transition-colors'
          style={{
            color: tool.danger ? theme.accent.danger : theme.node.muted,
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = theme.toolbar.itemHover
            event.currentTarget.style.color = tool.danger
              ? theme.accent.danger
              : theme.node.text
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = 'transparent'
            event.currentTarget.style.color = tool.danger
              ? theme.accent.danger
              : theme.node.muted
          }}
          aria-label={t(tool.labelKey)}
          title={t(tool.labelKey)}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  )
}