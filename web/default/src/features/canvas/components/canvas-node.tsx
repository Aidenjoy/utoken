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
  AlertCircle,
  Download,
  Image as ImageIcon,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Type,
  Upload,
  Video,
  X,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import type { CanvasTheme } from '../canvas-theme'
import {
  CANVAS_NODE_TITLE_KEYS,
  type CanvasNode,
  type CanvasNodeMetadata,
  type CanvasNodeType,
  type CanvasPosition,
} from '../types'

// ===== 画布节点卡片（移植自 BeefTV canvas-node：外置标题/四角缩放/连接轨/状态徽章） =====

export interface CanvasNodePatch {
  title?: string
  position?: CanvasPosition
  width?: number
  height?: number
  metadata?: Partial<CanvasNodeMetadata>
}

interface CanvasNodeViewProps {
  node: CanvasNode
  theme: CanvasTheme
  selected: boolean
  referenceCount: number
  modelConfigured: boolean
  isConnectionTarget: boolean
  getScale: () => number
  onSelect: (id: string) => void
  onPatch: (id: string, patch: CanvasNodePatch) => void
  onMove: (id: string, position: CanvasPosition) => void
  onGenerate: (node: CanvasNode) => void
  onUploadImage: (node: CanvasNode, file: File) => void
  onConnectionStart: (nodeId: string, event: React.PointerEvent) => void
  onCreateConnected: (
    nodeId: string,
    side: 'left' | 'right',
    type: CanvasNodeType
  ) => void
  onOpenSettings: () => void
}

const NODE_TYPE_ICON = {
  text: Type,
  image: ImageIcon,
  video: Video,
} as const

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

const MIN_WIDTH = 240
const MIN_HEIGHT = 160

const CORNER_CLASSES = {
  nw: '-top-1 -left-1 cursor-nwse-resize',
  ne: '-top-1 -right-1 cursor-nesw-resize',
  sw: '-bottom-1 -left-1 cursor-nesw-resize',
  se: '-bottom-1 -right-1 cursor-nwse-resize',
} as const

export const CanvasNodeView = React.memo(function CanvasNodeView(
  props: CanvasNodeViewProps
) {
  const {
    node,
    theme,
    selected,
    referenceCount,
    modelConfigured,
    isConnectionTarget,
    getScale,
    onSelect,
    onPatch,
    onMove,
    onGenerate,
    onUploadImage,
    onConnectionStart,
    onCreateConnected,
    onOpenSettings,
  } = props
  const { t } = useTranslation()

  const [editingTitle, setEditingTitle] = React.useState(false)
  const [titleValue, setTitleValue] = React.useState(node.title)
  const [editingPrompt, setEditingPrompt] = React.useState(false)
  const [menuSide, setMenuSide] = React.useState<'left' | 'right' | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const dragState = React.useRef({
    active: false,
    moved: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    pending: null as CanvasPosition | null,
    frame: null as number | null,
  })

  const TypeIcon = NODE_TYPE_ICON[node.type]
  const status = node.metadata.status ?? 'idle'
  const loading = status === 'loading'
  const hasMedia = Boolean(node.metadata.url)

  // 生成成功后自动回到媒体视图（重新生成流程中composer自动收起）
  React.useEffect(() => {
    if (node.metadata.status === 'success' && node.metadata.url) {
      setEditingPrompt(false)
    }
  }, [node.metadata.status, node.metadata.url])

  // ----- 节点拖拽（rAF 合帧，直接提交位置，视口手势互不干扰） -----
  const handleCardPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType !== 'touch') return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('button,input,textarea,select,a,[data-no-drag]')) return
    event.stopPropagation()
    onSelect(node.id)
    const state = dragState.current
    state.active = true
    state.moved = false
    state.pointerId = event.pointerId
    state.startX = event.clientX
    state.startY = event.clientY
    state.originX = node.position.x
    state.originY = node.position.y
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleCardPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current
    if (!state.active || state.pointerId !== event.pointerId) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
    state.moved = true
    setDragging(true)
    const scale = getScale()
    state.pending = {
      x: state.originX + dx / scale,
      y: state.originY + dy / scale,
    }
    if (state.frame === null) {
      state.frame = requestAnimationFrame(() => {
        state.frame = null
        if (state.pending) onMove(node.id, state.pending)
      })
    }
  }

  const handleCardPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current
    if (!state.active || state.pointerId !== event.pointerId) return
    state.active = false
    if (state.frame !== null) {
      cancelAnimationFrame(state.frame)
      state.frame = null
    }
    if (state.pending) onMove(node.id, state.pending)
    state.pending = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  // ----- 四角缩放（图片有产物时保持原始比例） -----
  const handleResizePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
    corner: 'nw' | 'ne' | 'sw' | 'se'
  ) => {
    event.stopPropagation()
    event.preventDefault()
    onSelect(node.id)
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startY = event.clientY
    const start = { ...node.position, width: node.width, height: node.height }
    const aspect =
      node.type === 'image' &&
      node.metadata.url &&
      node.metadata.naturalWidth &&
      node.metadata.naturalHeight
        ? node.metadata.naturalWidth / node.metadata.naturalHeight
        : null

    const handleMove = (moveEvent: PointerEvent) => {
      const scale = getScale()
      const dx = (moveEvent.clientX - startX) / scale
      const dy = (moveEvent.clientY - startY) / scale
      let width = start.width
      let height = start.height
      let x = start.x
      let y = start.y
      if (corner === 'se' || corner === 'ne') width = start.width + dx
      else width = start.width - dx
      if (corner === 'se' || corner === 'sw') height = start.height + dy
      else height = start.height - dy
      width = Math.max(MIN_WIDTH, width)
      height = Math.max(MIN_HEIGHT, height)
      if (aspect) {
        height = Math.max(MIN_HEIGHT, width / aspect)
        width = height * aspect
      }
      if (corner === 'nw' || corner === 'sw') x = start.x + start.width - width
      if (corner === 'nw' || corner === 'ne') {
        y = start.y + start.height - height
      }
      onPatch(node.id, { position: { x, y }, width, height })
    }
    const handleUp = (upEvent: PointerEvent) => {
      element.removeEventListener('pointermove', handleMove)
      element.removeEventListener('pointerup', handleUp)
      element.removeEventListener('pointercancel', handleUp)
      if (element.hasPointerCapture(upEvent.pointerId)) {
        element.releasePointerCapture(upEvent.pointerId)
      }
    }
    element.addEventListener('pointermove', handleMove)
    element.addEventListener('pointerup', handleUp)
    element.addEventListener('pointercancel', handleUp)
  }

  // ----- 连接轨：拖拽连线 / 单击弹出「添加相连节点」菜单 -----
  const railPointerState = React.useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    started: false,
    side: 'right' as 'left' | 'right',
  })

  const handleRailPointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    side: 'left' | 'right'
  ) => {
    event.stopPropagation()
    if (side === 'left') return // 左轨只作为连线落点提示
    const state = railPointerState.current
    state.pointerId = event.pointerId
    state.startX = event.clientX
    state.startY = event.clientY
    state.started = false
    state.side = side
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleRailPointerMove = (
    event: React.PointerEvent<HTMLButtonElement>
  ) => {
    const state = railPointerState.current
    if (state.pointerId !== event.pointerId || state.started) return
    if (
      Math.abs(event.clientX - state.startX) > 5 ||
      Math.abs(event.clientY - state.startY) > 5
    ) {
      state.started = true
      setMenuSide(null)
      onConnectionStart(node.id, event)
    }
  }

  const handleRailPointerUp = (
    event: React.PointerEvent<HTMLButtonElement>
  ) => {
    const state = railPointerState.current
    if (state.pointerId !== event.pointerId) return
    state.pointerId = -1
    if (!state.started) {
      setMenuSide((prev) => (prev === state.side ? null : state.side))
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  // 菜单外点击关闭
  React.useEffect(() => {
    if (!menuSide) return
    const close = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (!target?.closest('[data-connection-create-menu]')) setMenuSide(null)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menuSide])

  const commitTitle = () => {
    setEditingTitle(false)
    const title = titleValue.trim()
    if (title && title !== node.title) onPatch(node.id, { title })
    else setTitleValue(node.title)
  }

  const patchMetadata = (metadata: Partial<CanvasNodeMetadata>) =>
    onPatch(node.id, { metadata })

  const selectStyle: React.CSSProperties = {
    background: theme.node.panel,
    color: theme.node.text,
    border: `1px solid ${theme.node.stroke}`,
  }

  const renderComposer = () => (
    <div className='flex min-h-0 flex-1 flex-col gap-2 p-3'>
      <textarea
        value={node.metadata.prompt ?? ''}
        onChange={(e) => patchMetadata({ prompt: e.target.value })}
        placeholder={
          node.type === 'image'
            ? t('Describe the image you want to generate...')
            : t('Describe the motion and scene of the video...')
        }
        className='canvas-scroll min-h-16 w-full flex-1 resize-none rounded-lg bg-transparent p-2 text-xs leading-relaxed outline-none'
        style={{
          color: theme.node.text,
          border: `1px solid ${theme.node.stroke}`,
        }}
      />
      {referenceCount > 0 && (
        <div
          className='flex items-center gap-1 text-[11px]'
          style={{ color: theme.node.muted }}
        >
          <Link2 aria-hidden='true' className='size-3' />
          {t('Upstream reference images')} ×{referenceCount}
        </div>
      )}
      {!modelConfigured && (
        <button
          type='button'
          onClick={onOpenSettings}
          className='flex items-center gap-1 rounded-md px-1.5 py-1 text-left text-[11px]'
          style={{ background: 'rgba(245,158,11,.15)', color: '#fcd34d' }}
        >
          <Settings2 aria-hidden='true' className='size-3 shrink-0' />
          {t('Model not configured, click to set up')}
        </button>
      )}
      <div className='flex flex-wrap items-center gap-1.5'>
        {node.type === 'image' ? (
          <select
            value={node.metadata.size ?? '2048x2048'}
            onChange={(e) => patchMetadata({ size: e.target.value })}
            className='h-7 rounded-md px-1.5 text-[11px] outline-none'
            style={selectStyle}
            aria-label={t('Image size')}
          >
            {IMAGE_SIZE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <>
            <select
              value={node.metadata.aspectRatio ?? '16:9'}
              onChange={(e) => patchMetadata({ aspectRatio: e.target.value })}
              className='h-7 rounded-md px-1.5 text-[11px] outline-none'
              style={selectStyle}
              aria-label={t('Aspect ratio')}
            >
              {VIDEO_ASPECT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <select
              value={node.metadata.duration ?? 5}
              onChange={(e) =>
                patchMetadata({ duration: Number(e.target.value) })
              }
              className='h-7 rounded-md px-1.5 text-[11px] outline-none'
              style={selectStyle}
              aria-label={t('Duration')}
            >
              {VIDEO_DURATION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}s
                </option>
              ))}
            </select>
            <select
              value={node.metadata.resolution ?? '720p'}
              onChange={(e) => patchMetadata({ resolution: e.target.value })}
              className='h-7 rounded-md px-1.5 text-[11px] outline-none'
              style={selectStyle}
              aria-label={t('Resolution')}
            >
              {VIDEO_RESOLUTION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      <div className='flex items-center gap-1.5'>
        <button
          type='button'
          disabled={loading || !(node.metadata.prompt ?? '').trim()}
          onClick={() => onGenerate(node)}
          className='flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40'
          style={{
            background: theme.accent.primary,
            color: theme.accent.onPrimary,
          }}
        >
          {loading ? (
            <Loader2 aria-hidden='true' className='size-3.5 animate-spin' />
          ) : (
            <Sparkles aria-hidden='true' className='size-3.5' />
          )}
          {loading ? t('Generating...') : t('Generate')}
        </button>
        {node.type === 'image' && (
          <>
            <button
              type='button'
              onClick={() => fileInputRef.current?.click()}
              className='flex size-8 items-center justify-center rounded-lg transition-colors'
              style={{
                border: `1px solid ${theme.node.stroke}`,
                color: theme.node.muted,
              }}
              aria-label={t('Upload image')}
              title={t('Upload image')}
            >
              <Upload aria-hidden='true' className='size-3.5' />
            </button>
            <input
              ref={fileInputRef}
              type='file'
              accept='image/*'
              className='hidden'
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onUploadImage(node, file)
                e.target.value = ''
              }}
            />
          </>
        )}
        {editingPrompt && hasMedia && (
          <button
            type='button'
            onClick={() => setEditingPrompt(false)}
            className='flex size-8 items-center justify-center rounded-lg'
            style={{
              border: `1px solid ${theme.node.stroke}`,
              color: theme.node.muted,
            }}
            aria-label={t('Back to result')}
          >
            <X aria-hidden='true' className='size-3.5' />
          </button>
        )}
      </div>
    </div>
  )

  const renderMedia = () => (
    <div
      className='group/media relative min-h-0 flex-1 overflow-hidden rounded-b-[13px]'
      style={{ background: 'rgba(0,0,0,.25)' }}
    >
      {node.type === 'image' ? (
        <img
          src={node.metadata.url}
          alt={node.title}
          draggable={false}
          className='size-full object-contain'
          onLoad={(e) => {
            const img = e.currentTarget
            if (
              img.naturalWidth &&
              (node.metadata.naturalWidth !== img.naturalWidth ||
                node.metadata.naturalHeight !== img.naturalHeight)
            ) {
              patchMetadata({
                naturalWidth: img.naturalWidth,
                naturalHeight: img.naturalHeight,
              })
            }
          }}
        />
      ) : (
        <video
          src={node.metadata.url}
          controls
          playsInline
          preload='metadata'
          className='size-full object-contain'
          data-no-drag
        />
      )}
      {/* 悬停工具：重新生成 / 下载 */}
      <div className='absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover/media:opacity-100'>
        <button
          type='button'
          onClick={() => setEditingPrompt(true)}
          className='flex size-7 items-center justify-center rounded-md bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75'
          aria-label={t('Regenerate')}
          title={t('Regenerate')}
        >
          <RefreshCw aria-hidden='true' className='size-3.5' />
        </button>
        <a
          href={node.metadata.url}
          download
          target='_blank'
          rel='noreferrer'
          className='flex size-7 items-center justify-center rounded-md bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75'
          aria-label={t('Download')}
          title={t('Download')}
        >
          <Download aria-hidden='true' className='size-3.5' />
        </a>
      </div>
    </div>
  )

  const renderError = () => (
    <div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center'>
      <AlertCircle
        aria-hidden='true'
        className='size-6'
        style={{ color: theme.accent.danger }}
      />
      <p
        className='canvas-scroll line-clamp-4 text-[11px] leading-relaxed'
        style={{ color: theme.node.muted }}
      >
        {node.metadata.error || t('Generation failed')}
      </p>
      <button
        type='button'
        onClick={() => onGenerate(node)}
        className='flex h-7 items-center gap-1 rounded-lg px-3 text-[11px] font-medium'
        style={{
          background: theme.accent.primarySoft,
          color: theme.node.text,
        }}
      >
        <RefreshCw aria-hidden='true' className='size-3' />
        {t('Retry')}
      </button>
    </div>
  )

  const renderLoading = () => (
    <div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4'>
      <div className='canvas-node-loading-ring relative flex size-12 items-center justify-center'>
        <Loader2
          aria-hidden='true'
          className='size-8 animate-spin'
          style={{ color: theme.accent.primary }}
        />
      </div>
      <p className='text-xs' style={{ color: theme.node.muted }}>
        {node.type === 'video'
          ? t('Generating video, this may take a few minutes...')
          : t('Generating image...')}
      </p>
    </div>
  )

  const renderBody = () => {
    if (node.type === 'text') {
      return (
        <textarea
          ref={textareaRef}
          value={node.metadata.content ?? ''}
          onChange={(e) => patchMetadata({ content: e.target.value })}
          placeholder={t('Type your idea, prompt or note here...')}
          className='canvas-scroll min-h-0 w-full flex-1 resize-none bg-transparent p-3 text-sm leading-relaxed outline-none'
          style={{ color: theme.node.text }}
          data-no-drag
        />
      )
    }
    if (loading) return renderLoading()
    if (status === 'error' && !hasMedia) return renderError()
    if (hasMedia && !editingPrompt) return renderMedia()
    return renderComposer()
  }

  const renderRail = (side: 'left' | 'right') => (
    <div
      className={`absolute top-1/2 z-10 -translate-y-1/2 ${side === 'left' ? '-left-3.5' : '-right-3.5'}`}
    >
      <button
        type='button'
        data-no-drag
        onPointerDown={(e) => handleRailPointerDown(e, side)}
        onPointerMove={handleRailPointerMove}
        onPointerUp={handleRailPointerUp}
        className={`flex size-6 cursor-crosshair items-center justify-center rounded-full transition-all duration-150 ${
          selected || isConnectionTarget
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100'
        } ${isConnectionTarget && side === 'left' ? 'scale-125' : ''}`}
        style={{
          background: theme.node.panel,
          border: `1px solid ${isConnectionTarget && side === 'left' ? theme.accent.primary : theme.node.stroke}`,
          color: theme.node.muted,
          boxShadow: theme.node.shadow,
        }}
        aria-label={
          side === 'right'
            ? t('Drag to connect, click to add node')
            : t('Connection input')
        }
      >
        <Plus aria-hidden='true' className='size-3.5' />
      </button>
      {menuSide === side && (
        <div
          data-connection-create-menu
          data-canvas-no-zoom
          className={`absolute top-1/2 z-30 w-36 -translate-y-1/2 overflow-hidden rounded-lg py-1 ${side === 'right' ? 'left-8' : 'right-8'}`}
          style={{
            background: theme.toolbar.panel,
            border: `1px solid ${theme.toolbar.border}`,
            boxShadow: theme.node.hoverShadow,
            backdropFilter: 'blur(12px)',
          }}
        >
          {(['image', 'video', 'text'] as const).map((type) => {
            const Icon = NODE_TYPE_ICON[type]
            return (
              <button
                key={type}
                type='button'
                onClick={() => {
                  setMenuSide(null)
                  onCreateConnected(node.id, side, type)
                }}
                className='flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors'
                style={{ color: theme.toolbar.item }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = theme.toolbar.itemHover
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <Icon aria-hidden='true' className='size-3.5' />
                {t(CANVAS_NODE_TITLE_KEYS[type])}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )

  let zIndex = 10
  if (dragging) zIndex = 30
  else if (selected) zIndex = 20

  return (
    <div
      data-node-id={node.id}
      className='group absolute flex flex-col'
      style={{
        left: node.position.x,
        top: node.position.y,
        width: node.width,
        height: node.height,
        background: theme.node.fill,
        border: `${selected ? 1.5 : 1}px solid ${selected ? theme.node.activeStroke : theme.node.stroke}`,
        borderRadius: 14,
        boxShadow: selected ? theme.node.hoverShadow : theme.node.shadow,
        zIndex,
        cursor: dragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        outline: isConnectionTarget
          ? `2px solid ${theme.accent.primary}`
          : undefined,
        outlineOffset: 3,
      }}
      onPointerDown={handleCardPointerDown}
      onPointerMove={handleCardPointerMove}
      onPointerUp={handleCardPointerUp}
      onPointerCancel={handleCardPointerUp}
      onDoubleClick={(event) => {
        if (node.type === 'text') {
          event.stopPropagation()
          textareaRef.current?.focus()
        }
      }}
    >
      {/* 外置标题行：inverse-scale 保持屏幕尺寸恒定 */}
      <div
        className='absolute bottom-full left-0 mb-1.5 flex items-center gap-1.5 whitespace-nowrap'
        style={{
          transform: 'scale(var(--canvas-live-inverse-scale, 1))',
          transformOrigin: 'bottom left',
        }}
        data-no-drag
      >
        <TypeIcon
          aria-hidden='true'
          className='size-3.5 shrink-0'
          style={{ color: theme.node.muted }}
        />
        {editingTitle ? (
          <input
            value={titleValue}
            autoFocus
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle()
              if (e.key === 'Escape') {
                setTitleValue(node.title)
                setEditingTitle(false)
              }
            }}
            className='w-40 rounded-md px-1.5 py-0.5 text-xs outline-none'
            style={{
              background: theme.node.panel,
              color: theme.node.text,
              border: `1px solid ${theme.node.stroke}`,
            }}
          />
        ) : (
          <button
            type='button'
            onClick={() => {
              setTitleValue(node.title)
              setEditingTitle(true)
            }}
            className='flex max-w-56 items-center gap-1 text-xs font-medium'
            style={{ color: theme.node.muted }}
            title={t('Click to rename node')}
          >
            <span className='truncate'>{node.title}</span>
            <Pencil
              aria-hidden='true'
              className='size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60'
            />
          </button>
        )}
      </div>

      {renderRail('left')}
      {renderRail('right')}
      {renderBody()}

      {/* 四角缩放手柄 */}
      {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
        <div
          key={corner}
          data-no-drag
          onPointerDown={(e) => handleResizePointerDown(e, corner)}
          className={`absolute size-2.5 rounded-[3px] transition-opacity ${
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          } ${CORNER_CLASSES[corner]}`}
          style={{
            background: theme.node.panel,
            border: `1px solid ${selected ? theme.node.activeStroke : theme.node.stroke}`,
          }}
        />
      ))}
    </div>
  )
})
