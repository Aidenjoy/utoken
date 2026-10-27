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
import { Check, Copy, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import {
  formatLogQuota,
  formatTimestampToDate,
  formatUseTime,
} from '@/lib/format'

import { TASK_ACTIONS, TASK_STATUS } from '../../constants'
import { taskActionMapper, taskStatusMapper } from '../../lib/mappers'
import type { TaskLog } from '../../types'
import {
  RelayDetailsDialog,
  prettyJson,
  type RelayDetailRow,
} from './relay-details-dialog'

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

/**
 * 任务详情弹窗：任务形态详情的唯一真源。任务日志表格与使用日志表格
 * （关联到任务的行）都渲染本组件，保证两处详情逐字段一致、共用一套代码。
 * task=null（使用日志行关联任务尚在加载）时渲染同一外壳的空态，
 * 避免打开过程中在两种版式之间跳变。
 */
export function TaskDetailsDialog({
  task,
  open,
  onOpenChange,
}: {
  task: TaskLog | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard({ notify: false })

  const title = (
    <>
      <Info className='h-5 w-5' />
      {t('Task Details')}
    </>
  )
  const description = t(
    'View the full request and response data for this task'
  )

  if (!task) {
    return (
      <RelayDetailsDialog
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        description={description}
        requestJson=''
        responseJson=''
      />
    )
  }

  const properties = task.properties ?? {}
  const model =
    properties.origin_model_name || properties.upstream_model_name || '-'
  const durationSec =
    task.finish_time && task.submit_time && task.finish_time >= task.submit_time
      ? task.finish_time - task.submit_time
      : 0

  const isSuccess = task.status === TASK_STATUS.SUCCESS
  const isVideoAction = VIDEO_ACTIONS.has(task.action)
  // 直链过期/报错时的鉴权代理回退；仅成功的视频任务适用。
  const videoProxyUrl =
    isSuccess && isVideoAction && task.task_id
      ? `/v1/videos/${task.task_id}/content`
      : ''

  // 传入参数优先展示用户提交的完整请求体快照（base64 已截断）；
  // 旧任务无快照时回退到 properties（仅含 prompt 与模型名）。
  const requestJson =
    prettyJson(task.request_data) || prettyJson(task.properties)
  const responseJson = prettyJson(task.data)

  const basicRows: RelayDetailRow[] = [
    {
      className: 'sm:col-span-2',
      label: t('Task ID'),
      mono: true,
      value: (
        <span className='inline-flex items-center gap-1.5'>
          <span className='break-all'>{task.task_id || '-'}</span>
          {task.task_id && (
            <button
              type='button'
              onClick={() => copyToClipboard(task.task_id)}
              title={t('Copy to clipboard')}
              className='text-muted-foreground hover:text-foreground shrink-0'
            >
              {copiedText === task.task_id ? (
                <Check className='size-3 text-green-600' />
              ) : (
                <Copy className='size-3' />
              )}
            </button>
          )}
        </span>
      ),
    },
    { label: t('Platform'), value: t(task.platform) || '-' },
    {
      label: t('Action'),
      value: t(taskActionMapper.getLabel(task.action)) || task.action || '-',
    },
    {
      label: t('Status'),
      value: (
        <StatusBadge
          label={t(
            taskStatusMapper.getLabel(task.status, task.status || 'Submitting')
          )}
          variant={taskStatusMapper.getVariant(task.status)}
          size='sm'
          copyable={false}
          className='-ml-1.5'
        />
      ),
    },
    { label: t('Progress'), value: task.progress || '-' },
    { label: t('Channel ID'), mono: true, value: task.channel_id || '-' },
    { label: t('User'), value: task.username || String(task.user_id ?? '-') },
    { label: t('Group'), value: task.group || '-' },
    { label: t('Cost'), mono: true, value: formatLogQuota(task.quota ?? 0) },
    { label: t('Submit Time'), mono: true, value: formatTime(task.submit_time) },
    { label: t('Start Time'), mono: true, value: formatTime(task.start_time) },
    {
      label: t('Finish Time'),
      mono: true,
      value: formatTime(task.finish_time),
    },
    {
      label: t('Duration'),
      mono: true,
      value: durationSec > 0 ? formatUseTime(durationSec) : '-',
    },
  ]

  return (
    <RelayDetailsDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      basicRows={basicRows}
      requestModel={model}
      upstreamModel={properties.upstream_model_name}
      requestUrl={properties.request_url}
      requestJson={requestJson}
      responseJson={responseJson}
      resultUrl={task.result_url}
      videoProxyUrl={videoProxyUrl}
      failReason={task.fail_reason}
    />
  )
}
