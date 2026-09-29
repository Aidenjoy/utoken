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
import type { Organization } from '@/features/organization/types'
import { updateAdminOrganizationTokenRate } from '@/features/organizations/api'

const MIN_RATE = 0.1
const MAX_RATE = 100

type Props = {
  open: boolean
  organization: Organization | null
  onOpenChange: (open: boolean) => void
}

/**
 * Set an enterprise's token consumption rate. Saving overwrites the personal
 * rate of every member (last setting wins); later joins inherit it too.
 */
export function SetOrgTokenRateDialog({
  open,
  organization,
  onOpenChange,
}: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [rate, setRate] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      const current = organization?.token_rate ?? 0
      setRate(current > 0 ? String(current) : '')
    }
  }, [open, organization])

  const parsed = Number.parseFloat(rate)
  const isValid =
    rate.trim() !== '' &&
    Number.isFinite(parsed) &&
    parsed >= MIN_RATE &&
    parsed <= MAX_RATE

  const submit = async () => {
    if (!organization || !isValid) return
    setIsSubmitting(true)
    try {
      const result = await updateAdminOrganizationTokenRate(
        organization.id,
        parsed
      )
      if (!result.success) {
        toast.error(result.message || t('Failed to update token rate'))
        return
      }
      toast.success(t('Token rate updated'))
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: ['org-token-rates'] })
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
            {t('Organization: {{name}}', {
              name: organization?.display_name || organization?.name || '',
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
              placeholder='1.2'
              value={rate}
              onChange={(event) => setRate(event.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              {t(
                'Saving overwrites the personal token rate of every member in this organization.'
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
