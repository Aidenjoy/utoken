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
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowLeft,
  Check,
  CloudOff,
  Loader2,
  Settings2,
  Workflow,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { getDirectorSettings } from '@/features/director/api'

import {
  getCanvasGeneration,
  getCanvasProject,
  submitCanvasGeneration,
  updateCanvasProject,
  uploadCanvasFile,
} from './api'
import { getCanvasTheme } from './canvas-theme'
import {
  CanvasConnections,
  type ConnectingState,
} from './components/canvas-connections'
import { CanvasNodeView, type CanvasNodePatch } from './components/canvas-node'
import { CanvasToolbar } from './components/canvas-toolbar'
import { InfiniteCanvas } from './components/infinite-canvas'
import {
  CANVAS_NODE_TITLE_KEYS,
  createCanvasNode,
  parseCanvasDocument,
  type CanvasDocument,
  type CanvasNode,
  type CanvasNodeType,
  type CanvasPosition,
  type ViewportTransform,
} from './types'

// ===== 智能画布编辑器（移植自 BeefTV 画布项目页的编排：视口/节点/连线/生成/自动保存） =====

type Selection = { kind: 'node' | 'connection'; id: string } | null
type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

const MIN_SCALE = 0.05
const MAX_SCALE = 2

function clampScale(scale: number) {
  return Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE)
}

export function CanvasEditorPage(props: { projectId: number }) {
  const { projectId } = props
  const { t } = useTranslation()
  const navigate = useNavigate()

  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const uploadInputRef = React.useRef<HTMLInputElement | null>(null)

  const [doc, setDoc] = React.useState<CanvasDocument | null>(null)
  const [title, setTitle] = React.useState('')
  const [selection, setSelection] = React.useState<Selection>(null)
  const [tool, setTool] = React.useState<'select' | 'hand'>('select')
  const [connecting, setConnecting] = React.useState<ConnectingState | null>(
    null
  )
  const [saveState, setSaveState] = React.useState<SaveState>('saved')

  const docRef = React.useRef(doc)
  docRef.current = doc
  const titleRef = React.useRef(title)
  titleRef.current = title
  const loadedRef = React.useRef(false)
  const lastSavedRef = React.useRef('')
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollingBusyRef = React.useRef(new Set<number>())

  // ----- 项目加载 -----
  const { data: projectRes, isPending: projectPending } = useQuery({
    queryKey: ['canvas', 'project', projectId],
    queryFn: () => getCanvasProject(projectId),
    retry: false,
  })
  const project = projectRes?.success ? projectRes.data : undefined

  React.useEffect(() => {
    if (project && !loadedRef.current) {
      loadedRef.current = true
      const parsed = parseCanvasDocument(project.document)
      setDoc(parsed)
      setTitle(project.title)
      lastSavedRef.current = JSON.stringify({
        title: project.title,
        document: project.document ?? '',
      })
    }
  }, [project])

  // 模型设定（画布复用视频工厂的图片/视频模型与内部令牌）
  const { data: settingsRes } = useQuery({
    queryKey: ['director', 'settings'],
    queryFn: getDirectorSettings,
  })
  const imageModelConfigured = Boolean(
    settingsRes?.data?.settings?.imageModel && settingsRes?.data?.tokens?.image
  )
  const videoModelConfigured = Boolean(
    settingsRes?.data?.settings?.videoModel && settingsRes?.data?.tokens?.video
  )

  const theme = getCanvasTheme(doc?.theme ?? 'dark')

  // ----- 自动保存（防抖 1.2s，卸载时立即落盘） -----
  const saveNow = React.useCallback(async () => {
    const current = docRef.current
    if (!current || !loadedRef.current) return
    const payload = JSON.stringify({
      title: titleRef.current,
      document: JSON.stringify(current),
    })
    if (payload === lastSavedRef.current) {
      setSaveState('saved')
      return
    }
    setSaveState('saving')
    try {
      const res = await updateCanvasProject({
        id: projectId,
        title: titleRef.current,
        document: JSON.stringify(current),
      })
      if (res.success) {
        lastSavedRef.current = payload
        setSaveState('saved')
      } else {
        setSaveState('error')
      }
    } catch {
      setSaveState('error')
    }
  }, [projectId])

  React.useEffect(() => {
    if (!doc || !loadedRef.current) return
    const payload = JSON.stringify({
      title,
      document: JSON.stringify(doc),
    })
    if (payload === lastSavedRef.current) return
    setSaveState('dirty')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      void saveNow()
    }, 1200)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [doc, title, saveNow])

  // 离开编辑器时把未落盘的修改立即保存
  React.useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      void saveNow()
    },
    [saveNow]
  )

  // ----- 文档修改 -----
  const patchNode = React.useCallback((id: string, patch: CanvasNodePatch) => {
    setDoc((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        nodes: prev.nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                ...patch,
                metadata: patch.metadata
                  ? { ...node.metadata, ...patch.metadata }
                  : node.metadata,
              }
            : node
        ),
      }
    })
  }, [])

  const moveNode = React.useCallback((id: string, position: CanvasPosition) => {
    setDoc((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        nodes: prev.nodes.map((node) =>
          node.id === id ? { ...node, position } : node
        ),
      }
    })
  }, [])

  const getScale = React.useCallback(() => docRef.current?.viewport.k ?? 1, [])

  const clientToWorld = React.useCallback(
    (clientX: number, clientY: number): CanvasPosition => {
      const rect = containerRef.current?.getBoundingClientRect()
      const v = docRef.current?.viewport ?? { x: 0, y: 0, k: 1 }
      if (!rect) return { x: 0, y: 0 }
      return {
        x: (clientX - rect.left - v.x) / v.k,
        y: (clientY - rect.top - v.y) / v.k,
      }
    },
    []
  )

  const viewportCenterWorld = React.useCallback((): CanvasPosition => {
    const rect = containerRef.current?.getBoundingClientRect()
    const v = docRef.current?.viewport ?? { x: 0, y: 0, k: 1 }
    if (!rect) return { x: 0, y: 0 }
    return {
      x: (rect.width / 2 - v.x) / v.k,
      y: (rect.height / 2 - v.y) / v.k,
    }
  }, [])

  const addNode = React.useCallback(
    (type: CanvasNodeType, world?: CanvasPosition): CanvasNode => {
      const node = createCanvasNode(
        type,
        world ?? { x: 0, y: 0 },
        t(CANVAS_NODE_TITLE_KEYS[type])
      )
      if (!world) {
        const center = viewportCenterWorld()
        node.position = {
          x: center.x - node.width / 2,
          y: center.y - node.height / 2,
        }
      }
      setDoc((prev) =>
        prev ? { ...prev, nodes: [...prev.nodes, node] } : prev
      )
      setSelection({ kind: 'node', id: node.id })
      return node
    },
    [t, viewportCenterWorld]
  )

  const addConnection = React.useCallback(
    (fromNodeId: string, toNodeId: string) => {
      if (fromNodeId === toNodeId) return
      setDoc((prev) => {
        if (!prev) return prev
        const exists = prev.connections.some(
          (c) => c.fromNodeId === fromNodeId && c.toNodeId === toNodeId
        )
        if (exists) return prev
        return {
          ...prev,
          connections: [
            ...prev.connections,
            {
              id: `conn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
              fromNodeId,
              toNodeId,
            },
          ],
        }
      })
    },
    []
  )

  // 连接轨单击：在节点旁创建相连的新节点
  const createConnected = React.useCallback(
    (nodeId: string, side: 'left' | 'right', type: CanvasNodeType) => {
      const source = docRef.current?.nodes.find((n) => n.id === nodeId)
      if (!source) return
      const node = createCanvasNode(
        type,
        { x: 0, y: 0 },
        t(CANVAS_NODE_TITLE_KEYS[type])
      )
      node.position =
        side === 'right'
          ? {
              x: source.position.x + source.width + 100,
              y: source.position.y + source.height / 2 - node.height / 2,
            }
          : {
              x: source.position.x - node.width - 100,
              y: source.position.y + source.height / 2 - node.height / 2,
            }
      setDoc((prev) => {
        if (!prev) return prev
        const connection =
          side === 'right'
            ? { fromNodeId: nodeId, toNodeId: node.id }
            : { fromNodeId: node.id, toNodeId: nodeId }
        return {
          ...prev,
          nodes: [...prev.nodes, node],
          connections: [
            ...prev.connections,
            {
              id: `conn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
              ...connection,
            },
          ],
        }
      })
      setSelection({ kind: 'node', id: node.id })
    },
    [t]
  )

  // ----- 连线拖拽 -----
  const startConnection = React.useCallback(
    (nodeId: string, event: React.PointerEvent) => {
      setConnecting({
        fromNodeId: nodeId,
        mouse: clientToWorld(event.clientX, event.clientY),
      })
    },
    [clientToWorld]
  )

  React.useEffect(() => {
    if (!connecting) return
    const handleMove = (event: PointerEvent) => {
      const mouse = clientToWorld(event.clientX, event.clientY)
      const element = document.elementFromPoint(event.clientX, event.clientY)
      const nodeElement = element?.closest('[data-node-id]')
      const targetNodeId =
        nodeElement?.getAttribute('data-node-id') ?? undefined
      setConnecting((prev) =>
        prev
          ? {
              ...prev,
              mouse,
              targetNodeId:
                targetNodeId && targetNodeId !== prev.fromNodeId
                  ? targetNodeId
                  : undefined,
            }
          : prev
      )
    }
    const handleUp = () => {
      setConnecting((prev) => {
        if (prev?.targetNodeId) {
          addConnection(prev.fromNodeId, prev.targetNodeId)
        }
        return null
      })
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }
  }, [connecting !== null, clientToWorld, addConnection]) // eslint-disable-line react-hooks/exhaustive-deps

  // ----- 生成与轮询 -----
  const upstreamReferenceImages = React.useCallback((nodeId: string) => {
    const current = docRef.current
    if (!current) return []
    const nodeMap = new Map(current.nodes.map((n) => [n.id, n]))
    const refs: string[] = []
    for (const connection of current.connections) {
      if (connection.toNodeId !== nodeId) continue
      const from = nodeMap.get(connection.fromNodeId)
      if (from?.type === 'image' && from.metadata.url) {
        refs.push(from.metadata.url)
      }
    }
    return refs.slice(0, 8)
  }, [])

  const generate = React.useCallback(
    async (node: CanvasNode) => {
      const prompt = (node.metadata.prompt ?? '').trim()
      if (!prompt || node.type === 'text') return
      const referenceImages = upstreamReferenceImages(node.id)
      patchNode(node.id, {
        metadata: { status: 'loading', error: undefined },
      })
      try {
        const res = await submitCanvasGeneration({
          projectId,
          nodeId: node.id,
          kind: node.type,
          prompt,
          size: node.type === 'image' ? node.metadata.size : undefined,
          aspectRatio:
            node.type === 'video' ? node.metadata.aspectRatio : undefined,
          resolution:
            node.type === 'video' ? node.metadata.resolution : undefined,
          duration: node.type === 'video' ? node.metadata.duration : undefined,
          referenceImages,
        })
        if (res.success && res.data) {
          patchNode(node.id, {
            metadata: { generationId: res.data.generationId },
          })
        } else {
          patchNode(node.id, { metadata: { status: 'idle' } })
        }
      } catch {
        patchNode(node.id, { metadata: { status: 'idle' } })
      }
    },
    [projectId, patchNode, upstreamReferenceImages]
  )

  // 每 3s 轮询生成中的节点任务
  React.useEffect(() => {
    const timer = setInterval(async () => {
      const current = docRef.current
      if (!current) return
      for (const node of current.nodes) {
        const generationId = node.metadata.generationId
        if (node.metadata.status !== 'loading' || !generationId) continue
        if (pollingBusyRef.current.has(generationId)) continue
        pollingBusyRef.current.add(generationId)
        try {
          const res = await getCanvasGeneration(generationId)
          const generation = res.data
          if (!res.success || !generation) continue
          if (generation.status === 'success') {
            patchNode(node.id, {
              metadata: {
                status: 'success',
                url: generation.resultUrl,
                error: undefined,
              },
            })
          } else if (generation.status === 'failed') {
            patchNode(node.id, {
              metadata: {
                status: 'error',
                error: generation.errorMsg || t('Generation failed'),
              },
            })
          }
        } catch {
          // 网络抖动时保持 loading，下一轮继续
        } finally {
          pollingBusyRef.current.delete(generationId)
        }
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [patchNode, t])

  // ----- 上传导入 -----
  const importFiles = React.useCallback(
    async (files: File[], world: CanvasPosition) => {
      const mediaFiles = files
        .filter(
          (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
        )
        .slice(0, 5)
      if (mediaFiles.length === 0) {
        toast.error(t('Only image and video files can be imported'))
        return
      }
      for (const [index, file] of mediaFiles.entries()) {
        try {
          const res = await uploadCanvasFile(file)
          if (!res.success || !res.data) continue
          const type: CanvasNodeType = file.type.startsWith('video/')
            ? 'video'
            : 'image'
          const node = createCanvasNode(
            type,
            { x: world.x + index * 60, y: world.y + index * 40 },
            file.name.replace(/\.[^.]+$/, '') || t('Imported media')
          )
          node.metadata = {
            ...node.metadata,
            url: res.data.url,
            status: 'success',
          }
          setDoc((prev) =>
            prev ? { ...prev, nodes: [...prev.nodes, node] } : prev
          )
        } catch {
          // 单个文件失败不阻断其余导入（错误已由全局拦截器提示）
        }
      }
    },
    [t]
  )

  const uploadImageToNode = React.useCallback(
    async (node: CanvasNode, file: File) => {
      try {
        const res = await uploadCanvasFile(file)
        if (res.success && res.data) {
          patchNode(node.id, {
            metadata: {
              url: res.data.url,
              status: 'success',
              error: undefined,
            },
          })
        }
      } catch {
        // 全局拦截器已提示
      }
    },
    [patchNode]
  )

  // ----- 视口控制 -----
  const setViewport = React.useCallback((viewport: ViewportTransform) => {
    setDoc((prev) => (prev ? { ...prev, viewport } : prev))
  }, [])

  const zoomAroundCenter = React.useCallback(
    (factor: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      const current = docRef.current?.viewport
      if (!rect || !current) return
      const centerX = rect.width / 2
      const centerY = rect.height / 2
      const newScale = clampScale(current.k * factor)
      const worldX = (centerX - current.x) / current.k
      const worldY = (centerY - current.y) / current.k
      setViewport({
        x: centerX - worldX * newScale,
        y: centerY - worldY * newScale,
        k: newScale,
      })
    },
    [setViewport]
  )

  const fitView = React.useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect()
    const nodes = docRef.current?.nodes
    if (!rect || !nodes || nodes.length === 0) {
      setViewport({ x: 0, y: 0, k: 1 })
      return
    }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const node of nodes) {
      minX = Math.min(minX, node.position.x)
      minY = Math.min(minY, node.position.y)
      maxX = Math.max(maxX, node.position.x + node.width)
      maxY = Math.max(maxY, node.position.y + node.height)
    }
    const padding = 120
    const scale = clampScale(
      Math.min(
        (rect.width - padding) / Math.max(maxX - minX, 1),
        (rect.height - padding) / Math.max(maxY - minY, 1),
        1.5
      )
    )
    setViewport({
      x: rect.width / 2 - ((minX + maxX) / 2) * scale,
      y: rect.height / 2 - ((minY + maxY) / 2) * scale,
      k: scale,
    })
  }, [setViewport])

  // ----- 删除与快捷键 -----
  const deleteSelection = React.useCallback(() => {
    setSelection((currentSelection) => {
      if (!currentSelection) return null
      setDoc((prev) => {
        if (!prev) return prev
        if (currentSelection.kind === 'node') {
          return {
            ...prev,
            nodes: prev.nodes.filter((n) => n.id !== currentSelection.id),
            connections: prev.connections.filter(
              (c) =>
                c.fromNodeId !== currentSelection.id &&
                c.toNodeId !== currentSelection.id
            ),
          }
        }
        return {
          ...prev,
          connections: prev.connections.filter(
            (c) => c.id !== currentSelection.id
          ),
        }
      })
      return null
    })
  }, [])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const isTyping = target?.closest(
        "input,textarea,select,[contenteditable='true']"
      )
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveNow()
        return
      }
      if (isTyping) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        deleteSelection()
        return
      }
      if (event.key === 'Escape') {
        setSelection(null)
        setConnecting(null)
        return
      }
      if (event.key.toLowerCase() === 'v') setTool('select')
      if (event.key.toLowerCase() === 'h') setTool('hand')
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [deleteSelection, saveNow])

  // ----- 派生数据 -----
  const referenceCounts = React.useMemo(() => {
    const counts = new Map<string, number>()
    if (!doc) return counts
    const nodeMap = new Map(doc.nodes.map((n) => [n.id, n]))
    for (const connection of doc.connections) {
      const from = nodeMap.get(connection.fromNodeId)
      if (from?.type === 'image' && from.metadata.url) {
        counts.set(
          connection.toNodeId,
          (counts.get(connection.toNodeId) ?? 0) + 1
        )
      }
    }
    return counts
  }, [doc])

  const modelConfiguredByType = {
    image: imageModelConfigured,
    video: videoModelConfigured,
    text: true,
  }

  const handleViewportChange = React.useCallback(
    (viewport: ViewportTransform) => {
      setDoc((prev) => (prev ? { ...prev, viewport } : prev))
    },
    []
  )

  const handleSelectNode = React.useCallback((id: string) => {
    setSelection({ kind: 'node', id })
  }, [])

  const handleSelectConnection = React.useCallback((id: string) => {
    setSelection({ kind: 'connection', id })
  }, [])

  const openSettings = React.useCallback(() => {
    void saveNow()
    navigate({ to: '/director/settings' })
  }, [navigate, saveNow])

  const goBack = React.useCallback(() => {
    void saveNow()
    navigate({ to: '/canvas' })
  }, [navigate, saveNow])

  // ----- 渲染 -----
  if (projectPending || !doc) {
    return (
      <div
        className='fixed inset-0 z-[100] flex items-center justify-center'
        style={{ background: '#141414', color: '#ededed' }}
      >
        {projectRes && !projectRes.success ? (
          <div className='flex flex-col items-center gap-3'>
            <p className='text-sm'>{t('Canvas project not found')}</p>
            <button
              type='button'
              onClick={() => navigate({ to: '/canvas' })}
              className='rounded-lg bg-white/10 px-4 py-2 text-xs'
            >
              {t('Back to projects')}
            </button>
          </div>
        ) : (
          <Loader2 aria-hidden='true' className='size-6 animate-spin' />
        )}
      </div>
    )
  }

  const saveIndicator = () => {
    if (saveState === 'saving') {
      return (
        <span
          className='flex items-center gap-1 text-xs'
          style={{ color: theme.node.muted }}
        >
          <Loader2 aria-hidden='true' className='size-3 animate-spin' />
          {t('Saving...')}
        </span>
      )
    }
    if (saveState === 'error') {
      return (
        <button
          type='button'
          onClick={() => void saveNow()}
          className='flex items-center gap-1 text-xs'
          style={{ color: theme.accent.danger }}
        >
          <CloudOff aria-hidden='true' className='size-3' />
          {t('Save failed, click to retry')}
        </button>
      )
    }
    if (saveState === 'dirty') {
      return (
        <span className='text-xs' style={{ color: theme.node.faint }}>
          {t('Unsaved changes')}
        </span>
      )
    }
    return (
      <span
        className='flex items-center gap-1 text-xs'
        style={{ color: theme.node.faint }}
      >
        <Check aria-hidden='true' className='size-3' />
        {t('All changes saved')}
      </span>
    )
  }

  return (
    <div
      className='fixed inset-0 z-[100] flex flex-col'
      style={{ background: theme.canvas.background, color: theme.node.text }}
    >
      {/* 顶栏：返回 / 标题 / 保存状态 / 模型设定 */}
      <div
        data-canvas-no-zoom
        className='relative z-50 flex h-12 shrink-0 items-center gap-2 px-3'
        style={{
          background: theme.toolbar.panel,
          borderBottom: `1px solid ${theme.toolbar.border}`,
          backdropFilter: 'blur(12px)',
        }}
      >
        <button
          type='button'
          onClick={goBack}
          className='flex size-8 items-center justify-center rounded-lg transition-colors'
          style={{ color: theme.toolbar.item }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = theme.toolbar.itemHover
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
          aria-label={t('Back to projects')}
          title={t('Back to projects')}
        >
          <ArrowLeft aria-hidden='true' className='size-4' />
        </button>
        <Workflow
          aria-hidden='true'
          className='size-4 shrink-0'
          style={{ color: theme.node.muted }}
        />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            if (!title.trim()) setTitle(t('Untitled canvas'))
          }}
          maxLength={64}
          className='w-44 rounded-md bg-transparent px-1.5 py-1 text-sm font-medium transition-all outline-none focus:w-64'
          style={{ color: theme.node.text }}
          onFocus={(e) => {
            e.currentTarget.style.background = theme.toolbar.itemHover
          }}
          onBlurCapture={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
          aria-label={t('Project name')}
        />
        {saveIndicator()}
        <div className='ml-auto flex items-center gap-2'>
          <span
            className='hidden items-center gap-1 rounded-full px-2.5 py-1 text-[11px] tabular-nums sm:flex'
            style={{
              background: theme.toolbar.itemHover,
              color: theme.node.muted,
            }}
          >
            <Workflow aria-hidden='true' className='size-3' />
            {doc.nodes.length} {t('nodes')}
          </span>
          <button
            type='button'
            onClick={openSettings}
            className='flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors'
            style={{ color: theme.toolbar.item }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.toolbar.itemHover
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
            title={t('Model Settings')}
          >
            <Settings2 aria-hidden='true' className='size-3.5' />
            <span className='hidden sm:inline'>{t('Model Settings')}</span>
          </button>
        </div>
      </div>

      {/* 画布区域 */}
      <div className='relative min-h-0 flex-1'>
        <InfiniteCanvas
          containerRef={containerRef}
          viewport={doc.viewport}
          theme={theme}
          background={doc.background}
          tool={tool}
          onViewportChange={handleViewportChange}
          onBackgroundClick={() => setSelection(null)}
          onDoubleClick={(world) => {
            const node = addNode('text', { x: world.x - 160, y: world.y - 100 })
            setSelection({ kind: 'node', id: node.id })
          }}
          onDropFiles={(files, world) => void importFiles(files, world)}
          dropHint={t('Drop images or videos to import')}
          graphicsLayer={
            <CanvasConnections
              nodes={doc.nodes}
              connections={doc.connections}
              selectedId={
                selection?.kind === 'connection' ? selection.id : null
              }
              connecting={connecting}
              theme={theme}
              onSelect={handleSelectConnection}
            />
          }
        >
          {doc.nodes.map((node) => (
            <CanvasNodeView
              key={node.id}
              node={node}
              theme={theme}
              selected={selection?.kind === 'node' && selection.id === node.id}
              referenceCount={referenceCounts.get(node.id) ?? 0}
              modelConfigured={modelConfiguredByType[node.type]}
              isConnectionTarget={connecting?.targetNodeId === node.id}
              getScale={getScale}
              onSelect={handleSelectNode}
              onPatch={patchNode}
              onMove={moveNode}
              onGenerate={generate}
              onUploadImage={uploadImageToNode}
              onConnectionStart={startConnection}
              onCreateConnected={createConnected}
              onOpenSettings={openSettings}
            />
          ))}
        </InfiniteCanvas>

        {/* 空画布引导 */}
        {doc.nodes.length === 0 && (
          <div className='pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 px-6 text-center'>
            <Workflow
              aria-hidden='true'
              className='size-12'
              style={{ color: theme.node.faint }}
            />
            <p
              className='text-base font-medium'
              style={{ color: theme.node.muted }}
            >
              {t('An infinite canvas for your ideas')}
            </p>
            <p
              className='max-w-md text-xs leading-relaxed'
              style={{ color: theme.node.faint }}
            >
              {t(
                'Double-click to add a text node, or use the toolbar below to add image and video nodes. Connect nodes to pass reference images into generation.'
              )}
            </p>
          </div>
        )}

        <CanvasToolbar
          theme={theme}
          tool={tool}
          onToolChange={setTool}
          scale={doc.viewport.k}
          onZoomIn={() => zoomAroundCenter(1.2)}
          onZoomOut={() => zoomAroundCenter(1 / 1.2)}
          onZoomReset={() =>
            zoomAroundCenter(1 / (docRef.current?.viewport.k ?? 1))
          }
          onFitView={fitView}
          background={doc.background}
          onBackgroundChange={(background) =>
            setDoc((prev) => (prev ? { ...prev, background } : prev))
          }
          colorTheme={doc.theme}
          onToggleTheme={() =>
            setDoc((prev) =>
              prev
                ? { ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' }
                : prev
            )
          }
          onAddNode={(type) => addNode(type)}
          onUploadImage={() => uploadInputRef.current?.click()}
        />
        <input
          ref={uploadInputRef}
          type='file'
          accept='image/*'
          multiple
          className='hidden'
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            if (files.length > 0) {
              const center = viewportCenterWorld()
              void importFiles(files, { x: center.x - 180, y: center.y - 210 })
            }
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
