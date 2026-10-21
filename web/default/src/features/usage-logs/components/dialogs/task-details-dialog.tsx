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
import { Check, Cloud, Copy, ExternalLink, Info, LogIn, Monitor } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { formatLogQuota, formatTimestampToDate, formatUseTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import { TASK_ACTIONS, TASK_STATUS } from '../../constants'
import { taskActionMapper, taskStatusMapper } from '../../lib/mappers'
import type { TaskLog } from '../../types'

// Video-generation actions resolve their result through the authenticated
// /v1/videos/{id}/content proxy, matching the inline preview in the list.
const VIDEO_ACTIONS = new Set<string>([
  TASK_ACTIONS.GENERATE,
  TASK_ACTIONS.TEXT_GENERATE,
  TASK_ACTIONS.FIRST_TAIL_GENERATE,
  TASK_ACTIONS.REFERENCE_GENERATE,
  TASK_ACTIONS.REMIX_GENERATE,
])

// Pretty-print a value that may be a JSON string, an object, or an array.
// Returns '' when there is nothing meaningful to show.
function prettyJson(value: unknown): string {
  if (value == null || value === '') return ''
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatTime(timestamp?: number): string {
  if (!timestamp || timestamp <= 0) return '-'
  return formatTimestampToDate(timestamp, 'seconds')
}

function DetailRow(props: {
  label: React.ReactNode
  value: React.ReactNode
  mono?: boolean
  muted?: boolean
  danger?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] gap-2 text-sm sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3',
        props.className
      )}
    >
      <span className='text-muted-foreground min-w-0 text-xs'>{props.label}</span>
      <span
        className={cn(
          'max-w-full min-w-0 text-xs break-all sm:wrap-break-word',
          props.mono && 'font-mono',
          props.muted && 'text-muted-foreground',
          props.danger && 'text-red-600 dark:text-red-400'
        )}
      >
        {props.value}
      </span>
    </div>
  )
}

function DetailSection(props: {
  icon?: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className='min-w-0 space-y-1.5'>
      <Label className='flex items-center gap-1.5 text-xs font-semibold'>
        {props.icon}
        {props.label}
      </Label>
      <div className='bg-muted/30 min-w-0 space-y-1.5 overflow-hidden rounded-md border p-2.5 max-sm:p-2'>
        {props.children}
      </div>
    </div>
  )
}

function JsonBlock(props: {
  json: string
  onCopy: (text: string) => void
  copied: boolean
}) {
  const { t } = useTranslation()
  if (!props.json) {
    return <p className='text-muted-foreground/60 text-xs'>{t('None')}</p>
  }
  return (
    <div className='bg-muted/50 relative rounded-md border'>
      <Button
        variant='ghost'
        size='sm'
        className='absolute top-1.5 right-1.5 h-7 w-7 p-0'
        onClick={() => props.onCopy(props.json)}
        title={t('Copy to clipboard')}
      >
        {props.copied ? (
          <Check className='size-3.5 text-green-600' />
        ) : (
          <Copy className='size-3.5' />
        )}
      </Button>
      <pre className='max-h-60 overflow-auto p-2.5 pr-10 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap'>
        {props.json}
      </pre>
    </div>
  )
}

interface TaskDetailsDialogProps {
  log: TaskLog
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TaskDetailsDialog({
  log,
  open,
  onOpenChange,
}: TaskDetailsDialogProps) {
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard({ notify: false })

  const properties = log.properties ?? {}
  const propertiesJson = useMemo(() => prettyJson(log.properties), [log.properties])
  const dataJson = useMemo(() => prettyJson(log.data), [log.data])

  const model = properties.origin_model_name || properties.upstream_model_name || '-'
  const durationSec =
    log.finish_time && log.submit_time && log.finish_time >= log.submit_time
      ? log.finish_time - log.submit_time
      : 0

  const proxyVideoUrl = log.task_id ? `/v1/videos/${log.task_id}/content` : ''
  const isVideoAction = VIDEO_ACTIONS.has(log.action)
  const isSuccess = log.status === TASK_STATUS.SUCCESS
  const directResultUrl =
    log.result_url && /^https?:\/\//.test(log.result_url) ? log.result_url : ''
  const videoSrc =
    isSuccess && isVideoAction && proxyVideoUrl ? proxyVideoUrl : directResultUrl

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <>
          <Info className='h-5 w-5' />
          {t('Task Details')}
        </>
      }
      description={t('View the full request and response data for this task')}
      titleClassName='flex items-center gap-2'
      contentClassName='sm:max-w-3xl'
      contentHeight='auto'
      bodyClassName='space-y-4'
    >
      {/* 1. Basic info */}
      <DetailSection icon={<Info className='size-3.5' />} label={t('Basic Info')}>
        <div className='grid gap-1.5 sm:grid-cols-2'>
          <DetailRow
            className='sm:col-span-2'
            label={t('Task ID')}
            mono
            value={
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
            }
          />
          <DetailRow label={t('Platform')} value={t(log.platform) || '-'} />
          <DetailRow
            label={t('Action')}
            value={t(taskActionMapper.getLabel(log.action)) || log.action || '-'}
          />
          <DetailRow
            label={t('Status')}
            value={
              <StatusBadge
                label={t(
                  taskStatusMapper.getLabel(log.status, log.status || 'Submitting')
                )}
                variant={taskStatusMapper.getVariant(log.status)}
                size='sm'
                copyable={false}
                className='-ml-1.5'
              />
            }
          />
          <DetailRow label={t('Progress')} value={log.progress || '-'} />
          <DetailRow label={t('Channel ID')} mono value={log.channel_id || '-'} />
          <DetailRow
            label={t('User')}
            value={log.username || String(log.user_id ?? '-')}
          />
          <DetailRow label={t('Group')} value={log.group || '-'} />
          <DetailRow label={t('Cost')} mono value={formatLogQuota(log.quota ?? 0)} />
          <DetailRow label={t('Submit Time')} mono value={formatTime(log.submit_time)} />
          <DetailRow label={t('Start Time')} mono value={formatTime(log.start_time)} />
          <DetailRow label={t('Finish Time')} mono value={formatTime(log.finish_time)} />
          <DetailRow
            label={t('Duration')}
            mono
            value={durationSec > 0 ? formatUseTime(durationSec) : '-'}
          />
        </div>
      </DetailSection>

      {/* 2. Input parameters */}
      <DetailSection
        icon={<LogIn className='size-3.5' />}
        label={t('Input Parameters')}
      >
        <DetailRow label={t('Model')} mono value={model} />
        {properties.upstream_model_name && (
          <DetailRow
            label={t('Upstream Model')}
            mono
            value={properties.upstream_model_name}
          />
        )}
        <JsonBlock
          json={propertiesJson}
          onCopy={copyToClipboard}
          copied={copiedText === propertiesJson}
        />
      </DetailSection>

      {/* 3. Output parameters */}
      <DetailSection
        icon={<Cloud className='size-3.5' />}
        label={t('Output Parameters')}
      >
        {directResultUrl && (
          <DetailRow
            className='sm:col-span-1'
            label={t('Result URL')}
            value={
              <span className='inline-flex min-w-0 items-center gap-1.5'>
                <a
                  href={directResultUrl}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='truncate hover:underline'
                >
                  {directResultUrl}
                </a>
                <ExternalLink className='text-muted-foreground size-3 shrink-0' />
              </span>
            }
          />
        )}
        {log.fail_reason && (
          <DetailRow label={t('Fail Reason')} danger value={log.fail_reason} />
        )}
        <JsonBlock
          json={dataJson}
          onCopy={copyToClipboard}
          copied={copiedText === dataJson}
        />
      </DetailSection>

      {/* 4. Video preview */}
      <DetailSection
        icon={<Monitor className='size-3.5' />}
        label={t('Video Preview')}
      >
        {videoSrc ? (
          <video
            src={videoSrc}
            controls
            preload='metadata'
            className='bg-black w-full rounded-md'
          />
        ) : (
          <p className='text-muted-foreground/60 text-xs'>
            {t('No video available')}
          </p>
        )}
      </DetailSection>
    </Dialog>
  )
}
