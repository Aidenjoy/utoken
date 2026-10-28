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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge, type StatusBadgeProps } from '@/components/status-badge'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { formatLogQuota, formatTimestampToDate } from '@/lib/format'

import { getTaskById } from '../../api'
import type { UsageLog } from '../../data/schema'
import { useLogBodies } from '../../hooks/use-log-bodies'
import { parseLogOther } from '../../lib/format'
import { getLogTypeConfig } from '../../lib/utils'
import type { LogsScope, TaskLog } from '../../types'
import {
  RelayDetailsDialog,
  prettyJson,
  type RelayDetailRow,
} from './relay-details-dialog'
import { TaskDetailsDialog } from './task-details-dialog'

/**
 * 通用日志详情弹窗：与任务日志详情共用同一份 RelayDetailsDialog 代码与同一版式
 * （基本信息区块 + 传入/传出参数 + 可选视频预览），仅 basicRows 字段按日志类型取值。
 * 请求/返回快照仅在弹窗打开时按需拉取（大 JSON 存独立表、不进列表）。
 * 关联到异步任务的行（如 seedance 消耗/退款）其请求体/响应体/视频都挂在任务上、
 * log_bodies 无记录，故按 task_id 拉取任务后直接渲染与任务日志完全相同的详情。
 */
export function CommonLogDetailsDialog({
  log,
  scope,
  open,
  onOpenChange,
}: {
  log: UsageLog
  scope: LogsScope
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard({ notify: false })
  const typeConfig = getLogTypeConfig(log.type)
  const other = parseLogOther(log.other)
  const taskId = other?.task_id

  // 关联任务行的详情数据源是任务本身；打开时按 scope 拉取单个任务。
  const [task, setTask] = useState<TaskLog | null>(null)
  useEffect(() => {
    if (!open || !taskId) {
      setTask(null)
      return
    }
    let cancelled = false
    getTaskById(scope, taskId)
      .then((found) => {
        if (!cancelled) setTask(found)
      })
      .catch(() => {
        if (!cancelled) setTask(null)
      })
    return () => {
      cancelled = true
    }
  }, [open, taskId, scope])

  const { requestData, responseData } = useLogBodies(log.request_id, open && !taskId)

  // 关联到任务的行：完全复用任务日志详情弹窗，保证两处逐字段一致。
  if (taskId) {
    return (
      <TaskDetailsDialog
        task={task}
        open={open}
        onOpenChange={onOpenChange}
      />
    )
  }

  // 与任务日志 basicRows 同一组装方式：标识字段 + 类型徽标 + 费用/时间，
  // 首行跨两列并带复制按钮（对应任务日志的 Task ID 行）。
  const basicRows: RelayDetailRow[] = [
    {
      className: 'sm:col-span-2',
      label: t('Request ID'),
      mono: true,
      value: (
        <span className='inline-flex items-center gap-1.5'>
          <span className='break-all'>{log.request_id || '-'}</span>
          {log.request_id && (
            <button
              type='button'
              onClick={() => copyToClipboard(log.request_id)}
              title={t('Copy to clipboard')}
              className='text-muted-foreground hover:text-foreground shrink-0'
            >
              {copiedText === log.request_id ? (
                <Check className='size-3 text-green-600' />
              ) : (
                <Copy className='size-3' />
              )}
            </button>
          )}
        </span>
      ),
    },
    {
      label: t('Type'),
      value: (
        <StatusBadge
          label={t(typeConfig.label)}
          variant={typeConfig.color as StatusBadgeProps['variant']}
          size='sm'
          copyable={false}
          className='-ml-1.5'
        />
      ),
    },
    {
      label: t('Channel'),
      mono: true,
      value: log.channel_name
        ? `${log.channel} (${log.channel_name})`
        : String(log.channel ?? '-'),
    },
    { label: t('Token'), mono: true, value: log.token_name || '-' },
    { label: t('Group'), value: log.group || '-' },
    { label: t('User'), value: log.username || '-' },
    { label: t('Cost'), mono: true, value: formatLogQuota(log.quota ?? 0) },
    {
      label: t('Time'),
      mono: true,
      value: formatTimestampToDate(log.created_at, 'seconds'),
    },
    ...(log.upstream_request_id
      ? [
          {
            label: t('Upstream Request ID'),
            mono: true,
            value: log.upstream_request_id,
          },
        ]
      : []),
  ]

  return (
    <RelayDetailsDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <>
          <Info className='h-5 w-5' />
          {t('Protocol Details')}
        </>
      }
      basicRows={basicRows}
      requestModel={log.model_name || undefined}
      upstreamModel={other?.upstream_model_name}
      requestUrl={other?.request_url}
      requestJson={prettyJson(requestData)}
      responseJson={prettyJson(responseData)}
    />
  )
}
