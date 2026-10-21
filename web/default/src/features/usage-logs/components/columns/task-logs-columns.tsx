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
import type { ColumnDef } from '@tanstack/react-table'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Info, Music, RefreshCw } from 'lucide-react'
/* eslint-disable react-refresh/only-export-components */
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StatusBadge } from '@/components/status-badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { useIsSuperAdmin } from '@/hooks/use-admin'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import {
  formatLogQuota,
  formatTimestampToDate,
  formatUseTime,
} from '@/lib/format'
import { cn } from '@/lib/utils'

import { REFETCH_RESULT_TOAST, TASK_ACTIONS, TASK_STATUS } from '../../constants'
import { refetchTaskLog } from '../../api'
import { taskActionMapper, taskStatusMapper } from '../../lib/mappers'
import type { TaskLog, LogsScope } from '../../types'
import {
  AudioPreviewDialog,
  type AudioClip,
} from '../dialogs/audio-preview-dialog'
import { FailReasonDialog } from '../dialogs/fail-reason-dialog'
import {
  RelayDetailsDialog,
  prettyJson,
  type RelayDetailRow,
} from '../dialogs/relay-details-dialog'
import { useUsageLogsContext } from '../usage-logs-provider'
import {
  createDurationColumn,
  createChannelColumn,
  createProgressColumn,
} from './column-helpers'

// Video-generation actions can fall back to the authenticated
// /v1/videos/{id}/content proxy when no direct result URL is available.
const VIDEO_ACTIONS = new Set<string>([
  TASK_ACTIONS.GENERATE,
  TASK_ACTIONS.TEXT_GENERATE,
  TASK_ACTIONS.FIRST_TAIL_GENERATE,
  TASK_ACTIONS.REFERENCE_GENERATE,
  TASK_ACTIONS.REMIX_GENERATE,
])

function formatTime(timestamp?: number): string {
  if (!timestamp || timestamp <= 0) return '-'
  return formatTimestampToDate(timestamp, 'seconds')
}

function parseTaskData(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function AudioPreviewCell({ log }: { log: TaskLog }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const clips = useMemo(() => {
    const data = parseTaskData(log.data)
    return data.filter(
      (c) =>
        c && typeof c === 'object' && (c as Record<string, unknown>).audio_url
    )
  }, [log.data])

  if (clips.length === 0) return null

  return (
    <>
      <button
        type='button'
        className='group flex items-center gap-1 text-left text-xs'
        onClick={() => setOpen(true)}
      >
        <Music className='text-muted-foreground size-3' />
        <span className='text-foreground leading-snug group-hover:underline'>
          {t('Click to preview audio')}
        </span>
      </button>
      <AudioPreviewDialog
        open={open}
        onOpenChange={setOpen}
        clips={clips as AudioClip[]}
      />
    </>
  )
}

// 管理员手动补录：重新回源上游并结算单个任务（找回被超时清扫丢弃的结果）。
function TaskRefetchCell({ log }: { log: TaskLog }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(false)

  if (!log.task_id) {
    return <span className='text-muted-foreground/60 text-xs'>-</span>
  }

  const handleRefetch = async () => {
    setLoading(true)
    try {
      const res = await refetchTaskLog(log.task_id)
      if (res?.success) {
        const summary = res.data?.result
        const toastKey =
          (summary && REFETCH_RESULT_TOAST[summary]) || 'Task re-queried and settled'
        toast.success(t(toastKey))
        await queryClient.invalidateQueries({ queryKey: ['logs'] })
      } else {
        toast.error(res?.message || t('Re-query failed'))
      }
    } catch {
      toast.error(t('Re-query failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type='button'
      disabled={loading}
      onClick={handleRefetch}
      title={t('Re-query upstream and settle billing')}
      className='text-foreground flex items-center gap-1 text-xs hover:underline disabled:opacity-50'
    >
      <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
      <span>{t('Re-query')}</span>
    </button>
  )
}

// 仅超级管理员可见：查看单个任务的完整请求/响应数据（含提示词、分辨率、
// 上游返回、视频地址与 token 消耗）。其余角色不渲染该按钮。复用统一的
// RelayDetailsDialog（与使用日志详情同一份弹窗代码），任务侧额外传入 basicRows
// 与视频预览地址。
function TaskDetailsCell({ log }: { log: TaskLog }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { copiedText, copyToClipboard } = useCopyToClipboard({ notify: false })

  const properties = log.properties ?? {}
  const model =
    properties.origin_model_name || properties.upstream_model_name || '-'
  const durationSec =
    log.finish_time && log.submit_time && log.finish_time >= log.submit_time
      ? log.finish_time - log.submit_time
      : 0

  const isSuccess = log.status === TASK_STATUS.SUCCESS
  const isVideoAction = VIDEO_ACTIONS.has(log.action)
  // 直链过期/报错时的鉴权代理回退；仅成功的视频任务适用。
  const videoProxyUrl =
    isSuccess && isVideoAction && log.task_id
      ? `/v1/videos/${log.task_id}/content`
      : ''

  // 传入参数优先展示用户提交的完整请求体快照（base64 已截断）；
  // 旧任务无快照时回退到 properties（仅含 prompt 与模型名）。
  const requestJson = prettyJson(log.request_data) || prettyJson(log.properties)
  const responseJson = prettyJson(log.data)

  const basicRows: RelayDetailRow[] = [
    {
      className: 'sm:col-span-2',
      label: t('Task ID'),
      mono: true,
      value: (
        <span className='inline-flex items-center gap-1.5'>
          <span className='break-all'>{log.task_id || '-'}</span>
          {log.task_id && (
            <button
              type='button'
              onClick={() => copyToClipboard(log.task_id)}
              title={t('Copy to clipboard')}
              className='text-muted-foreground hover:text-foreground shrink-0'
            >
              {copiedText === log.task_id ? (
                <Check className='size-3 text-green-600' />
              ) : (
                <Copy className='size-3' />
              )}
            </button>
          )}
        </span>
      ),
    },
    { label: t('Platform'), value: t(log.platform) || '-' },
    {
      label: t('Action'),
      value: t(taskActionMapper.getLabel(log.action)) || log.action || '-',
    },
    {
      label: t('Status'),
      value: (
        <StatusBadge
          label={t(
            taskStatusMapper.getLabel(log.status, log.status || 'Submitting')
          )}
          variant={taskStatusMapper.getVariant(log.status)}
          size='sm'
          copyable={false}
          className='-ml-1.5'
        />
      ),
    },
    { label: t('Progress'), value: log.progress || '-' },
    { label: t('Channel ID'), mono: true, value: log.channel_id || '-' },
    { label: t('User'), value: log.username || String(log.user_id ?? '-') },
    { label: t('Group'), value: log.group || '-' },
    { label: t('Cost'), mono: true, value: formatLogQuota(log.quota ?? 0) },
    { label: t('Submit Time'), mono: true, value: formatTime(log.submit_time) },
    { label: t('Start Time'), mono: true, value: formatTime(log.start_time) },
    { label: t('Finish Time'), mono: true, value: formatTime(log.finish_time) },
    {
      label: t('Duration'),
      mono: true,
      value: durationSec > 0 ? formatUseTime(durationSec) : '-',
    },
  ]

  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(true)}
        title={t('View the full request and response data for this task')}
        className='text-foreground flex items-center gap-1 text-xs hover:underline'
      >
        <Info className='size-3.5' />
        <span>{t('Details')}</span>
      </button>
      <RelayDetailsDialog
        open={open}
        onOpenChange={setOpen}
        title={
          <>
            <Info className='h-5 w-5' />
            {t('Task Details')}
          </>
        }
        description={t('View the full request and response data for this task')}
        basicRows={basicRows}
        requestModel={model}
        upstreamModel={properties.upstream_model_name}
        requestJson={requestJson}
        responseJson={responseJson}
        resultUrl={log.result_url}
        videoProxyUrl={videoProxyUrl}
        failReason={log.fail_reason}
      />
    </>
  )
}

export function useTaskLogsColumns(scope: LogsScope): ColumnDef<TaskLog>[] {
  const isAdmin = scope === 'admin'
  const isAgent = scope === 'agent'
  const { t } = useTranslation()
  const isSuperAdmin = useIsSuperAdmin()
  const columns: ColumnDef<TaskLog>[] = [
    {
      accessorKey: 'submit_time',
      header: t('Submit Time'),
      cell: ({ row }) => {
        const log = row.original
        const submitTime = row.getValue('submit_time') as number

        return (
          <div className='flex min-w-0 flex-col gap-0.5'>
            <span className='truncate font-mono text-xs tabular-nums'>
              {formatTimestampToDate(submitTime, 'seconds')}
            </span>
            {log.finish_time ? (
              <span className='text-muted-foreground/60 truncate font-mono text-[11px] tabular-nums'>
                {formatTimestampToDate(log.finish_time, 'seconds')}
              </span>
            ) : (
              <span className='text-muted-foreground/50 text-[11px]'>-</span>
            )}
          </div>
        )
      },
      size: 180,
    },
  ]

  if (isAdmin) {
    columns.push(createChannelColumn<TaskLog>({ headerLabel: t('Channel') }))
  }

  // Member/user column: admins get a clickable cell (opens the user info
  // dialog), agents get plain text only so they never hit the admin-only
  // /api/user/:id endpoint.
  if (isAdmin || isAgent) {
    columns.push({
      id: 'user',
      header: t('User'),
      accessorFn: (row) => row.username || row.user_id,
      cell: function UserCell({ row }) {
        const { sensitiveVisible, setSelectedUserId, setUserInfoDialogOpen } =
          useUsageLogsContext()
        const log = row.original
        const displayName = log.username || String(log.user_id || '?')

        if (isAgent) {
          return (
            <span className='text-muted-foreground max-w-[120px] truncate text-sm'>
              {displayName}
            </span>
          )
        }

        return (
          <button
            type='button'
            className='flex items-center gap-1.5 text-left'
            onClick={(e) => {
              e.stopPropagation()
              setSelectedUserId(log.user_id)
              setUserInfoDialogOpen(true)
            }}
          >
            <Avatar className='ring-border/60 size-6 ring-1 max-sm:hidden'>
              <AvatarFallback
                className={cn(
                  'text-[11px] font-semibold',
                  !sensitiveVisible && 'bg-muted text-muted-foreground'
                )}
                style={
                  sensitiveVisible ? getUserAvatarStyle(displayName) : undefined
                }
              >
                {sensitiveVisible ? getUserAvatarFallback(displayName) : '•'}
              </AvatarFallback>
            </Avatar>
            <span className='text-muted-foreground truncate text-sm hover:underline'>
              {sensitiveVisible ? displayName : '••••'}
            </span>
          </button>
        )
      },
    })
  }

  columns.push(
    {
      accessorKey: 'task_id',
      header: t('Task ID'),
      cell: ({ row }) => {
        const log = row.original
        const taskId = row.getValue('task_id') as string
        if (!taskId) {
          return <span className='text-muted-foreground/60 text-xs'>-</span>
        }
        return (
          <div className='flex max-w-[170px] flex-col gap-0.5'>
            <StatusBadge
              label={taskId}
              copyText={taskId}
              variant='neutral'
              size='sm'
              className='border-border/60 bg-muted/30 !text-foreground max-w-full truncate rounded-md border px-1.5 py-0.5 font-mono'
            />
            <span className='text-muted-foreground/60 truncate text-[11px]'>
              {t(log.platform)} · {t(taskActionMapper.getLabel(log.action))}
            </span>
          </div>
        )
      },
      meta: { mobileTitle: true },
    },
    createDurationColumn<TaskLog>({
      submitTimeKey: 'submit_time',
      finishTimeKey: 'finish_time',
      unit: 'seconds',
      headerLabel: t('Duration'),
      warningThresholdSec: 300,
    }),
    {
      accessorKey: 'status',
      header: t('Status'),
      cell: ({ row }) => {
        const status = row.getValue('status') as string
        return (
          <StatusBadge
            label={t(taskStatusMapper.getLabel(status, status || 'Submitting'))}
            variant={taskStatusMapper.getVariant(status)}
            size='sm'
            copyable={false}
            className='-ml-1.5'
          />
        )
      },
    },
    createProgressColumn<TaskLog>({ headerLabel: t('Progress') }),
    {
      accessorKey: 'fail_reason',
      header: t('Details'),
      cell: function DetailsCell({ row }) {
        const log = row.original
        const failReason = row.getValue('fail_reason') as string
        const status = log.status
        const [dialogOpen, setDialogOpen] = useState(false)

        const isSunoSuccess =
          log.platform === 'suno' && status === TASK_STATUS.SUCCESS
        if (isSunoSuccess) {
          const data = parseTaskData(log.data)
          if (
            data.some(
              (c) =>
                c &&
                typeof c === 'object' &&
                (c as Record<string, unknown>).audio_url
            )
          ) {
            return <AudioPreviewCell log={log} />
          }
        }

        const isVideoTask =
          log.action === TASK_ACTIONS.GENERATE ||
          log.action === TASK_ACTIONS.TEXT_GENERATE ||
          log.action === TASK_ACTIONS.FIRST_TAIL_GENERATE ||
          log.action === TASK_ACTIONS.REFERENCE_GENERATE ||
          log.action === TASK_ACTIONS.REMIX_GENERATE
        const isSuccess = status === TASK_STATUS.SUCCESS
        const isUrl = failReason?.startsWith('http')

        if (isSuccess && isVideoTask && isUrl) {
          const videoUrl = `/v1/videos/${log.task_id}/content`
          return (
            <a
              href={videoUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='text-foreground text-xs hover:underline'
            >
              {t('Click to preview video')}
            </a>
          )
        }

        if (!failReason) {
          return <span className='text-muted-foreground/60 text-xs'>-</span>
        }

        return (
          <>
            <button
              type='button'
              className='group flex max-w-[200px] items-center gap-1 text-left text-xs'
              onClick={() => setDialogOpen(true)}
              title={t('Click to view full error message')}
            >
              <span className='truncate leading-snug text-red-600 group-hover:underline dark:text-red-400'>
                {failReason}
              </span>
            </button>
            <FailReasonDialog
              failReason={failReason}
              open={dialogOpen}
              onOpenChange={setDialogOpen}
            />
          </>
        )
      },
      size: 200,
      maxSize: 220,
    }
  )

  if (isAdmin) {
    columns.push({
      id: 'actions',
      header: t('Actions'),
      cell: ({ row }) => {
        const log = row.original
        return (
          <div className='flex items-center gap-3'>
            <TaskRefetchCell log={log} />
            {isSuperAdmin && <TaskDetailsCell log={log} />}
          </div>
        )
      },
      size: isSuperAdmin ? 190 : 110,
    })
  }

  return columns
}
