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
import { MessageSquareText, Repeat, Scissors, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

import type { DirectorStoryboard } from '../types'
import {
  clipSpans,
  defaultSubtitle,
  findSpanAt,
  fmtTime,
  sliderNumber,
  totalDuration,
  type ClipSpan,
  type EditSelection,
  type EditTimelineData,
} from './edit-utils'

// 播放头/刻度左偏：canvas padding 8px + 轨道标签列 40px
const TL_OFFSET = 48

interface EditTimelineProps {
  tl: EditTimelineData
  storyboards: DirectorStoryboard[]
  currentTime: number
  selected: EditSelection
  videoDurations: Record<string, number>
  onSeek: (t: number) => void
  onSelect: (sel: EditSelection) => void
  onChange: (mutate: (tl: EditTimelineData) => void) => void
}

export function EditTimeline(props: EditTimelineProps) {
  const { t } = useTranslation()
  const { tl, currentTime, selected } = props

  const [pxPerSec, setPxPerSec] = React.useState(20)
  const canvasRef = React.useRef<HTMLDivElement>(null)

  const spans = React.useMemo(() => clipSpans(tl.clips), [tl.clips])
  const total = React.useMemo(() => totalDuration(tl.clips), [tl.clips])
  const canvasWidth = Math.max(total * pxPerSec + 240, 600)

  // 标尺刻度：缩放越细刻度越密
  const ticks = React.useMemo(() => {
    let step = 10
    let majorEvery = 30
    if (pxPerSec >= 80) {
      step = 1
      majorEvery = 5
    } else if (pxPerSec >= 40) {
      step = 2
      majorEvery = 10
    } else if (pxPerSec >= 25) {
      step = 5
      majorEvery = 15
    }
    const list: { t: number; major: boolean }[] = []
    for (let time = 0; time <= Math.ceil(total) + step; time += step) {
      list.push({ t: time, major: time % majorEvery === 0 })
    }
    return list
  }, [pxPerSec, total])

  const storyboardNo = (clip: { storyboardId: number }) => {
    const sb = props.storyboards.find((s) => s.id === clip.storyboardId)
    return sb ? sb.storyboardNumber : '?'
  }

  const isSelected = (type: EditSelection['type'], index: number) =>
    selected.type === type && selected.index === index
  const select = (type: EditSelection['type'], index: number) =>
    props.onSelect({ type, index })

  // ---------- 播放头 / seek ----------

  const seekFromEvent = (e: React.MouseEvent | MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left - TL_OFFSET
    const time = Math.min(Math.max(x / pxPerSec, 0), total)
    props.onSeek(time)
  }

  const onSeekMouseDown = (e: React.MouseEvent) => {
    seekFromEvent(e)
    const move = (ev: MouseEvent) => seekFromEvent(ev)
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // ---------- 分割 / 删除 / 添加字幕 ----------

  const playheadSpan = findSpanAt(spans, currentTime)
  const splitOffset = playheadSpan ? currentTime - playheadSpan.tlStart : 0
  const canSplit =
    playheadSpan != null &&
    splitOffset > 0.05 &&
    splitOffset < playheadSpan.tlEnd - playheadSpan.tlStart - 0.05

  // 在播放头处把片段一分为二：转场留在后半段（表示与下一片段的过渡）
  const splitAtPlayhead = () => {
    const span = playheadSpan
    if (!span || !canSplit) return
    const speed = span.clip.speed > 0 ? span.clip.speed : 1
    const cut = span.clip.start + (currentTime - span.tlStart) * speed
    props.onChange((data) => {
      const clip = data.clips[span.index]
      if (!clip) return
      const first = {
        ...clip,
        transition: { type: '', duration: 0.5 },
        crop: clip.crop ? { ...clip.crop } : null,
        filter: { ...clip.filter },
        end: cut,
      }
      const second = {
        ...clip,
        transition: { ...clip.transition },
        crop: clip.crop ? { ...clip.crop } : null,
        filter: { ...clip.filter },
        start: cut,
      }
      data.clips.splice(span.index, 1, first, second)
    })
    props.onSelect({ type: 'clip', index: span.index })
  }

  const removeSelected = () => {
    const { type, index } = selected
    if (index < 0) return
    props.onChange((data) => {
      if (type === 'clip') data.clips.splice(index, 1)
      else if (type === 'subtitle') data.subtitles.splice(index, 1)
      else if (type === 'sticker') data.stickers.splice(index, 1)
    })
    props.onSelect({ type: '', index: -1 })
  }

  const addSubtitleAtPlayhead = () => {
    let newIndex = 0
    props.onChange((data) => {
      data.subtitles.push(
        defaultSubtitle({ start: currentTime, end: currentTime + 2 })
      )
      newIndex = data.subtitles.length - 1
    })
    props.onSelect({ type: 'subtitle', index: newIndex })
  }

  // ---------- 片段边缘裁剪（入点/出点） ----------

  const onTrimStart = (
    e: React.MouseEvent,
    span: ClipSpan,
    edge: 'left' | 'right'
  ) => {
    e.preventDefault()
    e.stopPropagation()
    const clip = span.clip
    const speed = clip.speed > 0 ? clip.speed : 1
    const srcDur = props.videoDurations[clip.srcUrl] || Infinity
    const startX = e.clientX
    const origStart = clip.start
    const origEnd = clip.end
    select('clip', span.index)

    const move = (ev: MouseEvent) => {
      const deltaSrc = ((ev.clientX - startX) / pxPerSec) * speed
      props.onChange((data) => {
        const target = data.clips[span.index]
        if (!target) return
        if (edge === 'left') {
          target.start = Math.min(
            Math.max(origStart + deltaSrc, 0),
            origEnd - 0.1
          )
        } else {
          target.end = Math.max(
            Math.min(origEnd + deltaSrc, srcDur),
            origStart + 0.1
          )
        }
      })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // ---------- 片段拖拽排序 ----------

  const [dragIndex, setDragIndex] = React.useState(-1)
  const [dragOverIndex, setDragOverIndex] = React.useState(-1)

  const onDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault()
    const from = dragIndex
    setDragIndex(-1)
    setDragOverIndex(-1)
    if (from < 0 || from === targetIndex) return
    // 鼠标落在目标块右半则插到其后
    const rect = e.currentTarget.getBoundingClientRect()
    let to = e.clientX > rect.left + rect.width / 2 ? targetIndex + 1 : targetIndex
    if (from < to) to--
    props.onChange((data) => {
      const [moved] = data.clips.splice(from, 1)
      data.clips.splice(to, 0, moved)
    })
    props.onSelect({ type: 'clip', index: to })
    toast.success(t('Clip order updated'))
  }

  return (
    <div className='flex flex-col gap-2'>
      {/* 工具行：分割/删除/加字幕/缩放 */}
      <div className='flex items-center gap-2'>
        <Button size='sm' variant='outline' disabled={!canSplit} onClick={splitAtPlayhead}>
          <Scissors aria-hidden='true' />
          {t('Split')}
        </Button>
        <Button
          size='sm'
          variant='outline'
          disabled={selected.index < 0}
          onClick={removeSelected}
        >
          <Trash2 aria-hidden='true' />
          {t('Delete')}
        </Button>
        <Button size='sm' variant='outline' onClick={addSubtitleAtPlayhead}>
          <MessageSquareText aria-hidden='true' />
          {t('Add Subtitle')}
        </Button>
        <span className='text-muted-foreground ml-2 text-xs'>
          {t('Total Duration')} {fmtTime(total)}
        </span>
        <div className='flex-1' />
        <span className='text-muted-foreground text-xs'>{t('Zoom')}</span>
        <Slider
          className='w-36'
          min={20}
          max={200}
          step={10}
          value={[pxPerSec]}
          onValueChange={(v) => setPxPerSec(sliderNumber(v))}
          aria-label={t('Zoom')}
        />
      </div>

      <div className='bg-muted/40 overflow-x-auto rounded-lg border'>
        <div
          ref={canvasRef}
          className='relative p-2 pt-1 pb-2 select-none'
          style={{ width: canvasWidth }}
        >
          {/* 标尺 */}
          <div
            className='relative ml-10 h-5.5 cursor-pointer'
            onMouseDown={onSeekMouseDown}
          >
            {ticks.map((tick) => (
              <div
                key={tick.t}
                className={cn(
                  'bg-border absolute bottom-0 w-px',
                  tick.major ? 'h-2.5' : 'h-1.5'
                )}
                style={{ left: tick.t * pxPerSec }}
              >
                {tick.major && (
                  <span className='text-muted-foreground absolute bottom-2.5 left-0.5 text-[10px] whitespace-nowrap'>
                    {fmtTime(tick.t)}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* 片段轨 */}
          <TrackRow label={t('Clips')}>
            <div className='relative h-11 flex-1 cursor-pointer overflow-hidden rounded-r-md border border-l-0 bg-background' onMouseDown={onSeekMouseDown}>
              {spans.map((span) => (
                <div
                  key={span.index}
                  draggable
                  onDragStart={(e) => {
                    setDragIndex(span.index)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnd={() => {
                    setDragIndex(-1)
                    setDragOverIndex(-1)
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOverIndex(span.index)
                  }}
                  onDragLeave={() => setDragOverIndex(-1)}
                  onDrop={(e) => onDrop(e, span.index)}
                  onClick={(e) => {
                    e.stopPropagation()
                    select('clip', span.index)
                  }}
                  className={cn(
                    'border-primary/40 bg-primary/10 absolute top-0.75 bottom-0.75 flex cursor-grab items-center overflow-hidden rounded-md border',
                    isSelected('clip', span.index) &&
                      'border-primary ring-primary bg-primary/20 ring-1',
                    dragIndex === span.index && 'opacity-40',
                    dragOverIndex === span.index && 'border-emerald-500'
                  )}
                  style={{
                    left: span.tlStart * pxPerSec,
                    width: Math.max((span.tlEnd - span.tlStart) * pxPerSec, 14),
                  }}
                >
                  <div
                    className='absolute top-0 bottom-0 left-0 z-2 w-2 cursor-ew-resize rounded-l-md hover:bg-primary/50'
                    onMouseDown={(e) => onTrimStart(e, span, 'left')}
                  />
                  <div className='text-primary pointer-events-none flex items-center gap-1 px-2.5 text-[11px] whitespace-nowrap'>
                    <span className='font-semibold'>
                      {span.clip.storyboardId
                        ? `#${storyboardNo(span.clip)}`
                        : t('Replaced')}
                    </span>
                    <span className='text-muted-foreground'>
                      {(span.tlEnd - span.tlStart).toFixed(1)}s
                    </span>
                    {span.clip.speed !== 1 && (
                      <span className='rounded bg-black/10 px-0.75 text-[10px]'>
                        {span.clip.speed}x
                      </span>
                    )}
                    {span.clip.muted && (
                      <span className='rounded bg-black/10 px-0.75 text-[10px]'>
                        {t('Muted')}
                      </span>
                    )}
                  </div>
                  {span.clip.transition.type &&
                    span.index < tl.clips.length - 1 && (
                      <div
                        className='bg-amber-500 absolute top-1/2 -right-px z-1 flex size-3.5 -translate-y-1/2 items-center justify-center rounded-full text-white'
                        title={`${t('Transition')} ${span.clip.transition.duration}s`}
                      >
                        <Repeat aria-hidden='true' className='size-2.5' />
                      </div>
                    )}
                  <div
                    className='absolute top-0 right-0 bottom-0 z-2 w-2 cursor-ew-resize rounded-r-md hover:bg-primary/50'
                    onMouseDown={(e) => onTrimStart(e, span, 'right')}
                  />
                </div>
              ))}
              {tl.clips.length === 0 && (
                <span className='text-muted-foreground absolute top-3.5 left-3 text-xs'>
                  {t('No clips')}
                </span>
              )}
            </div>
          </TrackRow>

          {/* 字幕轨 */}
          <TrackRow label={t('Subtitles')}>
            <div className='relative h-11 flex-1 cursor-pointer overflow-hidden rounded-r-md border border-l-0 bg-background' onMouseDown={onSeekMouseDown}>
              {tl.subtitles.map((sub, i) => (
                <div
                  key={`sub-${sub.start}-${sub.end}-${sub.text}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    select('subtitle', i)
                  }}
                  className={cn(
                    'border-emerald-300 bg-emerald-100 text-emerald-900 absolute top-1.5 bottom-1.5 flex items-center overflow-hidden rounded-md border px-2 text-[11px] whitespace-nowrap text-ellipsis',
                    isSelected('subtitle', i) &&
                      'border-emerald-500 ring-emerald-500 ring-1'
                  )}
                  style={{
                    left: sub.start * pxPerSec,
                    width: Math.max((sub.end - sub.start) * pxPerSec, 14),
                  }}
                >
                  {sub.text || t('Empty subtitle')}
                </div>
              ))}
            </div>
          </TrackRow>

          {/* 贴纸轨 */}
          <TrackRow label={t('Stickers')}>
            <div className='relative h-11 flex-1 cursor-pointer overflow-hidden rounded-r-md border border-l-0 bg-background' onMouseDown={onSeekMouseDown}>
              {tl.stickers.map((sticker, i) => (
                <div
                  key={`stk-${sticker.url}-${sticker.start}-${sticker.end}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    select('sticker', i)
                  }}
                  className={cn(
                    'border-amber-300 bg-amber-100 text-amber-900 absolute top-1.5 bottom-1.5 flex items-center overflow-hidden rounded-md border px-2 text-[11px] whitespace-nowrap text-ellipsis',
                    isSelected('sticker', i) && 'border-amber-500 ring-amber-500 ring-1'
                  )}
                  style={{
                    left: sticker.start * pxPerSec,
                    width: Math.max((sticker.end - sticker.start) * pxPerSec, 14),
                  }}
                >
                  {t('Sticker')} {i + 1}
                </div>
              ))}
            </div>
          </TrackRow>

          {/* 播放头 */}
          <div
            className='bg-destructive pointer-events-none absolute top-0 bottom-0 z-5 w-px'
            style={{ left: `${TL_OFFSET + currentTime * pxPerSec}px` }}
          >
            <div
              className='bg-destructive absolute top-0 -left-1.5 h-4 w-3.5 cursor-ew-resize rounded-b-md pointer-events-auto'
              onMouseDown={onSeekMouseDown}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function TrackRow(props: { label: string; children: React.ReactNode }) {
  return (
    <div className='mt-1 flex items-stretch'>
      <div className='text-muted-foreground bg-muted flex w-10 shrink-0 items-center justify-center rounded-l-md text-xs'>
        {props.label}
      </div>
      {props.children}
    </div>
  )
}
