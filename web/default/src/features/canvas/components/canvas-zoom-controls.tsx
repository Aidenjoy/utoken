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
import { Cable, Focus, Grid3x3, Link2, Map, Minus, Plus } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import type { CanvasTheme } from '../canvas-theme'
import { clampCanvasScale } from '../types'
import { CanvasMenuDivider, CanvasMenuRow } from './canvas-menu'
import {
  CANVAS_MENU_ATTR,
  modKey,
  useCanvasMenuDismiss,
} from './canvas-menu-utils'

// ===== 左下缩放/视图 cluster（移植自 BeefTV：连线/小地图/网格吸附/适合屏幕/精确缩放） =====

interface CanvasZoomControlsProps {
  theme: CanvasTheme
  scale: number
  assetCount: number
  showConnections: boolean
  showMinimap: boolean
  snapEnabled: boolean
  onToggleConnections: () => void
  onToggleMinimap: () => void
  onToggleSnap: () => void
  onFitView: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomTo: (scale: number) => void
  onOpenAssets: () => void
}

export function CanvasZoomControls(props: CanvasZoomControlsProps) {
  const {
    theme,
    scale,
    assetCount,
    showConnections,
    showMinimap,
    snapEnabled,
    onToggleConnections,
    onToggleMinimap,
    onToggleSnap,
    onFitView,
    onZoomIn,
    onZoomOut,
    onZoomTo,
    onOpenAssets,
  } = props
  const { t } = useTranslation()
  const [precisionOpen, setPrecisionOpen] = React.useState(false)
  const [precisionValue, setPrecisionValue] = React.useState('')
  const closePrecision = React.useCallback(() => setPrecisionOpen(false), [])
  useCanvasMenuDismiss(closePrecision)

  const commitPrecision = () => {
    const percent = Number.parseFloat(precisionValue)
    if (Number.isFinite(percent) && percent > 0) {
      onZoomTo(clampCanvasScale(percent / 100))
    }
    setPrecisionOpen(false)
  }

  const iconButton =
    'flex size-8 cursor-pointer items-center justify-center rounded-full transition-colors'

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

  return (
    <div
      data-canvas-no-zoom
      className='absolute bottom-4 left-4 z-40 flex items-center gap-0.5 rounded-full px-2 py-1.5'
      style={{
        background: theme.toolbar.panel,
        border: `1px solid ${theme.toolbar.border}`,
        boxShadow: theme.node.hoverShadow,
        backdropFilter: 'blur(12px)',
      }}
    >
      <button
        type='button'
        className={`${iconButton} relative`}
        style={itemStyle(false)}
        onClick={onOpenAssets}
        aria-label={t('Asset management')}
        title={t('Asset management')}
        {...hoverHandlers}
      >
        <Cable aria-hidden='true' className='size-4' />
        <span
          className='absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] font-semibold tabular-nums'
          style={{
            background: theme.accent.primary,
            color: theme.accent.onPrimary,
          }}
        >
          {assetCount}
        </span>
      </button>

      <span
        aria-hidden='true'
        className='mx-1 h-5 w-px shrink-0'
        style={{ background: theme.toolbar.border }}
      />

      <button
        type='button'
        className={iconButton}
        style={itemStyle(showConnections)}
        data-active={showConnections}
        onClick={onToggleConnections}
        aria-label={t('Toggle connections')}
        title={t('Show / hide node connections')}
        {...hoverHandlers}
      >
        <Link2 aria-hidden='true' className='size-4' />
      </button>
      <button
        type='button'
        className={iconButton}
        style={itemStyle(showMinimap)}
        data-active={showMinimap}
        onClick={onToggleMinimap}
        aria-label={t('Toggle minimap')}
        title={t('Toggle minimap')}
        {...hoverHandlers}
      >
        <Map aria-hidden='true' className='size-4' />
      </button>
      <button
        type='button'
        className={iconButton}
        style={itemStyle(snapEnabled)}
        data-active={snapEnabled}
        onClick={onToggleSnap}
        aria-label={t('Toggle grid snap')}
        title={t('Snap nodes to grid')}
        {...hoverHandlers}
      >
        <Grid3x3 aria-hidden='true' className='size-4' />
      </button>
      <button
        type='button'
        className={iconButton}
        style={itemStyle(false)}
        onClick={onFitView}
        aria-label={t('Fit view')}
        title={t('Fit all nodes in view')}
        {...hoverHandlers}
      >
        <Focus aria-hidden='true' className='size-4' />
      </button>

      <span
        aria-hidden='true'
        className='mx-1 h-5 w-px shrink-0'
        style={{ background: theme.toolbar.border }}
      />

      <div className='relative'>
        <button
          type='button'
          className='h-8 min-w-13 cursor-pointer rounded-full px-1.5 text-xs font-medium tabular-nums transition-colors'
          style={itemStyle(precisionOpen)}
          data-active={precisionOpen}
          onClick={() => {
            setPrecisionValue(String(Math.round(scale * 100)))
            setPrecisionOpen((prev) => !prev)
          }}
          aria-label={t('Zoom precision')}
          title={t('Zoom precision')}
          {...hoverHandlers}
        >
          {Math.round(scale * 100)}%
        </button>
        {precisionOpen && (
          <div
            {...{ [CANVAS_MENU_ATTR]: '' }}
            data-canvas-no-zoom
            className='absolute right-0 bottom-[calc(100%+10px)] w-46 rounded-xl py-1.5'
            style={{
              background: theme.toolbar.panel,
              border: `1px solid ${theme.toolbar.border}`,
              boxShadow: theme.node.hoverShadow,
              backdropFilter: 'blur(14px)',
            }}
          >
            <div className='px-2 pb-1'>
              <input
                value={precisionValue}
                autoFocus
                onChange={(event) =>
                  setPrecisionValue(
                    event.target.value.replaceAll(/[^\d.]/g, '')
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitPrecision()
                }}
                onBlur={commitPrecision}
                inputMode='decimal'
                aria-label={t('Zoom percent')}
                className='h-8 w-full rounded-lg px-2 text-xs tabular-nums outline-none'
                style={{
                  background: theme.toolbar.itemHover,
                  color: theme.toolbar.item,
                  border: `1px solid ${theme.toolbar.border}`,
                }}
              />
            </div>
            <CanvasMenuRow
              theme={theme}
              icon={<Plus className='size-4' />}
              label={t('Zoom in')}
              shortcut={modKey('+')}
              onClick={() => {
                onZoomIn()
                setPrecisionValue(String(Math.round(scale * 100) + 10))
              }}
            />
            <CanvasMenuRow
              theme={theme}
              icon={<Minus className='size-4' />}
              label={t('Zoom out')}
              shortcut={modKey('−')}
              onClick={() => {
                onZoomOut()
                setPrecisionValue(
                  String(Math.max(5, Math.round(scale * 100) - 10))
                )
              }}
            />
            <CanvasMenuRow
              theme={theme}
              icon={<Focus className='size-4' />}
              label={t('Fit to screen')}
              shortcut={modKey('0')}
              onClick={() => {
                onFitView()
                setPrecisionOpen(false)
              }}
            />
            <CanvasMenuDivider theme={theme} />
            {[50, 100, 800].map((percent) => (
              <CanvasMenuRow
                key={percent}
                theme={theme}
                icon={<span className='text-[10px] tabular-nums'>%</span>}
                label={t('Zoom to {{percent}}%', { percent })}
                onClick={() => {
                  onZoomTo(percent / 100)
                  setPrecisionOpen(false)
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
