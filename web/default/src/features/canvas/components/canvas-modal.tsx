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
import { X } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import type { CanvasTheme } from '../canvas-theme'

// ===== 画布模态/侧栏外壳（画布独立主题，不依赖站点 Dialog，保证明暗画布下视觉一致） =====

function useEscapeClose(onClose: () => void) {
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])
}

export function CanvasModal(props: {
  theme: CanvasTheme
  title: string
  onClose: () => void
  children: React.ReactNode
  width?: number
  headerExtra?: React.ReactNode
}) {
  const { theme, title, onClose, children, width = 760, headerExtra } = props
  const { t } = useTranslation()
  useEscapeClose(onClose)

  return (
    <div
      data-canvas-no-zoom
      className='fixed inset-0 z-[120] flex items-center justify-center p-4'
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type='button'
        aria-label={t('Close')}
        className='absolute inset-0 cursor-default'
        style={{ background: 'rgba(0,0,0,.62)', backdropFilter: 'blur(3px)' }}
        onClick={onClose}
      />
      <div
        role='dialog'
        aria-modal='true'
        aria-label={title}
        className='relative flex max-h-[86vh] w-full flex-col overflow-hidden rounded-2xl'
        style={{
          maxWidth: width,
          background: theme.toolbar.panel,
          border: `1px solid ${theme.toolbar.border}`,
          boxShadow: theme.node.hoverShadow,
          color: theme.node.text,
        }}
      >
        <div
          className='flex shrink-0 items-center gap-2 px-4 py-3'
          style={{ borderBottom: `1px solid ${theme.toolbar.border}` }}
        >
          <h2 className='min-w-0 flex-1 truncate text-sm font-semibold'>
            {title}
          </h2>
          {headerExtra}
          <button
            type='button'
            onClick={onClose}
            className='flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors'
            style={{ color: theme.node.muted }}
            aria-label={t('Close')}
            title={t('Close')}
          >
            <X aria-hidden='true' className='size-4' />
          </button>
        </div>
        <div className='canvas-scroll min-h-0 flex-1 overflow-y-auto'>
          {children}
        </div>
      </div>
    </div>
  )
}

export function CanvasDrawer(props: {
  theme: CanvasTheme
  title: string
  onClose: () => void
  children: React.ReactNode
  width?: number
  headerExtra?: React.ReactNode
}) {
  const { theme, title, onClose, children, width = 380, headerExtra } = props
  const { t } = useTranslation()
  useEscapeClose(onClose)

  return (
    <div
      data-canvas-no-zoom
      role='dialog'
      aria-label={title}
      className='absolute top-0 right-0 bottom-0 z-[90] flex flex-col'
      style={{
        width: `min(${width}px, 92vw)`,
        background: theme.toolbar.panel,
        borderLeft: `1px solid ${theme.toolbar.border}`,
        boxShadow: theme.node.hoverShadow,
        backdropFilter: 'blur(14px)',
        color: theme.node.text,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        className='flex shrink-0 items-center gap-2 px-4 py-3'
        style={{ borderBottom: `1px solid ${theme.toolbar.border}` }}
      >
        <h2 className='min-w-0 flex-1 truncate text-sm font-semibold'>
          {title}
        </h2>
        {headerExtra}
        <button
          type='button'
          onClick={onClose}
          className='flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors'
          style={{ color: theme.node.muted }}
          aria-label={t('Close')}
          title={t('Close')}
        >
          <X aria-hidden='true' className='size-4' />
        </button>
      </div>
      <div className='canvas-scroll min-h-0 flex-1 overflow-y-auto'>
        {children}
      </div>
    </div>
  )
}
