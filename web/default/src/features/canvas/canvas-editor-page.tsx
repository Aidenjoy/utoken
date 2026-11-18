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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  Brush,
  Check,
  CloudOff,
  Download,
  FolderOpen,
  Hand,
  ImagePlus,
  Loader2,
  Maximize,
  MousePointer2,
  Redo2,
  SquareDashed,
  Type as TypeIcon,
  Undo2,
  Upload,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

import {
  CanvasApiError,
  cancelTask,
  createTask,
  getCapabilities,
  getProject,
  listTasks,
  renameProject,
  repersistTask,
  saveDocument,
  saveTaskToAsset,
  taskDownloadUrl,
  uploadImage,
} from './api'
import { AssetPickerDialog } from './components/asset-picker-dialog'
import { CanvasStage } from './components/canvas-stage'
import { LayerPanel } from './components/layer-panel'
import { RenameProjectDialog } from './components/project-dialogs'
import { TaskPanel } from './components/task-panel'
import { ToolPanel, type ToolParamValues } from './components/tool-panel'
import { CANVAS_BACKGROUNDS, type StageTool } from './constants'
import {
  addLayer,
  commitHistory,
  commitTransient,
  createHistory,
  createImageLayer,
  createTextLayer,
  findLayer,
  type History,
  layerSourceSize,
  newIdempotencyKey,
  parseDocument,
  redoHistory,
  removeLayer,
  reorderLayer,
  undoHistory,
  updateLayer,
} from './lib/document'
import {
  documentThumbnail,
  downloadBlob,
  exportCanvasImage,
  exportFilename,
  loadCanvasImage,
} from './lib/export'
import { fitViewport, type Viewport } from './lib/geometry'
import {
  clearMaskSurface,
  createMaskSurface,
  type MaskSurface,
  maskSurfaceHasContent,
  maskSurfaceToDataURL,
} from './lib/mask'
import type {
  CanvasAsset,
  CanvasDocument,
  CanvasLayer,
  CanvasTask,
  ToolCapability,
} from './types'

// 智能画布：编辑器
// 文档状态（图层 + 历史 + 自动保存）与交互状态（视口、工具、蒙版、任务）都在这里，
// 子组件只做展示与事件上报。

const AUTOSAVE_DELAY = 1200
const ACTIVE_STATUSES = new Set(['pending', 'running'])

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

interface CanvasEditorPageProps {
  projectId: number
}

/** 参数默认值取自后端能力表，保证「不填即按官方默认」与界面显示一致 */
function defaultParamsFor(capability?: ToolCapability): ToolParamValues {
  const out: ToolParamValues = {}
  capability?.params.forEach((param) => {
    if (param.default !== undefined) {
      out[param.name] = param.default as string | number | boolean
    }
  })
  return out
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  )
}

export function CanvasEditorPage(props: CanvasEditorPageProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  // ---------- 项目与能力 ----------
  const projectQuery = useQuery({
    queryKey: ['canvas', 'project', props.projectId],
    queryFn: () => getProject(props.projectId),
  })
  const capabilitiesQuery = useQuery({
    queryKey: ['canvas', 'capabilities'],
    queryFn: getCapabilities,
    staleTime: 60_000,
  })
  const tasksQuery = useQuery({
    queryKey: ['canvas', 'tasks', props.projectId],
    queryFn: () =>
      listTasks({ projectId: props.projectId, p: 1, page_size: 50 }),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? []
      return items.some((task) => ACTIVE_STATUSES.has(task.status))
        ? 2000
        : false
    },
  })

  const project = projectQuery.data
  const tasks = tasksQuery.data?.items ?? []

  // ---------- 文档状态 ----------
  const [history, setHistory] = React.useState<History<CanvasDocument> | null>(
    null
  )
  const historyRef = React.useRef(history)
  historyRef.current = history
  const revisionRef = React.useRef(0)
  const savedSnapshotRef = React.useRef<CanvasDocument | null>(null)
  const interactionStartRef = React.useRef<CanvasDocument | null>(null)
  const [saveState, setSaveState] = React.useState<SaveState>('saved')

  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [viewport, setViewport] = React.useState<Viewport>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  })
  const [stageTool, setStageTool] = React.useState<StageTool>('select')
  const [panelOpen, setPanelOpen] = React.useState(false)
  const [renameOpen, setRenameOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)
  const [refPickerOpen, setRefPickerOpen] = React.useState(false)

  // ---------- 工具状态 ----------
  const [activeTool, setActiveTool] = React.useState<string | null>(null)
  const [params, setParams] = React.useState<ToolParamValues>({})
  const [prompt, setPrompt] = React.useState('')
  const [extraRefs, setExtraRefs] = React.useState<CanvasAsset[]>([])
  const [submitting, setSubmitting] = React.useState(false)

  // ---------- 蒙版 ----------
  const [maskSurface, setMaskSurface] = React.useState<MaskSurface | null>(null)
  const [maskReady, setMaskReady] = React.useState(false)
  const [brushSize, setBrushSize] = React.useState(24)

  const stageHostRef = React.useRef<HTMLDivElement | null>(null)
  const fittedRef = React.useRef(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  const doc = history?.present ?? null
  const selectedLayer =
    doc && selectedId ? (findLayer(doc, selectedId) ?? null) : null
  const selectedImageLayer =
    selectedLayer?.type === 'image' ? selectedLayer : null
  const activeCapability: ToolCapability | null = React.useMemo(() => {
    if (!activeTool) return null
    return (
      capabilitiesQuery.data?.tools.find((tool) => tool.tool === activeTool) ??
      null
    )
  }, [activeTool, capabilitiesQuery.data?.tools])

  // ---------- 初始化文档 ----------
  React.useEffect(() => {
    if (!project || historyRef.current) return
    const parsed = parseDocument(project.document, {
      width: project.width,
      height: project.height,
      background: project.background,
    })
    revisionRef.current = project.revision
    savedSnapshotRef.current = parsed
    setHistory(createHistory(parsed))
    setSaveState('saved')
  }, [project])

  // ---------- 视口初次适配 ----------
  React.useEffect(() => {
    const host = stageHostRef.current
    if (!host || !doc || fittedRef.current) return
    const rect = host.getBoundingClientRect()
    if (rect.width < 40 || rect.height < 40) return
    setViewport(fitViewport(doc.width, doc.height, rect.width, rect.height))
    fittedRef.current = true
  }, [doc])

  // ---------- 自动保存 ----------
  const persist = React.useCallback(
    async (snapshot: CanvasDocument) => {
      if (!project) return
      setSaveState('saving')
      try {
        // 空文字图层会被后端校验拒绝，保存前剔除
        const sanitized: CanvasDocument = {
          ...snapshot,
          layers: snapshot.layers.filter(
            (layer) => layer.type !== 'text' || (layer.text ?? '').trim() !== ''
          ),
        }
        const thumbnail = await documentThumbnail(sanitized).catch(() => '')
        const result = await saveDocument(project.id, {
          revision: revisionRef.current,
          document: sanitized,
          thumbnail,
          background: sanitized.background,
        })
        revisionRef.current = result.revision
        savedSnapshotRef.current = snapshot
        setSaveState('saved')
        queryClient.invalidateQueries({ queryKey: ['canvas', 'projects'] })
      } catch (error) {
        if (
          error instanceof CanvasApiError &&
          error.code === 'revision_conflict'
        ) {
          // 另一个窗口先保存了：拉取最新 revision 后重试一次，保留本地内容
          try {
            const fresh = await getProject(project.id)
            revisionRef.current = fresh.revision
            setSaveState('dirty')
            toast.warning(t('Canvas updated elsewhere, retrying save'))
          } catch {
            setSaveState('error')
          }
          return
        }
        setSaveState('error')
        toast.error(error instanceof Error ? error.message : t('Save failed'))
      }
    },
    [project, queryClient, t]
  )

  React.useEffect(() => {
    if (!doc || !savedSnapshotRef.current) return
    if (doc === savedSnapshotRef.current) return
    setSaveState('dirty')
    const timer = window.setTimeout(() => {
      void persist(doc)
    }, AUTOSAVE_DELAY)
    return () => window.clearTimeout(timer)
  }, [doc, persist])

  // 离开页面前提醒未保存
  React.useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (saveState === 'dirty' || saveState === 'saving') {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [saveState])

  // ---------- 文档操作 ----------
  const commit = React.useCallback((next: CanvasDocument) => {
    setHistory((current) => (current ? commitHistory(current, next) : current))
  }, [])

  const beginInteraction = React.useCallback(() => {
    interactionStartRef.current = historyRef.current?.present ?? null
  }, [])

  const endInteraction = React.useCallback(() => {
    const start = interactionStartRef.current
    interactionStartRef.current = null
    if (!start) return
    setHistory((current) =>
      current ? commitTransient(current, start) : current
    )
  }, [])

  const patchLayer = React.useCallback(
    (layerId: string, patch: Partial<CanvasLayer>) => {
      setHistory((current) =>
        current
          ? {
              ...current,
              present: updateLayer(current.present, layerId, patch),
            }
          : current
      )
    },
    []
  )

  const patchLayerAndCommit = React.useCallback(
    (layerId: string, patch: Partial<CanvasLayer>) => {
      setHistory((current) =>
        current
          ? commitHistory(current, updateLayer(current.present, layerId, patch))
          : current
      )
    },
    []
  )

  const handleUndo = React.useCallback(() => {
    setHistory((current) => (current ? undoHistory(current) : current))
  }, [])
  const handleRedo = React.useCallback(() => {
    setHistory((current) => (current ? redoHistory(current) : current))
  }, [])

  const handleDeleteLayer = React.useCallback(() => {
    if (!selectedId) return
    setHistory((current) =>
      current
        ? commitHistory(current, removeLayer(current.present, selectedId))
        : current
    )
    setSelectedId(null)
  }, [selectedId])

  // ---------- 图层创建 ----------
  /** 把新图层居中放进画布，最多占画布的 90% */
  const placeCentered = React.useCallback(
    (layer: CanvasLayer, target: CanvasDocument): CanvasLayer => {
      const scale = Math.min(
        1,
        (target.width * 0.9) / layer.width,
        (target.height * 0.9) / layer.height
      )
      return {
        ...layer,
        scale,
        x: (target.width - layer.width * scale) / 2,
        y: (target.height - layer.height * scale) / 2,
      }
    },
    []
  )

  const addImageLayerFromUrl = React.useCallback(
    async (url: string, name: string) => {
      const current = historyRef.current?.present
      if (!current) return
      try {
        const image = await loadCanvasImage(url)
        const layer = placeCentered(
          createImageLayer({
            url,
            name,
            width: image.naturalWidth || current.width,
            height: image.naturalHeight || current.height,
          }),
          current
        )
        setHistory((state) =>
          state ? commitHistory(state, addLayer(state.present, layer)) : state
        )
        setSelectedId(layer.id)
      } catch {
        toast.error(t('Failed to load image'))
      }
    },
    [placeCentered, t]
  )

  const handleUploadFiles = React.useCallback(
    async (files: File[]) => {
      for (const file of files) {
        try {
          const uploaded = await uploadImage(file, props.projectId)
          const current = historyRef.current?.present
          if (!current) return
          const layer = placeCentered(
            createImageLayer({
              url: uploaded.url,
              name: uploaded.name,
              width: uploaded.width,
              height: uploaded.height,
            }),
            current
          )
          setHistory((state) =>
            state ? commitHistory(state, addLayer(state.present, layer)) : state
          )
          setSelectedId(layer.id)
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : t('Upload failed')
          )
        }
      }
    },
    [placeCentered, props.projectId, t]
  )

  const handleAddText = React.useCallback(() => {
    const current = historyRef.current?.present
    if (!current) return
    const layer = createTextLayer({
      text: t('Double-click to edit text'),
      canvasWidth: current.width,
      canvasHeight: current.height,
    })
    setHistory((state) =>
      state ? commitHistory(state, addLayer(state.present, layer)) : state
    )
    setSelectedId(layer.id)
    setStageTool('select')
  }, [t])

  // ---------- 键盘快捷键 ----------
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) handleRedo()
        else handleUndo()
        return
      }
      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault()
        const snapshot = historyRef.current?.present
        if (snapshot) void persist(snapshot)
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedId) {
          event.preventDefault()
          handleDeleteLayer()
        }
        return
      }
      if (event.key === 'Escape') {
        setStageTool('select')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleDeleteLayer, handleRedo, handleUndo, persist, selectedId])

  // ---------- 蒙版 ----------
  // 切图层或切工具都作废旧蒙版：蒙版尺寸必须始终等于当前原图的像素尺寸
  React.useEffect(() => {
    setMaskSurface(null)
    setMaskReady(false)
  }, [selectedId, activeTool])

  React.useEffect(() => {
    if (stageTool !== 'mask-brush' && stageTool !== 'mask-rect') return
    if (!selectedImageLayer) return
    const size = layerSourceSize(selectedImageLayer)
    if (
      maskSurface &&
      maskSurface.width === Math.round(size.width) &&
      maskSurface.height === Math.round(size.height)
    ) {
      return
    }
    setMaskSurface(createMaskSurface(size.width, size.height))
    setMaskReady(false)
  }, [maskSurface, selectedImageLayer, stageTool])

  const handleMaskPainted = React.useCallback(() => {
    if (!maskSurface) return
    setMaskReady(maskSurfaceHasContent(maskSurface))
  }, [maskSurface])

  const handleClearMask = React.useCallback(() => {
    if (!maskSurface) return
    clearMaskSurface(maskSurface)
    setMaskReady(false)
  }, [maskSurface])

  // ---------- 提交任务 ----------
  const handleSubmit = React.useCallback(async () => {
    if (!activeCapability || !doc) return
    const images: string[] = []
    if (activeCapability.requiresImage) {
      if (!selectedImageLayer?.url) {
        toast.error(t('Select an image layer on the canvas first'))
        return
      }
      images.push(selectedImageLayer.url)
    }
    extraRefs.forEach((asset) => images.push(`asset:${asset.refId}`))

    // 后端只有顶层 size 会进入 Ark 请求，params 原样入库；这里把 size 拆出来
    const { size, ...restParams } = params
    const cleanedParams: Record<string, string | number | boolean> = {}
    Object.entries(restParams).forEach(([key, value]) => {
      if (value === '' || value === undefined || value === null) return
      cleanedParams[key] = value
    })

    let mask: string | undefined
    if (activeCapability.supportsMask !== 'none' && maskSurface) {
      if (!maskSurfaceHasContent(maskSurface)) {
        toast.error(t('Paint the mask area before submitting'))
        return
      }
      mask = maskSurfaceToDataURL(maskSurface)
    }

    setSubmitting(true)
    try {
      const result = await createTask({
        projectId: props.projectId,
        tool: activeCapability.tool,
        idempotencyKey: newIdempotencyKey(activeCapability.tool),
        prompt: prompt.trim() || undefined,
        images: images.length > 0 ? images : undefined,
        mask,
        size:
          typeof size === 'string' && size.trim() !== ''
            ? size.trim()
            : undefined,
        params:
          Object.keys(cleanedParams).length > 0 ? cleanedParams : undefined,
      })
      if (result.reused) {
        toast.info(t('Reused the existing task for the same request'))
      } else {
        toast.success(t('Task submitted'))
      }
      queryClient.invalidateQueries({
        queryKey: ['canvas', 'tasks', props.projectId],
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('Submit failed'))
    } finally {
      setSubmitting(false)
    }
  }, [
    activeCapability,
    doc,
    extraRefs,
    maskSurface,
    params,
    prompt,
    props.projectId,
    queryClient,
    selectedImageLayer,
    t,
  ])

  // ---------- 任务结果 ----------
  const handleAddResultToCanvas = React.useCallback(
    async (task: CanvasTask, index: number) => {
      const image = task.result?.images?.[index]
      if (!image) return
      await addImageLayerFromUrl(
        image.url,
        `${task.toolLabel || task.tool} #${task.id}`
      )
      toast.success(t('Added to canvas'))
    },
    [addImageLayerFromUrl, t]
  )

  const saveAssetMutation = useMutation({
    mutationFn: (payload: { taskId: number; index: number }) =>
      saveTaskToAsset(payload.taskId, { index: payload.index }),
    onSuccess: () => toast.success(t('Saved to asset library')),
    onError: (error: Error) => toast.error(error.message),
  })

  const cancelMutation = useMutation({
    mutationFn: (taskId: number) => cancelTask(taskId),
    onSuccess: () => {
      toast.success(t('Cancel requested'))
      queryClient.invalidateQueries({
        queryKey: ['canvas', 'tasks', props.projectId],
      })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const repersistMutation = useMutation({
    mutationFn: (taskId: number) => repersistTask(taskId),
    onSuccess: () => {
      toast.success(t('Results re-stored'))
      queryClient.invalidateQueries({
        queryKey: ['canvas', 'tasks', props.projectId],
      })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const renameMutation = useMutation({
    mutationFn: (title: string) => renameProject(props.projectId, title),
    onSuccess: () => {
      toast.success(t('Renamed'))
      setRenameOpen(false)
      queryClient.invalidateQueries({
        queryKey: ['canvas', 'project', props.projectId],
      })
      queryClient.invalidateQueries({ queryKey: ['canvas', 'projects'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  // ---------- 导出 ----------
  const handleExport = React.useCallback(
    async (format: 'png' | 'jpeg') => {
      const snapshot = historyRef.current?.present
      if (!snapshot || !project) return
      try {
        const blob = await exportCanvasImage(snapshot, format)
        downloadBlob(blob, exportFilename(project.title, format))
        toast.success(t('Exported'))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('Export failed'))
      }
    },
    [project, t]
  )

  // ---------- 视口控制 ----------
  const zoomBy = (factor: number) => {
    const host = stageHostRef.current
    if (!host) return
    const rect = host.getBoundingClientRect()
    setViewport((current) => {
      const scale = Math.min(Math.max(current.scale * factor, 0.05), 8)
      const anchor = { x: rect.width / 2, y: rect.height / 2 }
      const canvasX = (anchor.x - current.offsetX) / current.scale
      const canvasY = (anchor.y - current.offsetY) / current.scale
      return {
        scale,
        offsetX: anchor.x - canvasX * scale,
        offsetY: anchor.y - canvasY * scale,
      }
    })
  }

  const fitToScreen = () => {
    const host = stageHostRef.current
    if (!host || !doc) return
    const rect = host.getBoundingClientRect()
    setViewport(fitViewport(doc.width, doc.height, rect.width, rect.height))
  }

  // ---------- 渲染 ----------
  const renderSaveState = () => {
    if (saveState === 'saving') {
      return (
        <>
          <Loader2 className='animate-spin' size={12} />
          {t('Saving...')}
        </>
      )
    }
    if (saveState === 'saved') {
      return (
        <>
          <Check size={12} />
          {t('Saved')}
        </>
      )
    }
    if (saveState === 'error') {
      return (
        <>
          <CloudOff size={12} className='text-destructive' />
          {t('Save failed')}
        </>
      )
    }
    return t('Unsaved changes')
  }

  let capabilitiesError: string | null = null
  if (capabilitiesQuery.isError) {
    capabilitiesError =
      capabilitiesQuery.error instanceof Error
        ? capabilitiesQuery.error.message
        : t('Failed to load capabilities')
  }

  if (projectQuery.isPending) {
    return (
      <div className='text-muted-foreground flex h-full items-center justify-center gap-2 text-sm'>
        <Loader2 className='animate-spin' size={16} />
        {t('Loading canvas...')}
      </div>
    )
  }

  if (projectQuery.isError || !project) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 text-sm'>
        <p className='text-destructive'>
          {projectQuery.error instanceof Error
            ? projectQuery.error.message
            : t('Canvas not found')}
        </p>
        <Button variant='outline' render={<Link to='/canvas' />}>
          <ArrowLeft className='mr-1' size={14} />
          {t('Back to canvas list')}
        </Button>
      </div>
    )
  }

  if (!doc) {
    return (
      <div className='text-muted-foreground flex h-full items-center justify-center text-sm'>
        {t('Loading canvas...')}
      </div>
    )
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      {/* 顶部工具条 */}
      <div className='flex flex-wrap items-center gap-2 border-b px-2 py-1.5'>
        <Button
          size='icon'
          variant='ghost'
          className='h-8 w-8'
          title={t('Back to canvas list')}
          render={<Link to='/canvas' />}
        >
          <ArrowLeft size={15} />
        </Button>
        <button
          type='button'
          className='hover:bg-accent rounded px-1.5 py-1 text-sm font-medium'
          onClick={() => setRenameOpen(true)}
          title={t('Rename')}
        >
          {project.title}
        </button>
        <span className='text-muted-foreground text-[11px]'>
          {doc.width}×{doc.height}
        </span>

        <span className='text-muted-foreground flex items-center gap-1 text-[11px]'>
          {renderSaveState()}
        </span>

        <div className='bg-border mx-1 h-5 w-px' />

        <Button
          size='icon'
          variant='ghost'
          className='h-8 w-8'
          disabled={!history || history.past.length === 0}
          onClick={handleUndo}
          title={t('Undo')}
        >
          <Undo2 size={15} />
        </Button>
        <Button
          size='icon'
          variant='ghost'
          className='h-8 w-8'
          disabled={!history || history.future.length === 0}
          onClick={handleRedo}
          title={t('Redo')}
        >
          <Redo2 size={15} />
        </Button>

        <div className='bg-border mx-1 h-5 w-px' />

        {(
          [
            { id: 'select', icon: MousePointer2, label: t('Select') },
            { id: 'pan', icon: Hand, label: t('Pan') },
            { id: 'mask-brush', icon: Brush, label: t('Mask brush') },
            { id: 'mask-rect', icon: SquareDashed, label: t('Rect select') },
          ] as const
        ).map((item) => (
          <Button
            key={item.id}
            size='icon'
            variant={stageTool === item.id ? 'secondary' : 'ghost'}
            className='h-8 w-8'
            title={item.label}
            onClick={() => setStageTool(item.id)}
          >
            <item.icon size={15} />
          </Button>
        ))}

        <div className='bg-border mx-1 h-5 w-px' />

        <Button
          size='sm'
          variant='ghost'
          className='h-8 gap-1 px-2 text-xs'
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={14} />
          {t('Upload')}
        </Button>
        <Button
          size='sm'
          variant='ghost'
          className='h-8 gap-1 px-2 text-xs'
          onClick={() => setImportOpen(true)}
        >
          <FolderOpen size={14} />
          {t('Import from library')}
        </Button>
        <Button
          size='sm'
          variant='ghost'
          className='h-8 gap-1 px-2 text-xs'
          onClick={handleAddText}
        >
          <TypeIcon size={14} />
          {t('Add text')}
        </Button>

        <div className='ml-auto flex items-center gap-1'>
          <Button
            size='icon'
            variant='ghost'
            className='h-8 w-8'
            title={t('Zoom out')}
            onClick={() => zoomBy(1 / 1.2)}
          >
            −
          </Button>
          <span className='text-muted-foreground w-11 text-center text-[11px]'>
            {Math.round(viewport.scale * 100)}%
          </span>
          <Button
            size='icon'
            variant='ghost'
            className='h-8 w-8'
            title={t('Zoom in')}
            onClick={() => zoomBy(1.2)}
          >
            +
          </Button>
          <Button
            size='icon'
            variant='ghost'
            className='h-8 w-8'
            title={t('Fit to screen')}
            onClick={fitToScreen}
          >
            <Maximize size={14} />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size='sm'
                  variant='outline'
                  className='h-8 gap-1 text-xs'
                >
                  <Download size={14} />
                  {t('Export')}
                </Button>
              }
            />
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onClick={() => void handleExport('png')}>
                {t('Export as PNG')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleExport('jpeg')}>
                {t('Export as JPEG')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            size='icon'
            variant='ghost'
            className='h-8 w-8 lg:hidden'
            onClick={() => setPanelOpen((open) => !open)}
            title={t('Panels')}
          >
            <ImagePlus size={15} />
          </Button>
        </div>
      </div>

      {/* 主体：舞台 + 右侧面板 */}
      <div className='relative flex min-h-0 flex-1'>
        <div ref={stageHostRef} className='relative min-w-0 flex-1'>
          <CanvasStage
            doc={doc}
            selectedId={selectedId}
            viewport={viewport}
            tool={stageTool}
            brushSize={brushSize}
            maskSurface={maskSurface}
            maskLayerId={
              stageTool === 'mask-brush' || stageTool === 'mask-rect'
                ? (selectedImageLayer?.id ?? null)
                : null
            }
            onSelect={setSelectedId}
            onViewportChange={setViewport}
            onLayerPatch={patchLayer}
            onInteractionStart={beginInteraction}
            onInteractionEnd={endInteraction}
            onMaskPainted={handleMaskPainted}
            onDropFiles={(files) => void handleUploadFiles(files)}
          />

          {/* 画布底色 */}
          <div className='bg-background/90 absolute bottom-2 left-2 flex items-center gap-1 rounded-md border px-1.5 py-1'>
            <span className='text-muted-foreground text-[11px]'>
              {t('Background')}
            </span>
            {CANVAS_BACKGROUNDS.map((color) => (
              <button
                key={color}
                type='button'
                title={color}
                className={cn(
                  'h-4 w-4 rounded-full border',
                  doc.background === color && 'ring-primary ring-2'
                )}
                style={{ backgroundColor: color }}
                onClick={() => commit({ ...doc, background: color })}
              />
            ))}
          </div>
        </div>

        <aside
          className={cn(
            'bg-background absolute inset-y-0 right-0 z-20 flex w-[340px] max-w-[86vw] flex-col border-l transition-transform',
            'lg:static lg:z-auto lg:max-w-none lg:translate-x-0',
            panelOpen
              ? 'translate-x-0 shadow-2xl'
              : 'translate-x-full lg:translate-x-0'
          )}
        >
          <Tabs defaultValue='tools' className='flex min-h-0 flex-1 flex-col'>
            <TabsList className='mx-2 mt-2 w-auto'>
              <TabsTrigger value='tools' className='flex-1'>
                {t('Tools')}
              </TabsTrigger>
              <TabsTrigger value='layers' className='flex-1'>
                {t('Layers')}
              </TabsTrigger>
              <TabsTrigger value='tasks' className='flex-1'>
                {t('Tasks')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value='tools' className='mt-0 min-h-0 flex-1'>
              <ToolPanel
                capabilities={capabilitiesQuery.data}
                capabilitiesLoading={capabilitiesQuery.isPending}
                capabilitiesError={capabilitiesError}
                activeTool={activeTool}
                onToolChange={(tool) => {
                  setActiveTool(tool)
                  setParams(
                    defaultParamsFor(
                      capabilitiesQuery.data?.tools.find(
                        (item) => item.tool === tool
                      )
                    )
                  )
                  setExtraRefs([])
                }}
                params={params}
                onParamsChange={(patch) =>
                  setParams((current) => ({ ...current, ...patch }))
                }
                prompt={prompt}
                onPromptChange={setPrompt}
                sourceLayer={selectedLayer}
                extraRefs={extraRefs}
                onPickRefs={() => setRefPickerOpen(true)}
                onRemoveRef={(refId) =>
                  setExtraRefs((current) =>
                    current.filter((asset) => asset.refId !== refId)
                  )
                }
                maskReady={maskReady}
                brushSize={brushSize}
                onBrushSizeChange={setBrushSize}
                onStartMask={(mode) => setStageTool(mode)}
                onClearMask={handleClearMask}
                onSubmit={() => void handleSubmit()}
                submitting={submitting}
              />
            </TabsContent>

            <TabsContent value='layers' className='mt-0 min-h-0 flex-1'>
              <LayerPanel
                doc={doc}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onPatch={patchLayerAndCommit}
                onReorder={(layerId, direction) =>
                  setHistory((current) =>
                    current
                      ? commitHistory(
                          current,
                          reorderLayer(current.present, layerId, direction)
                        )
                      : current
                  )
                }
                onRemove={(layerId) => {
                  setHistory((current) =>
                    current
                      ? commitHistory(
                          current,
                          removeLayer(current.present, layerId)
                        )
                      : current
                  )
                  if (selectedId === layerId) setSelectedId(null)
                }}
              />
            </TabsContent>

            <TabsContent value='tasks' className='mt-0 min-h-0 flex-1'>
              <TaskPanel
                tasks={tasks}
                loading={tasksQuery.isPending}
                onRefresh={() => void tasksQuery.refetch()}
                onCancel={(taskId) => cancelMutation.mutate(taskId)}
                onRepersist={(taskId) => repersistMutation.mutate(taskId)}
                onAddToCanvas={(task, index) =>
                  void handleAddResultToCanvas(task, index)
                }
                onSaveToLibrary={(task, index) =>
                  saveAssetMutation.mutate({ taskId: task.id, index })
                }
                onDownload={(task, index) => {
                  const link = document.createElement('a')
                  link.href = taskDownloadUrl(task.id, index)
                  link.rel = 'noopener'
                  link.click()
                }}
              />
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      <input
        ref={fileInputRef}
        type='file'
        accept='image/png,image/jpeg,image/webp,image/gif,image/bmp'
        multiple
        className='hidden'
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          if (files.length > 0) void handleUploadFiles(files)
        }}
      />

      <AssetPickerDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title={t('Import from asset library')}
        description={t('Selected images are added to the canvas as layers')}
        multiple
        onConfirm={(assets) => {
          assets.forEach((asset) => {
            void addImageLayerFromUrl(asset.url, asset.name || asset.refId)
          })
        }}
      />

      <AssetPickerDialog
        open={refPickerOpen}
        onOpenChange={setRefPickerOpen}
        title={t('Extra reference images')}
        description={t(
          'Pick images from the asset library as extra references'
        )}
        multiple
        selectedRefIds={extraRefs.map((asset) => asset.refId)}
        onConfirm={(assets) => {
          const limit = activeCapability?.maxImages ?? assets.length
          const merged = [...extraRefs]
          assets.forEach((asset) => {
            if (merged.some((item) => item.refId === asset.refId)) return
            if (1 + merged.length >= limit) return
            merged.push(asset)
          })
          setExtraRefs(merged)
        }}
      />

      <RenameProjectDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        initialTitle={project.title}
        submitting={renameMutation.isPending}
        onRename={(title) => renameMutation.mutate(title)}
      />
    </div>
  )
}
