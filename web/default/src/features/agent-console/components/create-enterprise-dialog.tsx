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
import { createMyEnterprise } from '@/features/agents/api'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

/**
 * Create an enterprise this agent develops. The identifier is normalized
 * server-side (lowercased, letters/digits/_/- only, 2-64 chars) and must be
 * globally unique; the display name is optional. An existing user is named as
 * the enterprise admin — the initial pool is always 0, since funding is added
 * later by an admin offline or by the enterprise admin's own online top-up.
 * On success the server binds the new org to this agent and syncs attribution.
 */
export function CreateEnterpriseDialog({
  open,
  onOpenChange,
  onSuccess,
}: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [ownerUsername, setOwnerUsername] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setName('')
    setDisplayName('')
    setOwnerUsername('')
  }, [open])

  // Identifier is required and at least 2 chars; the admin username is required
  // so the enterprise always has an owner. Display name is optional.
  const nameValid = name.trim().length >= 2
  const ownerValid = ownerUsername.trim().length > 0
  const canSubmit = nameValid && ownerValid

  const submit = async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      const result = await createMyEnterprise({
        name: name.trim(),
        display_name: displayName.trim() || undefined,
        owner_username: ownerUsername.trim(),
      })
      if (!result.success) {
        toast.error(result.message || t('Failed to create'))
        return
      }
      toast.success(t('Enterprise created'))
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: ['my-agent-enterprises'] })
      onSuccess?.()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('Failed to create'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[480px]'>
        <DialogHeader>
          <DialogTitle>{t('Create Enterprise')}</DialogTitle>
          <DialogDescription>
            {t(
              'The enterprise starts with an empty pool and is bound to you. Name an existing user as its admin.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label>{t('Identifier')}</Label>
            <Input
              value={name}
              maxLength={64}
              placeholder={t('e.g. acme-team')}
              onChange={(event) => setName(event.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              {t('Lowercase letters, digits, underscore or hyphen. 2-64 chars.')}
            </p>
          </div>

          <div className='space-y-2'>
            <Label>{t('Display Name')}</Label>
            <Input
              value={displayName}
              maxLength={128}
              placeholder={t('Optional display name')}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>

          <div className='space-y-2'>
            <Label>{t('Admin Username')}</Label>
            <Input
              value={ownerUsername}
              maxLength={64}
              placeholder={t('Existing username')}
              onChange={(event) => setOwnerUsername(event.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              {t('This user becomes the enterprise admin and can top up the pool.')}
            </p>
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
