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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import {
  SideDrawerSection,
  SideDrawerSectionHeader,
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
  ORG_NOTIFY_TARGET_PLACEHOLDERS,
  ORG_VALIDATION,
  getOrgNotifyTypeOptions,
  type OrgNotifyType,
} from '@/features/organization/constants'
import type { Organization } from '@/features/organization/types'
import { getGroups } from '@/features/users/api'
import { parseQuotaFromDollars, quotaUnitsToDollars } from '@/lib/format'

import {
  createAdminOrganization,
  updateAdminOrganization,
  type AdminCreateOrganizationPayload,
  type AdminUpdateOrganizationPayload,
} from '../api'
import {
  ORG_ADMIN_ERROR_MESSAGES,
  ORG_ADMIN_SUCCESS_MESSAGES,
} from '../constants'

/**
 * Quota-shaped fields (initial pool, alert thresholds) are entered in the
 * configured display currency and converted with `parseQuotaFromDollars`,
 * matching `features/users`. `0` disables an alert.
 */
const organizationFormSchema = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .min(ORG_VALIDATION.NAME_MIN_LENGTH)
    .max(ORG_VALIDATION.NAME_MAX_LENGTH)
    .regex(ORG_VALIDATION.NAME_PATTERN),
  display_name: z.string().trim().max(ORG_VALIDATION.DISPLAY_NAME_MAX_LENGTH),
  group: z.string().trim().min(1),
  owner_username: z.string().trim(),
  quota_amount: z.number().min(0),
  warning_threshold: z.number().min(0),
  daily_usage_alert: z.number().min(0),
  notify_type: z.string(),
  notify_target: z.string().trim().max(ORG_VALIDATION.NOTIFY_TARGET_MAX_LENGTH),
  cache_enabled: z.boolean(),
  cache_ttl: z.number().int().min(1).max(ORG_VALIDATION.CACHE_TTL_MAX),
  allow_wallet_fallback: z.boolean(),
  hide_pool_quota: z.boolean(),
})

type OrganizationFormInput = z.input<typeof organizationFormSchema>
type OrganizationFormValues = z.output<typeof organizationFormSchema>

const EMPTY_DEFAULTS: OrganizationFormInput = {
  name: '',
  display_name: '',
  group: 'default',
  owner_username: '',
  quota_amount: 0,
  warning_threshold: 0,
  daily_usage_alert: 0,
  notify_type: '',
  notify_target: '',
  cache_enabled: false,
  cache_ttl: ORG_VALIDATION.CACHE_TTL_DEFAULT,
  allow_wallet_fallback: false,
  hide_pool_quota: false,
}

type Props = {
  open: boolean
  /** Null means "create". */
  organization: Organization | null
  onOpenChange: (open: boolean) => void
}

export function OrganizationMutateDrawer({
  open,
  organization,
  onOpenChange,
}: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isEdit = organization !== null

  const notifyTypeOptions = useMemo(() => getOrgNotifyTypeOptions(t), [t])

  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: getGroups,
    staleTime: 5 * 60 * 1000,
  })
  const groups = groupsData?.data ?? []
  // A primitive, so the reset effect below can depend on it without the
  // freshly-allocated `groups` array retriggering it on every render.
  const defaultGroup = groupsData?.data?.[0] ?? EMPTY_DEFAULTS.group

  const form = useForm<OrganizationFormInput, unknown, OrganizationFormValues>({
    resolver: zodResolver(organizationFormSchema),
    defaultValues: EMPTY_DEFAULTS,
  })

  useEffect(() => {
    if (!open) return
    if (!organization) {
      form.reset({
        ...EMPTY_DEFAULTS,
        group: defaultGroup,
      })
      return
    }
    form.reset({
      ...EMPTY_DEFAULTS,
      name: organization.name,
      display_name: organization.display_name,
      group: organization.group || EMPTY_DEFAULTS.group,
      warning_threshold:
        organization.warning_threshold > 0
          ? quotaUnitsToDollars(organization.warning_threshold)
          : 0,
      daily_usage_alert:
        organization.daily_usage_alert > 0
          ? quotaUnitsToDollars(organization.daily_usage_alert)
          : 0,
      notify_type: organization.notify_type ?? '',
      notify_target: organization.notify_target ?? '',
      cache_enabled: organization.cache_enabled,
      cache_ttl:
        organization.cache_ttl > 0
          ? organization.cache_ttl
          : ORG_VALIDATION.CACHE_TTL_DEFAULT,
      allow_wallet_fallback: organization.allow_wallet_fallback,
      hide_pool_quota: organization.hide_pool_quota,
    })
  }, [open, organization, defaultGroup, form])

  const notifyType = form.watch('notify_type') as OrgNotifyType
  const targetPlaceholder =
    ORG_NOTIFY_TARGET_PLACEHOLDERS[notifyType] ??
    ORG_NOTIFY_TARGET_PLACEHOLDERS['']
  const cacheEnabled = form.watch('cache_enabled')

  const onSubmit = async (values: OrganizationFormValues) => {
    setIsSubmitting(true)
    try {
      const shared = {
        display_name: values.display_name || undefined,
        group: values.group,
        warning_threshold: parseQuotaFromDollars(values.warning_threshold),
        daily_usage_alert: parseQuotaFromDollars(values.daily_usage_alert),
        notify_type: values.notify_type,
        notify_target: values.notify_target,
        cache_enabled: values.cache_enabled,
        cache_ttl: values.cache_ttl,
        allow_wallet_fallback: values.allow_wallet_fallback,
        hide_pool_quota: values.hide_pool_quota,
      }
      const result = isEdit
        ? await updateAdminOrganization(
            organization.id,
            shared satisfies AdminUpdateOrganizationPayload
          )
        : await createAdminOrganization({
            ...shared,
            name: values.name,
            quota: parseQuotaFromDollars(values.quota_amount),
            owner_username: values.owner_username || undefined,
          } satisfies AdminCreateOrganizationPayload)

      if (!result.success) {
        toast.error(
          result.message ||
            t(
              isEdit
                ? ORG_ADMIN_ERROR_MESSAGES.UPDATE_FAILED
                : ORG_ADMIN_ERROR_MESSAGES.CREATE_FAILED
            )
        )
        return
      }
      toast.success(
        t(
          isEdit
            ? ORG_ADMIN_SUCCESS_MESSAGES.UPDATED
            : ORG_ADMIN_SUCCESS_MESSAGES.CREATED
        )
      )
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: ['admin-organizations'] })
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
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[600px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>
            {isEdit ? t('Edit Organization') : t('Create Organization')}
          </SheetTitle>
          <SheetDescription>
            {isEdit
              ? t(
                  'Changing the group also moves every member account to the new group so billing ratios stay consistent.'
                )
              : t(
                  'An organization owns one shared quota pool. Optionally appoint an existing user as its admin and fund the pool now.'
                )}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            id='admin-organization-form'
            onSubmit={handleSubmit}
            className={sideDrawerFormClassName()}
          >
            <SideDrawerSection>
              <SideDrawerSectionHeader title={t('Basic Info')} />
              <FormField
                control={form.control}
                name='name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Organization Name')}</FormLabel>
                    <FormControl>
                      {isEdit ? (
                        <Input value={organization.name} disabled />
                      ) : (
                        <Input
                          {...field}
                          autoComplete='off'
                          placeholder='acme-team'
                        />
                      )}
                    </FormControl>
                    {!isEdit ? (
                      <FormDescription>
                        {t(
                          '{{min}}-{{max}} lowercase letters, digits, hyphens or underscores. Fixed after creation.',
                          {
                            min: ORG_VALIDATION.NAME_MIN_LENGTH,
                            max: ORG_VALIDATION.NAME_MAX_LENGTH,
                          }
                        )}
                      </FormDescription>
                    ) : null}
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
                      {t('Defaults to the organization name when left empty')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='group'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Group')}</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(value) => field.onChange(value ?? '')}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t('Select a group')} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent alignItemWithTrigger={false}>
                        {groups.map((group) => (
                          <SelectItem key={group} value={group}>
                            {group}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {t('The group decides billing ratios for every member.')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SideDrawerSection>

            {!isEdit ? (
              <SideDrawerSection>
                <SideDrawerSectionHeader title={t('Initial Setup')} />
                <FormField
                  control={form.control}
                  name='owner_username'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Organization Admin Username')}</FormLabel>
                      <FormControl>
                        <Input {...field} autoComplete='off' />
                      </FormControl>
                      <FormDescription>
                        {t(
                          'An existing user who will manage this organization. Leave empty to appoint nobody.'
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
                      <FormLabel>{t('Initial Pool Quota')}</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min={0}
                          step='any'
                          value={
                            Number.isFinite(field.value) ? field.value : ''
                          }
                          onChange={(event) =>
                            field.onChange(event.target.valueAsNumber || 0)
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SideDrawerSection>
            ) : null}

            <SideDrawerSection>
              <SideDrawerSectionHeader title={t('Quota Alerts')} />
              <FormField
                control={form.control}
                name='warning_threshold'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Pool Balance Alert Threshold')}</FormLabel>
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
                      {t(
                        'Notify when the pool balance drops below this amount. 0 disables the alert.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='daily_usage_alert'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Daily Usage Alert Threshold')}</FormLabel>
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
                      {t(
                        "Notify when today's organization usage exceeds this amount. 0 disables the alert."
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='notify_type'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Notification Channel')}</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(value) => field.onChange(value ?? '')}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent alignItemWithTrigger={false}>
                        {notifyTypeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='notify_target'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Notification Target')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t(targetPlaceholder)} />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'Leave empty to notify every organization admin through their own account settings.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SideDrawerSection>

            <SideDrawerSection>
              <SideDrawerSectionHeader title={t('Response Cache')} />
              <FormField
                control={form.control}
                name='cache_enabled'
                render={({ field }) => (
                  <FormItem className='flex flex-row items-center justify-between gap-4 rounded-lg border p-3'>
                    <div className='space-y-0.5'>
                      <FormLabel>{t('Enable Response Cache')}</FormLabel>
                      <FormDescription>
                        {t(
                          'Requires Redis. Identical text-only requests replay the stored response and are billed at zero quota.'
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
              {cacheEnabled ? (
                <FormField
                  control={form.control}
                  name='cache_ttl'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Cache TTL (seconds)')}</FormLabel>
                      <FormControl>
                        <Input
                          type='number'
                          min={1}
                          max={ORG_VALIDATION.CACHE_TTL_MAX}
                          value={
                            Number.isFinite(field.value) ? field.value : ''
                          }
                          onChange={(event) =>
                            field.onChange(event.target.valueAsNumber || 0)
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {t('Maximum {{max}} seconds', {
                          max: ORG_VALIDATION.CACHE_TTL_MAX,
                        })}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}
            </SideDrawerSection>

            <SideDrawerSection>
              <SideDrawerSectionHeader
                title={t('Pool Visibility & Fallback')}
              />
              <FormField
                control={form.control}
                name='hide_pool_quota'
                render={({ field }) => (
                  <FormItem className='flex flex-row items-center justify-between gap-4 rounded-lg border p-3'>
                    <div className='space-y-0.5'>
                      <FormLabel>
                        {t('Hide Pool Balance From Members')}
                      </FormLabel>
                      <FormDescription>
                        {t(
                          'Members still see their own sub-quota, but not the shared pool balance.'
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
              <FormField
                control={form.control}
                name='allow_wallet_fallback'
                render={({ field }) => (
                  <FormItem className='flex flex-row items-center justify-between gap-4 rounded-lg border p-3'>
                    <div className='space-y-0.5'>
                      <FormLabel>{t('Fall Back To Personal Wallet')}</FormLabel>
                      <FormDescription>
                        {t(
                          "When the pool cannot cover a request, charge the member's personal balance instead of failing it."
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
            </SideDrawerSection>
          </form>
        </Form>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose
            render={<Button variant='outline' disabled={isSubmitting} />}
          >
            {t('Cancel')}
          </SheetClose>
          <Button
            form='admin-organization-form'
            type='submit'
            disabled={isSubmitting}
          >
            {isSubmitting ? <Loader2 className='size-4 animate-spin' /> : null}
            {isEdit ? t('Save') : t('Create')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
