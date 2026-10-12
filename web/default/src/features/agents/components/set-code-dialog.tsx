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
import { formatDiscount } from '@/lib/discount'

import {
  createAdminCode,
  createMyCode,
  updateAdminCode,
  updateMyCode,
} from '../api'
import { DISCOUNT_CODE_STATUS, type DiscountCode } from '../types'

type Props = {
  open: boolean
  code: DiscountCode | null
  onOpenChange: (open: boolean) => void
  /** 'admin' has no discount-range restriction; 'agent' is clamped to `range`. */
  mode: 'admin' | 'agent'
  /** Agent-only allowed discount range (pay multipliers). */
  range?: { min: number; max: number }
  /** Query key invalidated after a successful mutation. */
  queryKey: string
}

/**
 * Create or edit a discount invite code. `discount` is a pay multiplier in
 * (0, 1]: 0.6 means the invitee pays 60%. Admins may set any value; agents are
 * clamped to their allowed range. `max_uses` of 0 means unlimited, `expires_at`
 * of 0 means never expires.
 */
export function SetCodeDialog({
  open,
  code,
  onOpenChange,
  mode,
  range,
  queryKey,
}: Props) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const isEdit = code !== null

  const [discount, setDiscount] = useState('0.8')
  const [maxUses, setMaxUses] = useState('0')
  const [expiresAt, setExpiresAt] = useState<Date | undefined>(undefined)
  const [status, setStatus] = useState<number>(DISCOUNT_CODE_STATUS.ENABLED)
  const [remark, setRemark] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    if (code) {
      setDiscount(String(code.discount))
      setMaxUses(String(code.max_uses ?? 0))
      setExpiresAt(code.expires_at > 0 ? new Date(code.expires_at * 1000) : undefined)
      setStatus(code.status)
      setRemark(code.remark ?? '')
    } else {
      setDiscount(mode === 'agent' && range ? String(range.min) : '0.8')
      setMaxUses('0')
      setExpiresAt(undefined)
      setStatus(DISCOUNT_CODE_STATUS.ENABLED)
      setRemark('')
    }
  }, [open, code, mode, range])

  const discountParsed = Number.parseFloat(discount)
  const maxUsesParsed = Number.parseInt(maxUses, 10)
  const lowerBound = mode === 'agent' && range ? range.min : 0.01
  const upperBound = mode === 'agent' && range ? range.max : 1
  const discountValid =
    Number.isFinite(discountParsed) &&
    discountParsed >= lowerBound &&
    discountParsed <= upperBound
  const usesValid = Number.isInteger(maxUsesParsed) && maxUsesParsed >= 0
  // 编辑时折扣只读（创建后锁定），故不因折扣校验阻断保存。
  const canSubmit = usesValid && (isEdit || discountValid)

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
            ? await updateAdminCode(code.id, payload)
            : await updateMyCode(code.id, payload)
        if (!res.success) {
          toast.error(res.message || t('Failed to save'))
          return
        }
        toast.success(t('Code updated'))
      } else {
        const payload = {
          discount: discountParsed,
          max_uses: maxUsesParsed,
          expires_at: expires,
          remark: remark.trim(),
        }
        const res =
          mode === 'admin'
            ? await createAdminCode(payload)
            : await createMyCode(payload)
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
            {isEdit ? t('Edit Discount Code') : t('Create Discount Code')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'Discount is the payment multiplier: 0.6 means the invitee pays 60%. Invitees keep this discount on every future recharge.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label>{t('Discount (multiplier)')}</Label>
            <Input
              type='number'
              min={lowerBound}
              max={upperBound}
              step={0.01}
              value={discount}
              disabled={isEdit}
              onChange={(event) => setDiscount(event.target.value)}
            />
            {isEdit ? (
              <p className='text-muted-foreground text-xs'>
                {t(
                  'The discount is fixed after creation. Create a new code for a different discount.'
                )}
              </p>
            ) : (
              <p className='text-muted-foreground text-xs'>
                {discountValid
                  ? t('Invitee pays: {{value}}', {
                      value: formatDiscount(discountParsed, i18n.language, t),
                    })
                  : t('Require {{min}} ≤ discount ≤ {{max}}', {
                      min: lowerBound,
                      max: upperBound,
                    })}
              </p>
            )}
          </div>

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
                    status === DISCOUNT_CODE_STATUS.ENABLED
                      ? 'default'
                      : 'outline'
                  }
                  size='sm'
                  onClick={() => setStatus(DISCOUNT_CODE_STATUS.ENABLED)}
                >
                  {t('Enabled')}
                </Button>
                <Button
                  type='button'
                  variant={
                    status === DISCOUNT_CODE_STATUS.DISABLED
                      ? 'default'
                      : 'outline'
                  }
                  size='sm'
                  onClick={() => setStatus(DISCOUNT_CODE_STATUS.DISABLED)}
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
