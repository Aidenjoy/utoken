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
// ===== 媒体处理对话框（移植 BeefTV 画面裁切 / 宫格拆分 / 关键帧截取，纯客户端 canvas 实现） =====

import { Loader2 } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import type { CanvasTheme } from '../canvas-theme'
import { CanvasModal } from './canvas-modal'

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.addEventListener('load', () => resolve(img), { once: true })
    img.addEventListener('error', () => reject(new Error('image load failed')), {
      once: true,
    })
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('canvas export failed'))
    }, 'image/png')
  })
}

const CROP_ASPECTS = [
  { key: 'free', label: 'Free', ratio: 0 },
  { key: '1:1', label: '1:1', ratio: 1 },
  { key: '16:9', label: '16:9', ratio: 16 / 9 },
  { key: '9:16', label: '9:16', ratio: 9 / 16 },
  { key: '4:3', label: '4:3', ratio: 4 / 3 },
]

interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export function CanvasCropDialog(props: {
  theme: CanvasTheme
  url: string
  onClose: () => void
  onApply: (blob: Blob) => void
}) {
  const { theme, url, onClose, onApply } = props
  const { t } = useTranslation()
  const [img, setImg] = React.useState<HTMLImageElement | null>(null)
  const [rect, setRect] = React.useState<CropRect | null>(null)
  const [busy, setBusy] = React.useState(false)
  const stageRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<{ startX: number; startY: number } | null>(null)

  React.useEffect(() => {
    let alive = true
    loadImage(url)
      .then((loaded) => {
        if (!alive) return
        setImg(loaded)
        setRect({ x: 0, y: 0, w: loaded.naturalWidth, h: loaded.naturalHeight })
      })
      .catch(() => onClose())
    return () => {
      alive = false
    }
  }, [url, onClose])

  const toNatural = (event: React.PointerEvent) => {
    const stage = stageRef.current
    if (!stage || !img) return { x: 0, y: 0 }
    const box = stage.getBoundingClientRect()
    const scale = img.naturalWidth / box.width
    return {
      x: (event.clientX - box.left) * scale,
      y: (event.clientY - box.top) * scale,
    }
  }

  const applyAspect = (ratio: number) => {
    if (!img) return
    const { naturalWidth: w, naturalHeight: h } = img
    if (!ratio) {
      setRect({ x: 0, y: 0, w, h })
      return
    }
    let cw = w
    let ch = w / ratio
    if (ch > h) {
      ch = h
      cw = h * ratio
    }
    setRect({ x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch })
  }

  const apply = async () => {
    if (!img || !rect || rect.w < 8 || rect.h < 8) return
    setBusy(true)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(rect.w)
      canvas.height = Math.round(rect.h)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(
        img,
        rect.x,
        rect.y,
        rect.w,
        rect.h,
        0,
        0,
        canvas.width,
        canvas.height
      )
      onApply(await canvasToBlob(canvas))
    } finally {
      setBusy(false)
    }
  }

  return (
    <CanvasModal theme={theme} title={t('Crop image')} onClose={onClose} width={680}>
      <div className='flex flex-col gap-3 p-4'>
        <div className='flex flex-wrap items-center gap-1.5'>
          {CROP_ASPECTS.map((aspect) => (
            <button
              key={aspect.key}
              type='button'
              onClick={() => applyAspect(aspect.ratio)}
              className='h-7 rounded-md px-2.5 text-[11px] font-medium'
              style={{
                border: `1px solid ${theme.node.stroke}`,
                color: theme.node.text,
              }}
              aria-label={t('Crop aspect {{ratio}}', { ratio: aspect.label })}
            >
              {aspect.label}
            </button>
          ))}
          <span
            className='ml-auto text-[11px] tabular-nums'
            style={{ color: theme.node.muted }}
          >
            {rect
              ? `${Math.round(rect.w)}×${Math.round(rect.h)}`
              : t('Loading...')}
          </span>
        </div>
        <div
          ref={stageRef}
          className='relative w-full cursor-crosshair overflow-hidden rounded-xl select-none'
          style={{ border: `1px solid ${theme.node.stroke}`, touchAction: 'none' }}
          onPointerDown={(event) => {
            if (!img) return
            event.currentTarget.setPointerCapture(event.pointerId)
            const point = toNatural(event)
            dragRef.current = { startX: point.x, startY: point.y }
            setRect({ x: point.x, y: point.y, w: 0, h: 0 })
          }}
          onPointerMove={(event) => {
            if (!dragRef.current || !img) return
            const point = toNatural(event)
            const { startX, startY } = dragRef.current
            setRect({
              x: Math.max(0, Math.min(startX, point.x)),
              y: Math.max(0, Math.min(startY, point.y)),
              w: Math.min(img.naturalWidth, Math.abs(point.x - startX)),
              h: Math.min(img.naturalHeight, Math.abs(point.y - startY)),
            })
          }}
          onPointerUp={() => {
            dragRef.current = null
          }}
        >
          {img ? (
            <img
              src={url}
              alt={t('Crop preview')}
              draggable={false}
              className='pointer-events-none block w-full'
            />
          ) : (
            <div className='flex h-64 items-center justify-center'>
              <Loader2
                aria-hidden='true'
                className='size-6 animate-spin'
                style={{ color: theme.accent.primary }}
              />
            </div>
          )}
          {img && rect && rect.w > 0 && rect.h > 0 && (
            <div
              className='pointer-events-none absolute'
              style={{
                left: `${(rect.x / img.naturalWidth) * 100}%`,
                top: `${(rect.y / img.naturalHeight) * 100}%`,
                width: `${(rect.w / img.naturalWidth) * 100}%`,
                height: `${(rect.h / img.naturalHeight) * 100}%`,
                border: `2px solid ${theme.accent.primary}`,
                boxShadow: '0 0 0 9999px rgba(0,0,0,.45)',
              }}
            />
          )}
        </div>
        <div className='flex justify-end gap-2'>
          <button
            type='button'
            onClick={onClose}
            className='h-8 rounded-lg px-3 text-xs'
            style={{ border: `1px solid ${theme.node.stroke}`, color: theme.node.muted }}
          >
            {t('Cancel')}
          </button>
          <button
            type='button'
            disabled={busy || !rect || rect.w < 8 || rect.h < 8}
            onClick={() => void apply()}
            className='flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium disabled:opacity-40'
            style={{ background: theme.accent.primary, color: theme.accent.onPrimary }}
            aria-label={t('Apply crop')}
          >
            {busy && <Loader2 aria-hidden='true' className='size-3.5 animate-spin' />}
            {t('Apply crop')}
          </button>
        </div>
      </div>
    </CanvasModal>
  )
}

export function CanvasSplitDialog(props: {
  theme: CanvasTheme
  url: string
  onClose: () => void
  onApply: (blobs: Blob[]) => void
}) {
  const { theme, url, onClose, onApply } = props
  const { t } = useTranslation()
  const [grid, setGrid] = React.useState(2)
  const [img, setImg] = React.useState<HTMLImageElement | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    loadImage(url)
      .then((loaded) => alive && setImg(loaded))
      .catch(() => onClose())
    return () => {
      alive = false
    }
  }, [url, onClose])

  const apply = async () => {
    if (!img) return
    setBusy(true)
    try {
      const cellW = Math.floor(img.naturalWidth / grid)
      const cellH = Math.floor(img.naturalHeight / grid)
      const blobs: Blob[] = []
      for (let row = 0; row < grid; row++) {
        for (let col = 0; col < grid; col++) {
          const canvas = document.createElement('canvas')
          canvas.width = cellW
          canvas.height = cellH
          const ctx = canvas.getContext('2d')
          if (!ctx) continue
          ctx.drawImage(
            img,
            col * cellW,
            row * cellH,
            cellW,
            cellH,
            0,
            0,
            cellW,
            cellH
          )
          blobs.push(await canvasToBlob(canvas))
        }
      }
      onApply(blobs)
    } finally {
      setBusy(false)
    }
  }

  return (
    <CanvasModal theme={theme} title={t('Split into grid')} onClose={onClose} width={620}>
      <div className='flex flex-col gap-3 p-4'>
        <div className='flex items-center gap-1.5'>
          {[2, 3, 4].map((size) => (
            <button
              key={size}
              type='button'
              onClick={() => setGrid(size)}
              className='h-7 rounded-md px-2.5 text-[11px] font-medium'
              style={{
                border: `1px solid ${grid === size ? theme.accent.primary : theme.node.stroke}`,
                color: grid === size ? theme.accent.primary : theme.node.text,
              }}
              aria-label={t('{{size}}×{{size}} grid', { size })}
            >
              {size}×{size}
            </button>
          ))}
          <span className='ml-auto text-[11px]' style={{ color: theme.node.muted }}>
            {t('{{count}} pieces', { count: grid * grid })}
          </span>
        </div>
        <div
          className='relative w-full overflow-hidden rounded-xl'
          style={{ border: `1px solid ${theme.node.stroke}` }}
        >
          {img ? (
            <img
              src={url}
              alt={t('Split preview')}
              draggable={false}
              className='block w-full'
            />
          ) : (
            <div className='flex h-64 items-center justify-center'>
              <Loader2
                aria-hidden='true'
                className='size-6 animate-spin'
                style={{ color: theme.accent.primary }}
              />
            </div>
          )}
          <div
            aria-hidden='true'
            className='pointer-events-none absolute inset-0'
            style={{
              backgroundImage: `linear-gradient(${theme.accent.primary} 1.5px, transparent 1.5px), linear-gradient(90deg, ${theme.accent.primary} 1.5px, transparent 1.5px)`,
              backgroundSize: `${100 / grid}% ${100 / grid}%`,
            }}
          />
        </div>
        <div className='flex justify-end gap-2'>
          <button
            type='button'
            onClick={onClose}
            className='h-8 rounded-lg px-3 text-xs'
            style={{ border: `1px solid ${theme.node.stroke}`, color: theme.node.muted }}
          >
            {t('Cancel')}
          </button>
          <button
            type='button'
            disabled={busy || !img}
            onClick={() => void apply()}
            className='flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium disabled:opacity-40'
            style={{ background: theme.accent.primary, color: theme.accent.onPrimary }}
            aria-label={t('Apply split')}
          >
            {busy && <Loader2 aria-hidden='true' className='size-3.5 animate-spin' />}
            {t('Apply split')}
          </button>
        </div>
      </div>
    </CanvasModal>
  )
}

export function CanvasFrameDialog(props: {
  theme: CanvasTheme
  url: string
  onClose: () => void
  onApply: (blob: Blob) => void
}) {
  const { theme, url, onClose, onApply } = props
  const { t } = useTranslation()
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const [duration, setDuration] = React.useState(0)
  const [time, setTime] = React.useState(0)
  const [busy, setBusy] = React.useState(false)

  const seekTo = (target: number): Promise<void> => {
    const video = videoRef.current
    if (!video) return Promise.resolve()
    return new Promise((resolve) => {
      const done = () => {
        video.removeEventListener('seeked', done)
        setTime(video.currentTime)
        resolve()
      }
      video.addEventListener('seeked', done)
      video.currentTime = Math.max(0, Math.min(target, video.duration || 0))
    })
  }

  const capture = async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    setBusy(true)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      onApply(await canvasToBlob(canvas))
    } finally {
      setBusy(false)
    }
  }

  return (
    <CanvasModal theme={theme} title={t('Extract frame')} onClose={onClose} width={680}>
      <div className='flex flex-col gap-3 p-4'>
        <video
          ref={videoRef}
          src={url}
          playsInline
          muted
          preload='auto'
          crossOrigin='anonymous'
          className='max-h-[46vh] w-full rounded-xl bg-black object-contain'
          style={{ border: `1px solid ${theme.node.stroke}` }}
          onLoadedMetadata={(event) => {
            setDuration(event.currentTarget.duration || 0)
          }}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        />
        <input
          type='range'
          min={0}
          max={Math.max(duration, 0.1)}
          step={0.05}
          value={time}
          onChange={(event) => void seekTo(Number(event.target.value))}
          className='w-full'
          aria-label={t('Frame position')}
        />
        <div className='flex flex-wrap items-center gap-1.5'>
          <button
            type='button'
            onClick={() => void seekTo(0)}
            className='h-7 rounded-md px-2.5 text-[11px]'
            style={{ border: `1px solid ${theme.node.stroke}`, color: theme.node.text }}
            aria-label={t('First frame')}
          >
            {t('First frame')}
          </button>
          <button
            type='button'
            onClick={() => void seekTo(duration - 0.05)}
            className='h-7 rounded-md px-2.5 text-[11px]'
            style={{ border: `1px solid ${theme.node.stroke}`, color: theme.node.text }}
            aria-label={t('Last frame')}
          >
            {t('Last frame')}
          </button>
          <span className='ml-auto text-[11px] tabular-nums' style={{ color: theme.node.muted }}>
            {time.toFixed(2)}s / {duration.toFixed(2)}s
          </span>
        </div>
        <div className='flex justify-end gap-2'>
          <button
            type='button'
            onClick={onClose}
            className='h-8 rounded-lg px-3 text-xs'
            style={{ border: `1px solid ${theme.node.stroke}`, color: theme.node.muted }}
          >
            {t('Cancel')}
          </button>
          <button
            type='button'
            disabled={busy || !duration}
            onClick={() => void capture()}
            className='flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium disabled:opacity-40'
            style={{ background: theme.accent.primary, color: theme.accent.onPrimary }}
            aria-label={t('Save current frame as image node')}
          >
            {busy && <Loader2 aria-hidden='true' className='size-3.5 animate-spin' />}
            {t('Save current frame as image node')}
          </button>
        </div>
      </div>
    </CanvasModal>
  )
}