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
  Link2,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Type,
  WandSparkles,
  X,
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

const IMAGE_SIZE_OPTIONS = [
  { value: '2048x2048', label: '1:1' },
  { value: '2560x1440', label: '16:9' },
  { value: '1440x2560', label: '9:16' },
  { value: '2304x1728', label: '4:3' },
  { value: '1728x2304', label: '3:4' },
]
const VIDEO_ASPECT_OPTIONS = ['16:9', '9:16', '1:1', '4:3', '3:4']
const VIDEO_DURATION_OPTIONS = [5, 10]
const VIDEO_RESOLUTION_OPTIONS = ['480p', '720p', '1080p']
const AUDIO_VOICE_OPTIONS = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
const AUDIO_FORMAT_OPTIONS = ['mp3', 'opus', 'aac', 'flac', 'wav']
const AUDIO_SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2]

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
  if (!prompt.trim() && hasUpstreamText) {
    placeholder = t(
      'Connected text will be used as the prompt; add extra details here'
    )
  }

  const sizeLabel =
    IMAGE_SIZE_OPTIONS.find(
      (option) => option.value === (node.metadata.size ?? '2048x2048')
    )?.label ?? '1:1'
  const voice = node.metadata.voice ?? 'alloy'
  let summaryPill = ''
  if (node.type === 'image') {
    summaryPill = `${sizeLabel} · ${t('Auto')} · ${t('{{count}} images', { count })}`
  } else if (node.type === 'video') {
    summaryPill = `${(node.metadata.resolution ?? '720p').toUpperCase()} · ${node.metadata.aspectRatio ?? '16:9'} · ${node.metadata.duration ?? 5}s`
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

  const renderParamSelect = (
    label: string,
    value: string | number,
    options: { value: string | number; label: string }[],
    onChange: (value: string) => void
  ) => (
    <label className='flex items-center justify-between gap-2 text-[11px]'>
      <span style={{ color: theme.node.muted }}>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className='h-7 rounded-md px-1.5 text-[11px] outline-none'
        style={{
          background: theme.node.panel,
          color: theme.node.text,
          border: `1px solid ${theme.node.stroke}`,
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
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

      {/* 上游参考缩略图 / 文本 chip */}
      {references.some((ref) => ref.url || ref.text?.trim()) && (
        <div className='canvas-scroll flex gap-1 overflow-x-auto px-3 pt-2'>
          {references
            .filter((ref) => ref.url || ref.text?.trim())
            .map((ref) =>
              ref.url ? (
                <div
                  key={ref.connectionId}
                  className='group/ref relative size-10 shrink-0 overflow-hidden rounded-md'
                  style={{ border: `1px solid ${theme.node.stroke}` }}
                >
                  <img
                    src={ref.url}
                    alt={ref.title}
                    draggable={false}
                    className='size-full object-cover'
                  />
                  <button
                    type='button'
                    onClick={() => onDisconnect(ref.connectionId)}
                    className='absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover/ref:opacity-100'
                    aria-label={t('Remove reference {{title}}', {
                      title: ref.title,
                    })}
                  >
                    <X aria-hidden='true' className='size-3 text-white' />
                  </button>
                </div>
              ) : (
                <div
                  key={ref.connectionId || `inherited-${ref.id}`}
                  data-canvas-text-ref={ref.id}
                  className='group/ref relative flex h-10 shrink-0 items-center gap-1.5 rounded-md px-2'
                  style={{
                    border: `1px solid ${theme.node.stroke}`,
                    background: theme.toolbar.itemHover,
                  }}
                >
                  <Type
                    aria-hidden='true'
                    className='size-3.5 shrink-0'
                    style={{ color: theme.node.muted }}
                  />
                  <span
                    className='max-w-28 truncate text-[10px]'
                    style={{ color: theme.node.text }}
                  >
                    {ref.title}
                  </span>
                  {ref.connectionId && (
                    <button
                      type='button'
                      onClick={() => onDisconnect(ref.connectionId)}
                      className='absolute inset-0 flex items-center justify-center rounded-md bg-black/60 opacity-0 transition-opacity group-hover/ref:opacity-100'
                      aria-label={t('Remove reference {{title}}', {
                        title: ref.title,
                      })}
                    >
                      <X aria-hidden='true' className='size-3 text-white' />
                    </button>
                  )}
                </div>
              )
            )}
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

      {/* 底行：模型 pill / 参数 / 上传 / 摘要 / 数量 / 发送 */}
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
        <div className='relative ml-auto' data-panel-popover>
          <button
            type='button'
            onClick={() => {
              setParamsOpen((prev) => !prev)
              setPresetOpen(false)
            }}
            className={iconButtonClass}
            style={{ color: theme.node.muted }}
            aria-label={t('Generation parameters')}
            title={t('Generation parameters')}
          >
            <SlidersHorizontal aria-hidden='true' className='size-3.5' />
          </button>
          {paramsOpen && (
            <div
              className='absolute right-0 bottom-9 z-20 flex w-60 flex-col gap-2 rounded-xl p-3'
              style={{
                background: theme.toolbar.panel,
                border: `1px solid ${theme.toolbar.border}`,
                boxShadow: theme.node.hoverShadow,
              }}
            >
              {node.type === 'image' &&
                renderParamSelect(
                  t('Aspect ratio'),
                  node.metadata.size ?? '2048x2048',
                  IMAGE_SIZE_OPTIONS,
                  (value) => onPatchMetadata({ size: value })
                )}
              {node.type === 'video' && (
                <>
                  {renderParamSelect(
                    t('Aspect ratio'),
                    node.metadata.aspectRatio ?? '16:9',
                    VIDEO_ASPECT_OPTIONS.map((value) => ({
                      value,
                      label: value,
                    })),
                    (value) => onPatchMetadata({ aspectRatio: value })
                  )}
                  {renderParamSelect(
                    t('Resolution'),
                    node.metadata.resolution ?? '720p',
                    VIDEO_RESOLUTION_OPTIONS.map((value) => ({
                      value,
                      label: value,
                    })),
                    (value) => onPatchMetadata({ resolution: value })
                  )}
                  {renderParamSelect(
                    t('Duration'),
                    node.metadata.duration ?? 5,
                    VIDEO_DURATION_OPTIONS.map((value) => ({
                      value,
                      label: `${value}s`,
                    })),
                    (value) => onPatchMetadata({ duration: Number(value) })
                  )}
                </>
              )}
              {node.type === 'audio' && (
                <>
                  {renderParamSelect(
                    t('Voice'),
                    voice,
                    AUDIO_VOICE_OPTIONS.map((value) => ({
                      value,
                      label: value.charAt(0).toUpperCase() + value.slice(1),
                    })),
                    (value) => onPatchMetadata({ voice: value })
                  )}
                  {renderParamSelect(
                    t('Format'),
                    node.metadata.audioFormat ?? 'mp3',
                    AUDIO_FORMAT_OPTIONS.map((value) => ({
                      value,
                      label: value.toUpperCase(),
                    })),
                    (value) => onPatchMetadata({ audioFormat: value })
                  )}
                  {renderParamSelect(
                    t('Speed'),
                    node.metadata.speed ?? 1,
                    AUDIO_SPEED_OPTIONS.map((value) => ({
                      value,
                      label: `${value}x`,
                    })),
                    (value) => onPatchMetadata({ speed: Number(value) })
                  )}
                </>
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
        </div>
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
        {summaryPill && (
          <span
            className='flex h-7 items-center rounded-full px-2.5 text-[10px] whitespace-nowrap tabular-nums'
            style={pillStyle}
          >
            {summaryPill}
          </span>
        )}
        {(node.type === 'text' || node.type === 'image') && (
          <input
            value={count}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (Number.isFinite(value)) {
                onPatchMetadata({
                  count: Math.min(4, Math.max(1, Math.round(value))),
                })
              }
            }}
            aria-label={t('Generation count')}
            title={t('Generation count')}
            className='h-7 w-9 rounded-lg text-center text-[11px] tabular-nums outline-none'
            style={{
              background: theme.toolbar.itemHover,
              color: theme.node.text,
            }}
          />
        )}
        <button
          type='button'
          disabled={!canSend}
          onClick={() => onGenerate(node)}
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