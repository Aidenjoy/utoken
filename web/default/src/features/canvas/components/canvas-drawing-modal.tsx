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
import { Check, Eraser, Loader2, Pencil, Trash2, Undo2 } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import type { CanvasTheme } from '../canvas-theme'
import { CanvasModal } from './canvas-modal'

// ===== 绘图板（绘图节点：画笔/橡皮/色板/粗细/撤销/清空，保存为 PNG 上传到节点） =====

const BOARD_SIZE = 720
const MAX_UNDO = 20
const SWATCHES = [
  '#111827',
  '#ef4444',
  '#f97316',
  '#facc15',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
  '#ffffff',
]

export function CanvasDrawingModal(props: {
  theme: CanvasTheme
  initialUrl?: string
  onClose: () => void
  onSave: (file: File) => void
}) {
  const { theme, initialUrl, onClose, onSave } = props
  const { t } = useTranslation()
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const strokeRef = React.useRef({ active: false, lastX: 0, lastY: 0 })
  const undoStackRef = React.useRef<string[]>([])
  const [tool, setTool] = React.useState<'pen' | 'eraser'>('pen')
  const [color, setColor] = React.useState(SWATCHES[0])
  const [strokeWidth, setStrokeWidth] = React.useState(6)
  const [saving, setSaving] = React.useState(false)
  const [canUndo, setCanUndo] = React.useState(false)

  const paintWhite = React.useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, BOARD_SIZE, BOARD_SIZE)
  }, [])

  // 初始化白板；已有绘图时载入为底图
  React.useEffect(() => {
    paintWhite()
    if (!initialUrl) return
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.addEventListener('load', () => {
      const ctx = canvasRef.current?.getContext('2d')
      if (!ctx) return
      const ratio = Math.min(
        BOARD_SIZE / image.naturalWidth,
        BOARD_SIZE / image.naturalHeight
      )
      const width = image.naturalWidth * ratio
      const height = image.naturalHeight * ratio
      ctx.drawImage(
        image,
        (BOARD_SIZE - width) / 2,
        (BOARD_SIZE - height) / 2,
        width,
        height
      )
    })
    image.src = initialUrl
  }, [initialUrl, paintWhite])

  const boardPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * BOARD_SIZE,
      y: ((event.clientY - rect.top) / rect.height) * BOARD_SIZE,
    }
  }

  const pushUndo = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    undoStackRef.current.push(canvas.toDataURL('image/png'))
    if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift()
    setCanUndo(true)
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    pushUndo()
    const point = boardPoint(event)
    strokeRef.current = { active: true, lastX: point.x, lastY: point.y }
    // 单击落点也画一个圆点
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = tool === 'eraser' ? '#ffffff' : color
    ctx.beginPath()
    ctx.arc(point.x, point.y, strokeWidth / 2, 0, Math.PI * 2)
    ctx.fill()
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = strokeRef.current
    if (!stroke.active) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const point = boardPoint(event)
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color
    ctx.lineWidth = tool === 'eraser' ? strokeWidth * 2.5 : strokeWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(stroke.lastX, stroke.lastY)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
    stroke.lastX = point.x
    stroke.lastY = point.y
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    strokeRef.current.active = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleUndo = () => {
    const snapshot = undoStackRef.current.pop()
    setCanUndo(undoStackRef.current.length > 0)
    if (!snapshot) return
    const image = new Image()
    image.addEventListener('load', () => {
      const ctx = canvasRef.current?.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, BOARD_SIZE, BOARD_SIZE)
      ctx.drawImage(image, 0, 0)
    })
    image.src = snapshot
  }

  const handleSave = async () => {
    const canvas = canvasRef.current
    if (!canvas || saving) return
    setSaving(true)
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      )
      if (blob) {
        onSave(
          new File([blob], `drawing-${Date.now()}.png`, { type: 'image/png' })
        )
      }
    } finally {
      setSaving(false)
    }
  }

  const toolButtonClass =
    'flex size-8 cursor-pointer items-center justify-center rounded-lg transition-colors'

  return (
    <CanvasModal
      theme={theme}
      title={t('Drawing')}
      onClose={onClose}
      width={820}
    >
      <div className='flex flex-col gap-3 p-4'>
        <div className='flex flex-wrap items-center gap-2'>
          <button
            type='button'
            className={toolButtonClass}
            style={{
              background:
                tool === 'pen' ? theme.accent.primary : theme.toolbar.itemHover,
              color: tool === 'pen' ? theme.accent.onPrimary : theme.node.muted,
            }}
            onClick={() => setTool('pen')}
            aria-label={t('Pen')}
            title={t('Pen')}
          >
            <Pencil aria-hidden='true' className='size-4' />
          </button>
          <button
            type='button'
            className={toolButtonClass}
            style={{
              background:
                tool === 'eraser'
                  ? theme.accent.primary
                  : theme.toolbar.itemHover,
              color:
                tool === 'eraser' ? theme.accent.onPrimary : theme.node.muted,
            }}
            onClick={() => setTool('eraser')}
            aria-label={t('Eraser')}
            title={t('Eraser')}
          >
            <Eraser aria-hidden='true' className='size-4' />
          </button>
          <span
            aria-hidden='true'
            className='mx-1 h-5 w-px'
            style={{ background: theme.toolbar.border }}
          />
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type='button'
              onClick={() => {
                setColor(swatch)
                setTool('pen')
              }}
              className='size-6 cursor-pointer rounded-full transition-transform hover:scale-110'
              style={{
                background: swatch,
                border:
                  color === swatch && tool === 'pen'
                    ? `2px solid ${theme.accent.primary}`
                    : `1px solid ${theme.toolbar.border}`,
                boxShadow:
                  color === swatch && tool === 'pen'
                    ? `0 0 0 2px ${theme.toolbar.panel}`
                    : undefined,
              }}
              aria-label={t('Color {{color}}', { color: swatch })}
              title={swatch}
            />
          ))}
          <span
            aria-hidden='true'
            className='mx-1 h-5 w-px'
            style={{ background: theme.toolbar.border }}
          />
          <label
            className='flex items-center gap-2 text-[11px]'
            style={{ color: theme.node.muted }}
          >
            {t('Brush size')}
            <input
              type='range'
              min={2}
              max={40}
              value={strokeWidth}
              onChange={(event) => setStrokeWidth(Number(event.target.value))}
              className='w-24 accent-current'
              aria-label={t('Brush size')}
            />
            <span className='w-6 tabular-nums'>{strokeWidth}</span>
          </label>
          <div className='ml-auto flex items-center gap-1.5'>
            <button
              type='button'
              disabled={!canUndo}
              onClick={handleUndo}
              className='flex size-8 cursor-pointer items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-35'
              style={{
                background: theme.toolbar.itemHover,
                color: theme.node.muted,
              }}
              aria-label={t('Undo stroke')}
              title={t('Undo stroke')}
            >
              <Undo2 aria-hidden='true' className='size-4' />
            </button>
            <button
              type='button'
              onClick={() => {
                pushUndo()
                paintWhite()
              }}
              className='flex size-8 cursor-pointer items-center justify-center rounded-lg transition-colors'
              style={{
                background: theme.toolbar.itemHover,
                color: theme.accent.danger,
              }}
              aria-label={t('Clear board')}
              title={t('Clear board')}
            >
              <Trash2 aria-hidden='true' className='size-4' />
            </button>
          </div>
        </div>

        <canvas
          ref={canvasRef}
          width={BOARD_SIZE}
          height={BOARD_SIZE}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className='aspect-square w-full cursor-crosshair rounded-xl'
          style={{
            border: `1px solid ${theme.toolbar.border}`,
            touchAction: 'none',
            background: '#ffffff',
          }}
          aria-label={t('Drawing board')}
        />

        <div className='flex justify-end gap-2'>
          <button
            type='button'
            onClick={onClose}
            className='h-9 cursor-pointer rounded-xl px-4 text-xs'
            style={{
              border: `1px solid ${theme.toolbar.border}`,
              color: theme.node.muted,
            }}
          >
            {t('Cancel')}
          </button>
          <button
            type='button'
            disabled={saving}
            onClick={() => void handleSave()}
            className='flex h-9 cursor-pointer items-center gap-1.5 rounded-xl px-4 text-xs font-medium disabled:opacity-50'
            style={{
              background: theme.accent.primary,
              color: theme.accent.onPrimary,
            }}
          >
            {saving ? (
              <Loader2 aria-hidden='true' className='size-3.5 animate-spin' />
            ) : (
              <Check aria-hidden='true' className='size-3.5' />
            )}
            {t('Save to node')}
          </button>
        </div>
      </div>
    </CanvasModal>
  )
}
