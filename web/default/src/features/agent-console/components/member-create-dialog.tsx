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
import { createMember } from '@/features/agents/api'
import { ORG_VALIDATION } from '@/features/organization/constants'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

/**
 * Add an individual member by creating a new account for them. The account is
 * bound to this agent from the moment it exists, so it can only call the
 * agent's authorized models and is priced by the per-model discounts the agent
 * sets for it later; its personal wallet starts empty.
 *
 * There is deliberately no "bind an existing user" field here: agent
 * attribution is a permission, and only a system administrator may attach an
 * existing user (from the user list). Letting an agent claim existing accounts
 * would let them pull another party's customer, discounts and all, under their
 * own name.
 */
export function MemberCreateDialog({ open, onOpenChange, onSuccess }: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setUsername('')
    setPassword('')
    setDisplayName('')
    setEmail('')
  }, [open])

  const passwordLength = password.length
  const canSubmit =
    username.trim().length > 0 &&
    passwordLength >= ORG_VALIDATION.PASSWORD_MIN_LENGTH &&
    passwordLength <= ORG_VALIDATION.PASSWORD_MAX_LENGTH

  const submit = async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      const result = await createMember({
        username: username.trim(),
        password,
        display_name: displayName.trim() || undefined,
        email: email.trim() || undefined,
      })
      if (!result.success) {
        toast.error(result.message || t('Failed to create member'))
        return
      }
      toast.success(t('Member created'))
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: ['my-agent-members'] })
      onSuccess?.()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('Failed to create member'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[440px]'>
        <DialogHeader>
          <DialogTitle>{t('Add Member')}</DialogTitle>
          <DialogDescription>
            {t(
              'Create a new account bound to you. It is limited to your authorized models and starts with an empty wallet.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label>{t('Username')}</Label>
            <Input
              value={username}
              maxLength={64}
              autoFocus
              autoComplete='off'
              placeholder={t('Enter username')}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>

          <div className='space-y-2'>
            <Label>{t('Password')}</Label>
            <Input
              value={password}
              type='password'
              autoComplete='new-password'
              onChange={(event) => setPassword(event.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              {t('{{min}}-{{max}} characters', {
                min: ORG_VALIDATION.PASSWORD_MIN_LENGTH,
                max: ORG_VALIDATION.PASSWORD_MAX_LENGTH,
              })}
            </p>
          </div>

          <div className='space-y-2'>
            <Label>{t('Display Name')}</Label>
            <Input
              value={displayName}
              maxLength={64}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              {t('Defaults to the username when left empty')}
            </p>
          </div>

          <div className='space-y-2'>
            <Label>{t('Email')}</Label>
            <Input
              value={email}
              type='email'
              autoComplete='off'
              onChange={(event) => setEmail(event.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              {t(
                'Existing users can only be bound to you by a system administrator.'
              )}
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
            {isSubmitting ? t('Processing...') : t('Confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
