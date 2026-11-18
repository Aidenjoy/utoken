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
  Download,
  FolderPlus,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  XCircle,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

import { proxyImageUrl } from '../api'
import type { CanvasTask, CanvasTaskStatus } from '../types'

// 智能画布：任务面板
// 展示当前画布的任务进度与历史，结果图可加入画布、存入素材库或直接下载。

const STATUS_LABEL_KEY: Record<CanvasTaskStatus, string> = {
  pending: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  canceled: 'Canceled',
  reviewing: 'Needs review',
}

const STATUS_CLASS: Record<CanvasTaskStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  running: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  succeeded: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  failed: 'bg-rose-500/15 text-rose-700 dark:text-rose-400',
  canceled: 'bg-muted text-muted-foreground',
  reviewing: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
}

/** 展示实际扣费：结算完成显示实扣，否则显示预扣额度 */
function quotaLabel(task: CanvasTask, unit: string): string {
  if (task.settledQuota > 0) return `${task.settledQuota} ${unit}`
  if (task.quota > 0) return `${task.quota} ${unit}`
  return ''
}

function formatTime(seconds: number): string {
  if (!seconds) return '-'
  const date = new Date(seconds * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

interface TaskPanelProps {
  tasks: CanvasTask[]
  loading: boolean
  onRefresh: () => void
  onCancel: (taskId: number) => void
  onRepersist: (taskId: number) => void
  onAddToCanvas: (task: CanvasTask, index: number) => void
  onSaveToLibrary: (task: CanvasTask, index: number) => void
  onDownload: (task: CanvasTask, index: number) => void
}

export function TaskPanel(props: TaskPanelProps) {
  const { t } = useTranslation()
  const [preview, setPreview] = React.useState<{
    task: CanvasTask
    index: number
  } | null>(null)

  if (props.loading && props.tasks.length === 0) {
    return (
      <div className='text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm'>
        <Loader2 className='animate-spin' size={16} />
        {t('Loading...')}
      </div>
    )
  }

  if (props.tasks.length === 0) {
    return (
      <div className='text-muted-foreground px-4 py-10 text-center text-sm'>
        {t('No tasks yet for this canvas')}
      </div>
    )
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex items-center justify-between px-3 py-2'>
        <span className='text-muted-foreground text-[11px]'>
          {t('{{count}} tasks', { count: props.tasks.length })}
        </span>
        <Button
          size='sm'
          variant='ghost'
          className='h-7 gap-1 px-2 text-[11px]'
          onClick={props.onRefresh}
        >
          <RefreshCw size={12} />
          {t('Refresh')}
        </Button>
      </div>

      <div className='min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-3'>
        {props.tasks.map((task) => (
          <div key={task.id} className='rounded-md border px-2 py-2'>
            <div className='flex items-center gap-2'>
              <span className='min-w-0 flex-1 truncate text-xs font-medium'>
                {task.toolLabel || task.tool}
              </span>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-medium',
                  STATUS_CLASS[task.status]
                )}
              >
                {t(STATUS_LABEL_KEY[task.status])}
              </span>
            </div>

            <div className='text-muted-foreground mt-1 flex items-center gap-2 text-[11px]'>
              <span>#{task.id}</span>
              <span>{formatTime(task.createdAt)}</span>
              {task.model ? (
                <span className='truncate'>{task.model}</span>
              ) : null}
              <span className='ml-auto'>{quotaLabel(task, t('points'))}</span>
            </div>

            {task.status === 'running' || task.status === 'pending' ? (
              <div className='mt-1.5'>
                <Progress value={task.progress} className='h-1' />
                <span className='text-muted-foreground text-[10px]'>
                  {task.stage || ''} {task.progress}%
                </span>
              </div>
            ) : null}

            {task.errorMsg ? (
              <p className='text-destructive mt-1 text-[11px] break-words'>
                {task.errorMsg}
              </p>
            ) : null}

            {task.status === 'reviewing' ? (
              <p className='mt-1 text-[11px] text-amber-600 dark:text-amber-400'>
                {t(
                  'Upstream result is unknown; the task is parked for reconciliation and will not be retried automatically'
                )}
              </p>
            ) : null}

            {task.result?.images?.length ? (
              <div className='mt-2 grid grid-cols-2 gap-1.5'>
                {task.result.images.map((image, index) => (
                  <div
                    key={image.url}
                    className='group bg-muted/40 relative overflow-hidden rounded border'
                  >
                    <button
                      type='button'
                      className='block w-full'
                      onClick={() => setPreview({ task, index })}
                    >
                      <img
                        src={proxyImageUrl(image.url)}
                        alt={`${task.tool}-${index}`}
                        className='aspect-square w-full object-cover'
                        loading='lazy'
                      />
                    </button>
                    <div className='absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-gradient-to-t from-black/70 to-transparent p-1 opacity-0 transition-opacity group-hover:opacity-100'>
                      <button
                        type='button'
                        title={t('Add to canvas')}
                        className='rounded bg-white/90 p-1 text-black'
                        onClick={() => props.onAddToCanvas(task, index)}
                      >
                        <Plus size={12} />
                      </button>
                      <button
                        type='button'
                        title={t('Save to asset library')}
                        className='rounded bg-white/90 p-1 text-black'
                        onClick={() => props.onSaveToLibrary(task, index)}
                      >
                        <FolderPlus size={12} />
                      </button>
                      <button
                        type='button'
                        title={t('Download')}
                        className='rounded bg-white/90 p-1 text-black'
                        onClick={() => props.onDownload(task, index)}
                      >
                        <Download size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className='mt-1.5 flex items-center gap-1'>
              {task.cancelable ? (
                <Button
                  size='sm'
                  variant='ghost'
                  className='h-6 gap-1 px-1.5 text-[11px]'
                  onClick={() => props.onCancel(task.id)}
                >
                  <XCircle size={11} />
                  {t('Cancel task')}
                </Button>
              ) : null}
              {task.status === 'succeeded' ? (
                <Button
                  size='sm'
                  variant='ghost'
                  className='h-6 gap-1 px-1.5 text-[11px]'
                  onClick={() => props.onRepersist(task.id)}
                >
                  <RotateCcw size={11} />
                  {t('Re-store results')}
                </Button>
              ) : null}
              {task.status === 'failed' || task.status === 'canceled' ? (
                <Badge variant='outline' className='text-[10px] font-normal'>
                  {task.billingState === 'refunded'
                    ? t('Refunded')
                    : t('Not charged')}
                </Badge>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <Dialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
      >
        <DialogContent className='sm:max-w-3xl'>
          <DialogHeader>
            <DialogTitle>
              {preview ? preview.task.toolLabel || preview.task.tool : ''}
            </DialogTitle>
          </DialogHeader>
          {preview ? (
            <div className='flex flex-col gap-2'>
              <img
                src={proxyImageUrl(
                  preview.task.result?.images[preview.index]?.url ?? ''
                )}
                alt=''
                className='bg-muted max-h-[60vh] w-full rounded object-contain'
              />
              <div className='flex flex-wrap justify-end gap-2'>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => props.onDownload(preview.task, preview.index)}
                >
                  <Download className='mr-1' size={13} />
                  {t('Download')}
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() =>
                    props.onSaveToLibrary(preview.task, preview.index)
                  }
                >
                  <FolderPlus className='mr-1' size={13} />
                  {t('Save to asset library')}
                </Button>
                <Button
                  size='sm'
                  onClick={() => {
                    props.onAddToCanvas(preview.task, preview.index)
                    setPreview(null)
                  }}
                >
                  <Plus className='mr-1' size={13} />
                  {t('Add to canvas')}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
