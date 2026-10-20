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
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DateTimePicker } from '@/components/datetime-picker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import {
  createAdminInviteCode,
  createMyInviteCode,
  updateAdminInviteCode,
  updateMyInviteCode,
} from '../api'
import { INVITE_CODE_STATUS, type InviteCode } from '../types'

type Props = {
  open: boolean
  code: InviteCode | null
  onOpenChange: (open: boolean) => void
  /** 'admin' issues site-wide codes; 'agent' issues codes bound to the agent. */
  mode: 'admin' | 'agent'
  /** Query key invalidated after a successful mutation. */
  queryKey: string
}

/**
 * Create or edit an invite code. The code carries no discount: registering with
 * it only binds the new user to the code's owner, so an agent's code is what
 * pulls a user into that agent's authorized model list. The only knobs left are
 * how many times the code may be used and when it stops working — `max_uses` of
 * 0 means unlimited, `expires_at` of 0 means never expires.
 */
export function SetCodeDialog({
  open,
  code,
  onOpenChange,
  mode,
  queryKey,
}: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isEdit = code !== null

  const [maxUses, setMaxUses] = useState('0')
  const [expiresAt, setExpiresAt] = useState<Date | undefined>(undefined)
  const [status, setStatus] = useState<number>(INVITE_CODE_STATUS.ENABLED)
  const [remark, setRemark] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    if (code) {
      setMaxUses(String(code.max_uses ?? 0))
      setExpiresAt(
        code.expires_at > 0 ? new Date(code.expires_at * 1000) : undefined
      )
      setStatus(code.status)
      setRemark(code.remark ?? '')
    } else {
      setMaxUses('0')
      setExpiresAt(undefined)
      setStatus(INVITE_CODE_STATUS.ENABLED)
      setRemark('')
    }
  }, [open, code])

  const maxUsesParsed = Number.parseInt(maxUses, 10)
  const usesValid = Number.isInteger(maxUsesParsed) && maxUsesParsed >= 0
  const canSubmit = usesValid

  const submit = async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    const expires = expiresAt ? Math.floor(expiresAt.getTime() / 1000) : 0
    try {
      if (isEdit && code) {
        const payload = {
          max_uses: maxUsesParsed,
          expires_at: expires,
          status,
          remark: remark.trim(),
        }
        const res =
          mode === 'admin'
            ? await updateAdminInviteCode(code.id, payload)
            : await updateMyInviteCode(code.id, payload)
        if (!res.success) {
          toast.error(res.message || t('Failed to save'))
          return
        }
        toast.success(t('Code updated'))
      } else {
        const payload = {
          max_uses: maxUsesParsed,
          expires_at: expires,
          remark: remark.trim(),
        }
        const res =
          mode === 'admin'
            ? await createAdminInviteCode(payload)
            : await createMyInviteCode(payload)
        if (!res.success) {
          toast.error(res.message || t('Failed to create'))
          return
        }
        toast.success(t('Code created'))
      }
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: [queryKey] })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[480px]'>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('Edit Invite Code') : t('Create Invite Code')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'Anyone who registers with this code is bound to its owner. A code issued by an agent also limits that user to the models the agent is authorized for.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label>{t('Max Uses')}</Label>
            <Input
              type='number'
              min={0}
              step={1}
              value={maxUses}
              onChange={(event) => setMaxUses(event.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              {t('0 means unlimited uses.')}
            </p>
          </div>

          <div className='space-y-2'>
            <Label>{t('Expiration Time')}</Label>
            <DateTimePicker
              value={expiresAt}
              onChange={setExpiresAt}
              placeholder={t('Never expires')}
            />
          </div>

          {isEdit ? (
            <div className='space-y-2'>
              <Label>{t('Status')}</Label>
              <div className='flex gap-2'>
                <Button
                  type='button'
                  variant={
                    status === INVITE_CODE_STATUS.ENABLED
                      ? 'default'
                      : 'outline'
                  }
                  size='sm'
                  onClick={() => setStatus(INVITE_CODE_STATUS.ENABLED)}
                >
                  {t('Enabled')}
                </Button>
                <Button
                  type='button'
                  variant={
                    status === INVITE_CODE_STATUS.DISABLED
                      ? 'default'
                      : 'outline'
                  }
                  size='sm'
                  onClick={() => setStatus(INVITE_CODE_STATUS.DISABLED)}
                >
                  {t('Disabled')}
                </Button>
              </div>
            </div>
          ) : null}

          <div className='space-y-2'>
            <Label>{t('Remark')}</Label>
            <Textarea
              rows={2}
              maxLength={255}
              placeholder={t('Optional remark')}
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant='outline'
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button
            disabled={isSubmitting || !canSubmit}
            onClick={() => void submit()}
          >
            {isSubmitting ? t('Saving...') : t('Confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
