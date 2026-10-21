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
/* eslint-disable react-refresh/only-export-components */
import { Check, Cloud, Copy, ExternalLink, Info, LogIn, Monitor } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { cn } from '@/lib/utils'

// ============================================================================
// Shared primitives — single source for both task-log and usage-log details.
// ============================================================================

// Pretty-print a value that may be a JSON string, an object, or an array.
// Returns '' when there is nothing meaningful to show.
export function prettyJson(value: unknown): string {
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

export function DetailRow(props: {
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

export function DetailSection(props: {
  icon?: React.ReactNode
  label: string
  variant?: 'default' | 'danger'
  children: React.ReactNode
}) {
  const isDanger = props.variant === 'danger'
  return (
    <div className='min-w-0 space-y-1.5'>
      <Label
        className={cn(
          'flex items-center gap-1.5 text-xs font-semibold',
          isDanger && 'text-red-500'
        )}
      >
        {props.icon}
        {props.label}
      </Label>
      <div
        className={cn(
          'min-w-0 space-y-1.5 overflow-hidden rounded-md border p-2.5 max-sm:p-2',
          isDanger
            ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20'
            : 'bg-muted/30'
        )}
      >
        {props.children}
      </div>
    </div>
  )
}

export function JsonBlock(props: {
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

// ============================================================================
// Unified relay details dialog
// ============================================================================

export interface RelayDetailRow {
  label: React.ReactNode
  value: React.ReactNode
  mono?: boolean
  muted?: boolean
  danger?: boolean
  className?: string
}

interface RelayDetailsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Optional title/description so task-log and usage-log callers keep their own
  // heading (and status badge) while sharing one body layout.
  title?: React.ReactNode
  description?: string
  // Basic Info rows (task logs assemble these from TaskLog; usage logs fold their
  // identifiers into extraSections instead and omit this).
  basicRows?: RelayDetailRow[]
  // Optional Model / Upstream Model rows shown atop the Input Parameters block.
  requestModel?: string
  upstreamModel?: string
  // 传入/传出参数：已 pretty 打印的字符串（空串 → JsonBlock 显示「None」）。
  requestJson: string
  responseJson: string
  // 右侧视频预览仅在有可播放结果地址时渲染：resultUrl 为直链 http(s)，
  // videoProxyUrl 为鉴权代理回退（直链过期/报错时切换）。二者皆空则整列不渲染
  // （语言/生图即此路径）。
  resultUrl?: string
  videoProxyUrl?: string
  failReason?: string
  // 使用日志把计费/倍率/订阅等 sections 原样插入此处（见 usage-billing-sections）。
  extraSections?: React.ReactNode
}

export function RelayDetailsDialog(props: RelayDetailsDialogProps) {
  const { t } = useTranslation()
  const { copiedText, copyToClipboard } = useCopyToClipboard({ notify: false })

  const directResultUrl =
    props.resultUrl && /^https?:\/\//.test(props.resultUrl) ? props.resultUrl : ''
  const showVideo = !!directResultUrl || !!props.videoProxyUrl

  // Prefer the direct result URL: object storage honours Range requests, which
  // <video> needs to stream and seek. The /content proxy streams the whole body
  // as a plain 200 (it never forwards Range), so playback stalls at 0:00. Fall
  // back to the proxy when the signed direct URL has expired and errored.
  const [videoFallback, setVideoFallback] = useState(false)
  useEffect(() => {
    setVideoFallback(false)
  }, [props.resultUrl, props.videoProxyUrl])
  const baseVideoSrc = directResultUrl || props.videoProxyUrl || ''
  const videoSrc =
    videoFallback && props.videoProxyUrl ? props.videoProxyUrl : baseVideoSrc
  const handleVideoError = () => {
    if (!videoFallback && directResultUrl && props.videoProxyUrl) {
      setVideoFallback(true)
    }
  }

  const basicRows = props.basicRows ?? []

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        props.title ?? (
          <>
            <Info className='h-5 w-5' />
            {t('Log Details')}
          </>
        )
      }
      description={
        props.description ?? t('View the complete details for this log entry')
      }
      titleClassName='flex items-center gap-2'
      contentClassName='sm:max-w-5xl'
      contentHeight='calc(100vh - 15rem)'
      bodyClassName='h-full min-h-0'
    >
      <div
        className={cn(
          'grid min-h-0 gap-4 lg:h-full',
          showVideo && 'lg:grid-cols-[minmax(0,1fr)_minmax(16rem,21rem)]'
        )}
      >
        {/* Left: scrollable detail sections */}
        <div className='min-w-0 space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1'>
          {basicRows.length > 0 && (
            <DetailSection icon={<Info className='size-3.5' />} label={t('Basic Info')}>
              <div className='grid gap-1.5 sm:grid-cols-2'>
                {basicRows.map((row, idx) => (
                  <DetailRow
                    // eslint-disable-next-line react/no-array-index-key -- basicRows 为一次性静态列表，无重排/增删，索引作 key 安全
                    key={idx}
                    label={row.label}
                    value={row.value}
                    mono={row.mono}
                    muted={row.muted}
                    danger={row.danger}
                    className={row.className}
                  />
                ))}
              </div>
            </DetailSection>
          )}

          {props.extraSections}

          {/* Input parameters */}
          <DetailSection
            icon={<LogIn className='size-3.5' />}
            label={t('Input Parameters')}
          >
            {props.requestModel && (
              <DetailRow label={t('Model')} mono value={props.requestModel} />
            )}
            {props.upstreamModel && (
              <DetailRow
                label={t('Upstream Model')}
                mono
                value={props.upstreamModel}
              />
            )}
            <JsonBlock
              json={props.requestJson}
              onCopy={copyToClipboard}
              copied={copiedText === props.requestJson}
            />
          </DetailSection>

          {/* Output parameters */}
          <DetailSection
            icon={<Cloud className='size-3.5' />}
            label={t('Output Parameters')}
          >
            {directResultUrl && (
              <DetailRow
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
            {props.failReason && (
              <DetailRow label={t('Fail Reason')} danger value={props.failReason} />
            )}
            <JsonBlock
              json={props.responseJson}
              onCopy={copyToClipboard}
              copied={copiedText === props.responseJson}
            />
          </DetailSection>
        </div>

        {/* Right: pinned video preview (only when a playable result URL exists) */}
        {showVideo && (
          <div className='flex min-w-0 flex-col gap-1.5 lg:min-h-0'>
            <Label className='flex items-center gap-1.5 text-xs font-semibold'>
              <Monitor className='size-3.5' />
              {t('Video Preview')}
            </Label>
            <div className='bg-muted/30 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md border p-2.5'>
              {videoSrc ? (
                <video
                  key={videoSrc}
                  src={videoSrc}
                  controls
                  preload='metadata'
                  onError={handleVideoError}
                  className='max-h-full w-full rounded-md bg-black object-contain'
                />
              ) : (
                <p className='text-muted-foreground/60 text-xs'>
                  {t('No video available')}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
