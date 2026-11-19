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
// ===== 多选浮动工具条（移植 BeefTV selection toolbar：对齐/分布/排列/收纳/批量连接） =====

import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceAround,
  AlignHorizontalSpaceBetween,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceAround,
  AlignVerticalSpaceBetween,
  Copy,
  FolderPlus,
  Grid3x3,
  Link2,
  Sparkles,
  Trash2,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import type { CanvasTheme } from '../canvas-theme'

export type CanvasAlignMode =
  | 'left'
  | 'centerX'
  | 'right'
  | 'top'
  | 'centerY'
  | 'bottom'
  | 'distributeX'
  | 'distributeY'

export type CanvasArrangeMode = 'row' | 'column' | 'grid'

export function CanvasSelectionToolbar(props: {
  theme: CanvasTheme
  count: number
  onAlign: (mode: CanvasAlignMode) => void
  onArrange: (mode: CanvasArrangeMode) => void
  onPackFolder: () => void
  onBatchConnect: () => void
  onCopy: () => void
  onDelete: () => void
  onAskAssistant: () => void
}) {
  const { theme, count, onAlign, onArrange } = props
  const { t } = useTranslation()
  if (count < 2) return null

  const groups: {
    key: string
    items: {
      key: string
      labelKey: string
      icon: React.ReactNode
      disabled?: boolean
      danger?: boolean
      run: () => void
    }[]
  }[] = [
    {
      key: 'align',
      items: [
        {
          key: 'left',
          labelKey: 'Align left',
          icon: <AlignHorizontalJustifyStart className='size-4' />,
          run: () => onAlign('left'),
        },
        {
          key: 'centerX',
          labelKey: 'Align horizontal center',
          icon: <AlignHorizontalJustifyCenter className='size-4' />,
          run: () => onAlign('centerX'),
        },
        {
          key: 'right',
          labelKey: 'Align right',
          icon: <AlignHorizontalJustifyEnd className='size-4' />,
          run: () => onAlign('right'),
        },
        {
          key: 'top',
          labelKey: 'Align top',
          icon: <AlignVerticalJustifyStart className='size-4' />,
          run: () => onAlign('top'),
        },
        {
          key: 'centerY',
          labelKey: 'Align vertical center',
          icon: <AlignVerticalJustifyCenter className='size-4' />,
          run: () => onAlign('centerY'),
        },
        {
          key: 'bottom',
          labelKey: 'Align bottom',
          icon: <AlignVerticalJustifyEnd className='size-4' />,
          run: () => onAlign('bottom'),
        },
        {
          key: 'distributeX',
          labelKey: 'Distribute horizontally',
          icon: <AlignHorizontalSpaceBetween className='size-4' />,
          disabled: count < 3,
          run: () => onAlign('distributeX'),
        },
        {
          key: 'distributeY',
          labelKey: 'Distribute vertically',
          icon: <AlignVerticalSpaceBetween className='size-4' />,
          disabled: count < 3,
          run: () => onAlign('distributeY'),
        },
      ],
    },
    {
      key: 'arrange',
      items: [
        {
          key: 'row',
          labelKey: 'Arrange in row',
          icon: <AlignHorizontalSpaceAround className='size-4' />,
          run: () => onArrange('row'),
        },
        {
          key: 'column',
          labelKey: 'Arrange in column',
          icon: <AlignVerticalSpaceAround className='size-4' />,
          run: () => onArrange('column'),
        },
        {
          key: 'grid',
          labelKey: 'Arrange in grid',
          icon: <Grid3x3 className='size-4' />,
          run: () => onArrange('grid'),
        },
      ],
    },
    {
      key: 'group',
      items: [
        {
          key: 'pack',
          labelKey: 'Pack into folder',
          icon: <FolderPlus className='size-4' />,
          run: props.onPackFolder,
        },
        {
          key: 'connect',
          labelKey: 'Batch connect',
          icon: <Link2 className='size-4' />,
          run: props.onBatchConnect,
        },
        {
          key: 'assistant',
          labelKey: 'Ask assistant',
          icon: <Sparkles className='size-4' />,
          run: props.onAskAssistant,
        },
      ],
    },
    {
      key: 'edit',
      items: [
        {
          key: 'copy',
          labelKey: 'Copy selection',
          icon: <Copy className='size-4' />,
          run: props.onCopy,
        },
        {
          key: 'delete',
          labelKey: 'Delete selection',
          icon: <Trash2 className='size-4' />,
          danger: true,
          run: props.onDelete,
        },
      ],
    },
  ]

  return (
    <div
      data-canvas-menu
      data-canvas-no-zoom
      role='toolbar'
      aria-label={t('Selection tools')}
      className='absolute top-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-0.5 rounded-2xl px-1.5 py-1'
      style={{
        background: theme.toolbar.panel,
        border: `1px solid ${theme.toolbar.border}`,
        boxShadow: theme.node.hoverShadow,
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span
        className='px-1.5 text-[11px] font-medium tabular-nums'
        style={{ color: theme.node.muted }}
      >
        {t('{{count}} selected', { count })}
      </span>
      {groups.map((group, groupIndex) => (
        <div key={group.key} className='flex items-center gap-0.5'>
          {groupIndex > 0 && (
            <span
              aria-hidden='true'
              className='mx-1 h-5 w-px'
              style={{ background: theme.toolbar.border }}
            />
          )}
          {group.items.map((item) => (
            <button
              key={item.key}
              type='button'
              disabled={item.disabled}
              onClick={item.run}
              className='flex size-8 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-35'
              style={{
                color: item.danger ? theme.accent.danger : theme.node.muted,
              }}
              onMouseEnter={(event) => {
                if (item.disabled) return
                event.currentTarget.style.background = theme.toolbar.itemHover
                event.currentTarget.style.color = item.danger
                  ? theme.accent.danger
                  : theme.node.text
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = 'transparent'
                event.currentTarget.style.color = item.danger
                  ? theme.accent.danger
                  : theme.node.muted
              }}
              aria-label={t(item.labelKey)}
              title={t(item.labelKey)}
            >
              {item.icon}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}