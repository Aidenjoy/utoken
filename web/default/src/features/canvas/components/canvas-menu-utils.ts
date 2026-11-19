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

// ===== 画布菜单共享工具（属性标记/外部关闭钩子/平台修饰键），与组件分离保证 fast refresh =====

export const CANVAS_MENU_ATTR = 'data-canvas-menu'

export function useCanvasMenuDismiss(onClose: () => void) {
  React.useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (!target?.closest(`[${CANVAS_MENU_ATTR}]`)) onClose()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])
}

// 平台修饰键（Mac ⌘ / 其他 Ctrl），快捷键展示统一走这里
export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function modKey(shortcut: string): string {
  return IS_MAC ? `⌘${shortcut}` : `Ctrl+${shortcut}`
}

export function shiftModKey(shortcut: string): string {
  return IS_MAC ? `⇧⌘${shortcut}` : `Ctrl+Shift+${shortcut}`
}
