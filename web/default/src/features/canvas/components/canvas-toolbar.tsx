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
  Activity,
  Cable,
  Check,
  Clock3,
  Grid3x3,
  Grip,
  Hand,
  Keyboard,
  Link2,
  Map,
  Moon,
  MousePointer2,
  Palette,
  Plus,
  SquareDashed,
  Sun,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import type { CanvasTheme } from '../canvas-theme'
import type { CanvasBackgroundMode, CanvasColorTheme } from '../types'
import {
  CanvasCreateList,
  type CanvasCreateCommandId,
} from './canvas-create-menu'
import {
  CanvasMenuDivider,
  CanvasMenuRow,
  CanvasMenuSection,
} from './canvas-menu'
import {
  CANVAS_MENU_ATTR,
  modKey,
  shiftModKey,
  useCanvasMenuDismiss,
} from './canvas-menu-utils'

// ===== 底部浮动 Dock（移植自 BeefTV canvas-toolbar：添加/模式/资产/外观/历史/快捷键） =====

interface CanvasToolbarProps {
  theme: CanvasTheme
  tool: 'select' | 'hand'
  onToolChange: (tool: 'select' | 'hand') => void
  onCommand: (id: CanvasCreateCommandId) => void
  background: CanvasBackgroundMode
  onBackgroundChange: (mode: CanvasBackgroundMode) => void
  colorTheme: CanvasColorTheme
  onThemeChange: (theme: CanvasColorTheme) => void
  snapEnabled: boolean
  onToggleSnap: () => void
  showConnections: boolean
  onToggleConnections: () => void
  showMinimap: boolean
  onToggleMinimap: () => void
  tasksCount: number
  tasksOpen: boolean
  onToggleTasks: () => void
}

type DockPanel = 'add' | 'mode' | 'appearance' | 'shortcuts' | null

const SHORTCUT_ITEMS: { labelKey: string; keys: string }[] = [
  { labelKey: 'Search canvas nodes', keys: modKey('F') },
  { labelKey: 'Open / close assistant', keys: modKey('J') },
  { labelKey: 'Enter focus mode', keys: shiftModKey('F') },
  { labelKey: 'Undo', keys: modKey('Z') },
  { labelKey: 'Redo', keys: shiftModKey('Z') },
  { labelKey: 'Copy nodes', keys: modKey('C') },
  { labelKey: 'Paste', keys: modKey('V') },
  { labelKey: 'Create variant', keys: modKey('D') },
  { labelKey: 'Select all nodes', keys: modKey('A') },
  { labelKey: 'Switch to move tool', keys: 'V' },
  { labelKey: 'Switch to hand tool', keys: 'H' },
  { labelKey: 'Zoom in', keys: modKey('+') },
  { labelKey: 'Zoom out', keys: modKey('−') },
  { labelKey: 'Reset to 100%', keys: modKey('1') },
  { labelKey: 'Fit all nodes', keys: modKey('0') },
  { labelKey: 'Fit selected nodes', keys: modKey('3') },
  { labelKey: 'Delete selection', keys: 'Delete' },
  { labelKey: 'Close panels / clear selection', keys: 'Esc' },
]

export function CanvasToolbar(props: CanvasToolbarProps) {
  const {
    theme,
    tool,
    onToolChange,
    onCommand,
    background,
    onBackgroundChange,
    colorTheme,
    onThemeChange,
    snapEnabled,
    onToggleSnap,
    showConnections,
    onToggleConnections,
    showMinimap,
    onToggleMinimap,
    tasksCount,
    tasksOpen,
    onToggleTasks,
  } = props
  const { t } = useTranslation()
  const [openPanel, setOpenPanel] = React.useState<DockPanel>(null)
  const closePanel = React.useCallback(() => setOpenPanel(null), [])
  useCanvasMenuDismiss(closePanel)

  const togglePanel = (panel: DockPanel) =>
    setOpenPanel((prev) => (prev === panel ? null : panel))

  const panelStyle: React.CSSProperties = {
    background: theme.toolbar.panel,
    border: `1px solid ${theme.toolbar.border}`,
    boxShadow: theme.node.hoverShadow,
    backdropFilter: 'blur(14px)',
    color: theme.toolbar.item,
  }

  const iconButton =
    'flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors'

  const itemStyle = (active: boolean): React.CSSProperties => ({
    color: active ? theme.toolbar.activeText : theme.toolbar.item,
    background: active ? theme.toolbar.activeBg : 'transparent',
  })

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

  const toggleRow = (
    label: string,
    icon: React.ReactNode,
    active: boolean,
    onClick: () => void
  ) => (
    <button
      type='button'
      role='menuitemcheckbox'
      aria-checked={active}
      onClick={onClick}
      className='mx-1 flex min-h-8 w-[calc(100%-8px)] cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors'
      style={{ color: theme.toolbar.item }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = theme.toolbar.itemHover
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
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
      {active && (
        <Check
          aria-hidden='true'
          className='size-3.5 shrink-0'
          style={{ color: theme.toolbar.activeText }}
        />
      )}
    </button>
  )

  const backgroundOptions: {
    mode: CanvasBackgroundMode
    labelKey: string
    icon: React.ReactNode
  }[] = [
    { mode: 'dots', labelKey: 'Dots', icon: <Grip className='size-4' /> },
    { mode: 'lines', labelKey: 'Lines', icon: <Grid3x3 className='size-4' /> },
    {
      mode: 'blank',
      labelKey: 'Blank',
      icon: <SquareDashed className='size-4' />,
    },
  ]

  return (
    <div
      {...{ [CANVAS_MENU_ATTR]: '' }}
      data-canvas-no-zoom
      className='absolute bottom-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-1 rounded-full px-2 py-1.5'
      style={{
        background: theme.toolbar.panel,
        border: `1px solid ${theme.toolbar.border}`,
        boxShadow: theme.node.hoverShadow,
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* 添加节点：白色 prominent 主按钮 */}
      <button
        type='button'
        className='flex size-9 cursor-pointer items-center justify-center rounded-full transition-transform hover:scale-105'
        style={{
          background: theme.accent.primary,
          color: theme.accent.onPrimary,
          boxShadow: theme.node.shadow,
        }}
        onClick={() => togglePanel('add')}
        aria-label={t('Add node')}
        title={t('Add node')}
        data-active='true'
      >
        <Plus aria-hidden='true' className='size-4.5' />
      </button>

      {/* 画布模式：区域选择 ↔ 抓手 */}
      <button
        type='button'
        className={iconButton}
        style={itemStyle(openPanel === 'mode')}
        data-active={openPanel === 'mode'}
        onClick={() => togglePanel('mode')}
        aria-label={t('Canvas mode')}
        title={tool === 'select' ? t('Box select') : t('Hand tool')}
        {...hoverHandlers}
      >
        {tool === 'select' ? (
          <MousePointer2 aria-hidden='true' className='size-4' />
        ) : (
          <Hand aria-hidden='true' className='size-4' />
        )}
      </button>

      {/* 资产管理 */}
      <button
        type='button'
        className={iconButton}
        style={itemStyle(false)}
        onClick={() => {
          closePanel()
          onCommand('assets')
        }}
        aria-label={t('Asset management')}
        title={t('Asset management')}
        {...hoverHandlers}
      >
        <Cable aria-hidden='true' className='size-4' />
      </button>

      {/* 画布外观 */}
      <button
        type='button'
        className={iconButton}
        style={itemStyle(openPanel === 'appearance')}
        data-active={openPanel === 'appearance'}
        onClick={() => togglePanel('appearance')}
        aria-label={t('Canvas appearance')}
        title={t('Canvas appearance')}
        {...hoverHandlers}
      >
        <Palette aria-hidden='true' className='size-4' />
      </button>

      {/* 生成历史 */}
      <button
        type='button'
        className={iconButton}
        style={itemStyle(false)}
        onClick={() => {
          closePanel()
          onCommand('generation-history')
        }}
        aria-label={t('Generation history')}
        title={t('Generation history')}
        {...hoverHandlers}
      >
        <Clock3 aria-hidden='true' className='size-4' />
      </button>

      {/* 生成任务面板 */}
      <button
        type='button'
        className={`${iconButton} relative`}
        style={itemStyle(tasksOpen)}
        data-active={tasksOpen}
        onClick={() => {
          closePanel()
          onToggleTasks()
        }}
        aria-label={t('Active generation tasks')}
        title={t('Active generation tasks')}
        {...hoverHandlers}
      >
        <Activity aria-hidden='true' className='size-4' />
        {tasksCount > 0 && (
          <span
            className='absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full text-[9px] font-semibold tabular-nums'
            style={{
              background: theme.accent.primary,
              color: theme.accent.onPrimary,
            }}
          >
            {tasksCount}
          </span>
        )}
      </button>

      {/* 快捷键 */}
      <button
        type='button'
        className={iconButton}
        style={itemStyle(openPanel === 'shortcuts')}
        data-active={openPanel === 'shortcuts'}
        onClick={() => togglePanel('shortcuts')}
        aria-label={t('Keyboard shortcuts')}
        title={t('Keyboard shortcuts')}
        {...hoverHandlers}
      >
        <Keyboard aria-hidden='true' className='size-4' />
      </button>

      {/* 上浮面板 */}
      {openPanel === 'add' && (
        <div
          className='canvas-scroll absolute bottom-[calc(100%+10px)] left-0 max-h-[60vh] w-58 overflow-y-auto rounded-2xl py-1.5'
          style={panelStyle}
        >
          <CanvasCreateList
            theme={theme}
            onCommand={(id) => {
              closePanel()
              onCommand(id)
            }}
          />
        </div>
      )}

      {openPanel === 'mode' && (
        <div
          className='absolute bottom-[calc(100%+10px)] left-1/2 w-56 -translate-x-1/2 rounded-2xl py-1.5'
          style={panelStyle}
        >
          <CanvasMenuSection theme={theme}>
            {t('Canvas mode')}
          </CanvasMenuSection>
          <CanvasMenuRow
            theme={theme}
            icon={<MousePointer2 className='size-4' />}
            label={t('Move / box select')}
            shortcut='V'
            active={tool === 'select'}
            onClick={() => {
              onToolChange('select')
              closePanel()
            }}
          />
          <CanvasMenuRow
            theme={theme}
            icon={<Hand className='size-4' />}
            label={t('Hand tool')}
            shortcut='H'
            active={tool === 'hand'}
            onClick={() => {
              onToolChange('hand')
              closePanel()
            }}
          />
        </div>
      )}

      {openPanel === 'appearance' && (
        <div
          role='menu'
          aria-label={t('Canvas appearance')}
          className='canvas-scroll absolute bottom-[calc(100%+10px)] left-1/2 max-h-[60vh] w-72 -translate-x-1/2 overflow-y-auto rounded-2xl py-1.5'
          style={panelStyle}
        >
          <CanvasMenuSection theme={theme}>{t('Background')}</CanvasMenuSection>
          {backgroundOptions.map((option) =>
            toggleRow(
              t(option.labelKey),
              option.icon,
              background === option.mode,
              () => onBackgroundChange(option.mode)
            )
          )}
          <CanvasMenuDivider theme={theme} />
          <CanvasMenuSection theme={theme}>{t('Theme')}</CanvasMenuSection>
          {toggleRow(
            t('Light'),
            <Sun className='size-4' />,
            colorTheme === 'light',
            () => onThemeChange('light')
          )}
          {toggleRow(
            t('Dark'),
            <Moon className='size-4' />,
            colorTheme === 'dark',
            () => onThemeChange('dark')
          )}
          <CanvasMenuDivider theme={theme} />
          <CanvasMenuSection theme={theme}>{t('View')}</CanvasMenuSection>
          {toggleRow(
            t('Snap nodes to grid'),
            <Grid3x3 className='size-4' />,
            snapEnabled,
            onToggleSnap
          )}
          {toggleRow(
            t('Show node connections'),
            <Link2 className='size-4' />,
            showConnections,
            onToggleConnections
          )}
          {toggleRow(
            t('Minimap'),
            <Map className='size-4' />,
            showMinimap,
            onToggleMinimap
          )}
        </div>
      )}

      {openPanel === 'shortcuts' && (
        <div
          className='canvas-scroll absolute right-0 bottom-[calc(100%+10px)] max-h-[60vh] w-90 overflow-y-auto rounded-2xl py-2'
          style={panelStyle}
        >
          <CanvasMenuSection theme={theme}>
            {t('Keyboard shortcuts')}
          </CanvasMenuSection>
          {SHORTCUT_ITEMS.map((item) => (
            <div
              key={item.labelKey}
              className='flex min-h-8 items-center gap-2 px-3 text-xs'
              style={{ color: theme.toolbar.item }}
            >
              <span className='min-w-0 flex-1 truncate'>
                {t(item.labelKey)}
              </span>
              <kbd
                className='shrink-0 rounded-md px-1.5 py-0.5 text-[10px] tabular-nums'
                style={{
                  border: `1px solid ${theme.toolbar.border}`,
                  background: theme.toolbar.itemHover,
                  color: theme.node.muted,
                }}
              >
                {item.keys}
              </kbd>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
