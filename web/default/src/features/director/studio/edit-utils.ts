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
// 在线剪辑时间轴工具函数与常量。
// 数据结构与后端 service/director/edit.go 的 editTimeline 约定一致，保存时整体 JSON 序列化。

export interface EditFilter {
  brightness: number
  contrast: number
  saturation: number
  temperature: number
  preset: string
  sharpen: boolean
}

export interface EditTransition {
  type: string
  duration: number
}

export interface EditCrop {
  x: number
  y: number
  w: number
  h: number
}

export interface EditClip {
  storyboardId: number
  srcUrl: string
  start: number
  end: number
  speed: number
  volume: number
  muted: boolean
  transition: EditTransition
  rotate: number
  flip: string
  crop: EditCrop | null
  filter: EditFilter
}

export interface EditSubtitleStyle {
  fontFamily: string
  fontSize: number
  color: string
  position: string
  animation: string
}

export interface EditSubtitle {
  text: string
  start: number
  end: number
  style: EditSubtitleStyle
}

export interface EditAudio {
  bgmUrl: string
  bgmVolume: number
  voiceVolume: number
}

export interface EditSticker {
  url: string
  x: number
  y: number
  width: number
  start: number
  end: number
}

export interface EditTimelineData {
  clips: EditClip[]
  subtitles: EditSubtitle[]
  audio: EditAudio
  stickers: EditSticker[]
  aspectRatio: string
}

export interface ClipSpan {
  clip: EditClip
  index: number
  tlStart: number
  tlEnd: number
}

// 时间轴/属性面板共享的选中对象
export interface EditSelection {
  type: '' | 'clip' | 'subtitle' | 'sticker'
  index: number
}

// ---------- 默认值工厂 ----------

export function defaultFilter(over?: Partial<EditFilter>): EditFilter {
  return {
    brightness: 0,
    contrast: 1,
    saturation: 1,
    temperature: 0,
    preset: '',
    sharpen: false,
    ...over,
  }
}

export function defaultClip(over?: Partial<EditClip>): EditClip {
  return {
    storyboardId: 0,
    srcUrl: '',
    start: 0,
    end: 5,
    speed: 1,
    volume: 1,
    muted: false,
    transition: { type: '', duration: 0.5 },
    rotate: 0,
    flip: '',
    crop: null,
    filter: defaultFilter(),
    ...over,
  }
}

export function defaultSubtitleStyle(
  over?: Partial<EditSubtitleStyle>
): EditSubtitleStyle {
  return {
    fontFamily: '',
    fontSize: 34,
    color: '#ffffff',
    position: 'bottom',
    animation: '',
    ...over,
  }
}

export function defaultSubtitle(over?: Partial<EditSubtitle>): EditSubtitle {
  return {
    text: '',
    start: 0,
    end: 2,
    style: defaultSubtitleStyle(),
    ...over,
  }
}

export function defaultAudio(over?: Partial<EditAudio>): EditAudio {
  return { bgmUrl: '', bgmVolume: 0.8, voiceVolume: 1, ...over }
}

export function defaultSticker(over?: Partial<EditSticker>): EditSticker {
  return { url: '', x: 40, y: 40, width: 160, start: 0, end: 3, ...over }
}

export function emptyTimeline(): EditTimelineData {
  return {
    clips: [],
    subtitles: [],
    audio: defaultAudio(),
    stickers: [],
    aspectRatio: '',
  }
}

// 从接口/本地恢复的片段可能缺字段，补全默认值（深拷贝断引用）
export function normalizeClip(raw: Partial<EditClip> = {}): EditClip {
  return defaultClip({
    ...raw,
    transition: { type: '', duration: 0.5, ...raw.transition },
    crop: raw.crop ? { ...raw.crop } : null,
    filter: defaultFilter(raw.filter),
  })
}

export function normalizeSubtitle(
  raw: Partial<EditSubtitle> = {}
): EditSubtitle {
  return defaultSubtitle({
    ...raw,
    style: defaultSubtitleStyle(raw.style),
  })
}

export function parseTimeline(raw: string): EditTimelineData | null {
  const text = raw?.trim()
  if (!text || text === 'null') return null
  try {
    let parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'string') parsed = JSON.parse(parsed)
    const data = parsed as Partial<EditTimelineData>
    const clips = (data.clips ?? []).map(normalizeClip)
    return {
      clips,
      subtitles: (data.subtitles ?? []).map(normalizeSubtitle),
      audio: defaultAudio(data.audio),
      stickers: (data.stickers ?? []).map((s) => defaultSticker(s)),
      aspectRatio: data.aspectRatio ?? '',
    }
  } catch {
    return null
  }
}

// ---------- 时长计算 ----------

// 片段在时间轴上的实际时长（裁剪长度 / 变速倍率）
export function clipDuration(clip: EditClip): number {
  const speed = clip.speed > 0 ? clip.speed : 1
  return Math.max(0, (clip.end - clip.start) / speed)
}

// 各片段在时间轴上的区间
export function clipSpans(clips: EditClip[]): ClipSpan[] {
  let acc = 0
  return clips.map((clip, index) => {
    const dur = clipDuration(clip)
    const span = { clip, index, tlStart: acc, tlEnd: acc + dur }
    acc += dur
    return span
  })
}

export function totalDuration(clips: EditClip[]): number {
  return clipSpans(clips).reduce((sum, s) => sum + (s.tlEnd - s.tlStart), 0)
}

// 时间轴时间所在片段区间（末尾边界归入最后一片）
export function findSpanAt(spans: ClipSpan[], t: number): ClipSpan | null {
  if (spans.length === 0) return null
  const hit = spans.find((s) => t >= s.tlStart && t < s.tlEnd)
  if (hit) return hit
  const last = spans.at(-1)
  return last && t >= last.tlEnd ? last : spans[0]
}

// ---------- 展示格式化 ----------

// 秒 → mm:ss.d
export function fmtTime(sec: number): string {
  const v = Math.max(0, Number(sec) || 0)
  const m = Math.floor(v / 60)
  const s = Math.floor(v % 60)
  const d = Math.floor((v * 10) % 10)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`
}

// Base UI Slider onValueChange 归一化：单滑块取第一个值
export function sliderNumber(value: number | readonly number[]): number {
  return typeof value === 'number' ? value : (value[0] ?? 0)
}

// 输出画面尺寸（与后端 outputSize 对齐：短边对齐分辨率，长边取偶）
export function outputSize(
  aspectRatio: string,
  resolution: string
): { width: number; height: number } {
  let short = 1080
  switch (String(resolution || '').toUpperCase()) {
    case '480P':
      short = 480
      break
    case '720P':
      short = 720
      break
    case '4K':
    case '2160P':
      short = 2160
      break
  }
  let rw = 9
  let rh = 16
  const parts = String(aspectRatio || '9:16').split(':')
  if (parts.length === 2) {
    const w = Number.parseFloat(parts[0])
    const h = Number.parseFloat(parts[1])
    if (w > 0 && h > 0) {
      rw = w
      rh = h
    }
  }
  const even = (v: number) => {
    let n = Math.round(v)
    if (n % 2 !== 0) n++
    return Math.max(2, n)
  }
  if (rw >= rh) return { width: even((short * rw) / rh), height: short }
  return { width: short, height: even((short * rh) / rw) }
}

// ---------- 选项常量 ----------

export const TRANSITION_TYPES = [
  { value: '', label: 'No Transition' },
  { value: 'fade', label: 'Fade' },
  { value: 'fadeblack', label: 'Fade Black' },
  { value: 'fadewhite', label: 'Fade White' },
  { value: 'dissolve', label: 'Dissolve' },
  { value: 'wipeleft', label: 'Wipe Left' },
  { value: 'wiperight', label: 'Wipe Right' },
  { value: 'slideup', label: 'Slide Up' },
  { value: 'slidedown', label: 'Slide Down' },
]

export const FILTER_PRESETS = [
  { value: '', label: 'Original' },
  { value: 'vivid', label: 'Vivid' },
  { value: 'soft', label: 'Soft' },
  { value: 'film', label: 'Film' },
  { value: 'bw', label: 'Black & White' },
  { value: 'warm', label: 'Warm' },
  { value: 'cool', label: 'Cool' },
]

export const SUBTITLE_POSITIONS = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' },
]

export const ASPECT_RATIO_OPTIONS = [
  '21:9',
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
]

export const RESOLUTION_OPTIONS = ['480p', '720p', '1080p', '4k']

// 探测视频实际时长（带缓存），用于片段出点上限与替换素材后的校正
const durationCache: Record<string, number> = {}

export function probeVideoDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    if (!url) return resolve(0)
    if (durationCache[url]) return resolve(durationCache[url])
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.src = url
    video.addEventListener(
      'loadedmetadata',
      () => {
        durationCache[url] = video.duration || 0
        resolve(durationCache[url])
      },
      { once: true }
    )
    video.addEventListener('error', () => resolve(0), { once: true })
    setTimeout(() => resolve(durationCache[url] || 0), 8000)
  })
}
