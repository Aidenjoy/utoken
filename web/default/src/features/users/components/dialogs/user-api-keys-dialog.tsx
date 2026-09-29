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
import { fetchTokenKey, getApiKeys } from '@/features/keys/api'
import { API_KEY_STATUSES } from '@/features/keys/constants'
import type { ApiKey } from '@/features/keys/types'
import { copyToClipboard } from '@/lib/copy-to-clipboard'

import type { User } from '../../types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: Pick<User, 'id' | 'username'> | null
}

export function UserApiKeysDialog(props: Props) {
  const { t } = useTranslation()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(false)
  const [copyingId, setCopyingId] = useState<number | null>(null)

  const fetchKeys = useCallback(async () => {
    if (!props.user) return
    setLoading(true)
    try {
      const result = await getApiKeys({ userId: props.user.id, p: 1, size: 100 })
      setKeys(result.data?.items || [])
    } catch {
      toast.error(t('Failed to load API keys'))
    } finally {
      setLoading(false)
    }
  }, [props.user, t])

  useEffect(() => {
    if (props.open && props.user) {
      fetchKeys()
    } else {
      setKeys([])
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
      const ok = await copyToClipboard(result.data.key)
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
      <ScrollArea className='max-h-[50vh]'>
        <div className='space-y-2 pr-3'>
          {keys.map((key) => {
            const status = API_KEY_STATUSES[key.status]
            return (
              <div
                key={key.id}
                className='flex items-center justify-between gap-2 rounded-md border px-3 py-2.5'
              >
                <div className='min-w-0'>
                  <div className='flex items-center gap-1.5'>
                    <span className='truncate text-sm font-medium'>
                      {key.name}
                    </span>
                    {status && (
                      <StatusBadge
                        variant={status.variant}
                        label={t(status.label)}
                        copyable={false}
                        size='sm'
                      />
                    )}
                  </div>
                  <p className='text-muted-foreground truncate font-mono text-xs'>
                    {key.key}
                  </p>
                </div>
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-7 w-7 shrink-0 p-0'
                  onClick={() => handleCopy(key.id)}
                  disabled={copyingId === key.id}
                  aria-label={t('Copy Key')}
                >
                  {copyingId === key.id ? (
                    <Loader2 className='h-3.5 w-3.5 animate-spin' />
                  ) : (
                    <Copy className='h-3.5 w-3.5' />
                  )}
                </Button>
              </div>
            )
          })}
        </div>
      </ScrollArea>
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
      {body}
    </Dialog>
  )
}
