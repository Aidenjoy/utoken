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
  Grid3x3,
  Grip,
  Hand,
  Image as ImageIcon,
  Maximize,
  Minus,
  Moon,
  MousePointer2,
  Plus,
  SquareDashed,
  Sun,
  Type,
  Upload,
  Video,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import type { CanvasTheme } from '../canvas-theme'
import type {
  CanvasBackgroundMode,
  CanvasColorTheme,
  CanvasNodeType,
} from '../types'

// ===== 底部浮动工具栏（移植自 BeefTV canvas-toolbar 的 Floating Dock） =====

interface CanvasToolbarProps {
  theme: CanvasTheme
  tool: 'select' | 'hand'
  onToolChange: (tool: 'select' | 'hand') => void
  scale: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onFitView: () => void
  background: CanvasBackgroundMode
  onBackgroundChange: (mode: CanvasBackgroundMode) => void
  colorTheme: CanvasColorTheme
  onToggleTheme: () => void
  onAddNode: (type: CanvasNodeType) => void
  onUploadImage: () => void
}

export function CanvasToolbar(props: CanvasToolbarProps) {
  const { t } = useTranslation()
  const {
    theme,
    tool,
    onToolChange,
    scale,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    onFitView,
    background,
    onBackgroundChange,
    colorTheme,
    onToggleTheme,
    onAddNode,
    onUploadImage,
  } = props

  const itemStyle = (active = false): React.CSSProperties => ({
    color: active ? theme.toolbar.activeText : theme.toolbar.item,
    background: active ? theme.toolbar.activeBg : 'transparent',
  })

  const iconButton =
    'flex size-8 items-center justify-center rounded-full transition-colors'

  const hoverHandlers = {
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
      if (e.currentTarget.dataset.active !== 'true') {
        e.currentTarget.style.background = theme.toolbar.itemHover
      }
    },
    onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
      if (e.currentTarget.dataset.active !== 'true') {
        e.currentTarget.style.background = 'transparent'
      }
    },
  }

  const divider = (
    <span
      aria-hidden='true'
      className='mx-1 h-5 w-px shrink-0'
      style={{ background: theme.toolbar.border }}
    />
  )

  const menuContentStyle: React.CSSProperties = {
    background: theme.toolbar.panel,
    border: `1px solid ${theme.toolbar.border}`,
    color: theme.toolbar.item,
    backdropFilter: 'blur(12px)',
  }

  const backgroundIcons = {
    dots: Grip,
    lines: Grid3x3,
    blank: SquareDashed,
  } as const
  const BackgroundIcon = backgroundIcons[background]

  return (
    <div
      data-canvas-no-zoom
      className='absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-0.5 rounded-full px-2 py-1.5'
      style={{
        background: theme.toolbar.panel,
        border: `1px solid ${theme.toolbar.border}`,
        boxShadow: theme.node.hoverShadow,
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* 添加节点 */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type='button'
              className={`${iconButton} cursor-pointer`}
              style={itemStyle()}
              aria-label={t('Add node')}
              title={t('Add node')}
              {...hoverHandlers}
            />
          }
        >
          <Plus aria-hidden='true' className='size-4.5' />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side='top'
          align='center'
          sideOffset={10}
          style={menuContentStyle}
          data-canvas-no-zoom
        >
          <DropdownMenuItem onClick={() => onAddNode('image')}>
            <ImageIcon aria-hidden='true' />
            {t('Image node')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAddNode('video')}>
            <Video aria-hidden='true' />
            {t('Video node')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAddNode('text')}>
            <Type aria-hidden='true' />
            {t('Text node')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onUploadImage}>
            <Upload aria-hidden='true' />
            {t('Upload image')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {divider}

      {/* 工具切换：选择 / 抓手 */}
      <button
        type='button'
        className={`${iconButton} cursor-pointer`}
        style={itemStyle(tool === 'select')}
        data-active={tool === 'select'}
        onClick={() => onToolChange('select')}
        aria-label={t('Select tool')}
        title={t('Select tool (V)')}
        {...hoverHandlers}
      >
        <MousePointer2 aria-hidden='true' className='size-4' />
      </button>
      <button
        type='button'
        className={`${iconButton} cursor-pointer`}
        style={itemStyle(tool === 'hand')}
        data-active={tool === 'hand'}
        onClick={() => onToolChange('hand')}
        aria-label={t('Hand tool')}
        title={t('Hand tool (H)')}
        {...hoverHandlers}
      >
        <Hand aria-hidden='true' className='size-4' />
      </button>

      {divider}

      {/* 缩放控制 */}
      <button
        type='button'
        className={`${iconButton} cursor-pointer`}
        style={itemStyle()}
        onClick={onZoomOut}
        aria-label={t('Zoom out')}
        title={t('Zoom out')}
        {...hoverHandlers}
      >
        <Minus aria-hidden='true' className='size-4' />
      </button>
      <button
        type='button'
        className='h-8 min-w-12 cursor-pointer rounded-full px-1 text-xs font-medium tabular-nums transition-colors'
        style={itemStyle()}
        onClick={onZoomReset}
        aria-label={t('Reset zoom')}
        title={t('Reset zoom to 100%')}
        {...hoverHandlers}
      >
        {Math.round(scale * 100)}%
      </button>
      <button
        type='button'
        className={`${iconButton} cursor-pointer`}
        style={itemStyle()}
        onClick={onZoomIn}
        aria-label={t('Zoom in')}
        title={t('Zoom in')}
        {...hoverHandlers}
      >
        <Plus aria-hidden='true' className='size-4' />
      </button>
      <button
        type='button'
        className={`${iconButton} cursor-pointer`}
        style={itemStyle()}
        onClick={onFitView}
        aria-label={t('Fit view')}
        title={t('Fit all nodes in view')}
        {...hoverHandlers}
      >
        <Maximize aria-hidden='true' className='size-4' />
      </button>

      {divider}

      {/* 背景网格 */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type='button'
              className={`${iconButton} cursor-pointer`}
              style={itemStyle()}
              aria-label={t('Canvas background')}
              title={t('Canvas background')}
              {...hoverHandlers}
            />
          }
        >
          <BackgroundIcon aria-hidden='true' className='size-4' />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side='top'
          align='center'
          sideOffset={10}
          style={menuContentStyle}
          data-canvas-no-zoom
        >
          <DropdownMenuItem onClick={() => onBackgroundChange('dots')}>
            <Grip aria-hidden='true' />
            {t('Dots')}
            {background === 'dots' && <span className='ml-auto'>✓</span>}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onBackgroundChange('lines')}>
            <Grid3x3 aria-hidden='true' />
            {t('Lines')}
            {background === 'lines' && <span className='ml-auto'>✓</span>}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onBackgroundChange('blank')}>
            <SquareDashed aria-hidden='true' />
            {t('Blank')}
            {background === 'blank' && <span className='ml-auto'>✓</span>}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 明暗主题 */}
      <button
        type='button'
        className={`${iconButton} cursor-pointer`}
        style={itemStyle()}
        onClick={onToggleTheme}
        aria-label={t('Toggle canvas theme')}
        title={t('Toggle canvas theme')}
        {...hoverHandlers}
      >
        {colorTheme === 'dark' ? (
          <Sun aria-hidden='true' className='size-4' />
        ) : (
          <Moon aria-hidden='true' className='size-4' />
        )}
      </button>
    </div>
  )
}
