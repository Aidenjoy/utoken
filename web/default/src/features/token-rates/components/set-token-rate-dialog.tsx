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
import { updateUserTokenRate } from '@/features/users/api'
import type { User } from '@/features/users/types'

const MIN_RATE = 0.1
const MAX_RATE = 100

type Props = {
  open: boolean
  user: User | null
  onOpenChange: (open: boolean) => void
}

/**
 * Set a user's token consumption rate. The rate multiplies the tokens reported
 * by seedance video tasks before billing, so 1.5 charges 1.5x the upstream
 * tokens. It does not touch the pricing system itself.
 */
export function SetTokenRateDialog({ open, user, onOpenChange }: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [rate, setRate] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      const current = user?.token_rate ?? 0
      setRate(current > 0 ? String(current) : '')
    }
  }, [open, user])

  const parsed = Number.parseFloat(rate)
  const isValid =
    rate.trim() !== '' &&
    Number.isFinite(parsed) &&
    parsed >= MIN_RATE &&
    parsed <= MAX_RATE

  const submit = async () => {
    if (!user || !isValid) return
    setIsSubmitting(true)
    try {
      const result = await updateUserTokenRate(user.id, parsed)
      if (!result.success) {
        toast.error(result.message || t('Failed to update token rate'))
        return
      }
      toast.success(t('Token rate updated'))
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: ['token-rates'] })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[440px]'>
        <DialogHeader>
          <DialogTitle>{t('Set Token Rate')}</DialogTitle>
          <DialogDescription>
            {t('User: {{name}}', {
              name: user?.display_name || user?.username || '',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label>{t('Token Rate')}</Label>
            <Input
              type='number'
              min={MIN_RATE}
              max={MAX_RATE}
              step='0.1'
              placeholder='1.5'
              value={rate}
              onChange={(event) => setRate(event.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              {t(
                'Tokens consumed by this user are multiplied by this rate. Leave the pricing system unchanged.'
              )}
            </p>
          </div>
          {rate.trim() !== '' && !isValid ? (
            <p className='text-destructive text-xs'>
              {t('Rate must be between {{min}} and {{max}}', {
                min: MIN_RATE,
                max: MAX_RATE,
              })}
            </p>
          ) : null}
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
            disabled={isSubmitting || !isValid}
            onClick={() => void submit()}
          >
            {isSubmitting ? t('Saving...') : t('Confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
