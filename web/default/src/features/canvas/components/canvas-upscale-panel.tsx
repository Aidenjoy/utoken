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
import { Loader2, Settings2, WandSparkles } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import type { CanvasTheme } from '../canvas-theme'
import type { CanvasNode, CanvasNodeMetadata } from '../types'

// ===== 超分节点下方设置面板（对齐 BeefTV：倍率/模式/格式/模型/批量超分） =====

const UPSCALE_FORMAT_OPTIONS = ['png', 'jpg', 'webp']

interface CanvasUpscalePanelProps {
  node: CanvasNode
  theme: CanvasTheme
  modelConfigured: boolean
  modelName?: string
  imageCount: number
  videoCount: number
  busy: boolean
  onPatchMetadata: (metadata: Partial<CanvasNodeMetadata>) => void
  onBatchUpscale: (node: CanvasNode) => void
  onOpenSettings: () => void
}

export function CanvasUpscalePanel(props: CanvasUpscalePanelProps) {
  const {
    node,
    theme,
    modelConfigured,
    modelName,
    imageCount,
    videoCount,
    busy,
    onPatchMetadata,
    onBatchUpscale,
    onOpenSettings,
  } = props
  const { t } = useTranslation()

  const factor = node.metadata.upscaleFactor ?? 2
  const mode = node.metadata.upscaleMode ?? 'faithful'
  const format = node.metadata.upscaleFormat ?? 'png'
  const inputCount = imageCount + (node.metadata.sourceUrl ? 1 : 0)
  const canRun = inputCount > 0 && modelConfigured && !busy

  const fieldStyle: React.CSSProperties = {
    background: theme.node.panel,
    color: theme.node.text,
    border: `1px solid ${theme.node.stroke}`,
  }

  return (
    <div
      data-canvas-no-zoom
      className='flex flex-col gap-2.5 rounded-2xl p-3'
      style={{
        background: theme.toolbar.panel,
        border: `1px solid ${theme.toolbar.border}`,
        boxShadow: theme.node.hoverShadow,
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className='flex flex-wrap items-center gap-2'>
        {/* 倍率 */}
        <label
          className='flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px]'
          style={fieldStyle}
        >
          <span style={{ color: theme.node.muted }}>{t('Factor')}</span>
          <input
            type='number'
            min={1}
            max={4}
            value={factor}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (Number.isFinite(value)) {
                onPatchMetadata({
                  upscaleFactor: Math.min(4, Math.max(1, Math.round(value))),
                })
              }
            }}
            aria-label={t('Upscale factor')}
            className='w-10 bg-transparent text-center text-xs tabular-nums outline-none'
            style={{ color: theme.node.text }}
          />
          <span style={{ color: theme.node.faint }}>×</span>
        </label>
        {/* 模式分段 */}
        <div
          className='flex h-8 items-center rounded-lg p-0.5'
          style={fieldStyle}
          role='radiogroup'
          aria-label={t('Upscale mode')}
        >
          {(
            [
              { value: 'faithful', label: t('Faithful enhance') },
              { value: 'creative', label: t('Detail rebuild') },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type='button'
              role='radio'
              aria-checked={mode === option.value}
              onClick={() => onPatchMetadata({ upscaleMode: option.value })}
              className='flex h-full items-center rounded-md px-2.5 text-[11px] transition-colors'
              style={
                mode === option.value
                  ? {
                      background: theme.accent.primary,
                      color: theme.accent.onPrimary,
                    }
                  : { color: theme.node.muted }
              }
            >
              {option.label}
            </button>
          ))}
        </div>
        {/* 输出格式 */}
        <select
          value={format}
          onChange={(event) =>
            onPatchMetadata({ upscaleFormat: event.target.value })
          }
          className='h-8 rounded-lg px-2 text-[11px] outline-none'
          style={fieldStyle}
          aria-label={t('Output format')}
        >
          {UPSCALE_FORMAT_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option.toUpperCase()}
            </option>
          ))}
        </select>
        {/* 模型 */}
        <button
          type='button'
          onClick={onOpenSettings}
          className='flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px]'
          style={
            modelConfigured
              ? fieldStyle
              : { background: 'rgba(245,158,11,.15)', color: '#fcd34d' }
          }
          title={t('Model settings')}
        >
          <Settings2 aria-hidden='true' className='size-3 shrink-0' />
          {modelConfigured
            ? (modelName ?? t('Image model'))
            : t('No upscale model available')}
        </button>
      </div>
      <p className='text-[10px] leading-relaxed' style={{ color: theme.node.faint }}>
        {t(
          'Each connected image is enhanced with the settings above and saved as a new image node.'
        )}
        {videoCount > 0 && (
          <span style={{ color: '#fcd34d' }}>
            {' '}
            {t('Video upscaling is not supported by the current provider.')}
          </span>
        )}
      </p>
      <button
        type='button'
        disabled={!canRun}
        onClick={() => onBatchUpscale(node)}
        className='flex h-9 items-center justify-center gap-1.5 rounded-xl text-xs font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40'
        style={{
          background: theme.accent.primary,
          color: theme.accent.onPrimary,
        }}
      >
        {busy ? (
          <Loader2 aria-hidden='true' className='size-3.5 animate-spin' />
        ) : (
          <WandSparkles aria-hidden='true' className='size-3.5' />
        )}
        {t('Start batch upscale')}
        {inputCount > 0 && (
          <span className='tabular-nums opacity-80'>({inputCount})</span>
        )}
      </button>
    </div>
  )
}