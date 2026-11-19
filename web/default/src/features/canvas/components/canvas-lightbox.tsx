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
  Columns2,
  Download,
  Info,
  ZoomIn,
  ZoomOut,
  X,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import type { CanvasNode } from '../types'

// ===== 全景预览 Lightbox（移植 BeefTV image viewer：缩放/平移/信息侧栏/历史版本对比） =====

const MIN_ZOOM = 0.2
const MAX_ZOOM = 8

export function CanvasLightbox(props: {
  node: CanvasNode
  onClose: () => void
}) {
  const { node, onClose } = props
  const { t } = useTranslation()
  const [zoom, setZoom] = React.useState(1)
  const [offset, setOffset] = React.useState({ x: 0, y: 0 })
  const [showInfo, setShowInfo] = React.useState(false)
  const [compareIndex, setCompareIndex] = React.useState<number | null>(null)
  const stageRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

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

  // 滚轮缩放（capture + passive:false，围绕视口中心）
  React.useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      setZoom((prev) =>
        Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev * (event.deltaY > 0 ? 1 / 1.15 : 1.15)))
      )
    }
    stage.addEventListener('wheel', handleWheel, { passive: false })
    return () => stage.removeEventListener('wheel', handleWheel)
  }, [])

  const url = node.metadata.url
  const history = node.metadata.history ?? []
  if (!url) return null
  const isVideo = node.type === 'video'
  const isAudio = node.type === 'audio'
  const isImage = !isVideo && !isAudio
  const compareEntry =
    compareIndex !== null ? history[compareIndex] : undefined

  const resetView = () => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }

  const mediaElement = (src: string, label?: string) => {
    let media: React.ReactNode
    if (isVideo) {
      media = (
        <video
          src={src}
          controls
          autoPlay={!label}
          playsInline
          className='max-h-full max-w-full rounded-xl'
        />
      )
    } else if (isAudio) {
      media = (
        <audio src={src} controls autoPlay={!label} className='w-full max-w-md' />
      )
    } else {
      media = (
        <img
          src={src}
          alt={label ?? node.title}
          draggable={false}
          className='max-h-full max-w-full rounded-xl object-contain'
          style={
            label
              ? undefined
              : {
                  transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                }
          }
        />
      )
    }
    return (
      <div className='relative flex min-h-0 min-w-0 flex-1 items-center justify-center'>
        {media}
        {label && (
          <span className='absolute top-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-[10px] text-white'>
            {label}
          </span>
        )}
      </div>
    )
  }

  const infoRows: { label: string; value: string }[] = []
  if (node.metadata.prompt) {
    infoRows.push({ label: t('Prompt'), value: node.metadata.prompt })
  }
  if (node.metadata.size) infoRows.push({ label: t('Image size'), value: node.metadata.size })
  if (node.metadata.aspectRatio) {
    infoRows.push({ label: t('Aspect ratio'), value: node.metadata.aspectRatio })
  }
  if (node.metadata.resolution) {
    infoRows.push({ label: t('Resolution'), value: node.metadata.resolution })
  }
  if (node.metadata.duration) {
    infoRows.push({ label: t('Duration'), value: `${node.metadata.duration}s` })
  }
  if (node.metadata.naturalWidth) {
    infoRows.push({
      label: t('Pixels'),
      value: `${node.metadata.naturalWidth}×${node.metadata.naturalHeight}`,
    })
  }
  if (node.metadata.generationId) {
    infoRows.push({
      label: t('Generation ID'),
      value: String(node.metadata.generationId),
    })
  }
  infoRows.push({ label: t('Status'), value: t(node.metadata.status ?? 'idle') })

  return (
    <div
      data-canvas-no-zoom
      className='fixed inset-0 z-[125] flex flex-col items-center gap-3 p-6'
      style={{ background: 'rgba(0,0,0,.88)', backdropFilter: 'blur(6px)' }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClose}
      role='dialog'
      aria-modal='true'
      aria-label={t('Fullscreen preview')}
    >
      <div
        className='flex w-full max-w-6xl items-center gap-2'
        onClick={(event) => event.stopPropagation()}
      >
        <p className='min-w-0 flex-1 truncate text-sm font-medium text-white'>
          {node.title}
        </p>
        {isImage && (
          <>
            <button
              type='button'
              onClick={() => setZoom((prev) => Math.min(MAX_ZOOM, prev * 1.25))}
              className='flex size-8 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20'
              aria-label={t('Zoom in')}
              title={t('Zoom in')}
            >
              <ZoomIn aria-hidden='true' className='size-4' />
            </button>
            <button
              type='button'
              onClick={() => setZoom((prev) => Math.max(MIN_ZOOM, prev / 1.25))}
              className='flex size-8 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20'
              aria-label={t('Zoom out')}
              title={t('Zoom out')}
            >
              <ZoomOut aria-hidden='true' className='size-4' />
            </button>
            <button
              type='button'
              onClick={resetView}
              className='h-8 rounded-lg bg-white/10 px-2 text-[11px] text-white tabular-nums transition-colors hover:bg-white/20'
              aria-label={t('Reset zoom')}
              title={t('Reset zoom')}
            >
              {Math.round(zoom * 100)}%
            </button>
          </>
        )}
        {history.length > 1 && (
          <button
            type='button'
            onClick={() =>
              setCompareIndex((prev) =>
                prev === null ? Math.max(0, history.length - 2) : null
              )
            }
            className='flex size-8 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20'
            style={compareIndex !== null ? { background: 'rgba(255,255,255,.3)' } : undefined}
            aria-label={t('Compare versions')}
            title={t('Compare versions')}
          >
            <Columns2 aria-hidden='true' className='size-4' />
          </button>
        )}
        <button
          type='button'
          onClick={() => setShowInfo((prev) => !prev)}
          className='flex size-8 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20'
          style={showInfo ? { background: 'rgba(255,255,255,.3)' } : undefined}
          aria-label={t('Node information')}
          title={t('Node information')}
        >
          <Info aria-hidden='true' className='size-4' />
        </button>
        <a
          href={url}
          download
          target='_blank'
          rel='noreferrer'
          className='flex size-8 items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20'
          aria-label={t('Download')}
          title={t('Download')}
        >
          <Download aria-hidden='true' className='size-4' />
        </a>
        <button
          type='button'
          onClick={onClose}
          className='flex size-8 cursor-pointer items-center justify-center rounded-lg bg-white/10 text-white transition-colors hover:bg-white/20'
          aria-label={t('Close')}
          title={t('Close')}
        >
          <X aria-hidden='true' className='size-4' />
        </button>
      </div>
      <div
        className='flex min-h-0 w-full max-w-6xl flex-1 gap-3'
        onClick={(event) => event.stopPropagation()}
      >
        <div
          ref={stageRef}
          className='flex min-h-0 min-w-0 flex-1 items-center justify-center gap-3 overflow-hidden'
          style={{ cursor: isImage && zoom > 1 ? 'grab' : 'default', touchAction: 'none' }}
          onPointerDown={(event) => {
            if (!isImage || zoom <= 1 || compareEntry) return
            event.currentTarget.setPointerCapture(event.pointerId)
            dragRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              originX: offset.x,
              originY: offset.y,
            }
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current
            if (!drag || drag.pointerId !== event.pointerId) return
            setOffset({
              x: drag.originX + event.clientX - drag.startX,
              y: drag.originY + event.clientY - drag.startY,
            })
          }}
          onPointerUp={() => {
            dragRef.current = null
          }}
          onDoubleClick={() => {
            if (!isImage) return
            if (zoom > 1) resetView()
            else setZoom(2.5)
          }}
        >
          {compareEntry
            ? [
                mediaElement(compareEntry.url, t('Version {{n}}', { n: (compareIndex ?? 0) + 1 })),
                mediaElement(url, t('Current version')),
              ]
            : mediaElement(url)}
        </div>
        {showInfo && (
          <aside
            className='canvas-scroll w-72 shrink-0 overflow-y-auto rounded-xl p-3'
            style={{ background: 'rgba(255,255,255,.08)' }}
            aria-label={t('Node information')}
          >
            <p className='mb-2 text-[11px] font-semibold tracking-wide text-white/60 uppercase'>
              {t('Node information')}
            </p>
            <div className='flex flex-col gap-2.5'>
              {infoRows.map((row) => (
                <div key={row.label}>
                  <p className='text-[10px] text-white/50'>{row.label}</p>
                  <p className='text-xs leading-relaxed break-words text-white'>
                    {row.value}
                  </p>
                </div>
              ))}
              {history.length > 0 && (
                <div>
                  <p className='mb-1 text-[10px] text-white/50'>
                    {t('Generation history')}
                  </p>
                  <div className='flex flex-wrap gap-1.5'>
                    {history.map((entry, index) => (
                      <button
                        key={entry.id}
                        type='button'
                        onClick={() => setCompareIndex(index)}
                        className='size-12 overflow-hidden rounded-md'
                        style={{
                          border: `2px solid ${
                            compareIndex === index ? '#fff' : 'transparent'
                          }`,
                        }}
                        aria-label={t('Version {{n}}', { n: index + 1 })}
                        title={entry.prompt}
                      >
                        <img
                          src={entry.url}
                          alt=''
                          draggable={false}
                          className='size-full object-cover'
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}