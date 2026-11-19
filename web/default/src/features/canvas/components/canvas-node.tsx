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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Download,
  Folder,
  History,
  Image as ImageIcon,
  Link2,
  Loader2,
  Lock,
  Music2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Table2,
  Trash2,
  Type,
  Upload,
  Video,
  WandSparkles,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import type { CanvasTheme } from '../canvas-theme'
import type {
  CanvasNode,
  CanvasNodeMetadata,
  CanvasNodeType,
  CanvasPosition,
  CanvasScriptScene,
} from '../types'
import {
  CanvasCreateList,
  type CanvasCreateCommandId,
} from './canvas-create-menu'
import {
  CanvasNodeToolbar,
  type CanvasNodeToolId,
} from './canvas-node-toolbar'
import { CanvasScriptTable } from './canvas-script-table'

// ===== 画布节点卡片（移植自 BeefTV canvas-node：外置标题/四角缩放/连接轨/全类型渲染） =====

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
  modelConfigured: boolean
  textModelName?: string
  isConnectionTarget: boolean
  folderItemCount: number
  getScale: () => number
  onSelect: (id: string, additive: boolean) => void
  onPatch: (id: string, patch: CanvasNodePatch, silent?: boolean) => void
  onMove: (id: string, position: CanvasPosition) => void
  onBeginEdit: () => void
  onEndEdit: () => void
  onGenerate: (node: CanvasNode) => void
  onUploadFile: (node: CanvasNode, file: File) => void
  onConnectionStart: (nodeId: string, event: React.PointerEvent) => void
  onCreateConnected: (
    nodeId: string,
    side: 'left' | 'right',
    type: CanvasNodeType
  ) => void
  onOpenSettings: () => void
  onOpenDrawing: (node: CanvasNode) => void
  onOpenDirector: (node: CanvasNode) => void
  onExpandScene: (node: CanvasNode, scene: CanvasScriptScene) => void
  onSceneVideo: (node: CanvasNode, scene: CanvasScriptScene) => void
  onEnlarge: (node: CanvasNode) => void
  onBatchGenerate: (node: CanvasNode) => void
  references: {
    connectionId: string
    id: string
    title: string
    url?: string
    type: CanvasNodeType
  }[]
  onTool: (node: CanvasNode, tool: CanvasNodeToolId) => void
  onOpenFolder: (node: CanvasNode) => void
}

const NODE_TYPE_ICON = {
  text: Type,
  image: ImageIcon,
  video: Video,
  audio: Music2,
  upscale: WandSparkles,
  script: Clapperboard,
  director: Clapperboard,
  folder: Folder,
  drawing: Pencil,
  batch: Table2,
} as const

const RAIL_CREATABLE_TYPES = new Set<CanvasCreateCommandId>([
  'text',
  'image',
  'video',
  'upscale',
  'audio',
  'script',
  'director',
  'drawing',
  'folder',
  'batch',
])

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
    modelConfigured,
    textModelName,
    isConnectionTarget,
    folderItemCount,
    getScale,
    onSelect,
    onPatch,
    onMove,
    onBeginEdit,
    onEndEdit,
    onGenerate,
    onUploadFile,
    onConnectionStart,
    onCreateConnected,
    onOpenSettings,
    onOpenDrawing,
    onOpenDirector,
    onExpandScene,
    onSceneVideo,
    onEnlarge,
    onBatchGenerate,
    references,
    onTool,
    onOpenFolder,
  } = props
  const { t } = useTranslation()

  const [editingTitle, setEditingTitle] = React.useState(false)
  const [titleValue, setTitleValue] = React.useState(node.title)
  const [editingContent, setEditingContent] = React.useState(false)
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
  const isFolder = node.type === 'folder'
  const locked = Boolean(node.metadata.locked)
  const history = node.metadata.history ?? []
  const historyIndex = Math.min(
    node.metadata.historyIndex ?? history.length - 1,
    history.length - 1
  )
  // ----- 节点拖拽（rAF 合帧，直接提交位置，视口手势互不干扰） -----
  const handleCardPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType !== 'touch') return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('button,input,textarea,select,a,[data-no-drag]')) return
    event.stopPropagation()
    onSelect(node.id, event.shiftKey)
    if (locked) return
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
    if (!state.moved) onBeginEdit()
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
    if (state.moved) onEndEdit()
    state.pending = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  // ----- 四角缩放（图片类有产物时保持原始比例） -----
  const handleResizePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
    corner: 'nw' | 'ne' | 'sw' | 'se'
  ) => {
    event.stopPropagation()
    event.preventDefault()
    if (locked) return
    onSelect(node.id, false)
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startY = event.clientY
    const start = { ...node.position, width: node.width, height: node.height }
    const locksAspect =
      node.type === 'image' ||
      node.type === 'upscale' ||
      node.type === 'drawing'
    const aspect =
      locksAspect &&
      node.metadata.url &&
      node.metadata.naturalWidth &&
      node.metadata.naturalHeight
        ? node.metadata.naturalWidth / node.metadata.naturalHeight
        : null

    let resizeMoved = false
    const handleMove = (moveEvent: PointerEvent) => {
      if (!resizeMoved) {
        resizeMoved = true
        onBeginEdit()
      }
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
      if (resizeMoved) onEndEdit()
      if (element.hasPointerCapture(upEvent.pointerId)) {
        element.releasePointerCapture(upEvent.pointerId)
      }
    }
    element.addEventListener('pointermove', handleMove)
    element.addEventListener('pointerup', handleUp)
    element.addEventListener('pointercancel', handleUp)
  }

  // ----- 连接轨：拖拽连线 / 单击弹出「添加相连节点」list -----
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
    onEndEdit()
    const title = titleValue.trim()
    if (title && title !== node.title) onPatch(node.id, { title })
    else setTitleValue(node.title)
  }

  const patchMetadata = (metadata: Partial<CanvasNodeMetadata>) =>
    onPatch(node.id, { metadata })

  const uploadAccept = node.type === 'audio' ? 'audio/*' : 'image/*'

  const renderUploadButton = (label: string) => (
    <>
      <button
        type='button'
        onClick={() => fileInputRef.current?.click()}
        className='flex size-8 items-center justify-center rounded-lg transition-colors'
        style={{
          border: `1px solid ${theme.node.stroke}`,
          color: theme.node.muted,
        }}
        aria-label={label}
        title={label}
      >
        <Upload aria-hidden='true' className='size-3.5' />
      </button>
      <input
        ref={fileInputRef}
        type='file'
        accept={uploadAccept}
        className='hidden'
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onUploadFile(node, file)
          e.target.value = ''
        }}
      />
    </>
  )

  const renderMediaElement = () => {
    if (node.type === 'video') {
      return (
        <video
          src={node.metadata.url}
          controls
          playsInline
          preload='metadata'
          className='size-full object-contain'
          data-no-drag
        />
      )
    }
    if (node.type === 'audio') {
      return (
        <div className='flex size-full flex-col items-center justify-center gap-3 px-4'>
          <Music2
            aria-hidden='true'
            className='size-8'
            style={{ color: '#a855f7' }}
          />
          <audio
            src={node.metadata.url}
            controls
            preload='metadata'
            className='w-full'
            data-no-drag
          />
        </div>
      )
    }
    return (
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
            // 尺寸是派生元数据，静默落盘，避免每张图加载都压入一条撤销快照
            onPatch(
              node.id,
              {
                metadata: {
                  naturalWidth: img.naturalWidth,
                  naturalHeight: img.naturalHeight,
                },
              },
              true
            )
          }
        }}
      />
    )
  }

  const renderMedia = () => (
    <div
      className='group/media relative min-h-0 flex-1 overflow-hidden rounded-b-[13px]'
      style={{ background: 'rgba(0,0,0,.25)' }}
    >
      {renderMediaElement()}
      {node.type === 'upscale' && (
        <span
          className='absolute top-2 left-2 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-medium'
          style={{ background: 'rgba(0,0,0,.55)', color: '#fff' }}
        >
          <WandSparkles aria-hidden='true' className='size-2.5' />
          {t('AI upscale')}
        </span>
      )}
      {/* 悬停工具：重新生成 / 编辑绘图 / 下载 */}
      <div className='absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-hover/media:opacity-100'>
        {node.type === 'drawing' ? (
          <button
            type='button'
            onClick={() => onOpenDrawing(node)}
            className='flex size-7 items-center justify-center rounded-md bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75'
            aria-label={t('Edit drawing')}
            title={t('Edit drawing')}
          >
            <Pencil aria-hidden='true' className='size-3.5' />
          </button>
        ) : (
          <button
            type='button'
            onClick={() => onGenerate(node)}
            className='flex size-7 items-center justify-center rounded-md bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75'
            aria-label={t('Regenerate')}
            title={t('Regenerate')}
          >
            <RefreshCw aria-hidden='true' className='size-3.5' />
          </button>
        )}
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

  const renderLoading = () => {
    let loadingLabel = t('Generating image...')
    if (node.type === 'video') {
      loadingLabel = t('Generating video, this may take a few minutes...')
    } else if (node.type === 'text') {
      loadingLabel = t('Generating text...')
    } else if (node.type === 'audio') {
      loadingLabel = t('Generating audio...')
    }
    return (
      <div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4'>
        <div className='canvas-node-loading-ring relative flex size-12 items-center justify-center'>
          <Loader2
            aria-hidden='true'
            className='size-8 animate-spin'
            style={{ color: theme.accent.primary }}
          />
        </div>
        <p className='text-xs' style={{ color: theme.node.muted }}>
          {loadingLabel}
        </p>
      </div>
    )
  }

  // ----- 各类型节点主体 -----
  const renderBody = () => {
    if (node.type === 'text') {
      const content = node.metadata.content ?? ''
      const fontSize = node.metadata.fontSize ?? 14
      if (editingContent) {
        return (
          <textarea
            ref={textareaRef}
            autoFocus
            value={content}
            onChange={(e) => patchMetadata({ content: e.target.value })}
            onBlur={() => {
              setEditingContent(false)
              onEndEdit()
            }}
            placeholder={t('Type your idea, prompt or note here...')}
            aria-label={t('Node text')}
            className='canvas-scroll size-full resize-none rounded-[13px] bg-transparent p-3 leading-relaxed outline-none'
            style={{ color: theme.node.text, fontSize }}
          />
        )
      }
      if (!content.trim()) {
        // 空态：居中四条占位横条（对齐 BeefTV），双击卡片进入编辑
        return (
          <div className='flex size-full flex-col items-center justify-center gap-2.5'>
            {[64, 88, 76, 52].map((width) => (
              <div
                key={width}
                className='h-1.5 rounded-full'
                style={{ width, background: theme.node.stroke }}
              />
            ))}
          </div>
        )
      }
      return (
        <div
          className='canvas-scroll size-full overflow-y-auto p-3'
          data-canvas-wheel-scroll
        >
          <p
            className='leading-relaxed whitespace-pre-wrap'
            style={{ color: theme.node.text, fontSize }}
          >
            {content}
          </p>
        </div>
      )
    }

    if (node.type === 'folder') {
      const collapsed = Boolean(node.metadata.collapsed)
      return (
        <div className='flex size-full flex-col'>
          <div className='flex items-center gap-2 px-3 py-2'>
            <button
              type='button'
              onClick={() => patchMetadata({ collapsed: !collapsed })}
              className='flex size-6 cursor-pointer items-center justify-center rounded-md transition-colors'
              style={{ color: theme.node.muted }}
              aria-label={collapsed ? t('Expand folder') : t('Collapse folder')}
              title={collapsed ? t('Expand folder') : t('Collapse folder')}
            >
              {collapsed ? (
                <ChevronRight aria-hidden='true' className='size-4' />
              ) : (
                <ChevronDown aria-hidden='true' className='size-4' />
              )}
            </button>
            <span
              className='rounded-md px-1.5 py-0.5 text-[10px] tabular-nums'
              style={{
                background: theme.toolbar.itemHover,
                color: theme.node.muted,
              }}
            >
              {t('{{count}} items', { count: folderItemCount })}
            </span>
          </div>
          {collapsed ? (
            <div className='flex flex-1 flex-col items-center justify-center gap-2 pb-4'>
              <Folder
                aria-hidden='true'
                className='size-10'
                style={{ color: theme.node.faint }}
              />
              <p className='text-[11px]' style={{ color: theme.node.faint }}>
                {t('Folder collapsed')}
              </p>
            </div>
          ) : (
            <p
              className='px-3 pb-2 text-[11px] leading-relaxed'
              style={{ color: theme.node.faint }}
            >
              {t('Drag nodes into the folder area. Collapse to hide them.')}
            </p>
          )}
        </div>
      )
    }

    if (node.type === 'script') {
      return (
        <CanvasScriptTable
          node={node}
          theme={theme}
          modelConfigured={modelConfigured}
          textModelName={textModelName}
          onPatchMetadata={patchMetadata}
          onBeginEdit={onBeginEdit}
          onEndEdit={onEndEdit}
          onExpandScene={onExpandScene}
          onSceneVideo={onSceneVideo}
          onOpenSettings={onOpenSettings}
          onNodeInfo={(target) => onTool(target, 'info')}
          onEnlarge={onEnlarge}
        />
      )
    }

    if (node.type === 'batch') {
      const rows = node.metadata.rows ?? ['']
      const nonEmptyCount = rows.filter((row) => row.trim()).length
      return (
        <div className='flex min-h-0 flex-1 flex-col gap-2 p-3'>
          <p className='text-[11px]' style={{ color: theme.node.faint }}>
            {t('One prompt per row. Each row generates an image node.')}
          </p>
          <div className='canvas-scroll flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto'>
            {rows.map((row, index) => (
              // 行内容可编辑，用下标作 key 避免输入时重挂载失焦
              // eslint-disable-next-line react/no-array-index-key
              <div key={index} className='flex items-center gap-1.5'>
                <span
                  className='w-5 shrink-0 text-right text-[10px] tabular-nums'
                  style={{ color: theme.node.faint }}
                >
                  {index + 1}
                </span>
                <input
                  value={row}
                  onFocus={onBeginEdit}
                  onBlur={onEndEdit}
                  onChange={(e) =>
                    patchMetadata({
                      rows: rows.map((r, i) =>
                        i === index ? e.target.value : r
                      ),
                    })
                  }
                  placeholder={t('Prompt for row {{n}}', { n: index + 1 })}
                  aria-label={t('Prompt for row {{n}}', { n: index + 1 })}
                  className='h-8 min-w-0 flex-1 rounded-md bg-transparent px-2 text-xs outline-none'
                  style={{
                    color: theme.node.text,
                    border: `1px solid ${theme.node.stroke}`,
                  }}
                />
                <button
                  type='button'
                  disabled={rows.length <= 1}
                  onClick={() =>
                    patchMetadata({ rows: rows.filter((_, i) => i !== index) })
                  }
                  className='flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-35'
                  style={{ color: theme.accent.danger }}
                  aria-label={t('Delete row')}
                  title={t('Delete row')}
                >
                  <Trash2 aria-hidden='true' className='size-3.5' />
                </button>
              </div>
            ))}
          </div>
          <div className='flex shrink-0 items-center gap-1.5'>
            <button
              type='button'
              onClick={() => patchMetadata({ rows: [...rows, ''] })}
              className='flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2.5 text-[11px] transition-colors'
              style={{
                border: `1px solid ${theme.node.stroke}`,
                color: theme.node.muted,
              }}
            >
              <Plus aria-hidden='true' className='size-3' />
              {t('Add row')}
            </button>
            <button
              type='button'
              disabled={nonEmptyCount === 0}
              onClick={() => onBatchGenerate(node)}
              className='flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-40'
              style={{
                background: theme.accent.primary,
                color: theme.accent.onPrimary,
              }}
            >
              <Sparkles aria-hidden='true' className='size-3.5' />
              {t('Generate {{count}} images', { count: nonEmptyCount })}
            </button>
          </div>
        </div>
      )
    }

    if (
      node.type === 'drawing' &&
      !hasMedia &&
      !loading &&
      status !== 'error'
    ) {
      return (
        <div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4'>
          <Pencil
            aria-hidden='true'
            className='size-8'
            style={{ color: theme.node.faint }}
          />
          <button
            type='button'
            onClick={() => onOpenDrawing(node)}
            className='flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-medium'
            style={{
              background: theme.accent.primary,
              color: theme.accent.onPrimary,
            }}
          >
            <Pencil aria-hidden='true' className='size-3.5' />
            {t('Start drawing')}
          </button>
        </div>
      )
    }

    if (node.type === 'upscale' && !hasMedia && !loading && status !== 'error') {
      const imageCount =
        references.filter(
          (ref) =>
            ref.type === 'image' ||
            ref.type === 'drawing' ||
            ref.type === 'upscale'
        ).length + (node.metadata.sourceUrl ? 1 : 0)
      const videoCount = references.filter((ref) => ref.type === 'video').length
      return (
        <div className='group/upscale relative flex min-h-0 flex-1 flex-col'>
          <div
            className='flex items-center gap-1.5 px-3 pt-2.5 text-[10px]'
            style={{ color: theme.node.muted }}
          >
            <span
              className='rounded-md px-1.5 py-0.5 tabular-nums'
              style={{ background: theme.toolbar.itemHover }}
            >
              {t('{{count}} images', { count: imageCount })}
            </span>
            <span
              className='rounded-md px-1.5 py-0.5 tabular-nums'
              style={{ background: theme.toolbar.itemHover }}
            >
              {t('{{count}} videos', { count: videoCount })}
            </span>
          </div>
          <div className='flex flex-1 flex-col items-center justify-center gap-1.5 px-4 text-center'>
            <WandSparkles
              aria-hidden='true'
              className='size-7'
              style={{ color: theme.node.faint }}
            />
            <p className='text-[11px]' style={{ color: theme.node.muted }}>
              {t('Connect images or videos from the left')}
            </p>
            <p className='text-[10px]' style={{ color: theme.node.faint }}>
              {t('Multiple assets can be processed at once')}
            </p>
          </div>
          <div className='absolute right-2 bottom-2 opacity-0 transition-opacity group-hover/upscale:opacity-100'>
            {renderUploadButton(t('Upload source image'))}
          </div>
        </div>
      )
    }

    if (node.type === 'director') {
      const coverUrl = node.metadata.director?.coverUrl
      return (
        <div
          className='relative flex size-full items-center justify-center overflow-hidden'
          style={{ background: '#0a0a10' }}
        >
          {coverUrl && (
            <img
              src={coverUrl}
              alt=''
              draggable={false}
              className='absolute inset-0 size-full object-cover opacity-60'
            />
          )}
          <button
            type='button'
            onClick={() => onOpenDirector(node)}
            className='relative flex h-10 cursor-pointer items-center gap-2 rounded-xl px-4 text-xs font-semibold shadow-lg transition-transform hover:scale-105'
            style={{ background: '#fff', color: '#111' }}
          >
            <Clapperboard aria-hidden='true' className='size-4' />
            {t('Open director studio')}
          </button>
        </div>
      )
    }

    if (node.type === 'audio' && !hasMedia && !loading && status !== 'error') {
      return (
        <div className='group/audio relative flex min-h-0 flex-1 items-center justify-center'>
          <Music2
            aria-hidden='true'
            className='size-10'
            style={{ color: theme.node.faint }}
          />
          <div className='absolute right-2 bottom-2 opacity-0 transition-opacity group-hover/audio:opacity-100'>
            {renderUploadButton(t('Upload audio'))}
          </div>
        </div>
      )
    }

    if (loading) return renderLoading()
    if (status === 'error') return renderError()
    if (hasMedia) return renderMedia()
    // 空态占位图标：输入 composer 在节点下方弹出，不在卡内
    if (node.type === 'video') {
      return (
        <div className='flex min-h-0 flex-1 items-center justify-center'>
          <Play
            aria-hidden='true'
            className='size-10'
            fill='currentColor'
            strokeWidth={0}
            style={{ color: theme.node.faint }}
          />
        </div>
      )
    }
    return (
      <div className='flex min-h-0 flex-1 items-center justify-center'>
        <TypeIcon
          aria-hidden='true'
          className='size-10'
          style={{ color: theme.node.faint }}
        />
      </div>
    )
  }

  // ----- 连接轨按钮 + 「添加相连节点」弹层 -----
  const renderRail = (side: 'left' | 'right') => (
    <div
      className={`absolute top-1/2 z-30 -translate-y-1/2 transition-opacity ${
        side === 'left' ? '-left-3' : '-right-3'
      } ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
    >
      <button
        type='button'
        data-no-drag
        onPointerDown={(event) => handleRailPointerDown(event, side)}
        onPointerMove={handleRailPointerMove}
        onPointerUp={handleRailPointerUp}
        className='flex size-6 cursor-pointer items-center justify-center rounded-full transition-colors'
        style={{
          background: theme.node.panel,
          border: `1px solid ${
            isConnectionTarget ? theme.accent.primary : theme.node.stroke
          }`,
          color: isConnectionTarget ? theme.accent.primary : theme.node.muted,
          boxShadow: theme.node.shadow,
        }}
        aria-label={
          side === 'right' ? t('Add connected node') : t('Connection input')
        }
        title={
          side === 'right' ? t('Add connected node') : t('Connection input')
        }
      >
        {side === 'right' ? (
          <Plus aria-hidden='true' className='size-3' />
        ) : (
          <Link2 aria-hidden='true' className='size-3' />
        )}
      </button>
      {menuSide === side && (
        <div
          data-connection-create-menu
          onPointerDown={(event) => event.stopPropagation()}
          className={`canvas-scroll absolute top-8 max-h-80 w-58 overflow-y-auto rounded-xl py-1.5 ${
            side === 'left' ? 'left-0' : 'right-0'
          }`}
          style={{
            background: theme.toolbar.panel,
            border: `1px solid ${theme.toolbar.border}`,
            boxShadow: theme.node.hoverShadow,
          }}
        >
          <CanvasCreateList
            theme={theme}
            nodeTypesOnly
            includeResources={false}
            title={t('Add connected node')}
            onCommand={(id) => {
              if (!RAIL_CREATABLE_TYPES.has(id)) return
              setMenuSide(null)
              onCreateConnected(node.id, side, id as CanvasNodeType)
            }}
          />
        </div>
      )}
    </div>
  )

  let zIndex = 10
  if (isFolder) zIndex = 5
  else if (selected) zIndex = 20
  let cardBorder = `1px solid ${theme.node.stroke}`
  if (isFolder) {
    cardBorder = `1.5px dashed ${
      selected ? theme.accent.primary : theme.node.stroke
    }`
  } else if (isConnectionTarget) {
    cardBorder = `1px solid ${theme.accent.primary}`
  } else if (selected) {
    cardBorder = `1px solid ${theme.node.activeStroke}`
  }

  return (
    <div
      data-node-id={node.id}
      data-node-type={node.type}
      className='group absolute'
      style={{
        left: node.position.x,
        top: node.position.y,
        width: node.width,
        height: node.height,
        zIndex,
      }}
      onDoubleClick={(event) => {
        const target = event.target instanceof Element ? event.target : null
        if (target?.closest('button,input,textarea,select,a')) return
        if (node.type === 'text') {
          setEditingContent(true)
          onBeginEdit()
        } else if (node.type === 'drawing') onOpenDrawing(node)
        else if (node.type === 'director') onOpenDirector(node)
        else if (node.type === 'folder') onOpenFolder(node)
      }}
    >
      <CanvasNodeToolbar
        node={node}
        theme={theme}
        selected={selected}
        onTool={onTool}
      />
      {/* 历史版本堆叠层（最近两个旧版本垫在卡片后，仅视觉媒体节点） */}
      {history.length > 1 &&
        (node.type === 'image' ||
          node.type === 'video' ||
          node.type === 'upscale' ||
          node.type === 'drawing') && (
        <div aria-hidden='true' className='pointer-events-none absolute inset-0'>
          {[1, 2].map((layer) => {
            const entry = history[history.length - 1 - layer]
            if (!entry) return null
            return (
              <div
                key={entry.id}
                className='absolute inset-0 overflow-hidden rounded-[14px]'
                style={{
                  background: theme.node.panel,
                  boxShadow: `0 0 0 1px ${theme.node.stroke}`,
                  transform: `translate(${layer * 7}px, ${layer * 7}px) scale(${1 - layer * 0.008})`,
                  zIndex: -1,
                }}
              >
                <img
                  src={entry.url}
                  alt=''
                  draggable={false}
                  className='size-full object-cover'
                />
                <div
                  className='absolute inset-0'
                  style={{ background: `rgba(0,0,0,${0.28 + layer * 0.18})` }}
                />
              </div>
            )
          })}
        </div>
      )}
      {/* 外置标题（随缩放反向补偿，保持可读） */}
      <div
        className='absolute -top-7 left-0 flex items-center gap-1.5'
        style={{
          transform: 'scale(var(--canvas-live-inverse-scale, 1))',
          transformOrigin: 'left bottom',
        }}
      >
        <TypeIcon
          aria-hidden='true'
          className='size-3.5 shrink-0'
          style={{
            color: selected ? theme.accent.primary : theme.node.muted,
          }}
        />
        {editingTitle ? (
          <input
            value={titleValue}
            autoFocus
            data-no-drag
            onChange={(event) => setTitleValue(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitTitle()
              else if (event.key === 'Escape') {
                setTitleValue(node.title)
                setEditingTitle(false)
                onEndEdit()
              }
            }}
            aria-label={t('Node title')}
            className='h-6 w-44 rounded-md px-1.5 text-xs outline-none'
            style={{
              background: theme.node.panel,
              color: theme.node.text,
              border: `1px solid ${theme.accent.primary}`,
            }}
          />
        ) : (
          <button
            type='button'
            data-no-drag
            onClick={() => onSelect(node.id, false)}
            onDoubleClick={() => {
              setTitleValue(node.title)
              setEditingTitle(true)
              onBeginEdit()
            }}
            className='max-w-56 cursor-pointer truncate text-xs font-medium'
            style={{ color: theme.node.text }}
            title={node.title}
          >
            {node.title}
          </button>
        )}
        {loading && (
          <Loader2
            aria-hidden='true'
            className='size-3 shrink-0 animate-spin'
            style={{ color: theme.accent.primary }}
          />
        )}
        {locked && (
          <Lock
            aria-hidden='true'
            className='size-3 shrink-0'
            style={{ color: theme.node.muted }}
          />
        )}
      </div>

      {/* 卡片主体 */}
      <div
        className='relative flex size-full flex-col overflow-hidden rounded-[14px]'
        style={{
          background: isFolder ? `${theme.node.fill}66` : theme.node.fill,
          border: cardBorder,
          boxShadow:
            dragging || selected ? theme.node.hoverShadow : theme.node.shadow,
          cursor: dragging ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
        onPointerDown={handleCardPointerDown}
        onPointerMove={handleCardPointerMove}
        onPointerUp={handleCardPointerUp}
        onPointerCancel={handleCardPointerUp}
      >
        {history.length > 1 &&
          (node.type === 'image' ||
            node.type === 'video' ||
            node.type === 'upscale' ||
            node.type === 'drawing') && (
          <div
            data-no-drag
            className='absolute top-2 left-2 z-20 flex items-center gap-0.5 rounded-lg bg-black/55 px-1 py-0.5 text-white backdrop-blur-sm'
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              type='button'
              disabled={historyIndex <= 0}
              onClick={() =>
                patchMetadata({
                  url: history[historyIndex - 1].url,
                  historyIndex: historyIndex - 1,
                })
              }
              className='flex size-5 items-center justify-center rounded disabled:opacity-35'
              aria-label={t('Previous version')}
              title={t('Previous version')}
            >
              <ChevronLeft aria-hidden='true' className='size-3' />
            </button>
            <History aria-hidden='true' className='size-3' />
            <span className='text-[10px] tabular-nums'>
              {historyIndex + 1}/{history.length}
            </span>
            <button
              type='button'
              disabled={historyIndex >= history.length - 1}
              onClick={() =>
                patchMetadata({
                  url: history[historyIndex + 1].url,
                  historyIndex: historyIndex + 1,
                })
              }
              className='flex size-5 items-center justify-center rounded disabled:opacity-35'
              aria-label={t('Next version')}
              title={t('Next version')}
            >
              <ChevronRight aria-hidden='true' className='size-3' />
            </button>
          </div>
        )}
        {renderBody()}
      </div>

      {renderRail('left')}
      {renderRail('right')}

      {/* 四角缩放手柄（选中时显示） */}
      {selected &&
        (Object.keys(CORNER_CLASSES) as (keyof typeof CORNER_CLASSES)[]).map(
          (corner) => (
            <div
              key={corner}
              data-no-drag
              onPointerDown={(event) => handleResizePointerDown(event, corner)}
              className={`absolute z-30 size-2.5 rounded-[3px] ${CORNER_CLASSES[corner]}`}
              style={{
                background: theme.node.panel,
                border: `1.5px solid ${theme.accent.primary}`,
                touchAction: 'none',
              }}
            />
          )
        )}
    </div>
  )
})
