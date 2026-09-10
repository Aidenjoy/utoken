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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Organization } from '@/features/organization/types'
import { formatQuota, parseQuotaFromDollars } from '@/lib/format'

import { adjustAdminOrganizationQuota } from '../api'
import {
  ORG_ADMIN_ERROR_MESSAGES,
  ORG_ADMIN_SUCCESS_MESSAGES,
} from '../constants'

const INCREASE = 'increase'
const DEDUCT = 'deduct'

type Props = {
  open: boolean
  organization: Organization | null
  onOpenChange: (open: boolean) => void
}

/**
 * Pool top-up / adjustment. The backend takes a signed delta and rejects one
 * that would push the balance below zero, so the amount is entered as a
 * positive number plus an explicit direction and previewed before submitting.
 */
export function OrganizationQuotaDialog({
  open,
  organization,
  onOpenChange,
}: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [direction, setDirection] = useState(INCREASE)
  const [amount, setAmount] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const currentQuota = organization?.quota ?? 0
  const delta =
    direction === DEDUCT
      ? -parseQuotaFromDollars(amount)
      : parseQuotaFromDollars(amount)
  const nextQuota = currentQuota + delta
  const wouldGoNegative = nextQuota < 0

  const reset = () => {
    setDirection(INCREASE)
    setAmount(0)
  }

  const submit = async () => {
    if (!organization || delta === 0 || wouldGoNegative) return
    setIsSubmitting(true)
    try {
      const result = await adjustAdminOrganizationQuota(organization.id, delta)
      if (!result.success) {
        toast.error(result.message || t(ORG_ADMIN_ERROR_MESSAGES.QUOTA_FAILED))
        return
      }
      toast.success(t(ORG_ADMIN_SUCCESS_MESSAGES.QUOTA_ADJUSTED))
      onOpenChange(false)
      reset()
      void queryClient.invalidateQueries({ queryKey: ['admin-organizations'] })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value)
        if (!value) reset()
      }}
    >
      <DialogContent className='sm:max-w-[440px]'>
        <DialogHeader>
          <DialogTitle>{t('Adjust Pool Quota')}</DialogTitle>
          <DialogDescription>
            {t('Organization: {{name}}', {
              name: organization?.display_name || organization?.name || '',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='flex items-center justify-between rounded-lg border p-3 text-sm'>
            <span className='text-muted-foreground'>
              {t('Current Balance')}
            </span>
            <span className='font-medium tabular-nums'>
              {formatQuota(currentQuota)}
            </span>
          </div>

          <div className='space-y-2'>
            <Label>{t('Direction')}</Label>
            <Select
              value={direction}
              onValueChange={(value) => setDirection(value ?? INCREASE)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectItem value={INCREASE}>{t('Increase')}</SelectItem>
                <SelectItem value={DEDUCT}>{t('Deduct')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className='space-y-2'>
            <Label>{t('Amount')}</Label>
            <Input
              type='number'
              min={0}
              step='any'
              value={Number.isFinite(amount) ? amount : ''}
              onChange={(event) => setAmount(event.target.valueAsNumber || 0)}
            />
          </div>

          <div className='flex items-center justify-between rounded-lg border p-3 text-sm'>
            <span className='text-muted-foreground'>{t('New Balance')}</span>
            <span
              className={
                wouldGoNegative
                  ? 'text-destructive font-medium tabular-nums'
                  : 'font-medium tabular-nums'
              }
            >
              {formatQuota(nextQuota)}
            </span>
          </div>
          {wouldGoNegative ? (
            <p className='text-destructive text-xs'>
              {t('The balance cannot go below zero.')}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant='outline'
            disabled={isSubmitting}
            onClick={() => {
              onOpenChange(false)
              reset()
            }}
          >
            {t('Cancel')}
          </Button>
          <Button
            disabled={isSubmitting || delta === 0 || wouldGoNegative}
            onClick={() => void submit()}
          >
            {isSubmitting ? t('Saving...') : t('Confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
