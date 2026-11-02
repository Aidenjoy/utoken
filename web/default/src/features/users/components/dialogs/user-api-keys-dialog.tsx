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
import { Copy, KeySquare, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { fetchTokenKey, getApiKeys } from '@/features/keys/api'
import { API_KEY_STATUSES } from '@/features/keys/constants'
import type { ApiKey } from '@/features/keys/types'
import { copyToClipboard } from '@/lib/copy-to-clipboard'
import { formatQuota, formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { User } from '../../types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: Pick<User, 'id' | 'username'> | null
}

// 单页上限；超出时列表底部给出提示而不是静默截断
const PAGE_SIZE = 100

function MetaRow(props: { label: string; children: ReactNode }) {
  return (
    <div className='flex gap-2 text-xs'>
      <span className='text-muted-foreground w-20 shrink-0'>{props.label}</span>
      <span className='min-w-0 flex-1 break-words'>{props.children}</span>
    </div>
  )
}

function UserApiKeyRow(props: {
  apiKey: ApiKey
  copying: boolean
  onCopy: (id: number) => void
}) {
  const { t } = useTranslation()
  const apiKey = props.apiKey
  const statusConfig = API_KEY_STATUSES[apiKey.status]
  const models =
    apiKey.model_limits_enabled && apiKey.model_limits
      ? apiKey.model_limits.split(',').filter(Boolean)
      : []
  const deleted = Boolean(apiKey.deleted_at)
  const deletedAtMs = apiKey.deleted_at
    ? new Date(apiKey.deleted_at).getTime()
    : 0
  const neverExpires = apiKey.expired_time === -1
  const isExpired = !neverExpires && apiKey.expired_time * 1000 < Date.now()
  const quotaLabel = apiKey.unlimited_quota
    ? t('Unlimited')
    : `${t('Remaining:')} ${formatQuota(apiKey.remain_quota)}`

  return (
    <div
      className={cn('rounded-md border px-3 py-2.5', deleted && 'bg-muted/40')}
    >
      <div className='flex items-start justify-between gap-2'>
        <div className='flex min-w-0 flex-wrap items-center gap-1.5'>
          <span className='truncate text-sm font-medium'>{apiKey.name}</span>
          <span className='text-muted-foreground font-mono text-xs'>
            #{apiKey.id}
          </span>
          {deleted && (
            <StatusBadge
              variant='danger'
              label={t('Deleted key')}
              copyable={false}
              size='sm'
            />
          )}
          {statusConfig && (
            <StatusBadge
              variant={statusConfig.variant}
              label={t(statusConfig.label)}
              copyable={false}
              size='sm'
            />
          )}
        </div>
        <Button
          variant='ghost'
          size='sm'
          className='h-7 w-7 shrink-0 p-0'
          onClick={() => props.onCopy(apiKey.id)}
          disabled={props.copying}
          aria-label={t('Copy Key')}
        >
          {props.copying ? (
            <Loader2 className='h-3.5 w-3.5 animate-spin' />
          ) : (
            <Copy className='h-3.5 w-3.5' />
          )}
        </Button>
      </div>

      <p className='text-muted-foreground mt-1 truncate font-mono text-xs'>
        {`sk-${apiKey.key}`}
      </p>

      <div className='mt-2 space-y-1'>
        <MetaRow label={t('Quota')}>
          {quotaLabel} · {t('Used:')} {formatQuota(apiKey.used_quota)}
        </MetaRow>
        <MetaRow label={t('Models')}>
          {models.length === 0 ? (
            t('All models')
          ) : (
            <span className='font-mono'>{models.join(', ')}</span>
          )}
        </MetaRow>
        <MetaRow label={t('Expires')}>
          {neverExpires ? (
            t('Never')
          ) : (
            <>
              <span
                className={cn(
                  'font-mono',
                  isExpired && 'text-destructive font-medium'
                )}
              >
                {formatTimestampToDate(apiKey.expired_time)}
              </span>
              {isExpired && ` (${t('Expired')})`}
            </>
          )}
        </MetaRow>
        <MetaRow label={t('Last Used')}>
          {apiKey.accessed_time ? (
            <span className='font-mono'>
              {formatTimestampToDate(apiKey.accessed_time)}
            </span>
          ) : (
            t('Never used')
          )}
        </MetaRow>
        {deleted && (
          <MetaRow label={t('Deletion time')}>
            <span className='font-mono'>
              {formatTimestampToDate(deletedAtMs, 'milliseconds')}
            </span>
          </MetaRow>
        )}
      </div>
    </div>
  )
}

export function UserApiKeysDialog(props: Props) {
  const { t } = useTranslation()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [copyingId, setCopyingId] = useState<number | null>(null)
  // 默认包含已删除：客户删掉密钥后运营常需要在此核对并取回明文
  const [includeDeleted, setIncludeDeleted] = useState(true)

  const fetchKeys = useCallback(async () => {
    if (!props.user) return
    setLoading(true)
    try {
      const result = await getApiKeys({
        userId: props.user.id,
        p: 1,
        size: PAGE_SIZE,
        includeDeleted,
      })
      if (!result.success) {
        toast.error(result.message || t('Failed to load API keys'))
        setKeys([])
        setTotal(0)
        return
      }
      setKeys(result.data?.items || [])
      setTotal(result.data?.total || 0)
    } catch {
      toast.error(t('Failed to load API keys'))
    } finally {
      setLoading(false)
    }
  }, [props.user, includeDeleted, t])

  useEffect(() => {
    if (props.open && props.user) {
      fetchKeys()
    } else {
      setKeys([])
      setTotal(0)
    }
  }, [props.open, props.user, fetchKeys])

  const handleCopy = async (id: number) => {
    setCopyingId(id)
    try {
      const result = await fetchTokenKey(id)
      if (!result.success || !result.data?.key) {
        toast.error(result.message || t('Failed to load'))
        return
      }
      const ok = await copyToClipboard(`sk-${result.data.key}`)
      if (ok) toast.success(t('Copied'))
    } catch {
      toast.error(t('Failed to load'))
    } finally {
      setCopyingId(null)
    }
  }

  let body: ReactNode
  if (loading) {
    body = (
      <div className='flex items-center justify-center py-8'>
        <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
      </div>
    )
  } else if (keys.length === 0) {
    body = (
      <p className='text-muted-foreground py-4 text-center text-sm'>
        {t('This user has no API keys')}
      </p>
    )
  } else {
    body = (
      <>
        <ScrollArea className='max-h-[50vh]'>
          <div className='space-y-2 pr-3'>
            {keys.map((key) => (
              <UserApiKeyRow
                key={key.id}
                apiKey={key}
                copying={copyingId === key.id}
                onCopy={handleCopy}
              />
            ))}
          </div>
        </ScrollArea>
        {total > keys.length && (
          <p className='text-muted-foreground text-center text-xs'>
            {t('Only the first {{count}} keys are shown', {
              count: keys.length,
            })}
          </p>
        )}
      </>
    )
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        <>
          <KeySquare className='h-5 w-5' />
          {t('API Keys')}
        </>
      }
      description={
        props.user
          ? t('View and copy the API keys of {{username}}', {
              username: props.user.username,
            })
          : undefined
      }
      contentClassName='sm:max-w-lg'
      titleClassName='flex items-center gap-2'
      descriptionClassName='sr-only'
      contentHeight='auto'
      bodyClassName='space-y-4'
    >
      <div className='flex items-center justify-between gap-2 rounded-md border px-3 py-1.5'>
        <span className='text-muted-foreground text-xs'>
          {t('{{count}} key(s) in total', { count: total })}
        </span>
        <div className='flex items-center gap-2'>
          <span
            id='user-api-keys-include-deleted-label'
            className='text-muted-foreground text-xs'
          >
            {t('Include deleted keys')}
          </span>
          <Switch
            size='sm'
            disabled={loading}
            checked={includeDeleted}
            onCheckedChange={setIncludeDeleted}
            aria-labelledby='user-api-keys-include-deleted-label'
          />
        </div>
      </div>
      {body}
    </Dialog>
  )
}
