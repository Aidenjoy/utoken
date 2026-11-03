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
import { useEffect, useMemo, useState } from 'react'
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createMemberWithEnterprise } from '@/features/agents/api'
import {
  ORG_VALIDATION,
  getOrgRoleOptions,
} from '@/features/organization/constants'
import { ORG_ROLE, type OrgRole } from '@/features/organization/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

/**
 * Shortcut for agents whose customers are always enterprises: create the
 * enterprise and its first member in one step, instead of creating the
 * enterprise and then opening it to add a member. The two extra fields over
 * "Add Member" are the enterprise identifier and display name, plus an
 * enterprise-role dropdown (defaults to admin, since the first member usually
 * runs the enterprise).
 *
 * The server creates the enterprise bound to this agent, then the member inside
 * it; it pre-validates the member before writing and rolls the fresh enterprise
 * back if the member creation still fails, so nothing half-created is left
 * behind. Both the enterprise list and the member list are refreshed on success.
 */
export function EnterpriseMemberCreateDialog({
  open,
  onOpenChange,
  onSuccess,
}: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const roleOptions = useMemo(() => getOrgRoleOptions(t), [t])

  const [orgName, setOrgName] = useState('')
  const [orgDisplayName, setOrgDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [orgRole, setOrgRole] = useState<OrgRole>(ORG_ROLE.ADMIN)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setOrgName('')
    setOrgDisplayName('')
    setUsername('')
    setPassword('')
    setDisplayName('')
    setEmail('')
    setOrgRole(ORG_ROLE.ADMIN)
  }, [open])

  const passwordLength = password.length
  const canSubmit =
    orgName.trim().length >= ORG_VALIDATION.NAME_MIN_LENGTH &&
    username.trim().length > 0 &&
    passwordLength >= ORG_VALIDATION.PASSWORD_MIN_LENGTH &&
    passwordLength <= ORG_VALIDATION.PASSWORD_MAX_LENGTH

  const submit = async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      const result = await createMemberWithEnterprise({
        org: {
          name: orgName.trim(),
          display_name: orgDisplayName.trim() || undefined,
        },
        member: {
          username: username.trim(),
          password,
          display_name: displayName.trim() || undefined,
          email: email.trim() || undefined,
          org_role: orgRole,
        },
      })
      if (!result.success) {
        toast.error(result.message || t('Failed to create enterprise member'))
        return
      }
      toast.success(t('Enterprise member created'))
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: ['my-agent-members'] })
      void queryClient.invalidateQueries({ queryKey: ['my-agent-enterprises'] })
      onSuccess?.()
    } catch (e: unknown) {
      toast.error(
        e instanceof Error ? e.message : t('Failed to create enterprise member')
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[480px]'>
        <DialogHeader>
          <DialogTitle>{t('Add Enterprise Member')}</DialogTitle>
          <DialogDescription>
            {t(
              'Create a new enterprise bound to you and add this account as its first member in one step.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label>{t('Enterprise Identifier')}</Label>
            <Input
              value={orgName}
              maxLength={ORG_VALIDATION.NAME_MAX_LENGTH}
              autoFocus
              autoComplete='off'
              placeholder={t('e.g. acme-team')}
              onChange={(event) => setOrgName(event.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              {t(
                'Lowercase letters, digits, underscore or hyphen. 2-64 chars.'
              )}
            </p>
          </div>

          <div className='space-y-2'>
            <Label>{t('Enterprise Display Name')}</Label>
            <Input
              value={orgDisplayName}
              maxLength={ORG_VALIDATION.DISPLAY_NAME_MAX_LENGTH}
              autoComplete='off'
              placeholder={t('Optional display name')}
              onChange={(event) => setOrgDisplayName(event.target.value)}
            />
          </div>

          <div className='space-y-2'>
            <Label>{t('Username')}</Label>
            <Input
              value={username}
              maxLength={64}
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

          <div className='space-y-2'>
            <Label>{t('Organization Role')}</Label>
            <Select
              items={roleOptions}
              value={orgRole}
              onValueChange={(value) => setOrgRole(value as OrgRole)}
            >
              <SelectTrigger className='w-full'>
                <SelectValue placeholder={t('Select')} />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {roleOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
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
