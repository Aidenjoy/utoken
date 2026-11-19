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
  ArrowUp,
  Camera,
  Clapperboard,
  Image as ImageIcon,
  Link2,
  Loader2,
  Maximize2,
  Minus,
  Music2,
  Plus,
  Settings2,
  Sparkles,
  SquarePlay,
  Volume2,
  VolumeX,
  WandSparkles,
  X,
  type LucideIcon,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import type { CanvasTheme } from '../canvas-theme'
import type { CanvasNode, CanvasNodeMetadata, CanvasNodeType } from '../types'
import {
  CanvasMentionMenu,
  type CanvasMentionCandidate,
} from './canvas-mention-menu'

// ===== 节点下方提示词面板（对齐 BeefTV：点击节点在卡片下方弹出 composer） =====
// 面板渲染在画布屏幕空间覆盖层，借 --canvas-live-* CSS 变量实时跟随平移/缩放。

interface CanvasPromptPreset {
  id: string
  nameKey: string
  descKey: string
  promptKey: string
  modes: CanvasNodeType[]
}

const CANVAS_PROMPT_PRESETS: CanvasPromptPreset[] = [
  {
    id: 'character-sheet',
    nameKey: 'Character sheet',
    descKey: 'Front, side, back and expression references to lock consistency',
    promptKey:
      'Generate a character sheet: keep the same identity, facial features, hairstyle, outfit and body shape, include front, side, back and key expression references, clean background for reuse in later shots.',
    modes: ['image'],
  },
  {
    id: 'multi-angle',
    nameKey: 'Multi-camera angles',
    descKey: 'Continuous, connectable camera variations around one subject',
    promptKey:
      'Design multi-camera shots around the same subject, keeping characters, outfits, scene and lighting consistent: wide, full, medium, close-up, extreme close-up, side, back and top-down views with continuity between shots.',
    modes: ['image', 'video'],
  },
  {
    id: 'next-shot',
    nameKey: 'Next-shot reasoning',
    descKey: 'Reason the next action and shot transition from this frame',
    promptKey:
      'Based on the current frame, reason the next continuous shot: keep characters and scene consistent, specify the subject’s next action, gaze, environment change, camera movement and natural transition, without jumping composition or identity.',
    modes: ['image', 'video'],
  },
  {
    id: 'story-beats',
    nameKey: 'Continuous shots',
    descKey: 'Break a short plot into generatable continuous shot beats',
    promptKey:
      'Break this content into continuous shot beats. For each shot specify subject action, shot size, composition, camera position, movement, lighting, mood and the transition to adjacent shots, keeping characters, scene and props consistent.',
    modes: ['text', 'image', 'video'],
  },
  {
    id: 'cinematic-light',
    nameKey: 'Cinematic lighting',
    descKey: 'Keep content, improve realistic light, depth and blending',
    promptKey:
      'Keep the subject identity, action and original composition, optimize toward realistic cinematic lighting: specify key light direction, ambient bounce, shadow depth, skin tone and background blending, reduce plastic look and over-sharpening, do not change the content.',
    modes: ['image', 'video'],
  },
  {
    id: 'video-prompt',
    nameKey: 'Video prompt rewrite',
    descKey: 'Rewrite into time-ordered shot instructions models can follow',
    promptKey:
      'Rewrite the current request into a structured video prompt describing, in time order, the opening frame, subject action, camera movement, environment change, sound and ending frame; resolve conflicting instructions and keep all key constraints.',
    modes: ['text', 'video'],
  },
]

const IMAGE_QUALITY_OPTIONS = [
  { value: 'low', labelKey: 'Low quality' },
  { value: 'standard', labelKey: 'Standard quality' },
  { value: 'high', labelKey: 'High quality' },
  { value: 'ultra', labelKey: 'Ultra quality' },
  { value: 'extreme', labelKey: 'Extreme quality' },
]
const IMAGE_CLARITY_OPTIONS = ['1K', '2K', '4K']
const IMAGE_CLARITY_EDGE: Record<string, number> = {
  '1K': 1024,
  '2K': 2048,
  '4K': 4096,
}
const IMAGE_BACKGROUND_OPTIONS = [
  { value: 'auto', labelKey: 'Auto' },
  { value: 'keep', labelKey: 'Keep background' },
  { value: 'transparent', labelKey: 'Transparent background' },
]
const IMAGE_RATIO_OPTIONS = [
  '1:1',
  '1:2',
  '2:1',
  '9:16',
  '16:9',
  '3:4',
  '4:3',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '21:9',
  '9:21',
]

// 画幅+清晰度换算像素尺寸：长边取清晰度档位，短边收敛到网关 512~4096 边界
function imageSizeForRatio(ratio: string, clarity: string): string {
  const [rw, rh] = ratio.split(':').map(Number)
  const edge = IMAGE_CLARITY_EDGE[clarity] ?? 2048
  let w = rw >= rh ? edge : Math.round((edge * rw) / rh)
  let h = rw >= rh ? Math.round((edge * rh) / rw) : edge
  w = Math.min(4096, Math.max(512, w))
  h = Math.min(4096, Math.max(512, h))
  return `${w}x${h}`
}
// adaptive = 自动画幅（上游按参考图/提示词自适应）
const VIDEO_ASPECT_OPTIONS = [
  'adaptive',
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
  '21:9',
]
const VIDEO_RESOLUTION_OPTIONS = ['480p', '720p', '1080p']
const AUDIO_VOICE_OPTIONS = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
const AUDIO_FORMAT_OPTIONS = ['mp3', 'opus', 'aac', 'flac', 'wav']
const AUDIO_SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2]

// 上游参考磁贴：文本 → 图片 → 视频 → 音频 分组排序，组内按连接顺序编号
const REF_TILE_GROUP: Partial<Record<CanvasNodeType, number>> = {
  text: 0,
  image: 1,
  upscale: 1,
  drawing: 1,
  video: 2,
  audio: 3,
}

const REF_TILE_ICONS: Partial<Record<CanvasNodeType, LucideIcon>> = {
  image: ImageIcon,
  upscale: ImageIcon,
  drawing: ImageIcon,
  video: SquarePlay,
  audio: Music2,
  script: Clapperboard,
  director: Clapperboard,
}

export interface CanvasNodeReference {
  connectionId: string
  id: string
  title: string
  url?: string
  text?: string
  type: CanvasNodeType
}

interface CanvasNodePromptPanelProps {
  node: CanvasNode
  theme: CanvasTheme
  modelConfigured: boolean
  modelName?: string
  references: CanvasNodeReference[]
  onDisconnect: (connectionId: string) => void
  mentionCandidates: CanvasMentionCandidate[]
  onMention: (
    node: CanvasNode,
    candidate: { kind: 'node' | 'asset'; id: string; title: string }
  ) => void
  onPatchMetadata: (metadata: Partial<CanvasNodeMetadata>) => void
  onBeginEdit: () => void
  onEndEdit: () => void
  onGenerate: (node: CanvasNode) => void
  onUploadFile: (node: CanvasNode, file: File) => void
  onOptimize: (node: CanvasNode) => void
  optimizing: boolean
  onOpenSettings: () => void
  pickConnectActive: boolean
  onTogglePickConnect: () => void
}

export function CanvasNodePromptPanel(props: CanvasNodePromptPanelProps) {
  const {
    node,
    theme,
    modelConfigured,
    modelName,
    references,
    onDisconnect,
    mentionCandidates,
    onMention,
    onPatchMetadata,
    onBeginEdit,
    onEndEdit,
    onGenerate,
    onUploadFile,
    onOptimize,
    optimizing,
    onOpenSettings,
    pickConnectActive,
    onTogglePickConnect,
  } = props
  const { t } = useTranslation()
  const [mention, setMention] = React.useState<{
    start: number
    query: string
  } | null>(null)
  const [mentionActive, setMentionActive] = React.useState(0)
  const [presetOpen, setPresetOpen] = React.useState(false)
  const [paramsOpen, setParamsOpen] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  const [textHeight, setTextHeight] = React.useState(96)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const panelRef = React.useRef<HTMLDivElement | null>(null)

  const loading = node.metadata.status === 'loading'
  const locked = Boolean(node.metadata.locked)
  const prompt = node.metadata.prompt ?? ''
  const count = node.metadata.count ?? 1
  const presets = CANVAS_PROMPT_PRESETS.filter((preset) =>
    preset.modes.includes(node.type)
  )
  const mentionItems = React.useMemo(() => {
    if (!mention) return []
    const query = mention.query.toLowerCase()
    return mentionCandidates
      .filter((item) => item.title.toLowerCase().includes(query))
      .slice(0, 8)
  }, [mention, mentionCandidates])

  // 浮层外点击关闭（预设/参数弹层）
  React.useEffect(() => {
    if (!presetOpen && !paramsOpen) return
    const close = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (!target?.closest('[data-panel-popover]')) {
        setPresetOpen(false)
        setParamsOpen(false)
      }
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [presetOpen, paramsOpen])

  const selectMention = (candidate: CanvasMentionCandidate) => {
    if (!mention) return
    const caret = textareaRef.current?.selectionStart ?? prompt.length
    const next = `${prompt.slice(0, mention.start)}@${candidate.title} ${prompt.slice(caret)}`
    onPatchMetadata({ prompt: next })
    onMention(node, candidate)
    setMention(null)
  }

  let placeholder = t('Describe the scene you want to generate')
  if (node.type === 'text') {
    placeholder = t('Enter the text content you want to generate')
  } else if (node.type === 'image') {
    placeholder = t('Describe the image you want to generate...')
  } else if (node.type === 'video') {
    placeholder = t(
      'Describe the scene you want to generate, use @ to reference images, videos, audio or characters'
    )
  } else if (node.type === 'audio') {
    placeholder = t('Describe the audio you want, use @ to reference audio')
  }
  const hasUpstreamText = references.some((ref) => Boolean(ref.text?.trim()))
  // 磁贴只渲染直连上游：连线有几条就显示几个，继承文本仅参与提示词合成
  const shelfRefs = React.useMemo(() => {
    const ordinals = new Map<CanvasNodeType, number>()
    return references
      .filter((ref) => ref.connectionId)
      .sort(
        (a, b) => (REF_TILE_GROUP[a.type] ?? 4) - (REF_TILE_GROUP[b.type] ?? 4)
      )
      .map((ref) => {
        const ordinal = (ordinals.get(ref.type) ?? 0) + 1
        ordinals.set(ref.type, ordinal)
        return { ref, ordinal }
      })
  }, [references])
  if (!prompt.trim() && hasUpstreamText) {
    placeholder = t(
      'Connected text will be used as the prompt; add extra details here'
    )
  }

  const [sizeW, sizeH] = (node.metadata.size ?? '2048x2048')
    .split('x')
    .map(Number)
  const imageRatio =
    node.metadata.ratio ??
    IMAGE_RATIO_OPTIONS.find((option) => {
      const [rw, rh] = option.split(':').map(Number)
      return Math.abs(rw / rh - sizeW / sizeH) < 0.02
    }) ??
    '1:1'
  let fallbackClarity = '1K'
  if (Math.max(sizeW, sizeH) >= 4096) fallbackClarity = '4K'
  else if (Math.max(sizeW, sizeH) >= 2048) fallbackClarity = '2K'
  const imageClarity = node.metadata.clarity ?? fallbackClarity
  const imageQuality = node.metadata.quality ?? 'standard'
  const imageBackground = node.metadata.background ?? 'auto'
  // 画质/背景仅 OpenAI 系上游真实支持（与 SubmitCanvasImage 下发门控一致）：
  // gpt-image 有 quality+background，dall-e-3 有 quality(hd)；
  // 其余供应商（如方舟 seedream）协议无此参数，不展示点了不生效的档位
  const imageModelLower = (modelName ?? '').toLowerCase()
  const qualitySupported =
    imageModelLower.includes('gpt-image') || imageModelLower.includes('dall-e-3')
  const backgroundSupported = imageModelLower.includes('gpt-image')
  const qualityLabel =
    IMAGE_QUALITY_OPTIONS.find((option) => option.value === imageQuality)
      ?.labelKey ?? 'Standard quality'
  const patchImageFormat = (patch: { ratio?: string; clarity?: string }) => {
    const ratio = patch.ratio ?? imageRatio
    const clarity = patch.clarity ?? imageClarity
    onPatchMetadata({ ...patch, size: imageSizeForRatio(ratio, clarity) })
  }
  const videoRatio = node.metadata.aspectRatio ?? '16:9'
  const videoResolution = node.metadata.resolution ?? '720p'
  const videoDuration = node.metadata.duration ?? 5
  const videoAudio = node.metadata.generateAudio ?? true
  const voice = node.metadata.voice ?? 'alloy'
  let summaryPill = ''
  if (node.type === 'text') {
    summaryPill = t('{{count}} texts', { count })
  } else if (node.type === 'image') {
    const qualityPart = qualitySupported ? ` · ${t(qualityLabel)}` : ''
    summaryPill = `${imageRatio}${qualityPart} · ${imageClarity} · ${t('{{count}} images', { count })}`
  } else if (node.type === 'video') {
    const ratioLabel = videoRatio === 'adaptive' ? t('Auto') : videoRatio
    summaryPill = `${ratioLabel} · ${videoResolution.toUpperCase()} · ${videoDuration}s · ${t('{{count}} videos', { count })}`
  } else if (node.type === 'audio') {
    summaryPill = `${voice.charAt(0).toUpperCase()}${voice.slice(1)} · ${(node.metadata.audioFormat ?? 'mp3').toUpperCase()} · ${node.metadata.speed ?? 1}x`
  }

  const canSend =
    !loading &&
    !locked &&
    modelConfigured &&
    (Boolean(prompt.trim()) || hasUpstreamText)

  const pillStyle: React.CSSProperties = {
    background: theme.toolbar.itemHover,
    color: theme.node.muted,
  }
  const iconButtonClass =
    'flex size-7 items-center justify-center rounded-lg transition-colors'

  // 拖拽条调整输入区高度
  const startTextResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)
    const startY = event.clientY
    const startHeight = textHeight
    const handleMove = (moveEvent: PointerEvent) => {
      setTextHeight(
        Math.min(420, Math.max(72, startHeight + moveEvent.clientY - startY))
      )
    }
    const handleUp = () => {
      element.removeEventListener('pointermove', handleMove)
      element.removeEventListener('pointerup', handleUp)
      element.removeEventListener('pointercancel', handleUp)
    }
    element.addEventListener('pointermove', handleMove)
    element.addEventListener('pointerup', handleUp)
    element.addEventListener('pointercancel', handleUp)
  }

  const renderSegments = (
    label: string,
    options: { value: string; label: string }[],
    current: string,
    onSelect: (value: string) => void,
    fill = false
  ) => (
    <div>
      <div className='mb-1.5 text-[11px]' style={{ color: theme.node.muted }}>
        {label}
      </div>
      <div
        className={fill ? 'grid grid-cols-4 gap-1.5' : 'flex flex-wrap gap-1.5'}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type='button'
            onClick={() => onSelect(option.value)}
            className='flex h-8 items-center justify-center rounded-lg px-3 text-[11px] transition-colors'
            style={
              current === option.value
                ? {
                    border: `1px solid ${theme.node.activeStroke}`,
                    background: theme.toolbar.activeBg,
                    color: theme.node.text,
                  }
                : {
                    border: `1px solid ${theme.node.stroke}`,
                    color: theme.node.muted,
                  }
            }
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div
      ref={panelRef}
      data-canvas-no-zoom
      className='relative flex flex-col rounded-2xl'
      style={{
        background: theme.toolbar.panel,
        border: `1px solid ${theme.toolbar.border}`,
        boxShadow: theme.node.hoverShadow,
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {/* 头部：参考条 / 预设 / 点选连线 / 字号 / 放大 */}
      <div className='flex items-center gap-1 px-3 pt-2'>
        {node.type === 'audio' && (
          <span
            className='flex h-6 items-center gap-1 rounded-full px-2 text-[10px]'
            style={pillStyle}
          >
            <Link2 aria-hidden='true' className='size-3' />
            {t('References')}
            {references.length > 0 && <span>×{references.length}</span>}
          </span>
        )}
        <div className='ml-auto flex items-center gap-1'>
          {presets.length > 0 && (
            <div className='relative' data-panel-popover>
              <button
                type='button'
                onClick={() => {
                  setPresetOpen((prev) => !prev)
                  setParamsOpen(false)
                }}
                className='flex h-6 items-center gap-1 rounded-full px-2 text-[10px]'
                style={pillStyle}
              >
                <Sparkles aria-hidden='true' className='size-3' />
                {t('Presets')}
              </button>
              {presetOpen && (
                <div
                  className='canvas-scroll absolute top-7 right-0 z-20 max-h-72 w-72 overflow-y-auto rounded-xl py-1'
                  style={{
                    background: theme.toolbar.panel,
                    border: `1px solid ${theme.toolbar.border}`,
                    boxShadow: theme.node.hoverShadow,
                  }}
                >
                  {presets.map((preset) => (
                    <button
                      key={preset.id}
                      type='button'
                      onClick={() => {
                        onPatchMetadata({ prompt: t(preset.promptKey) })
                        setPresetOpen(false)
                        textareaRef.current?.focus()
                      }}
                      className='block w-full px-3 py-2 text-left transition-colors'
                    >
                      <span
                        className='block text-xs font-medium'
                        style={{ color: theme.node.text }}
                      >
                        {t(preset.nameKey)}
                      </span>
                      <span
                        className='mt-0.5 block text-[10px] leading-relaxed'
                        style={{ color: theme.node.faint }}
                      >
                        {t(preset.descKey)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            type='button'
            onClick={onTogglePickConnect}
            className='flex h-6 items-center gap-1 rounded-full px-2 text-[10px]'
            style={
              pickConnectActive
                ? {
                    background: theme.accent.primary,
                    color: theme.accent.onPrimary,
                  }
                : pillStyle
            }
            title={t('Click another node to connect it as a reference')}
          >
            <Link2 aria-hidden='true' className='size-3' />
            {t('Pick to connect')}
          </button>
          {node.type === 'text' && (
            <div
              className='flex h-6 items-center gap-0.5 rounded-full px-1'
              style={pillStyle}
            >
              <button
                type='button'
                onClick={() =>
                  onPatchMetadata({
                    fontSize: Math.max(10, (node.metadata.fontSize ?? 14) - 1),
                  })
                }
                className='flex size-4 items-center justify-center'
                aria-label={t('Decrease font size')}
              >
                <Minus aria-hidden='true' className='size-2.5' />
              </button>
              <span className='w-5 text-center text-[10px] tabular-nums'>
                {node.metadata.fontSize ?? 14}
              </span>
              <button
                type='button'
                onClick={() =>
                  onPatchMetadata({
                    fontSize: Math.min(32, (node.metadata.fontSize ?? 14) + 1),
                  })
                }
                className='flex size-4 items-center justify-center'
                aria-label={t('Increase font size')}
              >
                <Plus aria-hidden='true' className='size-2.5' />
              </button>
            </div>
          )}
          <button
            type='button'
            onClick={() => setExpanded(true)}
            className={iconButtonClass}
            style={{ color: theme.node.muted }}
            aria-label={t('Expand editor')}
            title={t('Expand editor')}
          >
            <Maximize2 aria-hidden='true' className='size-3.5' />
          </button>
        </div>
      </div>

      {/* 上游参考磁贴：类型图标 + 序号徽标，悬停右上角移除 */}
      {shelfRefs.length > 0 && (
        <div className='canvas-scroll flex gap-2 overflow-x-auto px-3 pt-2.5 pb-0.5'>
          {shelfRefs.map(({ ref, ordinal }) => {
            const TileIcon = REF_TILE_ICONS[ref.type]
            let tileIcon = <Link2 aria-hidden='true' className='size-5' />
            if (ref.type === 'text') {
              tileIcon = (
                <svg
                  aria-hidden='true'
                  viewBox='0 0 24 24'
                  fill='currentColor'
                  className='size-5'
                >
                  <rect x='4' y='4.6' width='16' height='2.6' rx='1.3' />
                  <rect x='4' y='9' width='16' height='2.6' rx='1.3' />
                  <rect x='4' y='13.4' width='16' height='2.6' rx='1.3' />
                  <rect x='4' y='17.8' width='10' height='2.6' rx='1.3' />
                </svg>
              )
            } else if (TileIcon) {
              tileIcon = <TileIcon aria-hidden='true' className='size-5' />
            }
            return (
              <div
                key={ref.connectionId}
                data-canvas-ref-type={ref.type}
                {...(ref.type === 'text'
                  ? { 'data-canvas-text-ref': ref.id }
                  : {})}
                title={
                  ref.text ? `${ref.title}\n${ref.text.slice(0, 80)}` : ref.title
                }
                className='group/tile relative flex size-11 shrink-0 items-center justify-center rounded-[10px]'
                style={{
                  background: theme.reference.fill,
                  color: theme.reference.icon,
                }}
              >
                {tileIcon}
                <span className='absolute -left-1 -top-1 flex size-4 items-center justify-center rounded-full bg-black text-[9px] font-semibold text-white transition-opacity group-hover/tile:opacity-0'>
                  {ordinal}
                </span>
                <button
                  type='button'
                  onClick={() => onDisconnect(ref.connectionId)}
                  aria-label={t('Remove reference {{title}}', {
                    title: ref.title,
                  })}
                  className='absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-current opacity-0 transition-opacity group-hover/tile:opacity-100'
                  style={{ background: theme.node.panel }}
                >
                  <X aria-hidden='true' className='size-3' />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* 提示词输入 */}
      <div className='relative px-3 pt-2'>
        {mention && mentionItems.length > 0 && (
          <CanvasMentionMenu
            anchorRef={textareaRef}
            items={mentionItems}
            activeIndex={mentionActive}
            theme={theme}
            onSelect={selectMention}
          />
        )}
        <textarea
          ref={textareaRef}
          value={prompt}
          readOnly={locked}
          onChange={(event) => {
            const value = event.target.value
            onPatchMetadata({ prompt: value })
            const caret = event.target.selectionStart ?? value.length
            const at = value.lastIndexOf('@', caret - 1)
            if (at >= 0) {
              const query = value.slice(at + 1, caret)
              if (query.length <= 24 && !/\s/.test(query)) {
                setMention({ start: at, query })
                setMentionActive(0)
                return
              }
            }
            setMention(null)
          }}
          onKeyDown={(event) => {
            if (mention && mentionItems.length > 0) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setMentionActive((prev) => (prev + 1) % mentionItems.length)
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setMentionActive(
                  (prev) =>
                    (prev - 1 + mentionItems.length) % mentionItems.length
                )
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                selectMention(mentionItems[mentionActive])
                return
              }
              if (event.key === 'Escape') {
                event.stopPropagation()
                setMention(null)
                return
              }
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              if (canSend) onGenerate(node)
            }
          }}
          onFocus={onBeginEdit}
          onBlur={() => {
            onEndEdit()
            setMention(null)
          }}
          placeholder={placeholder}
          aria-label={t('Prompt')}
          className='canvas-scroll w-full resize-none rounded-lg bg-transparent p-2 text-xs leading-relaxed outline-none'
          style={{ color: theme.node.text, height: textHeight }}
        />
      </div>

      {/* 居中拖拽条 */}
      <div
        onPointerDown={startTextResize}
        className='flex h-3 shrink-0 cursor-ns-resize items-center justify-center'
        role='separator'
        aria-orientation='horizontal'
        aria-label={t('Resize input')}
      >
        <div
          className='h-1 w-10 rounded-full'
          style={{ background: theme.node.stroke }}
        />
      </div>

      {/* 底行：模型 pill / 上传 / 摘要 pill（点击弹参数选择层） / 发送 */}
      <div className='flex flex-wrap items-center gap-1.5 px-3 pb-2.5'>
        <button
          type='button'
          onClick={onOpenSettings}
          className='flex h-7 max-w-56 items-center gap-1 rounded-full px-2.5 text-[10px]'
          style={{
            background: theme.toolbar.itemHover,
            color: modelConfigured ? theme.node.text : '#fcd34d',
          }}
          title={t('Model settings')}
        >
          {modelConfigured ? (
            <span className='truncate'>{modelName || t('Model')}</span>
          ) : (
            <>
              <Settings2 aria-hidden='true' className='size-3 shrink-0' />
              <span className='truncate'>
                {t('No model available, connect built-in compute')}
              </span>
            </>
          )}
        </button>
        <div
          className='relative ml-auto flex items-center gap-1.5'
          data-panel-popover
        >
          {(node.type === 'image' || node.type === 'audio') && (
            <>
              <button
                type='button'
                onClick={() => fileInputRef.current?.click()}
                className={iconButtonClass}
                style={{ color: theme.node.muted }}
                aria-label={
                  node.type === 'audio' ? t('Upload audio') : t('Upload image')
                }
                title={
                  node.type === 'audio' ? t('Upload audio') : t('Upload image')
                }
              >
                <Camera aria-hidden='true' className='size-3.5' />
              </button>
              <input
                ref={fileInputRef}
                type='file'
                accept={node.type === 'audio' ? 'audio/*' : 'image/*'}
                className='hidden'
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) onUploadFile(node, file)
                  event.target.value = ''
                }}
              />
            </>
          )}
          <button
            type='button'
            onClick={() => {
              setParamsOpen((prev) => !prev)
              setPresetOpen(false)
            }}
            className='flex h-7 cursor-pointer items-center gap-1 rounded-full px-2.5 text-[10px] whitespace-nowrap tabular-nums transition-colors'
            style={
              paramsOpen
                ? {
                    background: theme.toolbar.activeBg,
                    color: theme.node.text,
                  }
                : pillStyle
            }
            aria-label={t('Generation parameters')}
            title={t('Generation parameters')}
          >
            {node.type === 'video' &&
              (videoAudio ? (
                <Volume2 aria-hidden='true' className='size-3 shrink-0' />
              ) : (
                <VolumeX aria-hidden='true' className='size-3 shrink-0' />
              ))}
            {summaryPill}
          </button>
          {paramsOpen && (
            <div
              className='canvas-scroll absolute right-0 bottom-9 z-30 flex w-[340px] flex-col gap-3 overflow-y-auto rounded-xl p-3'
              style={{
                background: theme.toolbar.panel,
                border: `1px solid ${theme.toolbar.border}`,
                boxShadow: theme.node.hoverShadow,
                maxHeight: 'calc(100svh - 220px)',
              }}
            >
              {node.type === 'image' && (
                <>
                  {qualitySupported &&
                    renderSegments(
                      t('Image quality'),
                      IMAGE_QUALITY_OPTIONS.map((option) => ({
                        value: option.value,
                        label: t(option.labelKey),
                      })),
                      imageQuality,
                      (value) => onPatchMetadata({ quality: value })
                    )}
                  {renderSegments(
                    t('Clarity'),
                    IMAGE_CLARITY_OPTIONS.map((value) => ({
                      value,
                      label: value,
                    })),
                    imageClarity,
                    (value) => patchImageFormat({ clarity: value })
                  )}
                  {backgroundSupported &&
                    renderSegments(
                      t('Background'),
                      IMAGE_BACKGROUND_OPTIONS.map((option) => ({
                        value: option.value,
                        label: t(option.labelKey),
                      })),
                      imageBackground,
                      (value) => onPatchMetadata({ background: value })
                    )}
                  <div>
                    <div
                      className='mb-1.5 text-[11px]'
                      style={{ color: theme.node.muted }}
                    >
                      {t('Aspect ratio')}
                    </div>
                    <div className='grid grid-cols-5 gap-1.5'>
                      {IMAGE_RATIO_OPTIONS.map((ratio) => {
                        const [rw, rh] = ratio.split(':').map(Number)
                        const glyphW = rw >= rh ? 18 : Math.round((18 * rw) / rh)
                        const glyphH = rw >= rh ? Math.round((18 * rh) / rw) : 18
                        const selected = imageRatio === ratio
                        return (
                          <button
                            key={ratio}
                            type='button'
                            onClick={() => patchImageFormat({ ratio })}
                            className='flex h-14 flex-col items-center justify-center gap-1 rounded-lg transition-colors'
                            style={
                              selected
                                ? {
                                    border: `1px solid ${theme.node.activeStroke}`,
                                    background: theme.toolbar.activeBg,
                                    color: theme.node.text,
                                  }
                                : {
                                    border: `1px solid ${theme.node.stroke}`,
                                    color: theme.node.muted,
                                  }
                            }
                          >
                            <span
                              className='rounded-[3px]'
                              style={{
                                width: glyphW,
                                height: glyphH,
                                border: `1.5px solid ${selected ? theme.node.text : theme.node.muted}`,
                              }}
                            />
                            <span className='text-[10px] tabular-nums'>
                              {ratio}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  {renderSegments(
                    t('Generation count'),
                    [1, 2, 3, 4].map((value) => ({
                      value: String(value),
                      label: t('{{count}} images', { count: value }),
                    })),
                    String(count),
                    (value) => onPatchMetadata({ count: Number(value) }),
                    true
                  )}
                </>
              )}
              {node.type === 'video' && (
                <>
                  <div>
                    <div
                      className='mb-1.5 text-[11px]'
                      style={{ color: theme.node.muted }}
                    >
                      {t('Aspect ratio')}
                    </div>
                    <div className='grid grid-cols-4 gap-1.5'>
                      {VIDEO_ASPECT_OPTIONS.map((ratio) => {
                        const selected = videoRatio === ratio
                        let glyphW = 18
                        let glyphH = 12
                        if (ratio !== 'adaptive') {
                          const [rw, rh] = ratio.split(':').map(Number)
                          glyphW = rw >= rh ? 18 : Math.round((18 * rw) / rh)
                          glyphH = rw >= rh ? Math.round((18 * rh) / rw) : 18
                        }
                        return (
                          <button
                            key={ratio}
                            type='button'
                            onClick={() => onPatchMetadata({ aspectRatio: ratio })}
                            className='flex h-14 flex-col items-center justify-center gap-1 rounded-lg transition-colors'
                            style={
                              selected
                                ? {
                                    border: `1px solid ${theme.node.activeStroke}`,
                                    background: theme.toolbar.activeBg,
                                    color: theme.node.text,
                                  }
                                : {
                                    border: `1px solid ${theme.node.stroke}`,
                                    color: theme.node.muted,
                                  }
                            }
                          >
                            <span
                              className='rounded-[3px]'
                              style={{
                                width: glyphW,
                                height: glyphH,
                                border: `1.5px ${ratio === 'adaptive' ? 'dashed' : 'solid'} ${selected ? theme.node.text : theme.node.muted}`,
                              }}
                            />
                            <span className='text-[10px] tabular-nums'>
                              {ratio === 'adaptive' ? t('Auto') : ratio}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  {renderSegments(
                    t('Resolution'),
                    VIDEO_RESOLUTION_OPTIONS.map((value) => ({
                      value,
                      label: value.toUpperCase(),
                    })),
                    videoResolution,
                    (value) => onPatchMetadata({ resolution: value })
                  )}
                  <div>
                    <div className='mb-1.5 flex items-center justify-between text-[11px]'>
                      <span style={{ color: theme.node.muted }}>
                        {t('Video duration')}
                      </span>
                      <span
                        className='tabular-nums'
                        style={{ color: theme.node.text }}
                      >
                        {videoDuration}s
                      </span>
                    </div>
                    <input
                      type='range'
                      min={5}
                      max={15}
                      step={1}
                      value={videoDuration}
                      onChange={(event) =>
                        onPatchMetadata({ duration: Number(event.target.value) })
                      }
                      aria-label={t('Video duration')}
                      className='w-full cursor-pointer'
                      style={{ accentColor: theme.accent.primary }}
                    />
                  </div>
                  {renderSegments(
                    t('Generate audio'),
                    [
                      { value: 'on', label: t('On') },
                      { value: 'off', label: t('Off') },
                    ],
                    videoAudio ? 'on' : 'off',
                    (value) => onPatchMetadata({ generateAudio: value === 'on' })
                  )}
                  {renderSegments(
                    t('Generation count'),
                    [1, 2, 3, 4].map((value) => ({
                      value: String(value),
                      label: t('{{count}} videos', { count: value }),
                    })),
                    String(count),
                    (value) => onPatchMetadata({ count: Number(value) }),
                    true
                  )}
                </>
              )}
              {node.type === 'audio' && (
                <>
                  {renderSegments(
                    t('Voice'),
                    AUDIO_VOICE_OPTIONS.map((value) => ({
                      value,
                      label: value.charAt(0).toUpperCase() + value.slice(1),
                    })),
                    voice,
                    (value) => onPatchMetadata({ voice: value })
                  )}
                  {renderSegments(
                    t('Format'),
                    AUDIO_FORMAT_OPTIONS.map((value) => ({
                      value,
                      label: value.toUpperCase(),
                    })),
                    node.metadata.audioFormat ?? 'mp3',
                    (value) => onPatchMetadata({ audioFormat: value })
                  )}
                  {renderSegments(
                    t('Speed'),
                    AUDIO_SPEED_OPTIONS.map((value) => ({
                      value: String(value),
                      label: `${value}x`,
                    })),
                    String(node.metadata.speed ?? 1),
                    (value) => onPatchMetadata({ speed: Number(value) })
                  )}
                </>
              )}
              {node.type === 'text' &&
                renderSegments(
                  t('Generation count'),
                  [1, 2, 3, 4].map((value) => ({
                    value: String(value),
                    label: t('{{count}} texts', { count: value }),
                  })),
                  String(count),
                  (value) => onPatchMetadata({ count: Number(value) }),
                  true
                )}
              <button
                type='button'
                disabled={optimizing || loading || !prompt.trim()}
                onClick={() => onOptimize(node)}
                className='flex h-7 items-center justify-center gap-1.5 rounded-lg text-[11px] disabled:cursor-not-allowed disabled:opacity-40'
                style={{
                  border: `1px solid ${theme.node.stroke}`,
                  color: theme.node.text,
                }}
              >
                {optimizing ? (
                  <Loader2 aria-hidden='true' className='size-3 animate-spin' />
                ) : (
                  <WandSparkles aria-hidden='true' className='size-3' />
                )}
                {t('Optimize prompt')}
              </button>
            </div>
          )}
          <button
            type='button'
            disabled={!canSend}
            onClick={() => {
              setParamsOpen(false)
              onGenerate(node)
            }}
            className='flex size-8 items-center justify-center rounded-full transition-opacity disabled:cursor-not-allowed disabled:opacity-35'
            style={{
              background: theme.accent.primary,
              color: theme.accent.onPrimary,
            }}
            aria-label={t('Generate')}
            title={t('Generate')}
          >
            {loading ? (
              <Loader2 aria-hidden='true' className='size-4 animate-spin' />
            ) : (
              <ArrowUp aria-hidden='true' className='size-4' />
            )}
          </button>
        </div>
      </div>

      {/* 放大编辑弹层 */}
      {expanded && (
        <div
          className='fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-6'
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setExpanded(false)
          }}
        >
          <div
            className='flex w-[min(920px,92vw)] flex-col rounded-2xl p-4'
            style={{
              background: theme.toolbar.panel,
              border: `1px solid ${theme.toolbar.border}`,
            }}
          >
            <div className='mb-2 flex items-center justify-between'>
              <span
                className='text-xs font-medium'
                style={{ color: theme.node.text }}
              >
                {node.title}
              </span>
              <button
                type='button'
                onClick={() => setExpanded(false)}
                className={iconButtonClass}
                style={{ color: theme.node.muted }}
                aria-label={t('Close')}
              >
                <X aria-hidden='true' className='size-4' />
              </button>
            </div>
            <textarea
              value={prompt}
              autoFocus
              onChange={(event) =>
                onPatchMetadata({ prompt: event.target.value })
              }
              onFocus={onBeginEdit}
              onBlur={onEndEdit}
              placeholder={placeholder}
              aria-label={t('Prompt')}
              className='canvas-scroll h-[52vh] w-full resize-none rounded-lg bg-transparent p-3 text-sm leading-relaxed outline-none'
              style={{
                color: theme.node.text,
                border: `1px solid ${theme.node.stroke}`,
              }}
            />
            <div className='mt-2 flex justify-end'>
              <button
                type='button'
                disabled={!canSend}
                onClick={() => {
                  setExpanded(false)
                  onGenerate(node)
                }}
                className='flex h-8 items-center gap-1.5 rounded-full px-4 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-35'
                style={{
                  background: theme.accent.primary,
                  color: theme.accent.onPrimary,
                }}
              >
                <ArrowUp aria-hidden='true' className='size-3.5' />
                {t('Generate')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}