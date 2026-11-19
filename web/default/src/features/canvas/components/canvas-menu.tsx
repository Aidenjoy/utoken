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
import { ChevronRight } from 'lucide-react'
import * as React from 'react'

import type { CanvasTheme } from '../canvas-theme'
import { CANVAS_MENU_ATTR, useCanvasMenuDismiss } from './canvas-menu-utils'

// ===== 画布浮动菜单基元（移植自 BeefTV canvas-menu：图标盒/快捷键/分区/危险项） =====
// 所有菜单面板带 data-canvas-menu，外部点击/Escape 关闭时允许嵌套子菜单共存。

export function CanvasMenuPanel(props: {
  theme: CanvasTheme
  x: number
  y: number
  width?: number
  onClose: () => void
  children: React.ReactNode
  ariaLabel: string
}) {
  const { theme, x, y, width = 224, onClose, children, ariaLabel } = props
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = React.useState({ x, y })
  useCanvasMenuDismiss(onClose)

  // 视口内收敛：底部/右侧溢出时翻转，顶部不小于 68（让出工作区条）；
  // 内容高度变化（如搜索过滤）时重新收敛，避免子菜单远离父菜单
  React.useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const clamp = () => {
      const rect = panel.getBoundingClientRect()
      let nextX = x
      let nextY = y
      if (nextX + rect.width > window.innerWidth - 8) {
        nextX = Math.max(8, window.innerWidth - rect.width - 8)
      }
      if (nextY + rect.height > window.innerHeight - 8) {
        nextY = Math.max(68, y - rect.height)
      }
      nextY = Math.max(68, nextY)
      setPosition({ x: nextX, y: nextY })
    }
    clamp()
    const observer = new ResizeObserver(clamp)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [x, y])

  return (
    <div
      ref={panelRef}
      {...{ [CANVAS_MENU_ATTR]: '' }}
      data-canvas-no-zoom
      role='menu'
      aria-label={ariaLabel}
      className='canvas-scroll fixed z-[130] overflow-y-auto rounded-xl py-1.5'
      style={{
        left: position.x,
        top: position.y,
        width,
        maxHeight: 'min(70vh, 560px)',
        background: theme.toolbar.panel,
        border: `1px solid ${theme.toolbar.border}`,
        boxShadow: theme.node.hoverShadow,
        backdropFilter: 'blur(14px)',
        color: theme.toolbar.item,
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </div>
  )
}

export function CanvasMenuHeader(props: {
  theme: CanvasTheme
  children: React.ReactNode
}) {
  return (
    <div
      className='px-3 pt-1 pb-1.5 text-[11px] font-medium'
      style={{ color: props.theme.node.faint }}
    >
      {props.children}
    </div>
  )
}

export function CanvasMenuSection(props: {
  theme: CanvasTheme
  children: React.ReactNode
}) {
  return (
    <div
      className='px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wider uppercase'
      style={{ color: props.theme.node.faint }}
    >
      {props.children}
    </div>
  )
}

export function CanvasMenuDivider({ theme }: { theme: CanvasTheme }) {
  return (
    <div
      aria-hidden='true'
      className='mx-2 my-1 h-px'
      style={{ background: theme.toolbar.border }}
    />
  )
}

export function CanvasMenuButton(props: {
  theme: CanvasTheme
  icon?: React.ReactNode
  label: React.ReactNode
  shortcut?: string
  badge?: string
  danger?: boolean
  disabled?: boolean
  chevron?: boolean
  active?: boolean
  onClick?: () => void
  onMouseEnter?: () => void
}) {
  const {
    theme,
    icon,
    label,
    shortcut,
    badge,
    danger,
    disabled,
    chevron,
    active,
    onClick,
    onMouseEnter,
  } = props
  const [hover, setHover] = React.useState(false)
  const color = danger ? theme.accent.danger : theme.toolbar.item
  let background = 'transparent'
  if (hover && !disabled) {
    background = danger ? 'rgba(248,113,113,.12)' : theme.toolbar.itemHover
  } else if (active) {
    background = theme.toolbar.activeBg
  }
  return (
    <button
      type='button'
      role='menuitem'
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => {
        setHover(true)
        onMouseEnter?.()
      }}
      onMouseLeave={() => setHover(false)}
      className='mx-1 flex min-h-9 w-[calc(100%-8px)] items-center gap-2 rounded-lg px-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-35'
      style={{
        color,
        background,
      }}
    >
      {icon && (
        <span
          aria-hidden='true'
          className='flex size-7 shrink-0 items-center justify-center rounded-md'
          style={{
            border: `1px solid ${theme.toolbar.border}`,
            background: theme.toolbar.itemHover,
            color: danger ? theme.accent.danger : theme.node.muted,
          }}
        >
          {icon}
        </span>
      )}
      <span className='min-w-0 flex-1 truncate'>{label}</span>
      {badge && (
        <span
          className='shrink-0 rounded-full px-1.5 py-0.5 text-[10px]'
          style={{
            background: theme.toolbar.itemHover,
            color: theme.node.faint,
          }}
        >
          {badge}
        </span>
      )}
      {shortcut && (
        <span
          className='shrink-0 text-[10px] tabular-nums'
          style={{ color: theme.node.faint }}
        >
          {shortcut}
        </span>
      )}
      {chevron && (
        <ChevronRight
          aria-hidden='true'
          className='size-3.5 shrink-0'
          style={{ color: theme.node.faint }}
        />
      )}
    </button>
  )
}

// 行式列表按钮（添加节点 list / 模式菜单用，比 MenuButton 更紧凑）
export function CanvasMenuRow(props: {
  theme: CanvasTheme
  icon: React.ReactNode
  label: React.ReactNode
  badge?: string
  disabled?: boolean
  active?: boolean
  shortcut?: string
  onClick?: () => void
}) {
  const { theme, icon, label, badge, disabled, active, shortcut, onClick } =
    props
  const [hover, setHover] = React.useState(false)
  let background = 'transparent'
  if (hover && !disabled) background = theme.toolbar.itemHover
  else if (active) background = theme.toolbar.activeBg
  return (
    <button
      type='button'
      role='menuitem'
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className='mx-1 flex min-h-8 w-[calc(100%-8px)] items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:grayscale'
      style={{
        color: theme.toolbar.item,
        background,
      }}
    >
      <span
        aria-hidden='true'
        className='flex size-5 shrink-0 items-center justify-center opacity-80'
        style={{ color: theme.node.muted }}
      >
        {icon}
      </span>
      <span className='min-w-0 flex-1 truncate'>{label}</span>
      {badge && (
        <span
          className='shrink-0 rounded-full px-1.5 py-0.5 text-[10px]'
          style={{
            background: theme.toolbar.itemHover,
            color: theme.node.faint,
          }}
        >
          {badge}
        </span>
      )}
      {shortcut && (
        <span
          className='shrink-0 text-[10px] tabular-nums'
          style={{ color: theme.node.faint }}
        >
          {shortcut}
        </span>
      )}
    </button>
  )
}
