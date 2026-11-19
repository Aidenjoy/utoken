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
  Loader2,
  Minimize2,
  MousePointer2,
  PlusCircle,
  Sparkles,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { getDirectorAssets, getDirectorSettings } from '@/features/director/api'

import {
  cancelCanvasGeneration,
  createCanvasProject,
  deleteCanvasProject,
  getCanvasGeneration,
  getCanvasProject,
  optimizeCanvasPrompt,
  submitCanvasGeneration,
  updateCanvasProject,
  uploadCanvasFile,
} from './api'
import { getCanvasTheme } from './canvas-theme'
import { CanvasAgentPanel } from './components/canvas-agent-panel'
import {
  CanvasAssetPicker,
  type CanvasAssetInsert,
} from './components/canvas-asset-picker'
import {
  CanvasConnections,
  type ConnectingState,
} from './components/canvas-connections'
import {
  CanvasContextMenu,
  type CanvasContextMenuState,
} from './components/canvas-context-menu'
import {
  CanvasCreateList,
  type CanvasCreateCommandId,
} from './components/canvas-create-menu'
import { CanvasDirectorWorkspace } from './components/canvas-director-workspace'
import { CanvasDrawingModal } from './components/canvas-drawing-modal'
import { CanvasHistoryPicker } from './components/canvas-history-picker'
import { CanvasLightbox } from './components/canvas-lightbox'
import {
  CanvasCropDialog,
  CanvasFrameDialog,
  CanvasSplitDialog,
} from './components/canvas-media-dialogs'
import { CanvasMenuPanel } from './components/canvas-menu'
import { modKey } from './components/canvas-menu-utils'
import { CanvasMiniMap } from './components/canvas-mini-map'
import { CanvasNodeView, type CanvasNodePatch } from './components/canvas-node'
import { CanvasNodePromptPanel, type CanvasNodeReference } from './components/canvas-node-prompt-panel'
import type { CanvasNodeToolId } from './components/canvas-node-toolbar'
import {
  CanvasNodeInfoModal,
  CanvasTextEditModal,
} from './components/canvas-node-dialogs'
import { CanvasNodeSearch } from './components/canvas-node-search'
import {
  CanvasFolderBrowser,
  CanvasTaskPanel,
  type CanvasActiveTask,
} from './components/canvas-resource-dialogs'
import {
  CanvasSelectionToolbar,
  type CanvasAlignMode,
  type CanvasArrangeMode,
} from './components/canvas-selection-toolbar'
import { CanvasToolbar } from './components/canvas-toolbar'
import { CanvasTopBar, type CanvasSaveState } from './components/canvas-top-bar'
import { CanvasUpscalePanel } from './components/canvas-upscale-panel'
import { CanvasWorkflowPanel } from './components/canvas-workflow-panel'
import { CanvasZoomControls } from './components/canvas-zoom-controls'
import { InfiniteCanvas } from './components/infinite-canvas'
import { useCanvasHistory } from './hooks/use-canvas-history'
import { downloadMediaUrl, encodeWavBuffer } from './media-utils'
import {
  CANVAS_GRID_SIZE,
  CANVAS_NODE_TITLE_KEYS,
  canGenerateNode,
  canvasId,
  clampCanvasScale,
  collectUpstreamTexts,
  createCanvasNode,
  createCanvasTab,
  nodesHiddenByFolders,
  nodesInsideFolder,
  parseCanvasDocument,
  type CanvasBackgroundMode,
  type CanvasClipboard,
  type CanvasColorTheme,
  type CanvasDirectorState,
  type CanvasDocument,
  type CanvasDraft,
  type CanvasGeneration,
  type CanvasNode,
  type CanvasNodeType,
  type CanvasPosition,
  type CanvasScriptScene,
  type CanvasTab,
  type ViewportTransform,
} from './types'

// ===== 智能画布编辑器（移植自 BeefTV 画布项目页：多画布/历史/剪贴板/全节点类型/生成编排） =====

interface Selection {
  nodeIds: string[]
  connectionId: string | null
}

const EMPTY_SELECTION: Selection = { nodeIds: [], connectionId: null }
const EMPTY_NODE_REFERENCES: CanvasNodeReference[] = []
const CLIPBOARD_STORAGE_KEY = 'canvas:clipboard'
const CONNECTION_HINT_KEY = 'canvas:connections-hint-dismissed'

function activeTabOf(doc: CanvasDocument | null): CanvasTab | undefined {
  return doc?.canvases.find((cv) => cv.id === doc.activeCanvasId)
}

function readClipboard(): CanvasClipboard | null {
  try {
    const raw = localStorage.getItem(CLIPBOARD_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CanvasClipboard
    if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) return null
    return { nodes: parsed.nodes, connections: parsed.connections ?? [] }
  } catch {
    return null
  }
}

function readBoolSetting(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key)
  if (raw === '1') return true
  if (raw === '0') return false
  return fallback
}

// 复制/粘贴/变体共用：克隆节点并重映射内部连线
function clonePayload(
  payload: CanvasClipboard,
  offset: CanvasPosition
): CanvasClipboard {
  const idMap = new Map<string, string>()
  const nodes = payload.nodes.map((node) => {
    const id = canvasId('node')
    idMap.set(node.id, id)
    return {
      ...structuredClone(node),
      id,
      position: {
        x: node.position.x + offset.x,
        y: node.position.y + offset.y,
      },
    }
  })
  const connections = payload.connections
    .filter((c) => idMap.has(c.fromNodeId) && idMap.has(c.toNodeId))
    .map((c) => ({
      id: canvasId('conn'),
      fromNodeId: idMap.get(c.fromNodeId) ?? c.fromNodeId,
      toNodeId: idMap.get(c.toNodeId) ?? c.toNodeId,
    }))
  return { nodes, connections }
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const NODE_COMMAND_TYPES = new Set<CanvasCreateCommandId>([
  'text',
  'image',
  'video',
  'upscale',
  'audio',
  'director',
  'script',
  'drawing',
  'folder',
  'batch',
])

// 单选时在节点下方弹出输入面板的类型（BeefTV：点击节点→下方 composer）
const PANEL_NODE_TYPES = new Set<CanvasNodeType>([
  'text',
  'image',
  'video',
  'audio',
  'upscale',
])

// 素材库 type 字段→画布节点类型（@mention 插入共用）
function mediaNodeType(type: string): CanvasNodeType {
  if (type === 'video') return 'video'
  if (type === 'audio') return 'audio'
  return 'image'
}

export function CanvasEditorPage(props: { projectId: number }) {
  const { projectId } = props
  const { t } = useTranslation()
  const navigate = useNavigate()

  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const uploadInputRef = React.useRef<HTMLInputElement | null>(null)
  const uploadWorldRef = React.useRef<CanvasPosition | null>(null)

  const [doc, setDoc] = React.useState<CanvasDocument | null>(null)
  const [title, setTitle] = React.useState('')
  const [selection, setSelection] = React.useState<Selection>(EMPTY_SELECTION)
  const [tool, setTool] = React.useState<'select' | 'hand'>('select')
  const [connecting, setConnecting] = React.useState<ConnectingState | null>(
    null
  )
  const [saveState, setSaveState] = React.useState<CanvasSaveState>('saved')
  const [snapEnabled, setSnapEnabled] = React.useState(() =>
    readBoolSetting('canvas:snap', false)
  )
  const [showConnections, setShowConnections] = React.useState(() =>
    readBoolSetting('canvas:show-connections', true)
  )
  const [showMinimap, setShowMinimap] = React.useState(() =>
    readBoolSetting('canvas:minimap', true)
  )
  const [focusMode, setFocusMode] = React.useState(false)
  const [clipboard, setClipboard] = React.useState<CanvasClipboard | null>(
    readClipboard
  )
  const [contextMenu, setContextMenu] =
    React.useState<CanvasContextMenuState | null>(null)
  const [createMenu, setCreateMenu] = React.useState<{
    x: number
    y: number
    world: CanvasPosition
  } | null>(null)
  const [nodeSearchOpen, setNodeSearchOpen] = React.useState(false)
  const [assetPicker, setAssetPicker] = React.useState<{
    world?: CanvasPosition
  } | null>(null)
  const [historyPicker, setHistoryPicker] = React.useState<{
    world?: CanvasPosition
  } | null>(null)
  const [agentOpen, setAgentOpen] = React.useState(false)
  const [workflowOpen, setWorkflowOpen] = React.useState(false)
  const [lightboxNodeId, setLightboxNodeId] = React.useState<string | null>(
    null
  )
  const [drawingNodeId, setDrawingNodeId] = React.useState<string | null>(null)
  const [nodeInfoNodeId, setNodeInfoNodeId] = React.useState<string | null>(
    null
  )
  const [textEditNodeId, setTextEditNodeId] = React.useState<string | null>(
    null
  )
  const [tasksOpen, setTasksOpen] = React.useState(false)
  const [folderBrowserId, setFolderBrowserId] = React.useState<string | null>(
    null
  )
  const [cropNodeId, setCropNodeId] = React.useState<string | null>(null)
  const [splitNodeId, setSplitNodeId] = React.useState<string | null>(null)
  const [frameNodeId, setFrameNodeId] = React.useState<string | null>(null)
  const [optimizingNodeId, setOptimizingNodeId] = React.useState<string | null>(
    null
  )
  // 点选连线模式：面板发起，点击另一节点即连为参考
  const [pickConnectNodeId, setPickConnectNodeId] = React.useState<
    string | null
  >(null)
  const [directorNodeId, setDirectorNodeId] = React.useState<string | null>(
    null
  )
  const [batchUpscaleBusy, setBatchUpscaleBusy] = React.useState(false)
  const [containerSize, setContainerSize] = React.useState({
    width: 0,
    height: 0,
  })

  const docRef = React.useRef(doc)
  docRef.current = doc
  const titleRef = React.useRef(title)
  titleRef.current = title
  const selectionRef = React.useRef(selection)
  selectionRef.current = selection
  const snapRef = React.useRef(snapEnabled)
  snapRef.current = snapEnabled
  const pickConnectRef = React.useRef(pickConnectNodeId)
  pickConnectRef.current = pickConnectNodeId
  const loadedRef = React.useRef(false)
  const lastSavedRef = React.useRef('')
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollingBusyRef = React.useRef(new Set<number>())

  // ----- 项目加载（hash 指定画布时优先激活，供「在新窗口打开」使用） -----
  const { data: projectRes, isPending: projectPending } = useQuery({
    queryKey: ['canvas', 'project', projectId],
    queryFn: () => getCanvasProject(projectId),
    retry: false,
  })
  const project = projectRes?.success ? projectRes.data : undefined

  React.useEffect(() => {
    if (project && !loadedRef.current) {
      loadedRef.current = true
      const parsed = parseCanvasDocument(
        project.document,
        t('Canvas {{index}}', { index: 1 })
      )
      const hashId = window.location.hash.slice(1)
      if (hashId && parsed.canvases.some((cv) => cv.id === hashId)) {
        parsed.activeCanvasId = hashId
      }
      setDoc(parsed)
      setTitle(project.title)
      lastSavedRef.current = JSON.stringify({
        title: project.title,
        document: project.document ?? '',
      })
    }
  }, [project, t])

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
  const textModelConfigured = Boolean(
    settingsRes?.data?.settings?.textModel && settingsRes?.data?.tokens?.text
  )
  const audioModelConfigured = Boolean(
    settingsRes?.data?.settings?.audioModel && settingsRes?.data?.tokens?.text
  )

  // 素材库（左下资产管理徽章 + @mention 候选）
  const { data: assetsRes } = useQuery({
    queryKey: ['director', 'assets', 'canvas'],
    queryFn: () => getDirectorAssets({ p: 1, page_size: 50 }),
  })
  const assetCount = assetsRes?.success ? (assetsRes.data?.total ?? 0) : 0
  const mentionAssets = React.useMemo(
    () => (assetsRes?.success ? (assetsRes.data?.list ?? []) : []),
    [assetsRes]
  )

  const activeTab = activeTabOf(doc)
  const nodes = React.useMemo(() => activeTab?.nodes ?? [], [activeTab])
  const connections = React.useMemo(
    () => activeTab?.connections ?? [],
    [activeTab]
  )
  const viewport = activeTab?.viewport ?? { x: 0, y: 0, k: 1 }
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

  React.useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      void saveNow()
    },
    [saveNow]
  )

  // ----- 历史栈（撤销/重做；恢复时保留当前视口避免镜头跳动） -----
  const {
    record: recordHistory,
    beginContinuous: beginHistoryEdit,
    endContinuous: endHistoryEdit,
    undo: undoHistory,
    redo: redoHistory,
    canUndo,
    canRedo,
  } = useCanvasHistory({
    getSnapshot: () => {
      const current = docRef.current
      if (!current) return null
      return {
        canvases: current.canvases,
        activeCanvasId: current.activeCanvasId,
      }
    },
    restore: (snap) => {
      setDoc((prev) => {
        if (!prev) return prev
        const viewportById = new Map(
          prev.canvases.map((cv) => [cv.id, cv.viewport])
        )
        return {
          ...prev,
          canvases: snap.canvases.map((cv) => ({
            ...cv,
            viewport: viewportById.get(cv.id) ?? cv.viewport,
          })),
          activeCanvasId: snap.activeCanvasId,
        }
      })
      setSelection((prev) => ({
        nodeIds: prev.nodeIds.filter((id) =>
          snap.canvases.some((cv) => cv.nodes.some((n) => n.id === id))
        ),
        connectionId: null,
      }))
    },
  })

  // ----- 文档修改 -----
  const updateActiveTab = React.useCallback(
    (updater: (tab: CanvasTab) => CanvasTab) => {
      setDoc((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          canvases: prev.canvases.map((cv) =>
            cv.id === prev.activeCanvasId ? updater(cv) : cv
          ),
        }
      })
    },
    []
  )

  // 节点补丁可落在任意画布（轮询/生成状态跨 tab 更新）
  const applyNodePatch = React.useCallback(
    (id: string, patch: CanvasNodePatch, silent: boolean) => {
      if (!silent) recordHistory()
      setDoc((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          canvases: prev.canvases.map((cv) => {
            if (!cv.nodes.some((n) => n.id === id)) return cv
            return {
              ...cv,
              nodes: cv.nodes.map((node) =>
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
          }),
        }
      })
    },
    [recordHistory]
  )

  const patchNode = React.useCallback(
    (id: string, patch: CanvasNodePatch, silent = false) =>
      applyNodePatch(id, patch, silent),
    [applyNodePatch]
  )
  const patchNodeSilent = React.useCallback(
    (id: string, patch: CanvasNodePatch) => applyNodePatch(id, patch, true),
    [applyNodePatch]
  )

  // 拖拽移动：多选随动 + 文件夹带动框内节点 + 网格吸附
  const moveNode = React.useCallback((id: string, position: CanvasPosition) => {
    setDoc((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        canvases: prev.canvases.map((cv) => {
          if (cv.id !== prev.activeCanvasId) return cv
          const dragged = cv.nodes.find((n) => n.id === id)
          if (!dragged) return cv
          const target = snapRef.current
            ? {
                x: Math.round(position.x / CANVAS_GRID_SIZE) * CANVAS_GRID_SIZE,
                y: Math.round(position.y / CANVAS_GRID_SIZE) * CANVAS_GRID_SIZE,
              }
            : position
          const dx = target.x - dragged.position.x
          const dy = target.y - dragged.position.y
          if (dx === 0 && dy === 0) return cv
          const selectedIds = selectionRef.current.nodeIds
          const groupIds = new Set(
            selectedIds.includes(id) && selectedIds.length > 1
              ? selectedIds
              : [id]
          )
          if (dragged.type === 'folder') {
            for (const innerId of nodesInsideFolder(dragged, cv.nodes)) {
              groupIds.add(innerId)
            }
          }
          return {
            ...cv,
            nodes: cv.nodes.map((n) =>
              groupIds.has(n.id)
                ? {
                    ...n,
                    position: { x: n.position.x + dx, y: n.position.y + dy },
                  }
                : n
            ),
          }
        }),
      }
    })
  }, [])

  const getScale = React.useCallback(
    () => activeTabOf(docRef.current)?.viewport.k ?? 1,
    []
  )

  const clientToWorld = React.useCallback(
    (clientX: number, clientY: number): CanvasPosition => {
      const rect = containerRef.current?.getBoundingClientRect()
      const v = activeTabOf(docRef.current)?.viewport ?? { x: 0, y: 0, k: 1 }
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
    const v = activeTabOf(docRef.current)?.viewport ?? { x: 0, y: 0, k: 1 }
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
        const siblings = activeTabOf(docRef.current)?.nodes ?? []
        const gap = 48
        let x = center.x - node.width / 2
        const y = center.y - node.height / 2
        // 新节点避让已有节点：重叠时顺移到其右侧，避免完全堆叠点不到
        for (let attempt = 0; attempt < 32; attempt++) {
          const blocker = siblings.find(
            (other) =>
              x < other.position.x + other.width + gap &&
              x + node.width + gap > other.position.x &&
              y < other.position.y + other.height + gap &&
              y + node.height + gap > other.position.y
          )
          if (!blocker) break
          x = blocker.position.x + blocker.width + gap
        }
        node.position = { x, y }
      }
      recordHistory()
      updateActiveTab((tab) => ({ ...tab, nodes: [...tab.nodes, node] }))
      setSelection({ nodeIds: [node.id], connectionId: null })
      return node
    },
    [t, viewportCenterWorld, recordHistory, updateActiveTab]
  )

  const showConnectionHint = React.useCallback(() => {
    if (localStorage.getItem(CONNECTION_HINT_KEY)) return
    localStorage.setItem(CONNECTION_HINT_KEY, '1')
    toast(
      t(
        'Nodes connected. Upstream images are passed as references when generating.'
      ),
      {
        style: {
          background: '#6fe8e5',
          color: '#10292a',
          border: 'none',
        },
      }
    )
  }, [t])

  const addConnection = React.useCallback(
    (fromNodeId: string, toNodeId: string) => {
      if (fromNodeId === toNodeId) return
      const current = activeTabOf(docRef.current)
      if (
        current?.connections.some(
          (c) => c.fromNodeId === fromNodeId && c.toNodeId === toNodeId
        )
      ) {
        return
      }
      recordHistory()
      updateActiveTab((tab) =>
        // updater 内再查重：同一 tick 内多次调用也不会产生重复边
        tab.connections.some(
          (c) => c.fromNodeId === fromNodeId && c.toNodeId === toNodeId
        )
          ? tab
          : {
              ...tab,
              connections: [
                ...tab.connections,
                { id: canvasId('conn'), fromNodeId, toNodeId },
              ],
            }
      )
      showConnectionHint()
    },
    [recordHistory, updateActiveTab, showConnectionHint]
  )

  // 连接轨单击：在节点旁创建相连的新节点
  const createConnected = React.useCallback(
    (nodeId: string, side: 'left' | 'right', type: CanvasNodeType) => {
      const source = activeTabOf(docRef.current)?.nodes.find(
        (n) => n.id === nodeId
      )
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
      recordHistory()
      updateActiveTab((tab) => ({
        ...tab,
        nodes: [...tab.nodes, node],
        connections: [
          ...tab.connections,
          {
            id: canvasId('conn'),
            fromNodeId: side === 'right' ? nodeId : node.id,
            toNodeId: side === 'right' ? node.id : nodeId,
          },
        ],
      }))
      setSelection({ nodeIds: [node.id], connectionId: null })
      showConnectionHint()
    },
    [t, recordHistory, updateActiveTab, showConnectionHint]
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

  // ----- 选择 -----
  const handleSelectNode = React.useCallback(
    (id: string, additive: boolean) => {
      // 点选连线模式：点击另一节点→连为参考并在提示词插入 @引用
      const pickSourceId = pickConnectRef.current
      if (pickSourceId && !additive && id !== pickSourceId) {
        const tab = activeTabOf(docRef.current)
        const clicked = tab?.nodes.find((n) => n.id === id)
        const source = tab?.nodes.find((n) => n.id === pickSourceId)
        if (clicked && source) {
          addConnection(id, pickSourceId)
          const prevPrompt = source.metadata.prompt ?? ''
          patchNodeSilent(pickSourceId, {
            metadata: {
              prompt: `${prevPrompt}${prevPrompt && !prevPrompt.endsWith(' ') ? ' ' : ''}@${clicked.title} `,
            },
          })
        }
        setPickConnectNodeId(null)
        return
      }
      setSelection((prev) => {
        if (additive) {
          const nodeIds = prev.nodeIds.includes(id)
            ? prev.nodeIds.filter((n) => n !== id)
            : [...prev.nodeIds, id]
          return { nodeIds, connectionId: null }
        }
        if (prev.nodeIds.includes(id) && prev.nodeIds.length > 1) {
          return { ...prev, connectionId: null }
        }
        return { nodeIds: [id], connectionId: null }
      })
    },
    [addConnection, patchNodeSilent]
  )

  const handleSelectConnection = React.useCallback((id: string) => {
    setSelection({ nodeIds: [], connectionId: id })
  }, [])

  const handleBoxSelect = React.useCallback(
    (
      rect: { x: number; y: number; width: number; height: number },
      additive: boolean
    ) => {
      const tab = activeTabOf(docRef.current)
      if (!tab) return
      const hidden = nodesHiddenByFolders(tab.nodes)
      const hits = tab.nodes
        .filter((node) => {
          if (hidden.has(node.id)) return false
          return (
            node.position.x < rect.x + rect.width &&
            node.position.x + node.width > rect.x &&
            node.position.y < rect.y + rect.height &&
            node.position.y + node.height > rect.y
          )
        })
        .map((node) => node.id)
      setSelection((prev) => ({
        nodeIds: additive ? [...new Set([...prev.nodeIds, ...hits])] : hits,
        connectionId: null,
      }))
    },
    []
  )

  const selectAll = React.useCallback(() => {
    const tab = activeTabOf(docRef.current)
    if (!tab) return
    const hidden = nodesHiddenByFolders(tab.nodes)
    setSelection({
      nodeIds: tab.nodes.filter((n) => !hidden.has(n.id)).map((n) => n.id),
      connectionId: null,
    })
  }, [])

  const deleteNodes = React.useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      const idSet = new Set(ids)
      // 与 BeefTV 一致：删除节点时同步取消其进行中的生成任务，失败不阻断删除
      const tab = activeTabOf(docRef.current)
      for (const n of tab?.nodes ?? []) {
        if (
          idSet.has(n.id) &&
          n.metadata.status === 'loading' &&
          n.metadata.generationId
        ) {
          void cancelCanvasGeneration(n.metadata.generationId).catch(() => {})
        }
      }
      recordHistory()
      updateActiveTab((tab) => ({
        ...tab,
        nodes: tab.nodes.filter((n) => !idSet.has(n.id)),
        connections: tab.connections.filter(
          (c) => !idSet.has(c.fromNodeId) && !idSet.has(c.toNodeId)
        ),
      }))
      setSelection(EMPTY_SELECTION)
    },
    [recordHistory, updateActiveTab]
  )

  const deleteConnection = React.useCallback(
    (connectionId: string) => {
      recordHistory()
      updateActiveTab((tab) => ({
        ...tab,
        connections: tab.connections.filter((c) => c.id !== connectionId),
      }))
      setSelection(EMPTY_SELECTION)
    },
    [recordHistory, updateActiveTab]
  )

  const deleteSelection = React.useCallback(() => {
    const current = selectionRef.current
    if (current.connectionId) {
      deleteConnection(current.connectionId)
      return
    }
    deleteNodes(current.nodeIds)
  }, [deleteConnection, deleteNodes])

  // ----- 剪贴板：复制 / 粘贴 / 创建变体 -----
  const copyNodes = React.useCallback(
    (ids: string[]) => {
      const tab = activeTabOf(docRef.current)
      if (!tab || ids.length === 0) return
      const idSet = new Set(ids)
      const payload: CanvasClipboard = {
        nodes: structuredClone(tab.nodes.filter((n) => idSet.has(n.id))),
        connections: structuredClone(
          tab.connections.filter(
            (c) => idSet.has(c.fromNodeId) && idSet.has(c.toNodeId)
          )
        ),
      }
      setClipboard(payload)
      try {
        localStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(payload))
      } catch {
        // 存储不可用时仅保留内存剪贴板
      }
      toast.success(t('Copied {{count}} nodes', { count: ids.length }))
    },
    [t]
  )

  const insertPayload = React.useCallback(
    (payload: CanvasClipboard, world?: CanvasPosition) => {
      if (payload.nodes.length === 0) return
      let minX = Infinity
      let minY = Infinity
      for (const node of payload.nodes) {
        minX = Math.min(minX, node.position.x)
        minY = Math.min(minY, node.position.y)
      }
      const base = world ?? { x: minX + 40, y: minY + 40 }
      const cloned = clonePayload(payload, {
        x: base.x - minX,
        y: base.y - minY,
      })
      recordHistory()
      updateActiveTab((tab) => ({
        ...tab,
        nodes: [...tab.nodes, ...cloned.nodes],
        connections: [...tab.connections, ...cloned.connections],
      }))
      setSelection({
        nodeIds: cloned.nodes.map((n) => n.id),
        connectionId: null,
      })
    },
    [recordHistory, updateActiveTab]
  )

  const pasteNodes = React.useCallback(
    (world?: CanvasPosition) => {
      const payload = clipboard ?? readClipboard()
      if (!payload) return
      insertPayload(payload, world)
    },
    [clipboard, insertPayload]
  )

  const duplicateNodes = React.useCallback(
    (ids: string[]) => {
      const tab = activeTabOf(docRef.current)
      if (!tab || ids.length === 0) return
      const idSet = new Set(ids)
      insertPayload(
        {
          nodes: tab.nodes.filter((n) => idSet.has(n.id)),
          connections: tab.connections.filter(
            (c) => idSet.has(c.fromNodeId) && idSet.has(c.toNodeId)
          ),
        },
        undefined
      )
    },
    [insertPayload]
  )

  const copyNodeText = React.useCallback(
    async (node: CanvasNode) => {
      const text = node.metadata.content ?? node.metadata.prompt ?? ''
      try {
        await navigator.clipboard.writeText(text)
        toast.success(t('Text copied'))
      } catch {
        toast.error(t('Clipboard unavailable'))
      }
    },
    [t]
  )

  // ----- 生成与轮询 -----
  const upstreamReferenceImages = React.useCallback((nodeId: string) => {
    const tab = activeTabOf(docRef.current)
    if (!tab) return []
    const nodeMap = new Map(tab.nodes.map((n) => [n.id, n]))
    const refs: string[] = []
    for (const connection of tab.connections) {
      if (connection.toNodeId !== nodeId) continue
      const from = nodeMap.get(connection.fromNodeId)
      if (
        from &&
        (from.type === 'image' ||
          from.type === 'upscale' ||
          from.type === 'drawing') &&
        from.metadata.url
      ) {
        refs.push(from.metadata.url)
      }
    }
    return refs.slice(0, 8)
  }, [])

  const generate = React.useCallback(
    async (node: CanvasNode, referenceOverride?: string[]) => {
      if (!canGenerateNode(node.type)) return
      const isUpscale = node.type === 'upscale'
      const refs = referenceOverride ?? upstreamReferenceImages(node.id)
      let prompt = (node.metadata.prompt ?? '').trim()
      let referenceImages = refs
      if (!isUpscale) {
        // 对齐 BeefTV：上游文本节点内容自动并入提示词；@名称 指代解析为文本内容
        const tab = activeTabOf(docRef.current)
        const texts = collectUpstreamTexts(
          node.id,
          tab?.nodes ?? [],
          tab?.connections ?? []
        )
        const appended: string[] = []
        for (const item of texts) {
          if (prompt.includes(`@${item.title}`)) {
            prompt = prompt.split(`@${item.title}`).join(item.content)
          } else {
            appended.push(item.content)
          }
        }
        if (appended.length > 0) {
          prompt = [prompt, ...appended].filter(Boolean).join('\n\n')
        }
      }
      if (isUpscale) {
        const source = node.metadata.sourceUrl ?? refs[0]
        if (!source) {
          toast.error(t('Add a source image to enhance'))
          return
        }
        referenceImages = [
          source,
          ...refs.filter((url) => url !== source),
        ].slice(0, 8)
        if (!prompt) {
          prompt = t(
            'Enhance resolution and details while keeping the original composition'
          )
        }
        const factor = node.metadata.upscaleFactor ?? 2
        const mode = node.metadata.upscaleMode ?? 'faithful'
        const format = node.metadata.upscaleFormat ?? 'png'
        const modeText =
          mode === 'creative'
            ? 'creative detail rebuild'
            : 'faithful enhancement'
        prompt += ` Upscale ${factor}x with ${modeText}, output format ${format.toUpperCase()}.`
      } else if (!prompt) {
        return
      }
      let kind: 'image' | 'video' | 'text' | 'audio' = 'image'
      if (node.type === 'video') kind = 'video'
      else if (node.type === 'text') kind = 'text'
      else if (node.type === 'audio') kind = 'audio'
      recordHistory()
      patchNodeSilent(node.id, {
        metadata: {
          status: 'loading',
          error: undefined,
          startedAt: Date.now(),
        },
      })
      try {
        const res = await submitCanvasGeneration({
          projectId,
          nodeId: node.id,
          kind,
          prompt,
          size: kind === 'image' ? node.metadata.size : undefined,
          quality: kind === 'image' ? node.metadata.quality : undefined,
          background: kind === 'image' ? node.metadata.background : undefined,
          aspectRatio: kind === 'video' ? node.metadata.aspectRatio : undefined,
          resolution: kind === 'video' ? node.metadata.resolution : undefined,
          duration: kind === 'video' ? node.metadata.duration : undefined,
          generateAudio:
            kind === 'video' ? node.metadata.generateAudio : undefined,
          referenceImages,
          count:
            kind === 'image' || kind === 'text' || kind === 'video'
              ? node.metadata.count
              : undefined,
          voice: kind === 'audio' ? node.metadata.voice : undefined,
          audioFormat: kind === 'audio' ? node.metadata.audioFormat : undefined,
          speed: kind === 'audio' ? node.metadata.speed : undefined,
        })
        if (res.success && res.data) {
          patchNodeSilent(node.id, {
            metadata: { generationId: res.data.generationId },
          })
        } else {
          patchNodeSilent(node.id, {
            metadata: {
              status: 'error',
              error: res.message || t('Generation failed'),
            },
          })
        }
      } catch {
        patchNodeSilent(node.id, {
          metadata: { status: 'error', error: t('Generation failed') },
        })
      }
    },
    [projectId, patchNodeSilent, upstreamReferenceImages, recordHistory, t]
  )

  // 每 3s 轮询所有画布中生成中的节点任务
  React.useEffect(() => {
    const timer = setInterval(async () => {
      const current = docRef.current
      if (!current) return
      for (const tab of current.canvases) {
        for (const node of tab.nodes) {
          const generationId = node.metadata.generationId
          if (node.metadata.status !== 'loading' || !generationId) continue
          if (pollingBusyRef.current.has(generationId)) continue
          pollingBusyRef.current.add(generationId)
          try {
            const res = await getCanvasGeneration(generationId)
            const generation = res.data
            if (!res.success || !generation) continue
            // 轮询期间任务可能已被用户取消，重新确认状态再落盘
            const liveNode = docRef.current?.canvases
              .flatMap((cv) => cv.nodes)
              .find((n) => n.id === node.id)
            if (!liveNode || liveNode.metadata.status !== 'loading') continue
            if (generation.status === 'success') {
              if (generation.kind === 'text') {
                // 文本结果直接写入内容，无媒体 URL/历史
                patchNodeSilent(node.id, {
                  metadata: {
                    status: 'success',
                    content: generation.resultText,
                    error: undefined,
                  },
                })
              } else {
                const history = [...(liveNode.metadata.history ?? [])]
                const previousUrl = liveNode.metadata.url
                if (
                  previousUrl &&
                  previousUrl !== generation.resultUrl &&
                  history.at(-1)?.url !== previousUrl
                ) {
                  history.push({
                    id: canvasId('ver'),
                    url: previousUrl,
                    prompt: liveNode.metadata.prompt ?? '',
                    createdAt: Date.now(),
                  })
                }
                history.push({
                  id: canvasId('ver'),
                  url: generation.resultUrl,
                  prompt: generation.prompt,
                  generationId: generation.id,
                  createdAt: Date.now(),
                })
                const trimmed = history.slice(-12)
                patchNodeSilent(node.id, {
                  metadata: {
                    status: 'success',
                    url: generation.resultUrl,
                    error: undefined,
                    history: trimmed,
                    historyIndex: trimmed.length - 1,
                  },
                })
              }
              // 多产出（count>1）：首条为主结果，其余在源右侧生成兄弟节点
              if (generation.resultExtras) {
                let extras: string[] = []
                try {
                  const parsed: unknown = JSON.parse(generation.resultExtras)
                  if (Array.isArray(parsed)) {
                    extras = parsed.filter(
                      (item): item is string =>
                        typeof item === 'string' && item.length > 0
                    )
                  }
                } catch {
                  extras = []
                }
                if (extras.length > 0) {
                  let childType: CanvasNodeType = 'image'
                  if (generation.kind === 'text') childType = 'text'
                  else if (generation.kind === 'video') childType = 'video'
                  const created = extras.map((value, index) => {
                    const child = createCanvasNode(
                      childType,
                      {
                        x: liveNode.position.x + liveNode.width + 100,
                        y:
                          liveNode.position.y +
                          index * (liveNode.height + 60),
                      },
                      liveNode.title
                    )
                    child.metadata =
                      childType === 'text'
                        ? {
                            ...child.metadata,
                            content: value,
                            prompt: generation.prompt,
                            status: 'success',
                          }
                        : {
                            ...child.metadata,
                            url: value,
                            prompt: generation.prompt,
                            status: 'success',
                            // 视频兄弟节点沿用源节点画幅/清晰度/时长，保证卡片比例一致
                            ...(childType === 'video'
                              ? {
                                  aspectRatio: liveNode.metadata.aspectRatio,
                                  resolution: liveNode.metadata.resolution,
                                  duration: liveNode.metadata.duration,
                                }
                              : {}),
                          }
                    return child
                  })
                  const childConnections = created.map((child) => ({
                    id: canvasId('conn'),
                    fromNodeId: liveNode.id,
                    toNodeId: child.id,
                  }))
                  recordHistory()
                  // 源节点可能在非激活画布，落到其所在画布
                  setDoc((prev) =>
                    prev
                      ? {
                          ...prev,
                          canvases: prev.canvases.map((cv) =>
                            cv.nodes.some((n) => n.id === liveNode.id)
                              ? {
                                  ...cv,
                                  nodes: [...cv.nodes, ...created],
                                  connections: [
                                    ...cv.connections,
                                    ...childConnections,
                                  ],
                                }
                              : cv
                          ),
                        }
                      : prev
                  )
                }
              }
            } else if (generation.status === 'failed') {
              patchNodeSilent(node.id, {
                metadata: {
                  status: 'error',
                  error: generation.errorMsg || t('Generation failed'),
                },
              })
            } else if (generation.status === 'cancelled') {
              patchNodeSilent(node.id, {
                metadata: { status: 'error', error: t('Cancelled by user') },
              })
            }
          } catch {
            // 网络抖动时保持 loading，下一轮继续
          } finally {
            pollingBusyRef.current.delete(generationId)
          }
        }
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [patchNodeSilent, recordHistory, t])

  // ----- 上传导入 -----
  const importFiles = React.useCallback(
    async (files: File[], world: CanvasPosition) => {
      const mediaFiles = files
        .filter(
          (f) =>
            f.type.startsWith('image/') ||
            f.type.startsWith('video/') ||
            f.type.startsWith('audio/')
        )
        .slice(0, 5)
      if (mediaFiles.length === 0) {
        toast.error(t('Only image, video and audio files can be imported'))
        return
      }
      recordHistory()
      for (const [index, file] of mediaFiles.entries()) {
        try {
          const res = await uploadCanvasFile(file)
          if (!res.success || !res.data) continue
          let type: CanvasNodeType = 'image'
          if (file.type.startsWith('video/')) type = 'video'
          else if (file.type.startsWith('audio/')) type = 'audio'
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
          updateActiveTab((tab) => ({ ...tab, nodes: [...tab.nodes, node] }))
        } catch {
          // 单个文件失败不阻断其余导入（错误已由全局拦截器提示）
        }
      }
    },
    [t, recordHistory, updateActiveTab]
  )

  const uploadFileToNode = React.useCallback(
    async (node: CanvasNode, file: File) => {
      try {
        const res = await uploadCanvasFile(file)
        if (res.success && res.data) {
          const metadata =
            node.type === 'upscale'
              ? {
                  sourceUrl: res.data.url,
                  url: res.data.url,
                  status: 'success' as const,
                  error: undefined,
                }
              : {
                  url: res.data.url,
                  status: 'success' as const,
                  error: undefined,
                }
          patchNode(node.id, { metadata })
        }
      } catch {
        // 全局拦截器已提示
      }
    },
    [patchNode]
  )

  // ----- 视口控制 -----
  const setViewport = React.useCallback(
    (next: ViewportTransform) => {
      updateActiveTab((tab) => ({ ...tab, viewport: next }))
    },
    [updateActiveTab]
  )

  const zoomAroundCenter = React.useCallback(
    (factor: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      const current = activeTabOf(docRef.current)?.viewport
      if (!rect || !current) return
      const centerX = rect.width / 2
      const centerY = rect.height / 2
      const newScale = clampCanvasScale(current.k * factor)
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

  const zoomTo = React.useCallback(
    (scale: number) => {
      const current = activeTabOf(docRef.current)?.viewport
      if (!current) return
      zoomAroundCenter(clampCanvasScale(scale) / current.k)
    },
    [zoomAroundCenter]
  )

  const fitNodes = React.useCallback(
    (subset: CanvasNode[]) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      if (subset.length === 0) {
        setViewport({ x: 0, y: 0, k: 1 })
        return
      }
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const node of subset) {
        minX = Math.min(minX, node.position.x)
        minY = Math.min(minY, node.position.y)
        maxX = Math.max(maxX, node.position.x + node.width)
        maxY = Math.max(maxY, node.position.y + node.height)
      }
      const padding = 120
      const scale = clampCanvasScale(
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
    },
    [setViewport]
  )

  const fitView = React.useCallback(() => {
    fitNodes(activeTabOf(docRef.current)?.nodes ?? [])
  }, [fitNodes])

  const fitSelected = React.useCallback(() => {
    const tab = activeTabOf(docRef.current)
    if (!tab) return
    const idSet = new Set(selectionRef.current.nodeIds)
    const subset = tab.nodes.filter((n) => idSet.has(n.id))
    fitNodes(subset.length > 0 ? subset : tab.nodes)
  }, [fitNodes])

  const centerOnNode = React.useCallback(
    (nodeId: string) => {
      const tab = activeTabOf(docRef.current)
      const rect = containerRef.current?.getBoundingClientRect()
      const node = tab?.nodes.find((n) => n.id === nodeId)
      if (!tab || !rect || !node) return
      const k = tab.viewport.k
      setViewport({
        x: rect.width / 2 - (node.position.x + node.width / 2) * k,
        y: rect.height / 2 - (node.position.y + node.height / 2) * k,
        k,
      })
      setSelection({ nodeIds: [nodeId], connectionId: null })
    },
    [setViewport]
  )

  const navigateMinimap = React.useCallback(
    (worldX: number, worldY: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      const current = activeTabOf(docRef.current)?.viewport
      if (!rect || !current) return
      setViewport({
        x: rect.width / 2 - worldX * current.k,
        y: rect.height / 2 - worldY * current.k,
        k: current.k,
      })
    },
    [setViewport]
  )

  // 容器尺寸（minimap 视口框换算）
  React.useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const update = () =>
      setContainerSize({
        width: element.clientWidth,
        height: element.clientHeight,
      })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [doc === null]) // eslint-disable-line react-hooks/exhaustive-deps  // ----- 添加节点命令（dock / 右键 / 双击画布共用） -----
  const handleCreateCommand = React.useCallback(
    (id: CanvasCreateCommandId, world?: CanvasPosition) => {
      setCreateMenu(null)
      if (NODE_COMMAND_TYPES.has(id)) {
        const created = addNode(id as CanvasNodeType, world)
        if (id === 'director') setDirectorNodeId(created.id)
        return
      }
      if (id === 'upload') {
        uploadWorldRef.current = world ?? viewportCenterWorld()
        uploadInputRef.current?.click()
        return
      }
      if (id === 'generation-history') {
        setHistoryPicker({ world })
        return
      }
      if (id === 'assets') {
        setAssetPicker({ world })
      }
    },
    [addNode, viewportCenterWorld]
  )

  const insertAsset = React.useCallback(
    (asset: CanvasAssetInsert) => {
      const world = assetPicker?.world ?? viewportCenterWorld()
      const node = createCanvasNode(
        asset.type,
        { x: world.x - 180, y: world.y - 180 },
        asset.name || t(CANVAS_NODE_TITLE_KEYS[asset.type])
      )
      node.metadata = {
        ...node.metadata,
        url: asset.url,
        status: 'success',
        naturalWidth: asset.width,
        naturalHeight: asset.height,
      }
      recordHistory()
      updateActiveTab((tab) => ({ ...tab, nodes: [...tab.nodes, node] }))
      setSelection({ nodeIds: [node.id], connectionId: null })
    },
    [assetPicker, viewportCenterWorld, t, recordHistory, updateActiveTab]
  )

  const insertGeneration = React.useCallback(
    (generation: CanvasGeneration) => {
      const world = historyPicker?.world ?? viewportCenterWorld()
      const type: CanvasNodeType = generation.kind
      const node = createCanvasNode(
        type,
        { x: world.x - 180, y: world.y - 180 },
        generation.prompt.slice(0, 24) || t(CANVAS_NODE_TITLE_KEYS[type])
      )
      node.metadata = {
        ...node.metadata,
        url: generation.kind === 'text' ? undefined : generation.resultUrl,
        content:
          generation.kind === 'text' ? generation.resultText : undefined,
        prompt: generation.prompt,
        status: 'success',
        generationId: generation.id,
      }
      recordHistory()
      updateActiveTab((tab) => ({ ...tab, nodes: [...tab.nodes, node] }))
      setSelection({ nodeIds: [node.id], connectionId: null })
    },
    [historyPicker, viewportCenterWorld, t, recordHistory, updateActiveTab]
  )

  // ----- Agent 草案应用（文本/图片/视频三列布局 + 连线下标重映射） -----
  const applyDraft = React.useCallback(
    (draft: CanvasDraft) => {
      const columnX = { text: 0, image: 440, video: 920 }
      const columnY = { text: 0, image: 0, video: 0 }
      const created: CanvasNode[] = draft.nodes.map((draftNode) => {
        const node = createCanvasNode(
          draftNode.type,
          { x: columnX[draftNode.type], y: columnY[draftNode.type] },
          draftNode.title || t(CANVAS_NODE_TITLE_KEYS[draftNode.type])
        )
        columnY[draftNode.type] += node.height + 60
        node.metadata = {
          ...node.metadata,
          content: draftNode.content || undefined,
          prompt: draftNode.prompt || undefined,
        }
        return node
      })
      const connections = draft.connections
        .filter(
          (c) =>
            c.from >= 0 &&
            c.to >= 0 &&
            c.from < created.length &&
            c.to < created.length &&
            c.from !== c.to
        )
        .map((c) => ({
          id: canvasId('conn'),
          fromNodeId: created[c.from].id,
          toNodeId: created[c.to].id,
        }))
      recordHistory()
      updateActiveTab((tab) => ({
        ...tab,
        nodes: [...tab.nodes, ...created],
        connections: [...tab.connections, ...connections],
      }))
      setSelection(EMPTY_SELECTION)
      toast.success(t('Draft applied to canvas'))
      window.setTimeout(() => fitView(), 60)
    },
    [t, recordHistory, updateActiveTab, fitView]
  )

  // ----- 文本→图片 / 分镜展开 / 批量生成 -----
  const spawnImageFrom = React.useCallback(
    (source: CanvasNode, prompt: string, title?: string): CanvasNode => {
      const node = createCanvasNode(
        'image',
        {
          x: source.position.x + source.width + 100,
          y: source.position.y,
        },
        title || t('Image node')
      )
      node.metadata = { ...node.metadata, prompt }
      recordHistory()
      updateActiveTab((tab) => ({
        ...tab,
        nodes: [...tab.nodes, node],
        connections: [
          ...tab.connections,
          {
            id: canvasId('conn'),
            fromNodeId: source.id,
            toNodeId: node.id,
          },
        ],
      }))
      setSelection({ nodeIds: [node.id], connectionId: null })
      return node
    },
    [t, recordHistory, updateActiveTab]
  )

  const textToImage = React.useCallback(
    (node: CanvasNode) => {
      const prompt = (node.metadata.content ?? '').trim()
      if (!prompt) return
      const created = spawnImageFrom(node, prompt)
      void generate(created)
    },
    [spawnImageFrom, generate]
  )

  const expandScene = React.useCallback(
    (node: CanvasNode, scene: CanvasScriptScene) => {
      const prompt = scene.description.trim() || scene.title.trim()
      if (!prompt) {
        toast.error(t('Describe the scene visuals first'))
        return
      }
      const created = spawnImageFrom(node, prompt, scene.title)
      void generate(created)
    },
    [spawnImageFrom, generate, t]
  )

  // 分镜行→视频节点（时长≥8s 取 10s，否则 5s）
  const sceneVideo = React.useCallback(
    (node: CanvasNode, scene: CanvasScriptScene) => {
      const prompt = scene.description.trim() || scene.title.trim()
      if (!prompt) {
        toast.error(t('Describe the scene visuals first'))
        return
      }
      const created = createCanvasNode(
        'video',
        {
          x: node.position.x + node.width + 100,
          y: node.position.y,
        },
        scene.title || t(CANVAS_NODE_TITLE_KEYS.video)
      )
      created.metadata = {
        ...created.metadata,
        prompt,
        duration: (scene.duration ?? 0) >= 8 ? 10 : 5,
      }
      recordHistory()
      updateActiveTab((tab) => ({
        ...tab,
        nodes: [...tab.nodes, created],
        connections: [
          ...tab.connections,
          {
            id: canvasId('conn'),
            fromNodeId: node.id,
            toNodeId: created.id,
          },
        ],
      }))
      setSelection({ nodeIds: [created.id], connectionId: null })
      void generate(created)
    },
    [t, recordHistory, updateActiveTab, generate]
  )

  const enlargeNode = React.useCallback(
    (node: CanvasNode) => {
      patchNode(node.id, {
        width: Math.round(node.width * 1.5),
        height: Math.round(node.height * 1.5),
      })
    },
    [patchNode]
  )

  const batchGenerate = React.useCallback(
    (node: CanvasNode) => {
      const rows = (node.metadata.rows ?? []).filter((row) => row.trim())
      if (rows.length === 0) return
      const created: CanvasNode[] = rows.map((row, index) => {
        const child = createCanvasNode(
          'image',
          {
            x: node.position.x + node.width + 100,
            y: node.position.y + index * 120,
          },
          row.trim().slice(0, 24) || t('Image node')
        )
        child.metadata = { ...child.metadata, prompt: row.trim() }
        return child
      })
      recordHistory()
      updateActiveTab((tab) => ({
        ...tab,
        nodes: [...tab.nodes, ...created],
        connections: [
          ...tab.connections,
          ...created.map((child) => ({
            id: canvasId('conn'),
            fromNodeId: node.id,
            toNodeId: child.id,
          })),
        ],
      }))
      setSelection({ nodeIds: created.map((n) => n.id), connectionId: null })
      for (const child of created) void generate(child)
    },
    [t, recordHistory, updateActiveTab, generate]
  )

  // ----- 节点工具条 / 媒体处理 / 多选编排 -----
  // 上传产物并在源节点右侧建相连新节点（裁切/关键帧/音视频分离共用）
  const spawnUploadedNode = React.useCallback(
    async (
      source: CanvasNode,
      file: File,
      type: CanvasNodeType,
      title: string
    ): Promise<CanvasNode | null> => {
      try {
        const res = await uploadCanvasFile(file)
        if (!res.success || !res.data) return null
        const node = createCanvasNode(
          type,
          {
            x: source.position.x + source.width + 100,
            y: source.position.y,
          },
          title
        )
        node.metadata = {
          ...node.metadata,
          url: res.data.url,
          status: 'success',
        }
        recordHistory()
        updateActiveTab((tab) => ({
          ...tab,
          nodes: [...tab.nodes, node],
          connections: [
            ...tab.connections,
            {
              id: canvasId('conn'),
              fromNodeId: source.id,
              toNodeId: node.id,
            },
          ],
        }))
        setSelection({ nodeIds: [node.id], connectionId: null })
        return node
      } catch {
        return null
      }
    },
    [recordHistory, updateActiveTab]
  )

  const applySplit = React.useCallback(
    async (source: CanvasNode, blobs: Blob[]) => {
      const size = Math.max(1, Math.round(Math.sqrt(blobs.length)))
      const created: CanvasNode[] = []
      for (const [index, blob] of blobs.entries()) {
        try {
          const res = await uploadCanvasFile(
            new File([blob], `split-${index + 1}.png`, { type: 'image/png' })
          )
          if (!res.success || !res.data) continue
          const node = createCanvasNode(
            'image',
            {
              x:
                source.position.x +
                source.width +
                100 +
                (index % size) * 284,
              y: source.position.y + Math.floor(index / size) * 284,
            },
            `${t('Split piece')} ${index + 1}`
          )
          node.metadata = {
            ...node.metadata,
            url: res.data.url,
            status: 'success',
          }
          created.push(node)
        } catch {
          // 单块失败不阻断其余（错误已由全局拦截器提示）
        }
      }
      if (created.length === 0) return
      recordHistory()
      updateActiveTab((tab) => ({
        ...tab,
        nodes: [...tab.nodes, ...created],
        connections: [
          ...tab.connections,
          ...created.map((child) => ({
            id: canvasId('conn'),
            fromNodeId: source.id,
            toNodeId: child.id,
          })),
        ],
      }))
      setSelection({
        nodeIds: created.map((n) => n.id),
        connectionId: null,
      })
    },
    [t, recordHistory, updateActiveTab]
  )

  const extractAudio = React.useCallback(
    async (source: CanvasNode) => {
      const url = source.metadata.url
      if (!url) return
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error('fetch failed')
        const buffer = await res.arrayBuffer()
        const context = new AudioContext()
        try {
          const decoded = await context.decodeAudioData(buffer)
          const blob = encodeWavBuffer(decoded)
          const node = await spawnUploadedNode(
            source,
            new File([blob], `${source.title}.wav`, { type: 'audio/wav' }),
            'audio',
            t('Extracted audio')
          )
          if (!node) toast.error(t('Audio extraction failed'))
        } finally {
          void context.close()
        }
      } catch {
        toast.error(t('Audio extraction failed'))
      }
    },
    [t, spawnUploadedNode]
  )

  const handleNodeTool = React.useCallback(
    (node: CanvasNode, tool: CanvasNodeToolId) => {
      switch (tool) {
        case 'info':
          setNodeInfoNodeId(node.id)
          return
        case 'fullscreen':
          setLightboxNodeId(node.id)
          return
        case 'download': {
          const url = node.metadata.url
          if (!url) return
          let ext = '.png'
          if (node.type === 'video') ext = '.mp4'
          else if (node.type === 'audio') ext = '.wav'
          void downloadMediaUrl(url, `${node.title}${ext}`)
          return
        }
        case 'retry':
          void generate(node)
          return
        case 'crop':
          setCropNodeId(node.id)
          return
        case 'split':
          setSplitNodeId(node.id)
          return
        case 'frame':
          setFrameNodeId(node.id)
          return
        case 'extract-audio':
          void extractAudio(node)
          return
        case 'upscale': {
          const created = createCanvasNode(
            'upscale',
            {
              x: node.position.x + node.width + 100,
              y: node.position.y,
            },
            t(CANVAS_NODE_TITLE_KEYS.upscale)
          )
          created.metadata = {
            ...created.metadata,
            sourceUrl: node.metadata.url,
          }
          recordHistory()
          updateActiveTab((tab) => ({
            ...tab,
            nodes: [...tab.nodes, created],
            connections: [
              ...tab.connections,
              {
                id: canvasId('conn'),
                fromNodeId: node.id,
                toNodeId: created.id,
              },
            ],
          }))
          setSelection({ nodeIds: [created.id], connectionId: null })
          return
        }
        case 'edit-drawing':
          setDrawingNodeId(node.id)
          return
        case 'edit-text':
          setTextEditNodeId(node.id)
          return
        case 'open-folder':
          setFolderBrowserId(node.id)
          return
        case 'lock':
          patchNode(node.id, { metadata: { locked: !node.metadata.locked } })
          return
        case 'duplicate':
          duplicateNodes([node.id])
          return
        case 'delete':
          deleteNodes([node.id])
          return
      }
    },
    [generate, extractAudio, t, recordHistory, updateActiveTab, patchNode, duplicateNodes, deleteNodes]
  )

  const selectedNodes = React.useCallback(() => {
    const tab = activeTabOf(docRef.current)
    if (!tab) return []
    const idSet = new Set(selectionRef.current.nodeIds)
    return tab.nodes.filter((n) => idSet.has(n.id))
  }, [])

  const alignSelection = React.useCallback(
    (mode: CanvasAlignMode) => {
      const subset = selectedNodes()
      if (subset.length < 2) return
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const node of subset) {
        minX = Math.min(minX, node.position.x)
        minY = Math.min(minY, node.position.y)
        maxX = Math.max(maxX, node.position.x + node.width)
        maxY = Math.max(maxY, node.position.y + node.height)
      }
      const positions = new Map<string, CanvasPosition>()
      if (mode === 'distributeX' || mode === 'distributeY') {
        if (subset.length < 3) return
        const horizontal = mode === 'distributeX'
        const sorted = [...subset].sort((a, b) =>
          horizontal
            ? a.position.x - b.position.x
            : a.position.y - b.position.y
        )
        const first = sorted[0]
        const last = sorted.at(-1)
        if (!first || !last) return
        const totalSize = sorted.reduce(
          (sum, n) => sum + (horizontal ? n.width : n.height),
          0
        )
        const span = horizontal
          ? last.position.x + last.width - first.position.x
          : last.position.y + last.height - first.position.y
        const gap = (span - totalSize) / (sorted.length - 1)
        let cursor = horizontal ? first.position.x : first.position.y
        for (const node of sorted) {
          positions.set(
            node.id,
            horizontal
              ? { x: cursor, y: node.position.y }
              : { x: node.position.x, y: cursor }
          )
          cursor += (horizontal ? node.width : node.height) + gap
        }
      } else {
        const centerX = (minX + maxX) / 2
        const centerY = (minY + maxY) / 2
        for (const node of subset) {
          const position = { ...node.position }
          if (mode === 'left') position.x = minX
          if (mode === 'right') position.x = maxX - node.width
          if (mode === 'centerX') position.x = centerX - node.width / 2
          if (mode === 'top') position.y = minY
          if (mode === 'bottom') position.y = maxY - node.height
          if (mode === 'centerY') position.y = centerY - node.height / 2
          positions.set(node.id, position)
        }
      }
      recordHistory()
      updateActiveTab((tab) => ({
        ...tab,
        nodes: tab.nodes.map((n) => {
          const position = positions.get(n.id)
          return position ? { ...n, position } : n
        }),
      }))
    },
    [selectedNodes, recordHistory, updateActiveTab]
  )

  const arrangeSelection = React.useCallback(
    (mode: CanvasArrangeMode) => {
      const subset = selectedNodes()
      if (subset.length < 2) return
      const sorted = [...subset].sort(
        (a, b) =>
          a.position.y - b.position.y || a.position.x - b.position.x
      )
      const minX = Math.min(...sorted.map((n) => n.position.x))
      const minY = Math.min(...sorted.map((n) => n.position.y))
      const gap = 40
      const positions = new Map<string, CanvasPosition>()
      if (mode === 'row') {
        let cursor = minX
        for (const node of sorted) {
          positions.set(node.id, { x: cursor, y: minY })
          cursor += node.width + gap
        }
      } else if (mode === 'column') {
        let cursor = minY
        for (const node of sorted) {
          positions.set(node.id, { x: minX, y: cursor })
          cursor += node.height + gap
        }
      } else {
        const cols = Math.ceil(Math.sqrt(sorted.length))
        const cellW = Math.max(...sorted.map((n) => n.width)) + gap
        const cellH = Math.max(...sorted.map((n) => n.height)) + gap
        sorted.forEach((node, index) => {
          positions.set(node.id, {
            x: minX + (index % cols) * cellW,
            y: minY + Math.floor(index / cols) * cellH,
          })
        })
      }
      recordHistory()
      updateActiveTab((tab) => ({
        ...tab,
        nodes: tab.nodes.map((n) => {
          const position = positions.get(n.id)
          return position ? { ...n, position } : n
        }),
      }))
    },
    [selectedNodes, recordHistory, updateActiveTab]
  )

  const packSelectionIntoFolder = React.useCallback(() => {
    const subset = selectedNodes()
    if (subset.length === 0) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const node of subset) {
      minX = Math.min(minX, node.position.x)
      minY = Math.min(minY, node.position.y)
      maxX = Math.max(maxX, node.position.x + node.width)
      maxY = Math.max(maxY, node.position.y + node.height)
    }
    const folder = createCanvasNode(
      'folder',
      { x: minX - 32, y: minY - 56 },
      t(CANVAS_NODE_TITLE_KEYS.folder)
    )
    folder.width = maxX - minX + 64
    folder.height = maxY - minY + 88
    recordHistory()
    // 文件夹置顶数组首位，渲染时垫在成员节点下方
    updateActiveTab((tab) => ({ ...tab, nodes: [folder, ...tab.nodes] }))
    setSelection({ nodeIds: [folder.id], connectionId: null })
  }, [selectedNodes, t, recordHistory, updateActiveTab])

  const batchConnectSelection = React.useCallback(() => {
    const subset = selectedNodes()
    if (subset.length < 2) return
    const sorted = [...subset].sort(
      (a, b) =>
        a.position.x - b.position.x || a.position.y - b.position.y
    )
    const tab = activeTabOf(docRef.current)
    if (!tab) return
    const existing = new Set(
      tab.connections.map((c) => `${c.fromNodeId}->${c.toNodeId}`)
    )
    const added: { id: string; fromNodeId: string; toNodeId: string }[] = []
    for (let i = 0; i < sorted.length - 1; i++) {
      const fromNodeId = sorted[i].id
      const toNodeId = sorted[i + 1].id
      const key = `${fromNodeId}->${toNodeId}`
      if (existing.has(key)) continue
      existing.add(key)
      added.push({ id: canvasId('conn'), fromNodeId, toNodeId })
    }
    if (added.length === 0) return
    recordHistory()
    updateActiveTab((t) => ({
      ...t,
      connections: [...t.connections, ...added],
    }))
    showConnectionHint()
  }, [selectedNodes, recordHistory, updateActiveTab, showConnectionHint])

  const cancelTask = React.useCallback(
    (nodeId: string) => {
      const liveNode = docRef.current?.canvases
        .flatMap((cv) => cv.nodes)
        .find((n) => n.id === nodeId)
      const generationId = liveNode?.metadata.generationId
      if (liveNode?.metadata.status === 'loading' && generationId) {
        // 通知后端停止轮询；失败不阻断本地取消（任务可能刚好已完成）
        void cancelCanvasGeneration(generationId).catch(() => {})
      }
      patchNodeSilent(nodeId, {
        metadata: { status: 'error', error: t('Cancelled by user') },
      })
    },
    [patchNodeSilent, t]
  )

  const locateTask = React.useCallback(
    (nodeId: string, canvasId: string) => {
      setTasksOpen(false)
      setDoc((prev) => (prev ? { ...prev, activeCanvasId: canvasId } : prev))
      // 等切换画布落盘后再定位，避免读到旧 tab
      window.setTimeout(() => centerOnNode(nodeId), 0)
    },
    [centerOnNode]
  )

  const optimizePrompt = React.useCallback(
    async (node: CanvasNode) => {
      const prompt = (node.metadata.prompt ?? '').trim()
      if (!prompt) {
        toast.error(t('Write a prompt first'))
        return
      }
      setOptimizingNodeId(node.id)
      try {
        const res = await optimizeCanvasPrompt(prompt)
        if (res.success && res.data?.prompt) {
          patchNode(node.id, { metadata: { prompt: res.data.prompt } })
          toast.success(t('Prompt optimized'))
        } else {
          toast.error(res.message || t('Prompt optimization failed'))
        }
      } catch {
        // 全局拦截器已提示
      } finally {
        setOptimizingNodeId(null)
      }
    },
    [t, patchNode]
  )

  const handleMention = React.useCallback(
    (
      node: CanvasNode,
      candidate: { kind: 'node' | 'asset'; id: string; title: string }
    ) => {
      if (candidate.kind === 'node') {
        addConnection(candidate.id, node.id)
        return
      }
      const asset = mentionAssets.find((a) => String(a.id) === candidate.id)
      if (!asset) return
      const type: CanvasNodeType = mediaNodeType(asset.type)
      const created = createCanvasNode(
        type,
        { x: node.position.x - 360, y: node.position.y },
        asset.name || candidate.title
      )
      created.metadata = {
        ...created.metadata,
        url: asset.url,
        status: 'success',
        naturalWidth: asset.width || undefined,
        naturalHeight: asset.height || undefined,
      }
      recordHistory()
      updateActiveTab((tab) => ({
        ...tab,
        nodes: [...tab.nodes, created],
        connections: [
          ...tab.connections,
          {
            id: canvasId('conn'),
            fromNodeId: created.id,
            toNodeId: node.id,
          },
        ],
      }))
    },
    [addConnection, mentionAssets, recordHistory, updateActiveTab]
  )

  const disconnectReference = React.useCallback(
    (connectionId: string) => {
      recordHistory()
      updateActiveTab((tab) => ({
        ...tab,
        connections: tab.connections.filter((c) => c.id !== connectionId),
      }))
    },
    [recordHistory, updateActiveTab]
  )

  // ----- 多画布管理 -----
  const newCanvas = React.useCallback(() => {
    const current = docRef.current
    if (!current) return
    const tab = createCanvasTab(
      t('Canvas {{index}}', { index: current.canvases.length + 1 })
    )
    recordHistory()
    setDoc((prev) =>
      prev
        ? {
            ...prev,
            canvases: [...prev.canvases, tab],
            activeCanvasId: tab.id,
          }
        : prev
    )
    setSelection(EMPTY_SELECTION)
  }, [t, recordHistory])

  const selectCanvas = React.useCallback((id: string) => {
    setDoc((prev) => (prev ? { ...prev, activeCanvasId: id } : prev))
    setSelection(EMPTY_SELECTION)
    setContextMenu(null)
    setCreateMenu(null)
  }, [])

  const renameCanvas = React.useCallback(
    (id: string, nextTitle: string) => {
      const trimmed = nextTitle.trim()
      if (!trimmed) return
      recordHistory()
      setDoc((prev) =>
        prev
          ? {
              ...prev,
              canvases: prev.canvases.map((cv) =>
                cv.id === id ? { ...cv, title: trimmed } : cv
              ),
            }
          : prev
      )
    },
    [recordHistory]
  )

  const duplicateCanvas = React.useCallback(
    (id: string) => {
      const current = docRef.current
      const source = current?.canvases.find((cv) => cv.id === id)
      if (!current || !source) return
      const copy: CanvasTab = {
        ...structuredClone(source),
        id: canvasId('canvas'),
        title: t('{{title}} copy', { title: source.title }),
      }
      recordHistory()
      setDoc((prev) => {
        if (!prev) return prev
        const index = prev.canvases.findIndex((cv) => cv.id === id)
        const canvases = [...prev.canvases]
        canvases.splice(index + 1, 0, copy)
        return { ...prev, canvases, activeCanvasId: copy.id }
      })
      setSelection(EMPTY_SELECTION)
    },
    [t, recordHistory]
  )

  const deleteCanvas = React.useCallback(
    (id: string) => {
      recordHistory()
      setDoc((prev) => {
        if (!prev) return prev
        const remaining = prev.canvases.filter((cv) => cv.id !== id)
        if (remaining.length === 0) {
          const fresh = createCanvasTab(t('Canvas {{index}}', { index: 1 }))
          return { ...prev, canvases: [fresh], activeCanvasId: fresh.id }
        }
        const activeCanvasId =
          prev.activeCanvasId === id ? remaining[0].id : prev.activeCanvasId
        return { ...prev, canvases: remaining, activeCanvasId }
      })
      setSelection(EMPTY_SELECTION)
    },
    [t, recordHistory]
  )

  const exportCanvas = React.useCallback((id: string) => {
    const current = docRef.current
    const tab = current?.canvases.find((cv) => cv.id === id)
    if (!current || !tab) return
    downloadJson(`${titleRef.current || 'canvas'}-${tab.title}.json`, {
      ...current,
      canvases: [tab],
      activeCanvasId: tab.id,
    })
  }, [])

  const exportAll = React.useCallback(() => {
    const current = docRef.current
    if (!current) return
    downloadJson(`${titleRef.current || 'canvas'}.json`, current)
  }, [])

  const openCanvasNewWindow = React.useCallback((id: string) => {
    window.open(`${window.location.pathname}#${id}`, '_blank')
  }, [])

  // ----- 顶栏导航 -----
  const openSettings = React.useCallback(() => {
    void saveNow()
    void navigate({ to: '/director/settings' })
  }, [navigate, saveNow])

  // 批量超分：每个上游图片按面板参数生成一个相连的新图片节点
  const batchUpscale = React.useCallback(
    (node: CanvasNode) => {
      const tab = activeTabOf(docRef.current)
      if (!tab) return
      const nodeMap = new Map(tab.nodes.map((n) => [n.id, n]))
      const inputs: { url: string; title: string }[] = []
      if (node.metadata.sourceUrl) {
        inputs.push({ url: node.metadata.sourceUrl, title: node.title })
      }
      let hasVideo = false
      for (const connection of tab.connections) {
        if (connection.toNodeId !== node.id) continue
        const from = nodeMap.get(connection.fromNodeId)
        if (!from) continue
        if (from.type === 'video') {
          hasVideo = true
          continue
        }
        if (
          (from.type === 'image' ||
            from.type === 'drawing' ||
            from.type === 'upscale') &&
          from.metadata.url
        ) {
          inputs.push({ url: from.metadata.url, title: from.title })
        }
      }
      if (hasVideo) {
        toast.error(
          t('Video upscaling is not supported by the current provider.')
        )
      }
      if (inputs.length === 0) {
        toast.error(t('Connect images or videos from the left'))
        return
      }
      if (!imageModelConfigured) {
        openSettings()
        return
      }
      const factor = node.metadata.upscaleFactor ?? 2
      const mode = node.metadata.upscaleMode ?? 'faithful'
      const format = node.metadata.upscaleFormat ?? 'png'
      const modeText =
        mode === 'creative' ? 'creative detail rebuild' : 'faithful enhancement'
      const prompt = `Upscale this image ${factor}x with ${modeText}, keep composition and identity unchanged. Output format: ${format.toUpperCase()}.`
      const created = inputs.map((input, index) => {
        const child = createCanvasNode(
          'image',
          {
            x: node.position.x + node.width + 100,
            y: node.position.y + index * 140,
          },
          `${input.title} ${factor}×`
        )
        child.metadata = { ...child.metadata, prompt }
        return child
      })
      recordHistory()
      updateActiveTab((cv) => ({
        ...cv,
        nodes: [...cv.nodes, ...created],
        connections: [
          ...cv.connections,
          ...created.map((child) => ({
            id: canvasId('conn'),
            fromNodeId: node.id,
            toNodeId: child.id,
          })),
        ],
      }))
      setSelection({ nodeIds: created.map((n) => n.id), connectionId: null })
      setBatchUpscaleBusy(true)
      // 超分节点自身无 url，子节点参考图显式传入源图
      void Promise.all(
        created.map((child, index) => generate(child, [inputs[index].url]))
      ).finally(() => setBatchUpscaleBusy(false))
    },
    [t, imageModelConfigured, openSettings, recordHistory, updateActiveTab, generate]
  )

  const goHome = React.useCallback(() => {
    void saveNow()
    void navigate({ to: '/' })
  }, [navigate, saveNow])

  const goProjects = React.useCallback(() => {
    void saveNow()
    void navigate({ to: '/canvas' })
  }, [navigate, saveNow])

  const createProject = React.useCallback(async () => {
    void saveNow()
    try {
      const res = await createCanvasProject()
      if (res.success && res.data) {
        void navigate({
          to: '/canvas/$id',
          params: { id: String(res.data.id) },
        })
      } else {
        toast.error(res.message || t('Failed to create project'))
      }
    } catch {
      toast.error(t('Failed to create project'))
    }
  }, [saveNow, navigate, t])

  const deleteProject = React.useCallback(async () => {
    try {
      const res = await deleteCanvasProject(projectId)
      if (res.success) {
        loadedRef.current = false
        toast.success(t('Project deleted'))
        void navigate({ to: '/canvas' })
      } else {
        toast.error(res.message || t('Failed to delete project'))
      }
    } catch {
      toast.error(t('Failed to delete project'))
    }
  }, [projectId, navigate, t])

  // ----- 右键菜单 -----
  const handleContextMenu = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>, world: CanvasPosition) => {
      const target = event.target instanceof Element ? event.target : null
      const connectionElement = target?.closest('[data-connection-id]')
      if (connectionElement) {
        const connectionId =
          connectionElement.getAttribute('data-connection-id') ?? ''
        setContextMenu({
          kind: 'connection',
          x: event.clientX,
          y: event.clientY,
          connectionId,
        })
        return
      }
      const nodeElement = target?.closest('[data-node-id]')
      if (nodeElement) {
        const nodeId = nodeElement.getAttribute('data-node-id') ?? ''
        if (!selectionRef.current.nodeIds.includes(nodeId)) {
          setSelection({ nodeIds: [nodeId], connectionId: null })
        }
        setContextMenu({
          kind: 'node',
          x: event.clientX,
          y: event.clientY,
          nodeId,
        })
        return
      }
      setContextMenu({
        kind: 'canvas',
        x: event.clientX,
        y: event.clientY,
        world,
      })
    },
    []
  )

  const handleCanvasDoubleClick = React.useCallback((world: CanvasPosition) => {
    const rect = containerRef.current?.getBoundingClientRect()
    const v = activeTabOf(docRef.current)?.viewport ?? { x: 0, y: 0, k: 1 }
    if (!rect) return
    setCreateMenu({
      x: rect.left + world.x * v.k + v.x,
      y: rect.top + world.y * v.k + v.y,
      world,
    })
  }, [])

  // ----- 快捷键 -----
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (mod && key === 's') {
        event.preventDefault()
        void saveNow()
        return
      }
      const target = event.target instanceof Element ? event.target : null
      const isTyping = target?.closest(
        "input,textarea,select,[contenteditable='true']"
      )
      if (isTyping) return
      if (mod && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redoHistory()
        else undoHistory()
        return
      }
      if (mod && key === 'y') {
        event.preventDefault()
        redoHistory()
        return
      }
      if (mod && key === 'c') {
        event.preventDefault()
        copyNodes(selectionRef.current.nodeIds)
        return
      }
      if (mod && key === 'v') {
        event.preventDefault()
        pasteNodes()
        return
      }
      if (mod && key === 'd') {
        event.preventDefault()
        duplicateNodes(selectionRef.current.nodeIds)
        return
      }
      if (mod && key === 'a') {
        event.preventDefault()
        selectAll()
        return
      }
      if (mod && key === 'f' && event.shiftKey) {
        event.preventDefault()
        setFocusMode((prev) => !prev)
        return
      }
      if (mod && key === 'f') {
        event.preventDefault()
        setNodeSearchOpen((prev) => !prev)
        return
      }
      if (mod && key === 'j') {
        event.preventDefault()
        setAgentOpen((prev) => !prev)
        return
      }
      if (mod && (key === '+' || key === '=')) {
        event.preventDefault()
        zoomAroundCenter(1.2)
        return
      }
      if (mod && key === '-') {
        event.preventDefault()
        zoomAroundCenter(1 / 1.2)
        return
      }
      if (mod && key === '0') {
        event.preventDefault()
        fitView()
        return
      }
      if (mod && key === '1') {
        event.preventDefault()
        zoomTo(1)
        return
      }
      if (mod && key === '2') {
        event.preventDefault()
        fitView()
        return
      }
      if (mod && key === '3') {
        event.preventDefault()
        fitSelected()
        return
      }
      if (mod) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        deleteSelection()
        return
      }
      if (event.key === 'Escape') {
        if (directorNodeId) {
          setDirectorNodeId(null)
          return
        }
        if (pickConnectNodeId) {
          setPickConnectNodeId(null)
          return
        }
        if (contextMenu) {
          setContextMenu(null)
          return
        }
        if (createMenu) {
          setCreateMenu(null)
          return
        }
        if (nodeSearchOpen) {
          setNodeSearchOpen(false)
          return
        }
        if (focusMode) {
          setFocusMode(false)
          return
        }
        setSelection(EMPTY_SELECTION)
        setConnecting(null)
        return
      }
      if (key === 'v') setTool('select')
      if (key === 'h') setTool('hand')
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    saveNow,
    undoHistory,
    redoHistory,
    copyNodes,
    pasteNodes,
    duplicateNodes,
    selectAll,
    zoomAroundCenter,
    zoomTo,
    fitView,
    fitSelected,
    deleteSelection,
    contextMenu,
    createMenu,
    nodeSearchOpen,
    focusMode,
    directorNodeId,
    pickConnectNodeId,
  ])

  // ----- 派生数据 -----
  const hiddenIds = React.useMemo(() => nodesHiddenByFolders(nodes), [nodes])
  const visibleNodes = React.useMemo(
    () => nodes.filter((node) => !hiddenIds.has(node.id)),
    [nodes, hiddenIds]
  )

  const folderItemCounts = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const node of nodes) {
      if (node.type === 'folder') {
        counts.set(node.id, nodesInsideFolder(node, nodes).length)
      }
    }
    return counts
  }, [nodes])

  // 上游参考 shelf（缩略图 + 文本 chip + 断开）
  const referencesByNode = React.useMemo(() => {
    const map = new Map<string, typeof EMPTY_NODE_REFERENCES>()
    const nodeMap = new Map(nodes.map((n) => [n.id, n]))
    for (const connection of connections) {
      const from = nodeMap.get(connection.fromNodeId)
      if (!from) continue
      const list = map.get(connection.toNodeId) ?? []
      // 同一来源只保留一条参考（重复边不产生重复 chip）
      if (list.some((ref) => ref.id === from.id)) continue
      list.push({
        connectionId: connection.id,
        id: from.id,
        title: from.title,
        url:
          from.type === 'image' ||
          from.type === 'upscale' ||
          from.type === 'drawing'
            ? from.metadata.url
            : undefined,
        text:
          from.type === 'text'
            ? (from.metadata.content ?? from.metadata.prompt ?? '').trim() ||
              undefined
            : undefined,
        type: from.type,
      })
      map.set(connection.toNodeId, list)
    }
    // 沿媒体链继承的文本输入（无直连边，不可单独断开）
    for (const node of nodes) {
      const list = map.get(node.id) ?? []
      const directIds = new Set(list.map((ref) => ref.id))
      for (const item of collectUpstreamTexts(node.id, nodes, connections)) {
        if (directIds.has(item.id)) continue
        list.push({
          connectionId: '',
          id: item.id,
          title: item.title,
          text: item.content,
          type: 'text',
        })
      }
      if (list.length > 0) map.set(node.id, list)
    }
    return map
  }, [nodes, connections])

  // @mention 候选：画布节点 + 素材库
  const mentionCandidates = React.useMemo(() => {
    const items: {
      key: string
      kind: 'node' | 'asset'
      id: string
      title: string
      type: CanvasNodeType
    }[] = nodes
      .filter((n) => n.type !== 'folder')
      .map((n) => ({
        key: `node:${n.id}`,
        kind: 'node' as const,
        id: n.id,
        title: n.title,
        type: n.type,
      }))
    for (const asset of mentionAssets) {
      items.push({
        key: `asset:${asset.id}`,
        kind: 'asset' as const,
        id: String(asset.id),
        title: asset.name || t('Asset library'),
        type: mediaNodeType(asset.type),
      })
    }
    return items
  }, [nodes, mentionAssets, t])

  // 跨画布生成任务（任务面板）
  const activeTasks = React.useMemo(() => {
    if (!doc) return []
    const list: CanvasActiveTask[] = []
    for (const canvas of doc.canvases) {
      for (const node of canvas.nodes) {
        if (node.metadata.status === 'loading') {
          list.push({
            node,
            canvasId: canvas.id,
            canvasTitle: canvas.title,
          })
        }
      }
    }
    return list
  }, [doc])

  const selectedIdSet = React.useMemo(
    () => new Set(selection.nodeIds),
    [selection.nodeIds]
  )

  const findNode = React.useCallback(
    (id: string | null) => (id ? nodes.find((n) => n.id === id) : undefined),
    [nodes]
  )

  const modelConfiguredFor = (type: CanvasNodeType) => {
    if (type === 'video') return videoModelConfigured
    if (type === 'text' || type === 'script') return textModelConfigured
    if (type === 'audio') return audioModelConfigured
    if (type === 'image' || type === 'upscale') return imageModelConfigured
    return true
  }

  const modelNameFor = (type: CanvasNodeType): string | undefined => {
    const settings = settingsRes?.data?.settings
    if (type === 'video') return settings?.videoModel || undefined
    if (type === 'text' || type === 'script') {
      return settings?.textModel || undefined
    }
    if (type === 'audio') return settings?.audioModel || undefined
    return settings?.imageModel || undefined
  }

  const toggleSetting = (
    setter: React.Dispatch<React.SetStateAction<boolean>>,
    storageKey: string
  ) => {
    setter((prev) => {
      localStorage.setItem(storageKey, prev ? '0' : '1')
      return !prev
    })
  }

  // 面板高度实测：节点靠近画布底部时把面板夹在容器内，保证发送按钮始终可见
  const panelObserverRef = React.useRef<ResizeObserver | null>(null)
  const [panelHeight, setPanelHeight] = React.useState(240)
  const panelBoxRef = React.useCallback((element: HTMLDivElement | null) => {
    panelObserverRef.current?.disconnect()
    panelObserverRef.current = null
    if (!element) return
    const observer = new ResizeObserver(() => {
      setPanelHeight(element.offsetHeight)
    })
    observer.observe(element)
    panelObserverRef.current = observer
  }, [])

  // ----- 渲染 -----
  if (projectPending || !doc || !activeTab) {
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
              onClick={() => void navigate({ to: '/canvas' })}
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

  const lightboxNode = findNode(lightboxNodeId)
  const drawingNode = findNode(drawingNodeId)
  const nodeInfoNode = findNode(nodeInfoNodeId)
  const textEditNode = findNode(textEditNodeId)
  const folderBrowserNode = findNode(folderBrowserId)
  const cropNode = findNode(cropNodeId)
  const splitNode = findNode(splitNodeId)
  const frameNode = findNode(frameNodeId)
  const directorNode = findNode(directorNodeId)

  // 单选节点→下方弹出输入面板（屏幕空间，借 --canvas-live-* 变量跟随手势）
  const panelNode =
    !focusMode && selection.nodeIds.length === 1
      ? visibleNodes.find(
          (n) =>
            n.id === selection.nodeIds[0] && PANEL_NODE_TYPES.has(n.type)
        )
      : undefined
  const panelWidth = panelNode
    ? Math.min(
        Math.max(Math.round(panelNode.width * viewport.k * 1.5), 660),
        920,
        Math.max(320, containerSize.width - 24)
      )
    : 0
  const panelRefs = panelNode
    ? (referencesByNode.get(panelNode.id) ?? EMPTY_NODE_REFERENCES)
    : EMPTY_NODE_REFERENCES
  const panelImageCount = panelNode
    ? panelRefs.filter(
        (r) =>
          (r.type === 'image' || r.type === 'drawing' || r.type === 'upscale') &&
          r.url
      ).length + (panelNode.metadata.sourceUrl ? 1 : 0)
    : 0
  const panelVideoCount = panelNode
    ? panelRefs.filter((r) => r.type === 'video').length
    : 0

  return (
    <div
      className='fixed inset-0 z-[100]'
      style={{ background: theme.canvas.background, color: theme.node.text }}
    >
      <InfiniteCanvas
        containerRef={containerRef}
        viewport={viewport}
        theme={theme}
        background={doc.background}
        tool={tool}
        onViewportChange={setViewport}
        onBackgroundClick={() => {
          setSelection(EMPTY_SELECTION)
          setContextMenu(null)
          setCreateMenu(null)
        }}
        onDoubleClick={handleCanvasDoubleClick}
        onDropFiles={(files, world) => void importFiles(files, world)}
        onBoxSelect={handleBoxSelect}
        onContextMenu={handleContextMenu}
        dropHint={t('Drop images, videos or audio to import')}
        overlayLayer={
          panelNode ? (
            <div
              ref={panelBoxRef}
              data-canvas-no-zoom
              className='absolute'
              style={{
                zIndex: 60,
                width: panelWidth,
                left: `clamp(12px, calc(var(--canvas-live-x) + ${panelNode.position.x + panelNode.width / 2}px * var(--canvas-live-scale) - ${panelWidth / 2}px), calc(100% - ${panelWidth + 12}px))`,
                top: `clamp(60px, calc(var(--canvas-live-y) + ${panelNode.position.y + panelNode.height}px * var(--canvas-live-scale) + 14px), calc(100% - ${panelHeight + 76}px))`,
              }}
            >
              {panelNode.type === 'upscale' ? (
                <CanvasUpscalePanel
                  node={panelNode}
                  theme={theme}
                  modelConfigured={imageModelConfigured}
                  modelName={modelNameFor('upscale')}
                  imageCount={panelImageCount}
                  videoCount={panelVideoCount}
                  busy={batchUpscaleBusy}
                  onPatchMetadata={(metadata) =>
                    patchNodeSilent(panelNode.id, { metadata })
                  }
                  onBatchUpscale={batchUpscale}
                  onOpenSettings={openSettings}
                />
              ) : (
                <CanvasNodePromptPanel
                  node={panelNode}
                  theme={theme}
                  modelConfigured={modelConfiguredFor(panelNode.type)}
                  modelName={modelNameFor(panelNode.type)}
                  references={panelRefs}
                  onDisconnect={disconnectReference}
                  mentionCandidates={mentionCandidates}
                  onMention={handleMention}
                  onPatchMetadata={(metadata) =>
                    patchNodeSilent(panelNode.id, { metadata })
                  }
                  onBeginEdit={beginHistoryEdit}
                  onEndEdit={endHistoryEdit}
                  onGenerate={(target) => void generate(target)}
                  onUploadFile={(target, file) =>
                    void uploadFileToNode(target, file)
                  }
                  onOptimize={(target) => void optimizePrompt(target)}
                  optimizing={optimizingNodeId === panelNode.id}
                  onOpenSettings={openSettings}
                  pickConnectActive={pickConnectNodeId === panelNode.id}
                  onTogglePickConnect={() =>
                    setPickConnectNodeId((prev) =>
                      prev === panelNode.id ? null : panelNode.id
                    )
                  }
                />
              )}
            </div>
          ) : undefined
        }
        graphicsLayer={
          showConnections ? (
            <CanvasConnections
              nodes={visibleNodes}
              connections={connections}
              selectedId={selection.connectionId}
              connecting={connecting}
              theme={theme}
              onSelect={handleSelectConnection}
            />
          ) : undefined
        }
      >
        {visibleNodes.map((node) => (
          <CanvasNodeView
            key={node.id}
            node={node}
            theme={theme}
            selected={selectedIdSet.has(node.id)}
            modelConfigured={modelConfiguredFor(node.type)}
            textModelName={modelNameFor('text')}
            isConnectionTarget={connecting?.targetNodeId === node.id}
            folderItemCount={folderItemCounts.get(node.id) ?? 0}
            getScale={getScale}
            onSelect={handleSelectNode}
            onPatch={patchNode}
            onMove={moveNode}
            onBeginEdit={beginHistoryEdit}
            onEndEdit={endHistoryEdit}
            onGenerate={(target) => void generate(target)}
            onUploadFile={(target, file) => void uploadFileToNode(target, file)}
            onConnectionStart={startConnection}
            onCreateConnected={createConnected}
            onOpenSettings={openSettings}
            onOpenDrawing={(target) => setDrawingNodeId(target.id)}
            onOpenDirector={(target) => setDirectorNodeId(target.id)}
            onExpandScene={expandScene}
            onSceneVideo={sceneVideo}
            onEnlarge={enlargeNode}
            onBatchGenerate={batchGenerate}
            references={referencesByNode.get(node.id) ?? EMPTY_NODE_REFERENCES}
            onTool={handleNodeTool}
            onOpenFolder={(target) => setFolderBrowserId(target.id)}
          />
        ))}
      </InfiniteCanvas>

      {/* 3D 导演台全屏工作台 */}
      {directorNode && (
        <CanvasDirectorWorkspace
          node={directorNode}
          theme={theme}
          projectId={projectId}
          imageModelConfigured={imageModelConfigured}
          references={nodes
            .filter(
              (n) =>
                (n.type === 'image' ||
                  n.type === 'drawing' ||
                  n.type === 'upscale') &&
                n.metadata.url
            )
            .slice(0, 8)
            .map((n) => ({
              id: n.id,
              title: n.title,
              url: n.metadata.url as string,
            }))}
          saveState={saveState === 'error' ? 'dirty' : saveState}
          onClose={() => setDirectorNodeId(null)}
          onPatchDirector={(state: CanvasDirectorState) =>
            patchNodeSilent(directorNode.id, { metadata: { director: state } })
          }
          onBeginEdit={beginHistoryEdit}
          onEndEdit={endHistoryEdit}
          onOpenSettings={openSettings}
        />
      )}

      {/* 多选浮动工具条：对齐/分布/排列/收纳/批量连接 */}
      {!focusMode && selection.nodeIds.length >= 2 && (
        <CanvasSelectionToolbar
          theme={theme}
          count={selection.nodeIds.length}
          onAlign={alignSelection}
          onArrange={arrangeSelection}
          onPackFolder={packSelectionIntoFolder}
          onBatchConnect={batchConnectSelection}
          onCopy={() => copyNodes(selection.nodeIds)}
          onDelete={() => deleteNodes(selection.nodeIds)}
          onAskAssistant={() => setAgentOpen(true)}
        />
      )}

      {/* 生成任务面板 */}
      {tasksOpen && !focusMode && (
        <CanvasTaskPanel
          theme={theme}
          tasks={activeTasks}
          onLocate={locateTask}
          onCancel={cancelTask}
          onClose={() => setTasksOpen(false)}
        />
      )}

      {/* 空画布引导（BeefTV：双击画布自由生成节点 / 助手草案） */}
      {nodes.length === 0 && !createMenu && (
        <div className='pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 px-6 text-center'>
          <div className='relative'>
            <PlusCircle
              aria-hidden='true'
              className='size-14'
              style={{ color: theme.node.faint }}
            />
            <MousePointer2
              aria-hidden='true'
              className='absolute -right-3 -bottom-2 size-6'
              style={{ color: theme.accent.primary }}
            />
          </div>
          <p
            className='text-base font-medium'
            style={{ color: theme.node.muted }}
          >
            {t('Double-click the canvas to create nodes freely')}
          </p>
          <button
            type='button'
            onClick={() => setAgentOpen(true)}
            className='pointer-events-auto flex h-9 cursor-pointer items-center gap-2 rounded-full px-4 text-xs font-medium transition-opacity hover:opacity-85'
            style={{
              background: theme.accent.primary,
              color: theme.accent.onPrimary,
            }}
          >
            <Sparkles aria-hidden='true' className='size-3.5' />
            {t('Or let the assistant draft it')}
            <span
              className='rounded px-1.5 py-0.5 text-[10px]'
              style={{ background: 'rgba(0,0,0,.18)' }}
            >
              {modKey('J')}
            </span>
          </button>
        </div>
      )}

      {/* 顶部浮动工作区条 + 右上工具 */}
      {!focusMode && (
        <CanvasTopBar
          theme={theme}
          title={title}
          onTitleChange={setTitle}
          saveState={saveState}
          onRetrySave={() => void saveNow()}
          canvases={doc.canvases}
          activeCanvasId={doc.activeCanvasId}
          onSelectCanvas={selectCanvas}
          onNewCanvas={newCanvas}
          onRenameCanvas={renameCanvas}
          onDuplicateCanvas={duplicateCanvas}
          onDeleteCanvas={deleteCanvas}
          onExportCanvas={exportCanvas}
          onExportAll={exportAll}
          onOpenCanvasNewWindow={openCanvasNewWindow}
          onGoHome={goHome}
          onGoProjects={goProjects}
          onCreateProject={() => void createProject()}
          onDeleteProject={() => void deleteProject()}
          onOpenWorkflow={() => setWorkflowOpen(true)}
          onOpenAgent={() => setAgentOpen(true)}
          onOpenHistory={() => setHistoryPicker({})}
        />
      )}

      {/* 左下：资产管理 + 视图 cluster + 缩放 */}
      {!focusMode && (
        <CanvasZoomControls
          theme={theme}
          scale={viewport.k}
          assetCount={assetCount}
          showConnections={showConnections}
          showMinimap={showMinimap}
          snapEnabled={snapEnabled}
          onToggleConnections={() =>
            toggleSetting(setShowConnections, 'canvas:show-connections')
          }
          onToggleMinimap={() =>
            toggleSetting(setShowMinimap, 'canvas:minimap')
          }
          onToggleSnap={() => toggleSetting(setSnapEnabled, 'canvas:snap')}
          onFitView={fitView}
          onZoomIn={() => zoomAroundCenter(1.2)}
          onZoomOut={() => zoomAroundCenter(1 / 1.2)}
          onZoomTo={zoomTo}
          onOpenAssets={() => setAssetPicker({})}
        />
      )}

      {/* 小地图 */}
      {!focusMode && showMinimap && containerSize.width > 0 && (
        <CanvasMiniMap
          theme={theme}
          nodes={visibleNodes}
          viewport={viewport}
          containerWidth={containerSize.width}
          containerHeight={containerSize.height}
          onNavigate={navigateMinimap}
        />
      )}

      {/* 底部 Dock */}
      {!focusMode && (
        <CanvasToolbar
          theme={theme}
          tool={tool}
          onToolChange={setTool}
          onCommand={(id) => handleCreateCommand(id)}
          background={doc.background}
          onBackgroundChange={(background: CanvasBackgroundMode) => {
            recordHistory()
            setDoc((prev) => (prev ? { ...prev, background } : prev))
          }}
          colorTheme={doc.theme}
          onThemeChange={(colorTheme: CanvasColorTheme) => {
            recordHistory()
            setDoc((prev) => (prev ? { ...prev, theme: colorTheme } : prev))
          }}
          snapEnabled={snapEnabled}
          onToggleSnap={() => toggleSetting(setSnapEnabled, 'canvas:snap')}
          showConnections={showConnections}
          onToggleConnections={() =>
            toggleSetting(setShowConnections, 'canvas:show-connections')
          }
          showMinimap={showMinimap}
          onToggleMinimap={() =>
            toggleSetting(setShowMinimap, 'canvas:minimap')
          }
          tasksCount={activeTasks.length}
          tasksOpen={tasksOpen}
          onToggleTasks={() => setTasksOpen((prev) => !prev)}
        />
      )}

      {/* 专注模式退出按钮 */}
      {focusMode && (
        <button
          type='button'
          data-canvas-menu
          onClick={() => setFocusMode(false)}
          className='absolute top-3 right-3 z-[80] flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs'
          style={{
            background: theme.toolbar.panel,
            border: `1px solid ${theme.toolbar.border}`,
            color: theme.toolbar.item,
            boxShadow: theme.node.hoverShadow,
          }}
          title={t('Exit focus mode (Esc)')}
        >
          <Minimize2 aria-hidden='true' className='size-3.5' />
          {t('Exit focus mode')}
        </button>
      )}

      {/* 右键上下文菜单 */}
      {contextMenu && (
        <CanvasContextMenu
          theme={theme}
          state={contextMenu}
          nodes={nodes}
          selectedNodeIds={selection.nodeIds}
          canUndo={canUndo}
          canRedo={canRedo}
          canPaste={Boolean(clipboard && clipboard.nodes.length > 0)}
          onClose={() => setContextMenu(null)}
          onCreateCommand={handleCreateCommand}
          onUploadHere={(world) => {
            uploadWorldRef.current = world
            uploadInputRef.current?.click()
          }}
          onOpenAssets={(world) => setAssetPicker({ world })}
          onUndo={undoHistory}
          onRedo={redoHistory}
          onPaste={(world) => pasteNodes(world)}
          onCopyNodes={() => copyNodes(selectionRef.current.nodeIds)}
          onDuplicateNodes={() => duplicateNodes(selectionRef.current.nodeIds)}
          onDeleteNodes={() => deleteNodes(selectionRef.current.nodeIds)}
          onCopyText={(node) => void copyNodeText(node)}
          onLightbox={(node) => setLightboxNodeId(node.id)}
          onOpenHistory={() => setHistoryPicker({})}
          onNodeInfo={(node) => setNodeInfoNodeId(node.id)}
          onExpandTextEdit={(node) => setTextEditNodeId(node.id)}
          onTextToImage={textToImage}
          onToggleFolder={(node) =>
            patchNode(node.id, {
              metadata: { collapsed: !node.metadata.collapsed },
            })
          }
          onDeleteConnection={deleteConnection}
        />
      )}

      {/* 双击画布：添加节点 list */}
      {createMenu && (
        <CanvasMenuPanel
          theme={theme}
          x={createMenu.x}
          y={createMenu.y}
          width={248}
          onClose={() => setCreateMenu(null)}
          ariaLabel={t('Add node')}
        >
          <CanvasCreateList
            theme={theme}
            onCommand={(id) => handleCreateCommand(id, createMenu.world)}
          />
        </CanvasMenuPanel>
      )}

      {/* ⌘F 节点搜索 */}
      {nodeSearchOpen && (
        <CanvasNodeSearch
          theme={theme}
          nodes={nodes}
          onPick={centerOnNode}
          onClose={() => setNodeSearchOpen(false)}
        />
      )}

      {/* 素材库 / 生成历史 picker */}
      {assetPicker && (
        <CanvasAssetPicker
          theme={theme}
          onClose={() => setAssetPicker(null)}
          onInsert={insertAsset}
        />
      )}
      {historyPicker && (
        <CanvasHistoryPicker
          theme={theme}
          projectId={projectId}
          onClose={() => setHistoryPicker(null)}
          onInsert={insertGeneration}
        />
      )}

      {/* Agent / 工作流面板 */}
      {agentOpen && (
        <CanvasAgentPanel
          theme={theme}
          projectId={projectId}
          onClose={() => setAgentOpen(false)}
          onApply={applyDraft}
        />
      )}
      {workflowOpen && (
        <CanvasWorkflowPanel
          theme={theme}
          nodes={nodes}
          connections={connections}
          imageModelConfigured={imageModelConfigured}
          videoModelConfigured={videoModelConfigured}
          onClose={() => setWorkflowOpen(false)}
          onFocusNode={centerOnNode}
          onFitView={fitView}
          onOpenSettings={openSettings}
        />
      )}

      {/* 全屏预览 / 绘图板 / 节点信息 / 文本放大编辑 */}
      {lightboxNode && (
        <CanvasLightbox
          node={lightboxNode}
          onClose={() => setLightboxNodeId(null)}
        />
      )}
      {drawingNode && (
        <CanvasDrawingModal
          theme={theme}
          initialUrl={drawingNode.metadata.url}
          onClose={() => setDrawingNodeId(null)}
          onSave={(file) => {
            void uploadFileToNode(drawingNode, file)
            setDrawingNodeId(null)
          }}
        />
      )}
      {nodeInfoNode && (
        <CanvasNodeInfoModal
          theme={theme}
          node={nodeInfoNode}
          onClose={() => setNodeInfoNodeId(null)}
        />
      )}
      {textEditNode && (
        <CanvasTextEditModal
          theme={theme}
          node={textEditNode}
          onClose={() => setTextEditNodeId(null)}
          onChange={(content) =>
            patchNodeSilent(textEditNode.id, { metadata: { content } })
          }
          onBeginEdit={beginHistoryEdit}
          onEndEdit={endHistoryEdit}
          onGenerateImage={textToImage}
        />
      )}

      {/* 文件夹浏览器 / 图片裁切 / 宫格拆分 / 视频关键帧 */}
      {folderBrowserNode && (
        <CanvasFolderBrowser
          theme={theme}
          folder={folderBrowserNode}
          items={nodes.filter((n) =>
            nodesInsideFolder(folderBrowserNode, nodes).includes(n.id)
          )}
          onClose={() => setFolderBrowserId(null)}
          onLocate={(id) => {
            setFolderBrowserId(null)
            centerOnNode(id)
          }}
        />
      )}
      {cropNode?.metadata.url && (
        <CanvasCropDialog
          theme={theme}
          url={cropNode.metadata.url}
          onClose={() => setCropNodeId(null)}
          onApply={(blob) => {
            setCropNodeId(null)
            void spawnUploadedNode(
              cropNode,
              new File([blob], 'crop.png', { type: 'image/png' }),
              'image',
              t('Cropped image')
            )
          }}
        />
      )}
      {splitNode?.metadata.url && (
        <CanvasSplitDialog
          theme={theme}
          url={splitNode.metadata.url}
          onClose={() => setSplitNodeId(null)}
          onApply={(blobs) => {
            setSplitNodeId(null)
            void applySplit(splitNode, blobs)
          }}
        />
      )}
      {frameNode?.metadata.url && (
        <CanvasFrameDialog
          theme={theme}
          url={frameNode.metadata.url}
          onClose={() => setFrameNodeId(null)}
          onApply={(blob) => {
            setFrameNodeId(null)
            void spawnUploadedNode(
              frameNode,
              new File([blob], 'frame.png', { type: 'image/png' }),
              'image',
              t('Video frame')
            )
          }}
        />
      )}

      {/* 「上传到这里」隐藏输入 */}
      <input
        ref={uploadInputRef}
        type='file'
        accept='image/*,video/*,audio/*'
        multiple
        className='hidden'
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          if (files.length > 0) {
            const world = uploadWorldRef.current ?? viewportCenterWorld()
            void importFiles(files, { x: world.x - 180, y: world.y - 180 })
          }
          uploadWorldRef.current = null
          event.target.value = ''
        }}
      />
    </div>
  )
}
