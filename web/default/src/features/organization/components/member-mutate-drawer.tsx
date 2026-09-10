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
import { zodResolver } from '@hookform/resolvers/zod'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import {
  SideDrawerSection,
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import {
  formatQuota,
  parseQuotaFromDollars,
  quotaUnitsToDollars,
} from '@/lib/format'

import { createOrgMember, inviteOrgMember, updateOrgMember } from '../api'
import {
  ORG_ERROR_MESSAGES,
  ORG_SUCCESS_MESSAGES,
  ORG_VALIDATION,
  getOrgRoleOptions,
} from '../constants'
import { ORG_MEMBER_STATUS, ORG_ROLE, type OrgMemberDetail } from '../types'
import { useOptionalOrganization } from './organization-context'

export type MemberDrawerMode = 'create' | 'invite' | 'edit'

const FAILURE_MESSAGE_BY_MODE: Record<MemberDrawerMode, string> = {
  create: ORG_ERROR_MESSAGES.MEMBER_CREATE_FAILED,
  invite: ORG_ERROR_MESSAGES.MEMBER_INVITE_FAILED,
  edit: ORG_ERROR_MESSAGES.MEMBER_UPDATE_FAILED,
}

const SUCCESS_MESSAGE_BY_MODE: Record<MemberDrawerMode, string> = {
  create: ORG_SUCCESS_MESSAGES.MEMBER_CREATED,
  invite: ORG_SUCCESS_MESSAGES.MEMBER_INVITED,
  edit: ORG_SUCCESS_MESSAGES.MEMBER_UPDATED,
}

/**
 * Sub-quota is entered in the configured display currency and converted to
 * quota units with `parseQuotaFromDollars`, mirroring `features/users`.
 * `0` means unlimited, matching `OrgMember.QuotaLimit`.
 */
const memberFormSchema = z.object({
  username: z.string().trim(),
  password: z.string(),
  display_name: z.string().trim(),
  email: z.string().trim(),
  org_role: z.enum([ORG_ROLE.ADMIN, ORG_ROLE.MEMBER]),
  quota_amount: z.number().min(0),
  enabled: z.boolean(),
})

type MemberFormInput = z.input<typeof memberFormSchema>
type MemberFormValues = z.output<typeof memberFormSchema>

const EMPTY_DEFAULTS: MemberFormInput = {
  username: '',
  password: '',
  display_name: '',
  email: '',
  org_role: ORG_ROLE.MEMBER,
  quota_amount: 0,
  enabled: true,
}

type Props = {
  open: boolean
  mode: MemberDrawerMode
  member: OrgMemberDetail | null
  onOpenChange: (open: boolean) => void
  /**
   * 系统管理员代管某企业时传入目标企业 ID（后端按 org_id 查询参数定位）；
   * 企业管理员操作本企业时留空。
   */
  orgId?: number
  /** 无 OrganizationProvider 时（代管场景）由调用方提供刷新回调。 */
  onRefresh?: () => void
}

const MODE_TITLES: Record<MemberDrawerMode, string> = {
  create: 'Create Member',
  invite: 'Add Existing User',
  edit: 'Edit Member',
}

const MODE_DESCRIPTIONS: Record<MemberDrawerMode, string> = {
  create:
    'Create a new account inside your organization. It signs in as a regular user and consumes the shared pool.',
  invite:
    'Add an existing user to your organization. A user can only belong to one organization at a time.',
  edit: 'Adjust the member sub-quota, organization role and enabled state.',
}

export function MemberMutateDrawer({
  open,
  mode,
  member,
  onOpenChange,
  orgId,
  onRefresh,
}: Props) {
  const { t } = useTranslation()
  const orgContext = useOptionalOrganization()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const roleOptions = useMemo(() => getOrgRoleOptions(t), [t])

  const form = useForm<MemberFormInput, unknown, MemberFormValues>({
    resolver: zodResolver(memberFormSchema),
    defaultValues: EMPTY_DEFAULTS,
  })

  useEffect(() => {
    if (!open) return
    if (mode !== 'edit' || !member) {
      form.reset(EMPTY_DEFAULTS)
      return
    }
    form.reset({
      ...EMPTY_DEFAULTS,
      username: member.username,
      display_name: member.display_name,
      email: member.email,
      org_role:
        member.org_role === ORG_ROLE.ADMIN ? ORG_ROLE.ADMIN : ORG_ROLE.MEMBER,
      // Show the limit in the same unit the admin typed it in.
      quota_amount:
        member.quota_limit > 0 ? quotaUnitsToDollars(member.quota_limit) : 0,
      enabled: member.status === ORG_MEMBER_STATUS.ENABLED,
    })
  }, [open, mode, member, form])

  const quotaAmount = form.watch('quota_amount')
  const isEdit = mode === 'edit'
  const isCreate = mode === 'create'

  const onSubmit = async (values: MemberFormValues) => {
    setIsSubmitting(true)
    try {
      const quotaLimit = parseQuotaFromDollars(values.quota_amount)
      let result
      if (mode === 'create') {
        result = await createOrgMember(
          {
            username: values.username,
            password: values.password,
            display_name: values.display_name || undefined,
            email: values.email || undefined,
            org_role: values.org_role,
            quota_limit: quotaLimit,
          },
          orgId
        )
      } else if (mode === 'invite') {
        result = await inviteOrgMember(
          {
            username: values.username,
            org_role: values.org_role,
            quota_limit: quotaLimit,
          },
          orgId
        )
      } else if (member) {
        result = await updateOrgMember(
          member.id,
          {
            org_role: values.org_role,
            quota_limit: quotaLimit,
            status: values.enabled
              ? ORG_MEMBER_STATUS.ENABLED
              : ORG_MEMBER_STATUS.DISABLED,
          },
          orgId
        )
      }
      if (!result || !result.success) {
        toast.error(result?.message || t(FAILURE_MESSAGE_BY_MODE[mode]))
        return
      }
      toast.success(t(SUCCESS_MESSAGE_BY_MODE[mode]))
      onOpenChange(false)
      if (onRefresh) {
        onRefresh()
      } else {
        orgContext?.triggerRefresh()
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    void form.handleSubmit(onSubmit)(event)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value)
        if (!value) form.reset(EMPTY_DEFAULTS)
      }}
    >
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[560px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>{t(MODE_TITLES[mode])}</SheetTitle>
          <SheetDescription>{t(MODE_DESCRIPTIONS[mode])}</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            id='org-member-form'
            onSubmit={handleSubmit}
            className={sideDrawerFormClassName()}
          >
            <SideDrawerSection>
              {!isEdit && (
                <FormField
                  control={form.control}
                  name='username'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Username')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          autoComplete='off'
                          placeholder={t('Enter username')}
                        />
                      </FormControl>
                      {mode === 'invite' && (
                        <FormDescription>
                          {t(
                            'The account must already exist and belong to no organization.'
                          )}
                        </FormDescription>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {isEdit && (
                <FormItem>
                  <FormLabel>{t('Username')}</FormLabel>
                  <Input value={member?.username ?? ''} disabled />
                </FormItem>
              )}

              {isCreate && (
                <>
                  <FormField
                    control={form.control}
                    name='password'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Password')}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type='password'
                            autoComplete='new-password'
                          />
                        </FormControl>
                        <FormDescription>
                          {t('{{min}}-{{max}} characters', {
                            min: ORG_VALIDATION.PASSWORD_MIN_LENGTH,
                            max: ORG_VALIDATION.PASSWORD_MAX_LENGTH,
                          })}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='display_name'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Display Name')}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormDescription>
                          {t('Defaults to the username when left empty')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='email'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Email')}</FormLabel>
                        <FormControl>
                          <Input {...field} type='email' autoComplete='off' />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              <FormField
                control={form.control}
                name='org_role'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Organization Role')}</FormLabel>
                    <Select
                      items={roleOptions}
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger className='w-full'>
                          <SelectValue placeholder={t('Select')} />
                        </SelectTrigger>
                      </FormControl>
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
                    <FormDescription>
                      {t(
                        'Organization admins manage members and settings inside this organization only.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='quota_amount'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Sub-quota Limit')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={0}
                        step='any'
                        value={Number.isFinite(field.value) ? field.value : ''}
                        onChange={(event) =>
                          field.onChange(event.target.valueAsNumber || 0)
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      {quotaAmount > 0
                        ? `${t('Equivalent to')} ${formatQuota(
                            parseQuotaFromDollars(quotaAmount)
                          )} · ${t('0 means unlimited')}`
                        : t('0 means unlimited')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {isEdit && (
                <FormField
                  control={form.control}
                  name='enabled'
                  render={({ field }) => (
                    <FormItem className='flex items-center justify-between gap-4'>
                      <div className='space-y-0.5'>
                        <FormLabel>{t('Enabled')}</FormLabel>
                        <FormDescription>
                          {t(
                            'A disabled member keeps the account and history but can no longer consume the pool.'
                          )}
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              )}
            </SideDrawerSection>
          </form>
        </Form>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose render={<Button variant='outline' />}>
            {t('Close')}
          </SheetClose>
          <Button form='org-member-form' type='submit' disabled={isSubmitting}>
            {isSubmitting ? t('Saving...') : t('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
