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
import { createMyEnterprise, updateMyEnterprise } from '@/features/agents/api'
import type { AgentOrganization } from '@/features/agents/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null/undefined = create mode; an enterprise = edit mode. */
  enterprise?: AgentOrganization | null
  onSuccess?: () => void
}

/**
 * Create or edit an enterprise this agent develops. Both modes expose exactly
 * two fields: the identifier (normalized server-side to lowercase
 * letters/digits/_/-, 2-64 chars, globally unique) and the optional display
 * name. Group, pool funding, enterprise discounts and wallet policy are left
 * out on purpose — they either have their own entry point or belong to the
 * system administrator, and saving them overwrites every member's billing
 * fields, so they must not ride along in a general edit form.
 *
 * On create the server binds the new org to this agent and syncs attribution;
 * the pool starts at 0 and members are added afterwards, one of whom is
 * promoted to admin from the member list.
 */
export function EnterpriseMutateDialog({
  open,
  onOpenChange,
  enterprise,
  onSuccess,
}: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isEdit = enterprise != null

  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(enterprise?.name ?? '')
    setDisplayName(enterprise?.display_name ?? '')
  }, [open, enterprise])

  // Identifier is required and at least 2 chars. Display name is optional.
  const canSubmit = name.trim().length >= 2

  const submit = async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    const failureMessage = isEdit
      ? t('Failed to update enterprise')
      : t('Failed to create')
    const payload = {
      name: name.trim(),
      display_name: displayName.trim(),
    }
    try {
      const result = isEdit
        ? await updateMyEnterprise(enterprise.id, payload)
        : await createMyEnterprise(payload)
      if (!result.success) {
        toast.error(result.message || failureMessage)
        return
      }
      toast.success(
        isEdit ? t('Updated successfully') : t('Enterprise created')
      )
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: ['my-agent-enterprises'] })
      onSuccess?.()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : failureMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[480px]'>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('Edit Enterprise') : t('Create Enterprise')}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? t('Only the identifier and display name can be edited.')
              : t(
                  'The enterprise starts with an empty pool and is bound to you. Add members afterwards and promote one of them to admin.'
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
              {t(
                'Lowercase letters, digits, underscore or hyphen. 2-64 chars.'
              )}
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
