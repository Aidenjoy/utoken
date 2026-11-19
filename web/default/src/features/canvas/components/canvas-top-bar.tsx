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
  Check,
  ChevronDown,
  CloudOff,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  History,
  Home,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Workflow,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import type { CanvasTheme } from '../canvas-theme'
import type { CanvasTab } from '../types'
import {
  CanvasMenuButton,
  CanvasMenuDivider,
  CanvasMenuHeader,
  CanvasMenuPanel,
} from './canvas-menu'

// ===== 顶部浮动工作区条（移植自 BeefTV canvas-project-top-bar：工作区菜单/标题/画布 tabs/同步态） =====

export type CanvasSaveState = 'saved' | 'dirty' | 'saving' | 'error'

// 工作流 / Agent 功能开发中，暂时隐藏右上角入口；恢复时改为 true 即可
const showWorkflowAgent = false

interface CanvasTopBarProps {
  theme: CanvasTheme
  title: string
  onTitleChange: (title: string) => void
  saveState: CanvasSaveState
  onRetrySave: () => void
  canvases: CanvasTab[]
  activeCanvasId: string
  onSelectCanvas: (id: string) => void
  onNewCanvas: () => void
  onRenameCanvas: (id: string, title: string) => void
  onDuplicateCanvas: (id: string) => void
  onDeleteCanvas: (id: string) => void
  onExportCanvas: (id: string) => void
  onExportAll: () => void
  onOpenCanvasNewWindow: (id: string) => void
  onGoHome: () => void
  onGoProjects: () => void
  onCreateProject: () => void
  onDeleteProject: () => void
  onOpenWorkflow: () => void
  onOpenAgent: () => void
  onOpenHistory: () => void
}

export function CanvasTopBar(props: CanvasTopBarProps) {
  const {
    theme,
    title,
    onTitleChange,
    saveState,
    onRetrySave,
    canvases,
    activeCanvasId,
    onSelectCanvas,
    onNewCanvas,
    onRenameCanvas,
    onDuplicateCanvas,
    onDeleteCanvas,
    onExportCanvas,
    onExportAll,
    onOpenCanvasNewWindow,
    onGoHome,
    onGoProjects,
    onCreateProject,
    onDeleteProject,
    onOpenWorkflow,
    onOpenAgent,
    onOpenHistory,
  } = props
  const { t } = useTranslation()

  const [workspaceMenu, setWorkspaceMenu] = React.useState<{
    x: number
    y: number
  } | null>(null)
  const [canvasMenu, setCanvasMenu] = React.useState<{
    x: number
    y: number
  } | null>(null)
  const [moreMenu, setMoreMenu] = React.useState<{
    canvasId: string
    x: number
    y: number
  } | null>(null)
  const [confirmDeleteProject, setConfirmDeleteProject] = React.useState(false)
  const [confirmDeleteCanvas, setConfirmDeleteCanvas] = React.useState<
    string | null
  >(null)
  const [editingTitle, setEditingTitle] = React.useState(false)
  const [titleValue, setTitleValue] = React.useState(title)
  const [renamingCanvas, setRenamingCanvas] = React.useState<string | null>(
    null
  )
  const [renameValue, setRenameValue] = React.useState('')

  const activeCanvas = canvases.find((c) => c.id === activeCanvasId)

  const pillStyle: React.CSSProperties = {
    background: theme.toolbar.panel,
    border: `1px solid ${theme.toolbar.border}`,
    boxShadow: theme.node.hoverShadow,
    backdropFilter: 'blur(12px)',
  }

  const hoverHandlers = {
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.background = theme.toolbar.itemHover
    },
    onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.background = 'transparent'
    },
  }

  const commitTitle = () => {
    setEditingTitle(false)
    const next = titleValue.trim()
    if (next && next !== title) onTitleChange(next)
    else setTitleValue(title)
  }

  const commitRename = (id: string) => {
    const next = renameValue.trim()
    if (next) onRenameCanvas(id, next.slice(0, 60))
    setRenamingCanvas(null)
  }

  const saveIndicator = () => {
    if (saveState === 'saving') {
      return (
        <span
          className='flex items-center gap-1 px-1 text-[11px]'
          style={{ color: theme.node.muted }}
          aria-label={t('Saving...')}
        >
          <Loader2 aria-hidden='true' className='size-3 animate-spin' />
        </span>
      )
    }
    if (saveState === 'error') {
      return (
        <button
          type='button'
          onClick={onRetrySave}
          className='flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px]'
          style={{ color: theme.accent.danger }}
          title={t('Save failed, click to retry')}
        >
          <CloudOff aria-hidden='true' className='size-3' />
        </button>
      )
    }
    if (saveState === 'dirty') {
      return (
        <span
          className='px-1 text-[11px]'
          style={{ color: theme.node.faint }}
          aria-label={t('Unsaved changes')}
          title={t('Unsaved changes')}
        >
          ●
        </span>
      )
    }
    return (
      <span
        className='flex items-center px-1'
        style={{ color: theme.node.faint }}
        aria-label={t('All changes saved')}
        title={t('All changes saved')}
      >
        <Check aria-hidden='true' className='size-3.5' />
      </span>
    )
  }

  return (
    <>
      {/* 左上：工作区条 */}
      <div
        data-canvas-no-zoom
        className='absolute top-3 left-3 z-[65] flex max-w-[calc(100vw-24px)] items-center gap-0.5 rounded-2xl px-1.5 py-1.5'
        style={pillStyle}
      >
        <button
          type='button'
          className='flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors'
          style={{ color: theme.toolbar.item }}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            setConfirmDeleteProject(false)
            setWorkspaceMenu({ x: rect.left, y: rect.bottom + 6 })
          }}
          aria-label={t('Workspace menu')}
          title={t('Workspace menu')}
          {...hoverHandlers}
        >
          <Workflow aria-hidden='true' className='size-4' />
        </button>

        {editingTitle ? (
          <input
            value={titleValue}
            autoFocus
            maxLength={64}
            onChange={(event) => setTitleValue(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitTitle()
              if (event.key === 'Escape') {
                setTitleValue(title)
                setEditingTitle(false)
              }
            }}
            className='w-40 rounded-md px-1.5 py-1 text-sm font-medium outline-none'
            style={{
              background: theme.toolbar.itemHover,
              color: theme.node.text,
            }}
            aria-label={t('Project name')}
          />
        ) : (
          <button
            type='button'
            className='group/title flex min-w-0 cursor-pointer items-center gap-1 rounded-lg px-1.5 py-1 text-sm font-medium transition-colors'
            style={{ color: theme.node.text }}
            onClick={() => {
              setTitleValue(title)
              setEditingTitle(true)
            }}
            aria-label={t('Project name')}
            title={t('Click to rename project')}
            {...hoverHandlers}
          >
            <span className='max-w-36 truncate'>{title}</span>
            <Pencil
              aria-hidden='true'
              className='size-3 shrink-0 opacity-0 transition-opacity group-hover/title:opacity-60'
            />
          </button>
        )}

        <span
          aria-hidden='true'
          className='mx-0.5 h-5 w-px shrink-0'
          style={{ background: theme.toolbar.border }}
        />

        <button
          type='button'
          className='flex shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors'
          style={{ color: theme.toolbar.item }}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            setCanvasMenu({ x: rect.left, y: rect.bottom + 6 })
          }}
          aria-label={t('Switch canvas')}
          title={t('Switch canvas')}
          {...hoverHandlers}
        >
          <span className='max-w-28 truncate'>
            {activeCanvas?.title ?? t('Canvas')}
          </span>
          <ChevronDown aria-hidden='true' className='size-3' />
        </button>

        {saveIndicator()}
      </div>

      {/* 右上：工作流 / Agent / 版本记录（工作流与 Agent 入口暂时隐藏，开发中，恢复时把 showWorkflowAgent 改为 true） */}
      <div
        data-canvas-no-zoom
        className='absolute top-3 right-3 z-[65] flex items-center gap-0.5 rounded-2xl px-1.5 py-1.5'
        style={pillStyle}
      >
        {showWorkflowAgent && (
          <>
            <button
              type='button'
              className='flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs transition-colors'
              style={{ color: theme.toolbar.item }}
              onClick={onOpenWorkflow}
              aria-label={t('Workflow')}
              title={t('Workflow')}
              {...hoverHandlers}
            >
              <Workflow aria-hidden='true' className='size-3.5' />
              <span className='hidden md:inline'>{t('Workflow')}</span>
            </button>
            <button
              type='button'
              className='flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs transition-colors'
              style={{ color: theme.toolbar.item }}
              onClick={onOpenAgent}
              aria-label={t('AI Agent')}
              title={t('AI Agent (Ctrl/Cmd + J)')}
              {...hoverHandlers}
            >
              <Sparkles aria-hidden='true' className='size-3.5' />
              <span className='hidden md:inline'>{t('AI Agent')}</span>
            </button>
          </>
        )}
        <button
          type='button'
          className='flex size-8 cursor-pointer items-center justify-center rounded-lg transition-colors'
          style={{ color: theme.toolbar.item }}
          onClick={onOpenHistory}
          aria-label={t('Generation history')}
          title={t('Generation history')}
          {...hoverHandlers}
        >
          <History aria-hidden='true' className='size-4' />
        </button>
      </div>

      {/* 工作区菜单 */}
      {workspaceMenu && (
        <CanvasMenuPanel
          theme={theme}
          x={workspaceMenu.x}
          y={workspaceMenu.y}
          onClose={() => {
            setWorkspaceMenu(null)
            setConfirmDeleteProject(false)
          }}
          ariaLabel={t('Workspace menu')}
        >
          <CanvasMenuButton
            theme={theme}
            icon={<Home className='size-3.5' />}
            label={t('Back to home')}
            onClick={() => {
              setWorkspaceMenu(null)
              onGoHome()
            }}
          />
          <CanvasMenuButton
            theme={theme}
            icon={<FolderOpen className='size-3.5' />}
            label={t('All projects')}
            onClick={() => {
              setWorkspaceMenu(null)
              onGoProjects()
            }}
          />
          <CanvasMenuDivider theme={theme} />
          <CanvasMenuButton
            theme={theme}
            icon={<Plus className='size-3.5' />}
            label={t('Create new project')}
            onClick={() => {
              setWorkspaceMenu(null)
              onCreateProject()
            }}
          />
          <CanvasMenuButton
            theme={theme}
            icon={<Download className='size-3.5' />}
            label={t('Export all canvases')}
            onClick={() => {
              setWorkspaceMenu(null)
              onExportAll()
            }}
          />
          <CanvasMenuButton
            theme={theme}
            icon={<Download className='size-3.5' />}
            label={t('Export current canvas')}
            onClick={() => {
              setWorkspaceMenu(null)
              onExportCanvas(activeCanvasId)
            }}
          />
          <CanvasMenuDivider theme={theme} />
          <CanvasMenuButton
            theme={theme}
            icon={<Trash2 className='size-3.5' />}
            label={
              confirmDeleteProject
                ? t('Click again to confirm')
                : t('Delete project')
            }
            danger
            onClick={() => {
              if (!confirmDeleteProject) {
                setConfirmDeleteProject(true)
                return
              }
              setWorkspaceMenu(null)
              onDeleteProject()
            }}
          />
        </CanvasMenuPanel>
      )}

      {/* 画布切换面板 */}
      {canvasMenu && (
        <CanvasMenuPanel
          theme={theme}
          x={canvasMenu.x}
          y={canvasMenu.y}
          width={248}
          onClose={() => {
            setCanvasMenu(null)
            setRenamingCanvas(null)
          }}
          ariaLabel={t('Canvases')}
        >
          <div className='flex items-center justify-between px-3 pt-1 pb-1.5'>
            <span
              className='text-[11px] font-medium'
              style={{ color: theme.node.faint }}
            >
              {t('Canvases')}
            </span>
            <button
              type='button'
              className='flex size-6 cursor-pointer items-center justify-center rounded-md transition-colors'
              style={{ color: theme.node.muted }}
              onClick={() => {
                onNewCanvas()
              }}
              aria-label={t('New canvas')}
              title={t('New canvas')}
              {...hoverHandlers}
            >
              <Plus aria-hidden='true' className='size-3.5' />
            </button>
          </div>
          {canvases.map((canvas) => (
            <div
              key={canvas.id}
              className='mx-1 flex min-h-9 items-center gap-1 rounded-lg px-1.5'
              style={{
                background:
                  canvas.id === activeCanvasId
                    ? theme.toolbar.activeBg
                    : 'transparent',
              }}
            >
              {renamingCanvas === canvas.id ? (
                <input
                  value={renameValue}
                  autoFocus
                  maxLength={60}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onBlur={() => commitRename(canvas.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRename(canvas.id)
                    if (event.key === 'Escape') setRenamingCanvas(null)
                  }}
                  className='h-7 min-w-0 flex-1 rounded-md px-1.5 text-xs outline-none'
                  style={{
                    background: theme.toolbar.itemHover,
                    color: theme.node.text,
                    border: `1px solid ${theme.toolbar.border}`,
                  }}
                  aria-label={t('Rename canvas')}
                />
              ) : (
                <button
                  type='button'
                  className='flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-xs'
                  style={{ color: theme.toolbar.item }}
                  onClick={() => {
                    onSelectCanvas(canvas.id)
                    setCanvasMenu(null)
                  }}
                >
                  <span className='min-w-0 flex-1 truncate'>
                    {canvas.title}
                  </span>
                  {canvas.id === activeCanvasId && (
                    <Check
                      aria-hidden='true'
                      className='size-3.5 shrink-0'
                      style={{ color: theme.toolbar.activeText }}
                    />
                  )}
                </button>
              )}
              <button
                type='button'
                className='flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors'
                style={{ color: theme.node.muted }}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect()
                  setConfirmDeleteCanvas(null)
                  setMoreMenu({
                    canvasId: canvas.id,
                    x: rect.right + 4,
                    y: rect.top,
                  })
                }}
                aria-label={t('Canvas options')}
                title={t('Canvas options')}
                {...hoverHandlers}
              >
                <MoreHorizontal aria-hidden='true' className='size-3.5' />
              </button>
            </div>
          ))}
        </CanvasMenuPanel>
      )}

      {/* 单张画布的操作子菜单 */}
      {moreMenu && (
        <CanvasMenuPanel
          theme={theme}
          x={moreMenu.x}
          y={moreMenu.y}
          onClose={() => {
            setMoreMenu(null)
            setConfirmDeleteCanvas(null)
          }}
          ariaLabel={t('Canvas options')}
        >
          <CanvasMenuHeader theme={theme}>
            {canvases.find((c) => c.id === moreMenu.canvasId)?.title}
          </CanvasMenuHeader>
          <CanvasMenuButton
            theme={theme}
            icon={<ExternalLink className='size-3.5' />}
            label={t('Open in new window')}
            onClick={() => {
              onOpenCanvasNewWindow(moreMenu.canvasId)
              setMoreMenu(null)
            }}
          />
          <CanvasMenuButton
            theme={theme}
            icon={<Pencil className='size-3.5' />}
            label={t('Rename canvas')}
            onClick={() => {
              const canvas = canvases.find((c) => c.id === moreMenu.canvasId)
              setRenameValue(canvas?.title ?? '')
              setRenamingCanvas(moreMenu.canvasId)
              setMoreMenu(null)
            }}
          />
          <CanvasMenuButton
            theme={theme}
            icon={<Copy className='size-3.5' />}
            label={t('Duplicate canvas')}
            onClick={() => {
              onDuplicateCanvas(moreMenu.canvasId)
              setMoreMenu(null)
            }}
          />
          <CanvasMenuButton
            theme={theme}
            icon={<Download className='size-3.5' />}
            label={t('Export canvas')}
            onClick={() => {
              onExportCanvas(moreMenu.canvasId)
              setMoreMenu(null)
            }}
          />
          <CanvasMenuDivider theme={theme} />
          <CanvasMenuButton
            theme={theme}
            icon={<Trash2 className='size-3.5' />}
            label={
              confirmDeleteCanvas === moreMenu.canvasId
                ? t('Click again to confirm')
                : t('Delete canvas')
            }
            danger
            onClick={() => {
              if (confirmDeleteCanvas !== moreMenu.canvasId) {
                setConfirmDeleteCanvas(moreMenu.canvasId)
                return
              }
              onDeleteCanvas(moreMenu.canvasId)
              setMoreMenu(null)
            }}
          />
        </CanvasMenuPanel>
      )}
    </>
  )
}
