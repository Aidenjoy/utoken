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
import { Folder, Link2 } from 'lucide-react'
import * as React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import type { CanvasTheme } from '../canvas-theme'
import { CANVAS_NODE_TITLE_KEYS, type CanvasNodeType } from '../types'

// ===== @mention 资源菜单（移植自 BeefTV canvas-resource-mention-menu） =====
// 节点卡片 overflow-hidden 会裁切卡内浮层，因此与 BeefTV 一致改用 body portal +
// fixed 定位：锚定输入框矩形，空间不足时向下翻转并钳制最大高度，rAF 跟随画布
// 平移/缩放。菜单内 mousedown 阻止默认行为，避免点击候选项时输入框失焦关闭菜单。

export interface CanvasMentionCandidate {
  key: string
  kind: 'node' | 'asset'
  id: string
  title: string
  type: CanvasNodeType
}

const MENU_MAX_HEIGHT = 176
const ITEM_HEIGHT = 30
const VIEWPORT_MARGIN = 8
const ANCHOR_GAP = 4

export function CanvasMentionMenu(props: {
  anchorRef: React.RefObject<HTMLTextAreaElement | null>
  items: CanvasMentionCandidate[]
  activeIndex: number
  theme: CanvasTheme
  onSelect: (item: CanvasMentionCandidate) => void
}) {
  const { anchorRef, items, activeIndex, theme, onSelect } = props
  const { t } = useTranslation()
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const lastStyleRef = React.useRef('')
  const [style, setStyle] = React.useState<React.CSSProperties | null>(null)

  React.useLayoutEffect(() => {
    let frame = 0
    const update = () => {
      frame = requestAnimationFrame(update)
      const anchor = anchorRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const width = rect.width
      const natural = Math.min(
        MENU_MAX_HEIGHT,
        items.length * ITEM_HEIGHT + 8
      )
      const spaceAbove = rect.top - VIEWPORT_MARGIN
      const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN
      const showAbove = spaceAbove >= natural || spaceAbove >= spaceBelow
      const maxHeight = Math.max(
        ITEM_HEIGHT * 2,
        Math.min(MENU_MAX_HEIGHT, showAbove ? spaceAbove : spaceBelow)
      )
      const left = Math.min(
        Math.max(VIEWPORT_MARGIN, rect.left),
        Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)
      )
      const top = showAbove ? rect.top - ANCHOR_GAP : rect.bottom + ANCHOR_GAP
      const next: React.CSSProperties = {
        left,
        top,
        width,
        maxHeight,
        transform: showAbove ? 'translateY(-100%)' : undefined,
      }
      const serialized = JSON.stringify(next)
      if (serialized === lastStyleRef.current) return
      lastStyleRef.current = serialized
      setStyle(next)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [anchorRef, items.length])

  // 键盘导航时保持高亮项可见
  React.useEffect(() => {
    const active = menuRef.current?.querySelector('[data-active="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  return createPortal(
    <div
      ref={menuRef}
      data-canvas-menu
      role='menu'
      aria-label={t('Mention resources')}
      className='canvas-scroll fixed z-[90] overflow-y-auto rounded-xl py-1'
      style={{
        background: theme.toolbar.panel,
        border: `1px solid ${theme.toolbar.border}`,
        boxShadow: theme.node.hoverShadow,
        visibility: style ? undefined : 'hidden',
        ...style,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.preventDefault()}
    >
      {items.map((item, index) => (
        <button
          key={item.key}
          type='button'
          role='menuitem'
          data-active={index === activeIndex}
          onClick={() => onSelect(item)}
          className='flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs'
          style={{
            background:
              index === activeIndex ? theme.toolbar.itemHover : 'transparent',
            color: theme.node.text,
          }}
        >
          {item.kind === 'asset' ? (
            <Folder aria-hidden='true' className='size-3 shrink-0' />
          ) : (
            <Link2 aria-hidden='true' className='size-3 shrink-0' />
          )}
          <span className='truncate'>{item.title}</span>
          <span
            className='ml-auto shrink-0 text-[10px]'
            style={{ color: theme.node.muted }}
          >
            {item.kind === 'asset'
              ? t('Asset library')
              : t(CANVAS_NODE_TITLE_KEYS[item.type])}
          </span>
        </button>
      ))}
    </div>,
    document.body
  )
}