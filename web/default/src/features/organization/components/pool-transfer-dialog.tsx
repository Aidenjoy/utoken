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
import { useCallback, useEffect, useState } from 'react'
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
import { getSelf } from '@/lib/api'
import {
  formatQuota,
  parseQuotaFromDollars,
  quotaUnitsToDollars,
} from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

import { transferWalletToPool } from '../api'
import { useOrganization } from './organization-context'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * One-way personal wallet → organization pool transfer, for organization
 * admins. The wallet balance is re-read every time the dialog opens so the
 * amount ceiling and the sidebar balance share one fresh source; the backend
 * re-validates against the locked row regardless.
 */
export function PoolTransferDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation()
  const { summary, triggerRefresh } = useOrganization()
  const setUser = useAuthStore((state) => state.auth.setUser)
  const walletQuota = useAuthStore((state) => state.auth.user?.quota ?? 0)
  const [amount, setAmount] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  const refreshWallet = useCallback(async () => {
    try {
      const self = await getSelf()
      if (self?.success && self.data) {
        setUser(self.data)
      }
    } catch {
      // Keep the cached balance; the transfer is still bounded server-side.
    }
  }, [setUser])

  useEffect(() => {
    if (open) {
      void refreshWallet()
    }
  }, [open, refreshWallet])

  const poolQuota = summary?.pool_quota ?? 0
  const transferQuota = parseQuotaFromDollars(amount)
  const exceedsWallet = transferQuota > walletQuota
  const canSubmit = transferQuota > 0 && !exceedsWallet && !submitting

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const result = await transferWalletToPool(transferQuota)
      if (!result.success) {
        toast.error(result.message || t('Transfer failed'))
        return
      }
      toast.success(t('Transferred to the organization pool'))
      onOpenChange(false)
      setAmount(0)
      triggerRefresh()
      await refreshWallet()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value)
        if (!value) setAmount(0)
      }}
    >
      <DialogContent className='sm:max-w-[460px]'>
        <DialogHeader>
          <DialogTitle>{t('Transfer to Organization Pool')}</DialogTitle>
          <DialogDescription>
            {t(
              'Move balance from your personal wallet into the organization pool. The transfer is one-way and cannot be undone.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='flex items-center justify-between rounded-lg border p-3 text-sm'>
            <span className='text-muted-foreground'>{t('Wallet Balance')}</span>
            <span className='font-medium tabular-nums'>
              {formatQuota(walletQuota)}
            </span>
          </div>
          <div className='flex items-center justify-between rounded-lg border p-3 text-sm'>
            <span className='text-muted-foreground'>{t('Pool Balance')}</span>
            <span className='font-medium tabular-nums'>
              {formatQuota(poolQuota)}
            </span>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='pool-transfer-amount'>{t('Transfer Amount')}</Label>
            <div className='flex gap-2'>
              <Input
                id='pool-transfer-amount'
                type='number'
                min={0}
                step='any'
                value={Number.isFinite(amount) ? amount : ''}
                onChange={(event) => setAmount(event.target.valueAsNumber || 0)}
              />
              <Button
                type='button'
                variant='outline'
                className='shrink-0'
                onClick={() => setAmount(quotaUnitsToDollars(walletQuota))}
              >
                {t('All')}
              </Button>
            </div>
            {exceedsWallet ? (
              <p className='text-destructive text-xs'>
                {t('The amount cannot exceed your wallet balance')}
              </p>
            ) : null}
          </div>

          <div className='flex items-center justify-between rounded-lg border p-3 text-sm'>
            <span className='text-muted-foreground'>
              {t('New Pool Balance')}
            </span>
            <span className='font-medium tabular-nums'>
              {formatQuota(poolQuota + Math.max(transferQuota, 0))}
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t('Cancel')}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting ? t('Transferring...') : t('Confirm Transfer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
