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
import { Copy, Eye, EyeOff, KeyRound, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { copyToClipboard } from '@/lib/copy-to-clipboard'

import { fetchTokenAccessKey, resetTokenAccessKey } from '../../api'
import { ERROR_MESSAGES } from '../../constants'
import { useApiKeys } from '../api-keys-provider'

interface ArkCredentials {
  accessKey: string
  secretKey: string
}

// AccessKeyDialog 展示/管理令牌的 Ark 官方兼容 API 凭证（AK/SK）。
// AK 是标识符（列表已含，原样展示、可复制）；SK 列表仅含掩码，明文经
// /api/token/:id/access-key 拉取或重置后返回，且只在本次打开期间可见。
export function AccessKeyDialog() {
  const { t } = useTranslation()
  const { open, setOpen, currentRow, triggerRefresh } = useApiKeys()
  const isOpen = open === 'access-key'

  const [loading, setLoading] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [credentials, setCredentials] = useState<ArkCredentials | null>(null)

  const accessKey = credentials?.accessKey || currentRow?.access_key || ''
  const maskedSecretKey = currentRow?.secret_key || ''
  const secretKey =
    revealed && credentials?.secretKey ? credentials.secretKey : maskedSecretKey
  const hasCredentials = Boolean(accessKey)
  const busy = loading || resetting

  // 关闭即清空明文，保证 SK「仅本次可见」；下次打开需重新拉取。
  const handleClose = useCallback(() => {
    setCredentials(null)
    setRevealed(false)
    setConfirmingReset(false)
    setLoading(false)
    setResetting(false)
    setOpen(null)
  }, [setOpen])

  const applyCredentials = useCallback((data: ArkCredentials) => {
    setCredentials(data)
    setRevealed(true)
  }, [])

  // 拉取明文 SK（若令牌尚无 AK/SK，后端会按需补发）。
  const handleReveal = useCallback(async () => {
    if (!currentRow) return
    if (revealed) {
      setRevealed(false)
      return
    }
    if (credentials?.secretKey) {
      setRevealed(true)
      return
    }
    setLoading(true)
    try {
      const res = await fetchTokenAccessKey(currentRow.id)
      if (res.success && res.data) {
        applyCredentials({
          accessKey: res.data.access_key,
          secretKey: res.data.secret_key,
        })
      } else {
        toast.error(res.message || t(ERROR_MESSAGES.UNEXPECTED))
      }
    } catch {
      toast.error(t(ERROR_MESSAGES.UNEXPECTED))
    } finally {
      setLoading(false)
    }
  }, [currentRow, revealed, credentials, applyCredentials, t])

  const handleGenerate = useCallback(async () => {
    if (!currentRow) return
    setLoading(true)
    try {
      const res = await fetchTokenAccessKey(currentRow.id)
      if (res.success && res.data) {
        applyCredentials({
          accessKey: res.data.access_key,
          secretKey: res.data.secret_key,
        })
        toast.success(t('Ark AK/SK generated successfully'))
        triggerRefresh()
      } else {
        toast.error(res.message || t(ERROR_MESSAGES.UNEXPECTED))
      }
    } catch {
      toast.error(t(ERROR_MESSAGES.UNEXPECTED))
    } finally {
      setLoading(false)
    }
  }, [currentRow, applyCredentials, t, triggerRefresh])

  const handleReset = useCallback(async () => {
    if (!currentRow) return
    setResetting(true)
    try {
      const res = await resetTokenAccessKey(currentRow.id)
      if (res.success && res.data) {
        applyCredentials({
          accessKey: res.data.access_key,
          secretKey: res.data.secret_key,
        })
        setConfirmingReset(false)
        toast.success(t('Ark AK/SK reset successfully'))
        triggerRefresh()
      } else {
        toast.error(res.message || t(ERROR_MESSAGES.UNEXPECTED))
      }
    } catch {
      toast.error(t(ERROR_MESSAGES.UNEXPECTED))
    } finally {
      setResetting(false)
    }
  }, [currentRow, applyCredentials, t, triggerRefresh])

  const handleCopy = useCallback(
    async (value: string) => {
      if (!value) return
      const ok = await copyToClipboard(value)
      if (ok) toast.success(t('Copied'))
    },
    [t]
  )

  let revealIcon = <Eye />
  if (loading) {
    revealIcon = <Loader2 className='animate-spin' />
  } else if (revealed) {
    revealIcon = <EyeOff />
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => !next && handleClose()}
      title={t('Ark AK/SK')}
      description={t(
        'AccessKey and SecretKey for the Volcano Ark official-compatible Asset API.'
      )}
      contentClassName='sm:max-w-lg'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        confirmingReset ? (
          <>
            <Button
              variant='outline'
              onClick={() => setConfirmingReset(false)}
              disabled={busy}
            >
              {t('Cancel')}
            </Button>
            <Button variant='destructive' onClick={handleReset} disabled={busy}>
              {resetting ? (
                <Loader2 className='animate-spin' />
              ) : (
                <RefreshCw />
              )}
              {t('Confirm Reset')}
            </Button>
          </>
        ) : (
          <>
            <Button variant='outline' onClick={handleClose}>
              {t('Close')}
            </Button>
            {hasCredentials ? (
              <Button
                variant='destructive'
                onClick={() => setConfirmingReset(true)}
                disabled={busy}
              >
                <RefreshCw />
                {t('Reset AK/SK')}
              </Button>
            ) : (
              <Button onClick={handleGenerate} disabled={busy}>
                {loading ? (
                  <Loader2 className='animate-spin' />
                ) : (
                  <KeyRound />
                )}
                {t('Generate AK/SK')}
              </Button>
            )}
          </>
        )
      }
    >
      {confirmingReset ? (
        <p className='text-destructive text-sm'>
          {t(
            'Resetting creates a new AK/SK pair and the current credentials stop working immediately.'
          )}
        </p>
      ) : (
        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label>{t('AccessKey')}</Label>
            <div className='flex items-center gap-2'>
              <Input
                readOnly
                value={accessKey}
                placeholder={t('Not generated yet')}
                className='font-mono'
              />
              <Button
                variant='ghost'
                size='icon'
                onClick={() => handleCopy(accessKey)}
                disabled={!accessKey}
                aria-label={t('Copy')}
              >
                <Copy />
              </Button>
            </div>
          </div>

          <div className='space-y-2'>
            <Label>{t('SecretKey')}</Label>
            <div className='flex items-center gap-2'>
              <Input
                readOnly
                value={secretKey}
                placeholder={t('Not generated yet')}
                className='font-mono'
              />
              <Button
                variant='ghost'
                size='icon'
                onClick={handleReveal}
                disabled={!hasCredentials}
                aria-label={revealed ? t('Hide') : t('Show')}
              >
                {revealIcon}
              </Button>
              <Button
                variant='ghost'
                size='icon'
                onClick={() => handleCopy(secretKey)}
                disabled={!revealed || !secretKey}
                aria-label={t('Copy')}
              >
                <Copy />
              </Button>
            </div>
            <p className='text-muted-foreground text-xs'>
              {t(
                'The SecretKey is only shown right after generating or resetting. Copy and store it securely.'
              )}
            </p>
          </div>
        </div>
      )}
    </Dialog>
  )
}
