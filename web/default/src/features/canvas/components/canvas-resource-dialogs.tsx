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
// ===== 文件夹浏览 / 生成任务面板 / 项目回收站（移植 BeefTV folder browser、active task panel、recycle bin） =====

import {
  FolderOpen,
  Loader2,
  Locate,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { useQuery } from '@tanstack/react-query'

import {
  getCanvasRecycleProjects,
  permanentDeleteCanvasProject,
  restoreCanvasProject,
} from '../api'
import type { CanvasTheme } from '../canvas-theme'
import { CANVAS_NODE_TITLE_KEYS, type CanvasNode } from '../types'
import { CanvasModal } from './canvas-modal'
import { useCanvasMenuDismiss } from './canvas-menu-utils'

export function CanvasFolderBrowser(props: {
  theme: CanvasTheme
  folder: CanvasNode
  items: CanvasNode[]
  onClose: () => void
  onLocate: (id: string) => void
}) {
  const { theme, folder, items, onClose, onLocate } = props
  const { t } = useTranslation()
  return (
    <CanvasModal
      theme={theme}
      title={`${t('Folder')} · ${folder.title}`}
      onClose={onClose}
      width={720}
      headerExtra={
        <span className='text-[11px]' style={{ color: theme.node.muted }}>
          {t('{{count}} items', { count: items.length })}
        </span>
      }
    >
      <div className='canvas-scroll grid max-h-[62vh] grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3'>
        {items.length === 0 && (
          <div
            className='col-span-full flex flex-col items-center gap-2 py-10 text-xs'
            style={{ color: theme.node.muted }}
          >
            <FolderOpen aria-hidden='true' className='size-6' />
            {t('This folder is empty')}
          </div>
        )}
        {items.map((item) => {
          let preview: React.ReactNode = (
            <span className='text-[11px]' style={{ color: theme.node.muted }}>
              {t(CANVAS_NODE_TITLE_KEYS[item.type])}
            </span>
          )
          if (item.metadata.url && item.type === 'video') {
            preview = (
              <video
                src={item.metadata.url}
                muted
                playsInline
                preload='metadata'
                className='size-full object-cover'
              />
            )
          } else if (item.metadata.url) {
            preview = (
              <img
                src={item.metadata.url}
                alt={item.title}
                draggable={false}
                className='size-full object-cover'
              />
            )
          }
          return (
          <button
            key={item.id}
            type='button'
            onClick={() => onLocate(item.id)}
            className='flex flex-col gap-1.5 rounded-xl p-2 text-left transition-colors'
            style={{ border: `1px solid ${theme.node.stroke}` }}
            aria-label={t('Locate {{title}}', { title: item.title })}
          >
            <div
              className='flex h-24 items-center justify-center overflow-hidden rounded-lg'
              style={{ background: 'rgba(0,0,0,.25)' }}
            >
              {preview}
            </div>
            <span
              className='truncate text-xs font-medium'
              style={{ color: theme.node.text }}
            >
              {item.title}
            </span>
            <span className='text-[10px]' style={{ color: theme.node.muted }}>
              {t(CANVAS_NODE_TITLE_KEYS[item.type])}
            </span>
          </button>
          )
        })}
      </div>
    </CanvasModal>
  )
}

export interface CanvasActiveTask {
  node: CanvasNode
  canvasId: string
  canvasTitle: string
}

export function CanvasTaskPanel(props: {
  theme: CanvasTheme
  tasks: CanvasActiveTask[]
  onLocate: (nodeId: string, canvasId: string) => void
  onCancel: (nodeId: string) => void
  onClose: () => void
}) {
  const { theme, tasks, onLocate, onCancel, onClose } = props
  const { t } = useTranslation()
  useCanvasMenuDismiss(onClose)
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div
      data-canvas-menu
      role='dialog'
      aria-label={t('Active generation tasks')}
      className='canvas-scroll absolute bottom-[76px] left-1/2 z-[65] max-h-[50vh] w-88 -translate-x-1/2 overflow-y-auto rounded-2xl py-1.5'
      style={{
        background: theme.toolbar.panel,
        border: `1px solid ${theme.toolbar.border}`,
        boxShadow: theme.node.hoverShadow,
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className='flex items-center justify-between px-3 py-1.5'
        style={{ color: theme.node.muted }}
      >
        <span className='text-[11px] font-semibold tracking-wide uppercase'>
          {t('Active generation tasks')}
        </span>
        <button
          type='button'
          onClick={onClose}
          className='flex size-6 items-center justify-center rounded-md'
          aria-label={t('Close')}
        >
          <X aria-hidden='true' className='size-3.5' />
        </button>
      </div>
      {tasks.length === 0 && (
        <p className='px-3 py-4 text-center text-xs' style={{ color: theme.node.muted }}>
          {t('No running generation tasks')}
        </p>
      )}
      {tasks.map((task) => {
        const startedAt = task.node.metadata.startedAt ?? now
        const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
        return (
          <div
            key={task.node.id}
            className='flex items-center gap-2 px-3 py-2'
            style={{ borderTop: `1px solid ${theme.toolbar.border}` }}
          >
            <Loader2
              aria-hidden='true'
              className='size-4 shrink-0 animate-spin'
              style={{ color: theme.accent.primary }}
            />
            <div className='min-w-0 flex-1'>
              <p
                className='truncate text-xs font-medium'
                style={{ color: theme.node.text }}
              >
                {task.node.title}
              </p>
              <p className='truncate text-[10px]' style={{ color: theme.node.muted }}>
                {task.canvasTitle} · {t(CANVAS_NODE_TITLE_KEYS[task.node.type])} ·{' '}
                {t('{{seconds}}s elapsed', { seconds })}
              </p>
            </div>
            <button
              type='button'
              onClick={() => onLocate(task.node.id, task.canvasId)}
              className='flex size-7 shrink-0 items-center justify-center rounded-lg'
              style={{ color: theme.node.muted }}
              aria-label={t('Locate task node')}
              title={t('Locate task node')}
            >
              <Locate aria-hidden='true' className='size-3.5' />
            </button>
            <button
              type='button'
              onClick={() => onCancel(task.node.id)}
              className='flex size-7 shrink-0 items-center justify-center rounded-lg'
              style={{ color: theme.accent.danger }}
              aria-label={t('Cancel task')}
              title={t('Cancel task')}
            >
              <X aria-hidden='true' className='size-3.5' />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function CanvasRecycleBin(props: {
  theme: CanvasTheme
  onClose: () => void
  onChanged: () => void
}) {
  const { theme, onClose, onChanged } = props
  const { t } = useTranslation()
  const { data, refetch } = useQuery({
    queryKey: ['canvas-recycle-bin'],
    queryFn: () => getCanvasRecycleProjects(),
  })
  const items = React.useMemo(
    () => (data?.success ? (data.data?.list ?? []) : []),
    [data]
  )
  const [selected, setSelected] = React.useState<number[]>([])
  const [confirming, setConfirming] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const allSelected = items.length > 0 && selected.length === items.length

  const run = async (action: 'restore' | 'permanent') => {
    if (selected.length === 0) return
    setBusy(true)
    try {
      for (const id of selected) {
        if (action === 'restore') await restoreCanvasProject(id)
        else await permanentDeleteCanvasProject(id)
      }
      setSelected([])
      setConfirming(false)
      await refetch()
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <CanvasModal theme={theme} title={t('Recycle bin')} onClose={onClose} width={640}>
      <div className='flex flex-col gap-3 p-4'>
        <div className='flex items-center gap-2'>
          <label
            className='flex items-center gap-1.5 text-xs'
            style={{ color: theme.node.muted }}
          >
            <input
              type='checkbox'
              checked={allSelected}
              disabled={items.length === 0}
              onChange={(event) =>
                setSelected(event.target.checked ? items.map((i) => i.id) : [])
              }
              aria-label={t('Select all recycled projects')}
            />
            {t('Select all')}
          </label>
          <span className='ml-auto text-[11px]' style={{ color: theme.node.muted }}>
            {t('{{count}} projects', { count: items.length })}
          </span>
        </div>
        <div
          className='canvas-scroll flex max-h-[46vh] flex-col gap-2 overflow-y-auto'
          role='list'
          aria-label={t('Recycled projects')}
        >
          {items.length === 0 && (
            <p
              className='py-10 text-center text-xs'
              style={{ color: theme.node.muted }}
            >
              {t('Recycle bin is empty')}
            </p>
          )}
          {items.map((item) => (
            <label
              key={item.id}
              role='listitem'
              className='flex cursor-pointer items-center gap-2.5 rounded-xl p-2'
              style={{ border: `1px solid ${theme.node.stroke}` }}
            >
              <input
                type='checkbox'
                checked={selected.includes(item.id)}
                onChange={(event) =>
                  setSelected((prev) =>
                    event.target.checked
                      ? [...prev, item.id]
                      : prev.filter((id) => id !== item.id)
                  )
                }
                aria-label={t('Select {{title}}', { title: item.title })}
              />
              <div
                className='flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg'
                style={{ background: 'rgba(0,0,0,.25)' }}
              >
                {item.coverUrl ? (
                  <img
                    src={item.coverUrl}
                    alt=''
                    draggable={false}
                    className='size-full object-cover'
                  />
                ) : (
                  <Trash2
                    aria-hidden='true'
                    className='size-4'
                    style={{ color: theme.node.muted }}
                  />
                )}
              </div>
              <div className='min-w-0 flex-1'>
                <p
                  className='truncate text-xs font-medium'
                  style={{ color: theme.node.text }}
                >
                  {item.title}
                </p>
                <p className='text-[10px]' style={{ color: theme.node.muted }}>
                  {t('{{count}} nodes', { count: item.nodeCount })}
                </p>
              </div>
            </label>
          ))}
        </div>
        {confirming ? (
          <div
            role='alertdialog'
            aria-label={t('Confirm permanent delete')}
            className='flex items-center gap-2 rounded-xl p-2.5'
            style={{ background: 'rgba(239,68,68,.12)' }}
          >
            <p className='flex-1 text-xs' style={{ color: theme.node.text }}>
              {t('Permanently delete selected projects? This cannot be undone.')}
            </p>
            <button
              type='button'
              onClick={() => setConfirming(false)}
              className='h-7 rounded-lg px-2.5 text-[11px]'
              style={{ border: `1px solid ${theme.node.stroke}`, color: theme.node.muted }}
            >
              {t('Cancel')}
            </button>
            <button
              type='button'
              disabled={busy}
              onClick={() => void run('permanent')}
              className='h-7 rounded-lg px-2.5 text-[11px] font-medium disabled:opacity-40'
              style={{ background: theme.accent.danger, color: '#fff' }}
              aria-label={t('Delete forever')}
            >
              {t('Delete forever')}
            </button>
          </div>
        ) : (
          <div className='flex justify-end gap-2'>
            <button
              type='button'
              disabled={busy || selected.length === 0}
              onClick={() => setConfirming(true)}
              className='flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs disabled:opacity-40'
              style={{ border: `1px solid ${theme.node.stroke}`, color: theme.accent.danger }}
              aria-label={t('Delete forever')}
            >
              <Trash2 aria-hidden='true' className='size-3.5' />
              {t('Delete forever')}
            </button>
            <button
              type='button'
              disabled={busy || selected.length === 0}
              onClick={() => void run('restore')}
              className='flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium disabled:opacity-40'
              style={{ background: theme.accent.primary, color: theme.accent.onPrimary }}
              aria-label={t('Restore selected')}
            >
              {busy ? (
                <Loader2 aria-hidden='true' className='size-3.5 animate-spin' />
              ) : (
                <RotateCcw aria-hidden='true' className='size-3.5' />
              )}
              {t('Restore selected')}
            </button>
          </div>
        )}
      </div>
    </CanvasModal>
  )
}