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
import { inviteMember } from '@/features/agents/api'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

/**
 * Invite an existing individual user to become this agent's member by username.
 * This is the manual equivalent of registering with the agent's invite code: it
 * binds the user to the agent and confines them to the agent's authorized
 * models. Enterprise members follow their organization and cannot be invited
 * here, and a user already bound to another agent cannot be poached. The
 * server rejects both cases.
 */
export function MemberInviteDialog({ open, onOpenChange, onSuccess }: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [username, setUsername] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setUsername('')
  }, [open])

  const trimmed = username.trim()
  const canSubmit = trimmed.length > 0

  const submit = async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      const result = await inviteMember(trimmed)
      if (!result.success) {
        toast.error(result.message || t('Failed to invite member'))
        return
      }
      toast.success(t('Member invited'))
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: ['my-agent-members'] })
      onSuccess?.()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('Failed to invite member'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[440px]'>
        <DialogHeader>
          <DialogTitle>{t('Invite Member')}</DialogTitle>
          <DialogDescription>
            {t(
              'Bind an existing individual user to you by username. They will be limited to your authorized models.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-2'>
          <Label>{t('Username')}</Label>
          <Input
            value={username}
            maxLength={64}
            autoFocus
            placeholder={t('Existing username')}
            onChange={(event) => setUsername(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit && !isSubmitting) {
                event.preventDefault()
                void submit()
              }
            }}
          />
          <p className='text-muted-foreground text-xs'>
            {t(
              'Enterprise members and users bound to another agent cannot be invited.'
            )}
          </p>
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
